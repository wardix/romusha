import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import sharp from 'sharp'
import { createCanvas, loadImage } from 'canvas'
import type { CanvasRenderingContext2D as NodeCanvasRenderingContext2D } from 'canvas'
import { getAllEmployee } from './nusawork'
import { sendWaNotifFile } from './nusawa'
import logger from './logger'

import {
  birthdayGiftVoucherPeriodDays,
  birthdayGiftVoucherTemplatePath,
  birthdayPicPhones,
  birthdayWishes,
} from './config'

interface Employee {
    id: string
    full_name: string
    date_of_birth: string
    whatsapp?: string
    mobile_phone: string
    status_join: string
}

const VOUCHER_CONFIG = {
    name: {
        x: 4,
        y: 484,
        width: 736,
        height: 100,
        fontSize: 68,
        color: '#FFD533',
        fontSizeStep: 2,
    },
    expiryDate: {
        x: 68,
        y: 1020,
        width: 398,
        fontSize: 28,
        color: '#FFFFFF',
    },
} as const

/**
 * Sends birthday gift vouchers to all employees celebrating their birthday today.
 * Excludes interns and sends CC notifications to designated PICs.
 * 
 * @returns {Promise<void>}
 */
export async function sendGiftVoucherToBirthdayEmployees(): Promise<void> {
    let tempDirectory: string | null = null

    try {
        const employees = await getAllEmployee()
        
        if (!employees) return

        const birthdayEmployees = employees
        .filter((employee: Employee) => employee.status_join !== 'Internship')
        .filter((employee: Employee) => {
            const todayDayMonth = formatDayMonth(new Date())
            const birthDayMonth = formatDayMonth(new Date(`${employee.date_of_birth}T00:00:00`))
            return todayDayMonth === birthDayMonth
        })

        if (birthdayEmployees.length === 0) return

        tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'birthday-voucher-'))
        const ccPhones = JSON.parse(birthdayPicPhones)
        const voucherExpiryDate = new Date(Date.now() + 86400000 * Number(birthdayGiftVoucherPeriodDays))

        for (const employee of birthdayEmployees) {
        const voucherPath = path.join(
            tempDirectory,
            `voucher-${employee.id}${path.extname(birthdayGiftVoucherTemplatePath)}`
        )

        await createBirthdayVoucherGift(
            birthdayGiftVoucherTemplatePath,
            voucherPath,
            employee.full_name,
            voucherExpiryDate
        )

        const phoneNumber = normalizePhoneNumber(employee.whatsapp || employee.mobile_phone)
        await sendWaNotifFile(phoneNumber, voucherPath, birthdayWishes)

        for (const ccPhone of ccPhones) {
            await sendWaNotifFile(ccPhone, voucherPath, birthdayWishes)
        }
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Error send gift voucher: ${message}`)
    } finally {
        if (tempDirectory) {
        await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => {})
        }
    }
}

/**
 * Creates a personalized birthday voucher gift by overlaying employee name and expiry date on template image.
 * 
 * @param {string} templatePath - Path to the template image.
 * @param {string} outputPath - Path to save the generated voucher image.
 * @param {string} name - Employee name to be overlayed on the voucher.
 * @param {Date} endPeriodDate - Expiry date of the voucher.
 * @returns {Promise<void>}
 */
export async function createBirthdayVoucherGift(
    templatePath: string,
    outputPath: string,
    name: string,
    endPeriodDate: Date
    ): Promise<void> {
    const imageBuffer = await sharp(templatePath).toBuffer()
    const image = await loadImage(imageBuffer)

    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext('2d')

    context.drawImage(image, 0, 0)

    drawEmployeeName(context, name)
    drawExpiryDate(context, endPeriodDate)

    const buffer = canvas.toBuffer('image/png')
    await fs.writeFile(outputPath, buffer)
}

/**
 * Sends WhatsApp notification with image attachment.
 * 
 * @param {NodeCanvasRenderingContext2D} context - Canvas context for drawing.
 * @param {string} name - Employee name to be overlayed on the voucher.
 * @returns {void}
 */

function drawEmployeeName(context: NodeCanvasRenderingContext2D, name: string): void {
    const config = VOUCHER_CONFIG.name
    let fontSize = config.fontSize
    
    context.fillStyle = config.color
    context.font = `bold ${fontSize}px arial`

    let textWidth = context.measureText(name).width

    while (textWidth > config.width) {
        fontSize -= config.fontSizeStep
        context.font = `bold ${fontSize}px arial`
        textWidth = context.measureText(name).width
    }

    const x = config.x + (config.width - textWidth) / 2
    const y = config.y + (config.height + fontSize) / 2

    context.fillText(name, x, y)
}

function drawExpiryDate(context: NodeCanvasRenderingContext2D, date: Date): void {
    const config = VOUCHER_CONFIG.expiryDate
    const formattedDate = date.toLocaleString('id-ID', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    })

    context.font = `bold ${config.fontSize}px arial`
    context.fillStyle = config.color

    const textWidth = context.measureText(formattedDate).width
    const x = config.x + (config.width - textWidth) / 2

    context.fillText(formattedDate, x, config.y)
}

function formatDayMonth(date: Date): string {
    const formatter = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: '2-digit',
    })
    return formatter.format(date)
}

function normalizePhoneNumber(phone: string): string {
    if (phone.startsWith('0')) {
        return `62${phone.substring(1)}`
    }
    return phone
}