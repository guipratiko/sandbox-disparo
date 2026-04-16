/**
 * Notifica o Backend OnlyFlow para gravar a mensagem outbound no CRM (PostgreSQL).
 * Requer BACKEND_URL e DISPATCH_CLERKY_INTERNAL_KEY (igual no Backend).
 */

import axios from 'axios';
import { BACKEND_URL } from '../config/constants';
import type { CrmMirrorPayload } from './dispatchCrmMirrorPayload';

const INTERNAL_KEY = (process.env.DISPATCH_CLERKY_INTERNAL_KEY || '').trim();

let warnedMissingKey = false;

export async function tryMirrorEvolutionDispatchToCrm(params: {
  userId: string;
  instanceId: string;
  integration?: string | null;
  mirrorDispatchToCrm?: boolean;
  remoteJid: string;
  messageId: string;
  payload: CrmMirrorPayload;
}): Promise<void> {
  if (!params.mirrorDispatchToCrm) {
    return;
  }
  if (params.integration === 'WHATSAPP-CLOUD') {
    return;
  }
  if (!INTERNAL_KEY) {
    if (!warnedMissingKey) {
      console.warn(
        '[Disparo→CRM] DISPATCH_CLERKY_INTERNAL_KEY não definida no Disparo-Clerky; mensagens não serão espelhadas no CRM.'
      );
      warnedMissingKey = true;
    }
    return;
  }

  try {
    const res = await axios.post(
      `${BACKEND_URL}/api/internal/dispatch/crm-mirror`,
      {
        userId: params.userId,
        instanceId: params.instanceId,
        remoteJid: params.remoteJid,
        messageId: params.messageId,
        messageType: params.payload.messageType,
        content: params.payload.content,
        mediaUrl: params.payload.mediaUrl,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': INTERNAL_KEY,
        },
        timeout: 15000,
        validateStatus: () => true,
      }
    );
    if (res.status < 200 || res.status >= 300) {
      console.warn('[Disparo→CRM] Resposta do Backend:', res.status, res.data);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[Disparo→CRM] Falha ao espelhar mensagem no CRM:', msg);
  }
}
