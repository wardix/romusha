import { pool as db } from './nis.mysql'
import { createConnection } from 'mysql2/promise'
import { Client } from 'pg'
import { batchArray } from './array'
import { isValidDateFormat } from './date'
import {
  ZABBIX_PSQL_DB,
  ZABBIX_PSQL_HOST,
  ZABBIX_PSQL_PASSWORD,
  ZABBIX_PSQL_USER,
  ZBX_MYSQL_DB,
  ZBX_MYSQL_HOST,
  ZBX_MYSQL_PASSWORD,
  ZBX_MYSQL_PORT,
  ZBX_MYSQL_USER,
} from './config'

interface GraphMapEntry {
  gid: string
  acc: string
}

interface GraphMap {
  [csid: number]: GraphMapEntry
}

function isDominantColor(hexColor: string): 'blue' | 'green' | 'unknown' {
  // Remove '#' if present
  const hex = hexColor.startsWith('#') ? hexColor.slice(1) : hexColor

  // Parse the hex code into RGB components
  const red = parseInt(hex.slice(0, 2), 16)
  const green = parseInt(hex.slice(2, 4), 16)
  const blue = parseInt(hex.slice(4, 6), 16)

  // Compare blue and green values
  if (blue > green && blue > red) {
    return 'blue'
  } else if (green > blue && green > red) {
    return 'green'
  } else {
    return 'unknown' // Either red is dominant or there's a tie
  }
}

export async function syncZabbixData(date: string = 'yesterday') {
  const zabbixGraphPrefix = 'n'
  const zbxDb = await createConnection({
    host: ZBX_MYSQL_HOST,
    user: ZBX_MYSQL_USER,
    password: ZBX_MYSQL_PASSWORD,
    database: ZBX_MYSQL_DB,
    port: Number(ZBX_MYSQL_PORT),
  })
  const zabbixDb = new Client({
    host: ZABBIX_PSQL_HOST,
    user: ZABBIX_PSQL_USER,
    password: ZABBIX_PSQL_PASSWORD,
    database: ZABBIX_PSQL_DB,
  })

  await zabbixDb.connect()

  const query = `
    SELECT TRIM(cszg.GraphId) gid, cs.CustServId csid, cs.CustAccName acc
    FROM CustomerServicesZabbixGraph cszg
    LEFT JOIN CustomerServices cs ON cszg.CustServId = cs.CustServId
    LEFT JOIN Customer c ON cs.CustId = c.CustId
    WHERE cs.CustStatus NOT IN ('NA')
    AND c.BranchId = '020' 
    AND NOT (TRIM(cszg.GraphId) LIKE 's%')
    ORDER BY cs.CustServId, cszg.OrderNo, cszg.Id
  `

  const graphMap: GraphMap = {}

  const [rows] = await db.execute(query)
  for (const row of rows as any[]) {
    const { gid, csid, acc } = row
    if (csid in graphMap) {
      continue
    }
    graphMap[csid] = { gid, acc }
  }

  const csMap: any = {}
  const zabbixGids: number[] = []
  const zbxGids: number[] = []

  for (const csid in graphMap) {
    const { gid, acc } = graphMap[csid]
    if (gid.startsWith('m') || gid.startsWith('b') || gid.startsWith('j')) {
      const realGid = gid.substring(1).trim()
      const safeGraphid = `${zabbixGraphPrefix}${realGid}`
      zabbixGids.push(Number(realGid))
      csMap[`${safeGraphid}`] = { csid, acc }
    } else {
      zbxGids.push(Number(gid))
      csMap[gid] = { csid, acc }
    }
  }

  let startDate

  if (isValidDateFormat(date)) {
    startDate = new Date(date)
  } else {
    startDate = new Date()
    startDate.setDate(startDate.getDate() - 1) // yesterday
    startDate.setHours(0, 0, 0, 0)
  }
  const startTimestamp = Math.floor(startDate.getTime() / 1000)

  const yyyy = startDate.getFullYear()
  const mm = String(startDate.getMonth() + 1).padStart(2, '0')
  const dd = String(startDate.getDate()).padStart(2, '0')
  const formattedStartDate = `${yyyy}-${mm}-${dd}`

  const batchSize = 64
  const zbxGidsChunks = batchArray(zbxGids, batchSize)
  const trafficRecord: any = {}
  for (const chunk of zbxGidsChunks) {
    const sql = `
    SELECT
        gi.graphid,
        gi.color,
        (SUM(tu.value_avg) * 3600) AS volume
    FROM
        graphs_items gi
    LEFT JOIN
        trends_uint tu ON gi.itemid = tu.itemid
    WHERE
        gi.graphid IN (${Array(chunk.length).fill('?').join(',')})
        AND tu.clock >= ?
        AND tu.clock < ?
    GROUP BY gi.graphid, gi.color
  `
    const [rows] = await zbxDb.execute(sql, [
      ...chunk,
      ...[startTimestamp, startTimestamp + 86400],
    ])
    for (const { graphid, color, volume } of rows as any) {
      if (!(`${graphid}` in trafficRecord)) {
        trafficRecord[`${graphid}`] = {
          upload: 0,
          download: 0,
          csid: csMap[`${graphid}`].csid,
          acc: csMap[`${graphid}`].acc,
        }
      }
      if (isDominantColor(color) === 'green') {
        trafficRecord[`${graphid}`].download = volume
      } else if (isDominantColor(color) === 'blue') {
        trafficRecord[`${graphid}`].upload = volume
      }
    }
  }

  const zabbixGidsChunks = batchArray(zabbixGids, batchSize)
  for (const chunk of zabbixGidsChunks) {
    let paramIndex = 1
    const placeholders = chunk.map(() => `$${paramIndex++}`).join(',')
    const sql = `
    SELECT
        gi.graphid,
        gi.color,
        (SUM(tu.value_avg) * 3600) AS volume
    FROM
        graphs_items gi
    LEFT JOIN
        trends_uint tu ON gi.itemid = tu.itemid
    WHERE
        gi.graphid IN (${placeholders})
        AND tu.clock >= $${paramIndex++}
        AND tu.clock < $${paramIndex++}
    GROUP BY gi.graphid, gi.color
  `
    const result = await zabbixDb.query(sql, [
      ...chunk,
      ...[startTimestamp, startTimestamp + 86400],
    ])
    for (const { graphid, color, volume } of result.rows as any) {
      const safeGraphid = `${zabbixGraphPrefix}${graphid}`
      if (!(`${safeGraphid}` in trafficRecord)) {
        trafficRecord[`${safeGraphid}`] = {
          upload: 0,
          download: 0,
          csid: csMap[`${safeGraphid}`].csid,
          acc: csMap[`${safeGraphid}`].acc,
        }
      }
      if (isDominantColor(color) === 'green') {
        trafficRecord[`${safeGraphid}`].download = volume
      } else if (isDominantColor(color) === 'blue') {
        trafficRecord[`${safeGraphid}`].upload = volume
      }
    }
  }

  for (const graphid in trafficRecord) {
    const { upload, download, csid, acc } = trafficRecord[graphid]
    const sql = `
    REPLACE INTO traff_data
    SET accountName = '${acc}',
        csid = ${csid},
        date = '${formattedStartDate}',
        total = ${Number(upload) + Number(download)} / 8,
        download = ${download} / 8,
        upload = ${upload} / 8
    `
    await db.execute(sql)
  }

  await zbxDb.end()
  await zabbixDb.end()
}
