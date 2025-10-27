import { batchArray } from './array'

type JsonRpcResult<T> = {
  result: T
  error?: { code: number; message: string; data?: string }
}

type GraphItem = {
  graphid: string
  itemid: string
  sortorder: string
}

type ItemTrend = {
  itemid: string
  clock: string
  value_avg: string
}

let zbxId = 1

export async function zbxRpc<T = any>(
  url: string,
  method: string,
  params: any,
  auth: string = '',
): Promise<T> {
  const payload: any = {
    jsonrpc: '2.0',
    method,
    params,
    id: zbxId++,
  }
  const headers: any = {
    'Content-Type': 'application/json',
  }

  if (auth) {
    headers.Authorization = `Bearer ${auth}`
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!res.ok)
    throw new Error(`Zabbix API HTTP ${res.status}: ${await res.text()}`)

  const data: JsonRpcResult<T> = await res.json()
  if ((data as any).error) {
    const e = (data as any).error
    throw new Error(
      `Zabbix API error ${e.code}: ${e.message} ${e.data ? '- ' + e.data : ''}`,
    )
  }
  return (data as any).result
}

export async function zbxLogin(
  url: string,
  username: string,
  password: string,
): Promise<string> {
  try {
    const token = await zbxRpc<string>(url, 'user.login', {
      username,
      password,
    })
    return token
  } catch (error) {
    return ''
  }
}

export async function zbxGetGraphItems(
  url: string,
  graphIds: number[],
  auth: string,
) {
  const batches = batchArray(graphIds, 64)
  const returnData: GraphItem[] = []
  for (const batch of batches) {
    const graphItems = await zbxRpc<GraphItem[]>(
      url,
      'graphitem.get',
      {
        output: 'extend',
        graphids: batch,
      },
      auth,
    )
    returnData.push(...graphItems)
  }
  return returnData
}

export async function zbxGetTrends(
  url: string,
  itemIds: number[],
  startTimestamp: number,
  endTimestamp: number,
  auth: string,
) {
  const batches = batchArray(itemIds, 64)
  const returnData: ItemTrend[] = []
  for (const batch of batches) {
    const itemTrends = await zbxRpc<ItemTrend[]>(
      url,
      'trend.get',
      {
        output: 'extend',
        itemids: batch,
        time_from: Math.floor(startTimestamp),
        time_till: Math.floor(endTimestamp),
      },
      auth,
    )
    returnData.push(...itemTrends)
  }
  return returnData
}
