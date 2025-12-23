import axios from 'axios'
import fs from 'fs/promises'
import { WAENQ_MESSAGE_API_TOKEN, WAENQ_MESSAGE_API_URL } from './config'

export async function sendImage(
  to: string,
  imageFilePath: string,
  caption: string,
) {
  const buffer = await fs.readFile(imageFilePath)
  const payload = {
    to,
    body: 'image',
    image: buffer.toString('base64'),
    caption,
  }
  await axios.post(WAENQ_MESSAGE_API_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WAENQ_MESSAGE_API_TOKEN}`,
    },
  })
}

export async function sendText(to: string, text: string) {
  const payload = {
    to,
    body: 'text',
    text,
  }
  await axios.post(WAENQ_MESSAGE_API_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WAENQ_MESSAGE_API_TOKEN}`,
    },
  })
}
