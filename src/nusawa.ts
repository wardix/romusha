import axios from 'axios'
import * as fs from 'fs/promises'
import {
  NUSAWA_MESSAGE_API_TOKEN,
  NUSAWA_MESSAGE_API_URL,
  WHATSAPP_NUSACONTACT_API_URL,
  WHATSAPP_NUSACONTACT_API_NAMESPACE,
  WHATSAPP_NUSACONTACT_API_APIKEY,
  WHATSAPP_FEEDBACK_URL,
  WHATSAPP_QUESTION,
} from './config'

export async function sendWaNotif(to: string, message: string) {
  await axios.post(
    NUSAWA_MESSAGE_API_URL,
    { to, body: 'text', text: message },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${NUSAWA_MESSAGE_API_TOKEN}`,
      },
    },
  )
}

export async function sendWaNotifFile(
    to: string,
    filePath: string,
    message: string
    ): Promise<void> {
    const imageBuffer = await fs.readFile(filePath)
    
    const payload = {
        to,
        body: 'image',
        image: imageBuffer.toString('base64'),
        caption: message,
    }

    await axios.post(NUSAWA_MESSAGE_API_URL, payload, {
        headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${NUSAWA_MESSAGE_API_TOKEN}`,
        },
    })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function sendWhatsAppFeedbackScore(
  destination: string,
  JobTitle: string,
  retries: number = 3,
) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await axios.post(
        WHATSAPP_NUSACONTACT_API_URL,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: destination,
          type: 'template',
          template: {
            namespace: WHATSAPP_NUSACONTACT_API_NAMESPACE,
            name: 'feedback_score_v05',
            language: { code: 'id' },
            components: [
              { type: 'body', parameters: [{ type: 'text', text: JobTitle }] },
            ],
          },
        },
        {
          headers: {
            'X-Api-Key': WHATSAPP_NUSACONTACT_API_APIKEY,
            'Content-Type': 'application/json; charset=utf-8',
          },
        },
      )
      return
    } catch (err: any) {
      if (err.response?.status === 429 && attempt < retries) {
        console.warn(
          `Rate limit hit for ${destination} (attempt ${attempt}). Waiting 1 seconds...`,
        )
        await sleep(1000)
      } else {
        throw err
      }
    }
  }
}

export async function saveFeedbackSendInfo(
  destination: string,
  CustId: string,
  TtsId: string,
  insertedUpdateId: string,
  AssignedNo: string,
): Promise<number> {
  try {
    const response = await axios.post(
      WHATSAPP_FEEDBACK_URL,
      {
        destination,
        question: WHATSAPP_QUESTION,
        customer_id: CustId,
        ticket_id: TtsId,
        tts_update_id: insertedUpdateId,
        assigned_no: AssignedNo,
      },
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
      },
    )

    return response.status
  } catch (err: any) {
    console.error('Error sending feedback:', err)
    throw new Error('Failed to send feedback')
  }
}
