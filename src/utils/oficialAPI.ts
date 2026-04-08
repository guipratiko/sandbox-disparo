/**
 * Cliente para o microserviço da API oficial WhatsApp Cloud (OnlyFlow)
 */

import axios from 'axios';
import { OFFICIAL_API_CLERKY_URL, OFFICIAL_API_CLERKY_API_KEY } from '../config/constants';

const BASE = OFFICIAL_API_CLERKY_URL.replace(/\/$/, '');

function cleanNumber(remoteJid: string): string {
  return remoteJid.replace('@s.whatsapp.net', '').trim();
}

export interface SendResult {
  messageId: string;
  remoteJid: string;
}

export async function sendViaOficialAPI(
  phone_number_id: string,
  remoteJid: string,
  payload: { text?: string; image?: string; video?: string; audio?: string; document?: string; caption?: string; fileName?: string }
): Promise<SendResult> {
  const number = cleanNumber(remoteJid);
  const headers: Record<string, string> = {};
  if (OFFICIAL_API_CLERKY_API_KEY) {
    headers['x-api-key'] = OFFICIAL_API_CLERKY_API_KEY;
  }
  const res = await axios.post(
    `${BASE}/api/message/send`,
    { phone_number_id, number, ...payload },
    { timeout: 60000, headers }
  );
  const messageId = res.data?.data?.messageId || res.data?.messageId || '';
  if (!messageId) {
    throw new Error('OficialAPI não retornou messageId');
  }
  return { messageId, remoteJid };
}
