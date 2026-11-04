import type { RowDataPacket } from 'mysql2'
import { pool as nisDB } from './nis.mysql'
import axios from 'axios'
import {
  nusacontactSyncContactApiUrl,
  nusacontactApiKey,
  nusacontactSyncContactMaxAttempts,
} from './config'
import logger from './logger'

// Types
interface ContactDetail {
  name: string
  salutation: string
  ids: string[]
  branches: string[]
  companies: Array<{ id: string; name: string }>
  services: Array<{ id: string; name: string }>
  accounts: Array<{ id: string; name: string }>
  addresses: Array<{ id: string; name: string }>
}

// Constants
const CUSTOMER_LINK = {
  PREFIX: 'https://isx.nusa.net.id/customer.php?custId=',
  SUFFIX: '&pid=profile&module=customer',
}

const SUBSCRIPTION_LINK = {
  PREFIX: 'https://isx.nusa.net.id/v2/customer/service/',
  SUFFIX: '/detail',
}

const SYNC_CONFIG = {
  MAX_ATTEMPTS: 3,
  TIMEOUT: 10000,
  RETRY_DELAY: 1000,
}

/**
 * Sync customer contact data to Nusacontact system
 * @param {string} phone
 * @returns {Promise<void>}
 */

export async function syncNusacontactCustomer(phone: string): Promise<void> {
  if (!isValidPhone(phone)) {
    return
  }

  const contact = await getContactDetail(phone)

  // phone is no longer in NIS, clear the stale customer data in Nusacontact
  const formattedContact = contact
    ? formatContact(phone, contact)
    : formatUnknownContact(phone)
  await syncNusacontactContact(formattedContact)
}

/**
 * @param {string} phone
 * @returns {boolean}
 */
function isValidPhone(phone: string): boolean {
  return Boolean(phone) && phone.length >= 10
}

/**
 * Get customer contact detail from NIS database
 * @param {string} phone
 * @returns {Promise<ContactDetail | null>} null when phone is not found in NIS
 */
async function getContactDetail(phone: string): Promise<ContactDetail | null> {
  const contact: ContactDetail = {
    name: '',
    salutation: '',
    ids: [],
    branches: [],
    companies: [],
    services: [],
    accounts: [],
    addresses: [],
  }

  // Query 1: Basic customer data
  const sql1 = `
        SELECT sp.name, tcs.salutation, sp.custId AS customerId
        FROM sms_phonebook sp
        LEFT JOIN tapi_call_salutation tcs ON sp.salutationId = tcs.id
        WHERE sp.phone LIKE ?
        AND sp.custId IS NOT NULL
        ORDER BY sp.insertTime DESC
    `
  const [rows1] = await nisDB.execute<RowDataPacket[]>(sql1, [`%${phone}`])

  rows1.forEach(({ name, salutation, customerId }) => {
    if (!contact.name) {
      contact.name = name
      contact.salutation = salutation
    }
    contact.ids.push(customerId)
  })

  if (!contact.name || contact.ids.length === 0) {
    return null
  }

  const placeholders = contact.ids.map(() => '?').join(',')

  // Query 2: Company & branch data
  const sql2 = `
        SELECT CustId AS customerId, 
            CustCompany AS company,
            IFNULL(DisplayBranchId, BranchId) AS branch
        FROM Customer
        WHERE CustId IN (${placeholders})
    `
  const [rows2] = await nisDB.execute<RowDataPacket[]>(sql2, contact.ids)

  rows2.forEach(({ customerId, company, branch }) => {
    const trimmedCompany = company?.trim()
    if (trimmedCompany) {
      contact.companies.push({ id: customerId, name: trimmedCompany })
    }
    if (!contact.branches.includes(branch)) {
      contact.branches.push(branch)
    }
  })

  // Query 3: Services, accounts & addresses
  const sql3 = `
        SELECT cs.CustServId AS subscriptionId, 
            s.ServiceType AS service,
            cs.CustAccName AS account, 
            IFNULL(cs.installation_address, '') AS address
        FROM CustomerServices cs
        LEFT JOIN Services s ON cs.ServiceId = s.ServiceId
        LEFT JOIN Customer c ON cs.CustId = c.CustId
        WHERE cs.CustId IN (${placeholders}) 
        AND cs.CustStatus != 'NA'
    `
  const [rows3] = await nisDB.execute<RowDataPacket[]>(sql3, contact.ids)

  rows3.forEach(({ subscriptionId, service, account, address }) => {
    const normalizedAddress = address?.trim().replace(/\s+/g, ' ')
    if (normalizedAddress) {
      contact.addresses.push({ id: subscriptionId, name: normalizedAddress })
    }
    contact.services.push({ id: subscriptionId, name: service })
    contact.accounts.push({ id: subscriptionId, name: account?.trim() })
  })

  return contact
}

/**
 * Format current time as "YYYY-MM-DD HH:mm WIB" (e.g. "2026-08-13 15:28 WIB")
 * @returns {string}
 */
function formatUpdatedTimestamp(): string {
  const time = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())

  return `${time} WIB`
}

/**
 * Format contact data for Nusacontact
 * @param {string} phoneNumber
 * @param {ContactDetail} contact
 * @returns {any}
 */
function formatContact(phoneNumber: string, contact: ContactDetail): any {
  const timezone =
    Array.isArray(contact.branches) && contact.branches.includes('062')
      ? 'Asia/Makassar'
      : 'Asia/Jakarta'

  const branchCode = Array.isArray(contact.branches)
    ? contact.branches.join(', ')
    : ''

  const createLink = (text: string, id: string, isCustomer: boolean) => {
    const { PREFIX, SUFFIX } = isCustomer ? CUSTOMER_LINK : SUBSCRIPTION_LINK
    return `[${text}](${PREFIX}${id}${SUFFIX})`
  }

  const attributes: any = {
    salutation: contact.salutation || '',
    ids: contact.ids.map((id) => createLink(id, id, true)).join(', '),
    companies: contact.companies
      .map(({ id, name }) => createLink(name, id, true))
      .join(', '),
    update: formatUpdatedTimestamp(),
  }

  if (contact.services.length > 0) {
    attributes.services = contact.services
      .map(({ id, name }) => createLink(name, id, false))
      .join(', ')
  }

  if (contact.accounts.length > 0) {
    attributes.accounts = contact.accounts
      .map(({ id, name }) => createLink(name, id, false))
      .join(', ')
  }

  if (contact.addresses.length > 0) {
    attributes.addresses = contact.addresses
      .map(({ id, name }) => createLink(name, id, false))
      .join(', ')
  }

  return {
    phone_number: phoneNumber,
    name: contact.name,
    timezone,
    branch_code: branchCode,
    attributes: JSON.stringify(attributes),
  }
}

/**
 * Format contact that is not found in NIS, customer attributes are emptied.
 * Name is required by Nusacontact but only used for new contacts, an existing name is kept.
 * @param {string} phoneNumber
 * @returns {any}
 */
function formatUnknownContact(phoneNumber: string): any {
  return {
    phone_number: phoneNumber,
    name: phoneNumber,
    timezone: 'Asia/Jakarta',
    branch_code: '',
    attributes: JSON.stringify({ update: formatUpdatedTimestamp() }),
  }
}

/**
 * Sync contact data to Nusacontact API
 * @param {any} data
 * @returns {Promise<void>}
 */
async function syncNusacontactContact(data: any): Promise<void> {
  const maxAttempts =
    Number(nusacontactSyncContactMaxAttempts) || SYNC_CONFIG.MAX_ATTEMPTS

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await axios.post(nusacontactSyncContactApiUrl, data, {
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': nusacontactApiKey,
        },
        timeout: SYNC_CONFIG.TIMEOUT,
      })
      return
    } catch (error) {
      if (!axios.isAxiosError(error)) {
        break
      }

      const status = error.response?.status
      const message = error.response?.data || error.message

      logger.error(
        `[SYNC ERROR] Attempt ${attempt}/${maxAttempts} - ${status || 'No Status'}: ${message}`,
      )

      // Non-retryable client error (4xx except 408, 429)
      if (status && status >= 400 && status < 500) {
        logger.error('[SYNC STOPPED] Non-retryable client error.')
        break
      }

      if (attempt >= maxAttempts) {
        logger.error('[SYNC FAILED] Max retry reached.')
        break
      }

      // Delay before retry
      await new Promise((resolve) =>
        setTimeout(resolve, SYNC_CONFIG.RETRY_DELAY * attempt),
      )
    }
  }
}
