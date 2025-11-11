import fs from 'fs'
import path from 'path'
import type { RowDataPacket } from 'mysql2'
import { dbaIs5, zabbixMysqlPool } from './nis.mysql'
import {
  overSpeedBlockedSubscriberMetricFilePath,
  overSpeedBlockedSubscriberMetricName,
  overSpeedBlockedSubscriberThreshold,
} from './config'

// Types
interface Subscriber {
  csid: number
  acc: string
}

interface SubscriberGraphMap {
  [graphId: string]: Subscriber[]
}

interface GraphItemRow extends RowDataPacket {
  graphId: number
  itemId: number
}

interface OverSpeedItemRow extends RowDataPacket {
  itemId: number
}

interface BlockedSubscriberRow extends RowDataPacket {
  acc: string
  csid: number
  graphId: number
}

// Constants
const FOUR_HOURS_IN_SECONDS = 14400
const BLOCKED_STATUS = 'BL'
const BRANCH_ID = '020'


/**
 * Generate metrics for blocked subscribers with over-speed traffic
 * @returns Promise<void>
 */
export async function generateOverSpeedBlockedSubscriberMetrics(): Promise<void> {
  const subscribersGraphMap = await fetchBlockedSubscriberGraphs()
  const graphIds = Object.keys(subscribersGraphMap)
    .map(Number)
    .filter((id) => !isNaN(id))

  if (graphIds.length === 0) {
    writeMetricsFile([], overSpeedBlockedSubscriberMetricFilePath)
    return
  }

  const overSpeedGraphIds = await findOverSpeedGraphs(
    graphIds,
    Number(overSpeedBlockedSubscriberThreshold),
  )

  // Collect unique subscribers from over-speed graphs
  const overSpeedSubscribersMap = new Map<number, Subscriber>()

  for (const graphId of overSpeedGraphIds) {
    const subscribers = subscribersGraphMap[String(graphId)]
    if (!subscribers) continue

    for (const subscriber of subscribers) {
      if (!overSpeedSubscribersMap.has(subscriber.csid)) {
        overSpeedSubscribersMap.set(subscriber.csid, subscriber)
      }
    }
  }

  const overSpeedSubscribers = Array.from(overSpeedSubscribersMap.values())
  const metrics = generatePrometheusMetrics(
    overSpeedSubscribers,
    overSpeedBlockedSubscriberMetricName,
  )

  writeMetricsFile(metrics, overSpeedBlockedSubscriberMetricFilePath)
}

/**
 * Fetch all blocked subscribers with their Zabbix graph mappings from NIS database
 * @returns Promise<SubscriberGraphMap> - Map of graphId to array of subscribers
 */
async function fetchBlockedSubscriberGraphs(): Promise<SubscriberGraphMap> {
  const sql = `
    SELECT 
      cs.CustAccName AS acc,
      cs.CustServId AS csid,
      cszg.GraphId AS graphId
    FROM CustomerServicesZabbixGraph cszg
    LEFT JOIN CustomerServices cs ON cszg.CustServId = cs.CustServId
    LEFT JOIN Customer c ON c.CustId = cs.CustId
    WHERE cs.CustStatus = ? AND c.BranchId = ?
    ORDER BY cs.CustServId, cszg.Id
  `

  const [rows] = await dbaIs5.execute<BlockedSubscriberRow[]>(sql, [
    BLOCKED_STATUS,
    BRANCH_ID,
  ])

  const subscribersGraphMap: SubscriberGraphMap = {}

  for (const { acc, csid, graphId } of rows) {
    const key = String(graphId)
    if (!subscribersGraphMap[key]) {
      subscribersGraphMap[key] = []
    }
    subscribersGraphMap[key].push({ csid, acc })
  }

  return subscribersGraphMap
}

/**
 * Find graphs that have traffic exceeding the speed threshold in last 4 hours
 * 
 * @param graphIds - Array of graph IDs to check
 * @param speedThreshold - Speed threshold value to compare against
 * @returns Promise<number[]> - Array of graph IDs that exceeded the threshold
 */
async function findOverSpeedGraphs(
  graphIds: number[],
  speedThreshold: number,
): Promise<number[]> {
  if (graphIds.length === 0) {
    return []
  }

  // Get all items associated with the graphs
  const graphItemsQuery = `
    SELECT graphid AS graphId, itemid AS itemId 
    FROM graphs_items
    WHERE graphid IN (?)
  `
  const [graphItemRows] = await zabbixMysqlPool.execute<GraphItemRow[]>(
    graphItemsQuery,
    [graphIds],
  )

  // Build mapping: itemId -> graphIds[]
  const itemToGraphsMap = new Map<number, number[]>()
  const itemIds: number[] = []

  for (const { graphId, itemId } of graphItemRows) {
    if (!itemToGraphsMap.has(itemId)) {
      itemToGraphsMap.set(itemId, [])
      itemIds.push(itemId)
    }
    itemToGraphsMap.get(itemId)!.push(graphId)
  }

  if (itemIds.length === 0) {
    return []
  }

  // Find items with traffic exceeding threshold in last 4 hours
  const now = Math.floor(Date.now() / 1000)
  const startPeriod = now - FOUR_HOURS_IN_SECONDS

  const overSpeedQuery = `
    SELECT DISTINCT itemid AS itemId 
    FROM history_uint
    WHERE clock > ? 
      AND value > ?
      AND itemid IN (?)
  `
  const [overSpeedRows] = await zabbixMysqlPool.execute<OverSpeedItemRow[]>(
    overSpeedQuery,
    [startPeriod, speedThreshold, itemIds],
  )

  // Collect all unique graph IDs that are over speed
  const overSpeedGraphs = new Set<number>()
  for (const { itemId } of overSpeedRows) {
    const graphs = itemToGraphsMap.get(itemId)
    if (graphs) {
      graphs.forEach((graphId) => overSpeedGraphs.add(graphId))
    }
  }

  return Array.from(overSpeedGraphs)
}

/**
 * Write metrics to file atomically using temp file and rename strategy
 * 
 * @param metrics - Array of metric strings in Prometheus format
 * @param filePath - Destination file path for the metrics
 * @returns void
 */
function writeMetricsFile(metrics: string[], filePath: string): void {
  const metricDirectoryPath = path.dirname(filePath)
  const tempDirectoryPath = fs.mkdtempSync(
    path.join(metricDirectoryPath, 'temp-'),
  )
  const tempFilePath = path.join(tempDirectoryPath, 'metrics.prom')

  fs.writeFileSync(tempFilePath, metrics.join('\n'))
  fs.renameSync(tempFilePath, filePath)

  // Cleanup temp directory - wrapped in try-catch only for cleanup
  try {
    fs.rmdirSync(tempDirectoryPath)
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Generate Prometheus metric lines from subscribers
 * 
 * @param subscribers - Array of subscriber objects with csid and acc
 * @param metricName - Base metric name for Prometheus format
 * @returns string[] - Array of Prometheus metric strings
 */
function generatePrometheusMetrics(
  subscribers: Subscriber[],
  metricName: string,
): string[] {
  return subscribers.map(
    ({ csid, acc }) => `${metricName}{csid="${csid}",acc="${acc}"} 1`,
  )
}
