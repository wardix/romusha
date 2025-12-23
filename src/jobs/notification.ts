import { sendText as sendWhatsappText } from '../waenq'
import { getAllEmployee } from '../nusawork'
import { BIRTHDAY_VOUCHER_PIC_PHONES } from '../config'

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
