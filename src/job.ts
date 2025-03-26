import { type JsMsg, type NatsConnection } from 'nats'
import { generateEmployeeChart } from './employee.job'
import logger from './logger'
import { sendEmployeeOnDutyNotif } from './nusawork.job'
import { syncFttxMonitor } from './fttx.job'
import { notifyKarmaAlerts } from './alert.job'
import { collectAndPublishPPPoEData } from './pppoe.job'
import { syncZabbixData } from './zabbix.job'
import { muteOrphanAlert } from './mute-orphan-alert.job'

export async function processJob(message: JsMsg, nc: NatsConnection) {
  const subjectParts = message.subject.split('.')
  const jobName = subjectParts[2]
  logger.info(`executing job: ${jobName}`)

  switch (jobName) {
    case 'generateEmployeeChart':
      generateEmployeeChart()
      break
    case 'sendEmployeeOnDutyNotif':
      sendEmployeeOnDutyNotif()
      break
    case 'syncFttxMonitor':
      syncFttxMonitor()
      break
    case 'notifyKarmaAlerts':
      notifyKarmaAlerts()
      break
    case 'collectAndPublishPPPoEData':
      collectAndPublishPPPoEData(nc)
      break
    case 'syncZabbixData':
      const date = subjectParts[3]
      syncZabbixData(date)
      break
    case 'muteOrphanAlert':
      muteOrphanAlert()
      break

    default:
      logger.warn(`Unknown job: ${jobName}`)
  }
  message.ack()
}
