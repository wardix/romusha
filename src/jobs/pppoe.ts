import { JSONCodec, type NatsConnection } from 'nats'
import { Client } from 'ssh2'
import {
  PPPOE_FETHED_EVENT_SUBJECT,
  PPPOE_SERVERS,
  PPPOE_SERVERS_PRIVATE_KEY,
} from '../config'

type NetworkInterface = {
  network: string
  iface: string
}

type NatsMessage = {
  timestamp: number
  servers: Record<string, NetworkInterface[]>
}

function parseNetworkInterface(
  networkInterfacesString: string,
): NetworkInterface[] {
  const results: NetworkInterface[] = []
  const lines = networkInterfacesString.trim().split('\n').slice(3)
  for (const line of lines) {
    if (!line.trim()) continue
    const match = line
      .trim()
      .match(/\s*\d+\s+(?:D\s+)?[\d.]+\/\d+\s+([\d.]+)\s+(<pppoe-[^>]+>)/)
    if (match) {
      results.push({
        network: match[1],
        iface: match[2],
      })
    }
  }
  return results
}

async function sshExec(
  host: string,
  port: number,
  username: string,
  privateKey: Buffer,
  command: string,
) {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    const output: string[] = []
    conn
      .on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) return reject(err)
          stream
            .on('data', (data: Buffer) => output.push(data.toString()))
            .on('close', () => {
              conn.end()
              resolve(output.join('').trim())
            })
            .stderr.on('data', (data: Buffer) =>
              console.error('ERR:', data.toString()),
            )
        })
      })
      .on('error', reject)
      .connect({ host, port, username, privateKey })
  })
}

export async function collectAndPublishPPPoEData(natsConn: NatsConnection) {
  const servers = JSON.parse(PPPOE_SERVERS)
  const privateKeyBuffer = Buffer.from(PPPOE_SERVERS_PRIVATE_KEY)
  const message: NatsMessage = {
    timestamp: Date.now(),
    servers: {},
  }
  for (const { name, host, port, username } of servers) {
    const result = (await sshExec(
      host,
      port,
      username,
      privateKeyBuffer,
      '/ip address print where interface ~"<pppoe-"',
    )) as string
    const interfaces = parseNetworkInterface(result)
    message.servers[name] = interfaces
    console.log(name)
  }
  const jc = JSONCodec()
  natsConn.publish(PPPOE_FETHED_EVENT_SUBJECT, jc.encode(message))
}
