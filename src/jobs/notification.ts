import { sendText as sendWhatsappText } from '../waenq'
import { getAllEmployee } from '../nusawork'
import {
  getCustomerTransactionItem,
  getItemInvoiceDetail,
  getItemNameBySerial,
  getLatestItemTransaction,
  getSerialTransactionHistory,
} from '../nis'

import axios from 'axios'
import {
  BIRTHDAY_VOUCHER_PIC_PHONES,
  EXTRACT_SERIAL_URL,
  EXTRACT_SERIAL_API_KEY,
  EXTRACT_MAC_URL,
  EXTRACT_MAC_API_KEY,
} from '../config'

const mmddFormatter = Intl.DateTimeFormat('en-CA', {
  month: '2-digit',
  day: '2-digit',
})

function getUpcomingDates(numDays: number) {
  const formattedDates = []
  const date = new Date()
  for (let i = 0; i < numDays; i++) {
    date.setDate(date.getDate() + 1)
    formattedDates.push(mmddFormatter.format(date))
  }
  return formattedDates
}

function getUpcomingBirthdays(employees: any, numDays = 7) {
  const upcomingDates = getUpcomingDates(numDays)
  return employees.filter((employee: any) => {
    const birthDate = new Date(`${employee.date_of_birth}T00:00:00`)
    return upcomingDates.some(
      (date) => date === mmddFormatter.format(birthDate),
    )
  })
}

export async function notifyUpcomingBirthdays() {
  const employees = await getAllEmployee()
  const upcomingBirthdays = getUpcomingBirthdays(employees)

  if (upcomingBirthdays.length === 0) return

  const now = new Date()
  const currentYear = now.getFullYear()
  const notifMessages: string[] = ['Upcoming Birthdays:']

  upcomingBirthdays.sort((a: any, b: any) => {
    let aBirthday = new Date(a.date_of_birth)
    let bBirthday = new Date(b.date_of_birth)
    aBirthday.setFullYear(currentYear)
    bBirthday.setFullYear(currentYear)

    if (aBirthday < now) {
      aBirthday.setFullYear(currentYear + 1)
    }
    if (bBirthday < now) {
      bBirthday.setFullYear(currentYear + 1)
    }

    return aBirthday.getTime() - bBirthday.getTime()
  })

  upcomingBirthdays.forEach((employee: any) => {
    notifMessages.push(
      `${employee.date_of_birth.substring(5)} ${employee.full_name}`,
    )
  })

  BIRTHDAY_VOUCHER_PIC_PHONES.forEach(async (phone: string) => {
    await sendWhatsappText(phone, notifMessages.join('\n'))
  })
}

export async function notifyCustomerBorrowedItems(
  customerId: string,
  jid: string,
) {
  const items = (await getCustomerTransactionItem(customerId)) as {
    serial: string
    description: string
  }[]
  const skippedInvoice = new Set<string>()
  const processedInvoice = new Map<string, string>()
  const borrowedItems = new Map<string, string[]>()
  for (const { serial, description } of items) {
    const { type, typeObjectId } = await getLatestItemTransaction(serial)
    if (!type) continue
    if (type !== 'invoice') continue
    if (skippedInvoice.has(typeObjectId as string)) continue
    if (processedInvoice.has(typeObjectId as string)) {
      const subscriber = processedInvoice.get(typeObjectId as string) as string
      const itemSet = borrowedItems.get(subscriber as string) as string[]
      itemSet.push(`${serial} ${description}`)
      borrowedItems.set(subscriber, itemSet)
      continue
    }

    const { customerId: invoiceCustomerId, subscriber } =
      await getItemInvoiceDetail(typeObjectId)
    if (customerId !== invoiceCustomerId) {
      skippedInvoice.add(typeObjectId)
      continue
    }

    processedInvoice.set(typeObjectId, subscriber)
    const itemSet = borrowedItems.has(subscriber)
      ? (borrowedItems.get(subscriber as string) as string[])
      : []
    itemSet.push(`${serial} - ${description}`)
    borrowedItems.set(subscriber, itemSet)
  }
  let messageLines: string[] = []
  for (const [subscriber, items] of borrowedItems) {
    messageLines.push(`\n${subscriber}:`)
    for (const item of items) {
      messageLines.push(`  ${item}`)
    }
  }
  const message =
    messageLines.length == 0 ? 'no data found' : messageLines.join('\n').trim()
  await sendWhatsappText(jid, message)
}

async function sendSerialHistoryNotification(jid: string, serial: string) {
  const history = (await getSerialTransactionHistory(serial)) as {
    type: string
    type_object_id: string
    customer_id: string
    type_date: Date
    invoice_status: string
    invoice_type: string
    is_reversed: string
  }[]

  const itemName = await getItemNameBySerial(serial)
  let message = `${serial} ${itemName}\n`
  if (Array.isArray(history) && history.length > 0) {
    history.forEach((h) => {
      let typeLabel = h.type
      if (h.type === 'purchase') typeLabel = 'Purchase'
      else if (h.type === 'invoice') typeLabel = 'Invoice'

      if (h.invoice_type != null) {
        switch (parseInt(h.invoice_type)) {
          case 1:
            typeLabel = `${typeLabel} Permintaan`
            break
          case 0:
            typeLabel = `${typeLabel} Pengembalian`
            break
        }
      }

      switch (h.invoice_status) {
        case 'BL':
          typeLabel = `${typeLabel} Beli`
          break
        case 'PM':
          typeLabel = `${typeLabel} Pinjam`
          break
        case 'IV':
          typeLabel = `${typeLabel} Inventaris`
          break
        case 'RK':
          typeLabel = `${typeLabel} Rusak`
          break
      }

      if (parseInt(h.is_reversed) == 1) {
        typeLabel = `Reversed ${typeLabel}`
      }

      const date = Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(h.type_date)

      message += `- ${date} ${h.customer_id} ${typeLabel}\n`
    })
  } else {
    message += 'No transaction history found.'
  }

  await sendWhatsappText(jid, message.trim())
}

export async function notifySerialTransactions(
  serial: string,
  jid: string,
  data: any,
) {
  switch (serial) {
    case 'IMAGE':
      const { image } = data
      if (image && EXTRACT_SERIAL_URL) {
        try {
          const imageBuffer = Buffer.from(image, 'base64')
          const imageUint8Array = new Uint8Array(imageBuffer)
          const imageBlob = new Blob([imageUint8Array], { type: 'image/jpeg' })
          const formData = new FormData()
          formData.append('image', imageBlob, 'image.jpg')
          const response = await axios.post(EXTRACT_SERIAL_URL, formData, {
            headers: {
              'x-api-key': EXTRACT_SERIAL_API_KEY,
            },
          })

          const data = response.data
          if (data.success && data.found) {
            await sendSerialHistoryNotification(jid, data.serial_number)
          } else {
            const errorMsg = data.error || 'Serial not found in image.'
            await sendWhatsappText(jid, `Extraction Result: ${errorMsg}`)
          }
        } catch (error) {
          console.error('Failed to post IMAGE to extract serial API', error)
          await sendWhatsappText(
            jid,
            'Error: Failed to process serial extraction.',
          )
        }
      }
      break
    default:
      await sendSerialHistoryNotification(jid, serial)
      break
  }
}

export async function notifyMacTransactions(
  mac: string,
  jid: string,
  data: any,
) {
  switch (mac) {
    case 'IMAGE':
      const { image } = data
      if (image && EXTRACT_MAC_URL) {
        try {
          const imageBuffer = Buffer.from(image, 'base64')
          const imageUint8Array = new Uint8Array(imageBuffer)
          const imageBlob = new Blob([imageUint8Array], { type: 'image/jpeg' })
          const formData = new FormData()
          formData.append('image', imageBlob, 'image.jpg')
          const response = await axios.post(EXTRACT_MAC_URL, formData, {
            headers: {
              'x-api-key': EXTRACT_MAC_API_KEY,
            },
          })

          const data = response.data
          if (data.success && data.found) {
            const serial = data.mac_address
              .replaceAll(':', '')
              .replaceAll('-', '')
            await sendSerialHistoryNotification(jid, serial)
          } else {
            const errorMsg = data.error || 'MAC address not found in image.'
            await sendWhatsappText(jid, `Extraction Result: ${errorMsg}`)
          }
        } catch (error) {
          console.error('Failed to post IMAGE to extract MAC API', error)
          await sendWhatsappText(
            jid,
            'Error: Failed to process serial extraction.',
          )
        }
      }
      break
    default:
      const serial = mac.replaceAll(':', '').replaceAll('-', '')
      await sendSerialHistoryNotification(jid, serial)
      break
  }
}
