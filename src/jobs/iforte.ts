import { pool } from '../nis.mysql'
import { zbxLogin, zbxRpc } from '../zabbix'
import { batchArray } from '../array'
import {
  IFORTE_ZABBIX_API_URL,
  IFORTE_ZABBIX_PASSWORD,
  IFORTE_ZABBIX_USERNAME,
} from '../config'

async function getSubscriberGraphs() {
  const token = await zbxLogin(
    IFORTE_ZABBIX_API_URL,
    IFORTE_ZABBIX_USERNAME,
    IFORTE_ZABBIX_PASSWORD,
  )
  const graphs = await zbxRpc(
    IFORTE_ZABBIX_API_URL,
    'graph.get',
    {
      output: ['graphid', 'name'],
      search: { name: 'NUSANET-' },
      startSearch: true,
      sortfield: 'graphid',
      sortOrder: 'ASC',
      limit: 10000,
    },
    token,
  )
  const ret: Record<string, { cid: string; graphId: number }> = {}
  const re = /^NUSANET-(\d+):(\d+)-/
  for (const { name, graphid } of graphs) {
    const match = re.exec(name)
    if (!match) continue
    const cid = match[1]
    const sid = Number(match[2])
    ret[String(sid)] = { cid, graphId: graphid }
  }
  return ret
}

export async function syncZabbixSubscriberGraphs() {
  const graphs = await getSubscriberGraphs()
  const graphPrefix = 's'
  const graphIds = Object.values(graphs).map(
    ({ graphId }) => `${graphPrefix}${graphId}`,
  )
  const skippedGraphIds: string[] = []
  if (graphIds.length > 0) {
    for (const part of batchArray(graphIds, 64)) {
      const holder = part.map(() => '?').join(',')
      const sql = [
        'SELECT TRIM(GraphId) AS graphId',
        'FROM CustomerServicesZabbixGraph',
        `WHERE TRIM(GraphId) IN (${holder})`,
      ].join(' ')
      try {
        const [rows] = (await pool.execute(sql, part)) as any
        for (const { graphId } of rows) skippedGraphIds.push(graphId)
      } catch (error: any) {
        console.error(error)
      }
    }
  }

  const sql = [
    'INSERT INTO CustomerServicesZabbixGraph',
    'SET CustServId = ?,',
    'GraphId = ?,',
    'Title = "Traffic",',
    'UpdatedTime = NOW(),',
    'UpdatedBy = "0200306"',
  ].join(' ')

  for (const csid in graphs) {
    const { graphId } = graphs[csid]
    const prefixedGraphId = `${graphPrefix}${graphId}`
    if (skippedGraphIds.includes(prefixedGraphId)) continue
    await pool.execute(sql, [Number(csid), prefixedGraphId])
  }
}
