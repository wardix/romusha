import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { sendImage as sendWhatsappImage } from '../waenq'
import { getAllEmployee } from '../nusawork'
import { createBirthdayVoucher } from '../voucher'
import {
  BIRTHDAY_VOUCHER_PERIOD_DAYS,
  BIRTHDAY_VOUCHER_PIC_PHONES,
  BIRTHDAY_VOUCHER_TEMPLATE_PATH,
  BIRTHDAY_WISHES,
} from '../config'

export async function distributeBirthdayVouchers() {
  const employees = await getAllEmployee()
  const todayBirthdayEmployees = getTodayBirthdayEmployees(
    employees.filter((employee: any) => employee.status_join != 'Internship'),
  ) as any
  if (todayBirthdayEmployees.length == 0) {
    return
  }

  const tempDir = os.tmpdir()
  const uniquePrefixDir = path.join(tempDir, 'romusha-')
  const uniqueDir = await fs.mkdtemp(uniquePrefixDir)
  const voucherOutputPath = path.join(
    uniqueDir,
    path.basename(BIRTHDAY_VOUCHER_TEMPLATE_PATH),
  )
  const voucherExpiration = Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: 'long',
    day: '2-digit',
  }).format(Date.now() + 86400000 * BIRTHDAY_VOUCHER_PERIOD_DAYS)
  for (const employee of todayBirthdayEmployees) {
    let contact = (
      employee.whatsapp ? employee.whatsapp : employee.mobile_phone
    ) as string
    if (contact.startsWith('0')) {
      contact = `62${contact.substring(1)}`
    }
    await createBirthdayVoucher(
      BIRTHDAY_VOUCHER_TEMPLATE_PATH,
      voucherOutputPath,
      employee.full_name,
      voucherExpiration,
    )
    await sendWhatsappImage(contact, voucherOutputPath, BIRTHDAY_WISHES)
    for (const contact of BIRTHDAY_VOUCHER_PIC_PHONES) {
      await sendWhatsappImage(contact, voucherOutputPath, BIRTHDAY_WISHES)
    }
  }
}

function getTodayBirthdayEmployees(employees: any[]) {
  const mmddFormatter = Intl.DateTimeFormat('en-CA', {
    month: '2-digit',
    day: '2-digit',
  })
  return employees.filter(
    (employee) =>
      mmddFormatter.format(new Date(`${employee.date_of_birth}T00:00:00`)) ==
      mmddFormatter.format(Date.now()),
  )
}
