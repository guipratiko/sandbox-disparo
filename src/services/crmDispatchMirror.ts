/**
 * Espelha envios do disparo no CRM (OnlyFlow Backend), quando o utilizador ativa a opção no disparo.
 * Requer DISPATCH_CRM_MIRROR_SECRET igual ao do Backend e BACKEND_URL acessível.
 */

import axios from 'axios';
import { DISPATCH_CRM_MIRROR } from '../config/constants';
import type { SequenceStep, TemplateType } from '../types/dispatch';

export type MirrorDispatchCrmParams = {
  showInChat: boolean;
  userId: string;
  instanceId: string;
  remoteJid: string;
  messageId: string;
  messageType: string;
  content: string;
  mediaUrl: string | null;
  /** Nome exibido no card CRM */
  contactName: string;
  /** Telefone / label na coluna phone do CRM */
  contactPhone: string;
};

/** Monta type + content + mediaUrl para gravar no CRM (alinhado ao webhook Evolution). */
export function buildCrmMirrorFromTemplateType(
  type: TemplateType,
  personalized: Record<string, unknown>
): { messageType: string; content: string; mediaUrl: string | null } {
  switch (type) {
    case 'text':
      return {
        messageType: 'conversation',
        content: String((personalized as { text?: string }).text ?? ''),
        mediaUrl: null,
      };
    case 'image':
      return {
        messageType: 'imageMessage',
        content: '[Mídia]',
        mediaUrl: (personalized as { imageUrl?: string }).imageUrl ?? null,
      };
    case 'image_caption':
      return {
        messageType: 'imageMessage',
        content: String((personalized as { caption?: string }).caption ?? '[Mídia]'),
        mediaUrl: (personalized as { imageUrl?: string }).imageUrl ?? null,
      };
    case 'video':
      return {
        messageType: 'videoMessage',
        content: '[Mídia]',
        mediaUrl: (personalized as { videoUrl?: string }).videoUrl ?? null,
      };
    case 'video_caption':
      return {
        messageType: 'videoMessage',
        content: String((personalized as { caption?: string }).caption ?? '[Mídia]'),
        mediaUrl: (personalized as { videoUrl?: string }).videoUrl ?? null,
      };
    case 'audio':
      return {
        messageType: 'audioMessage',
        content: '[Mídia]',
        mediaUrl: (personalized as { audioUrl?: string }).audioUrl ?? null,
      };
    case 'file':
      return {
        messageType: 'documentMessage',
        content: '[Mídia]',
        mediaUrl: (personalized as { fileUrl?: string }).fileUrl ?? null,
      };
    case 'sequence':
      return { messageType: 'conversation', content: '', mediaUrl: null };
    default:
      return { messageType: 'conversation', content: '', mediaUrl: null };
  }
}

export function buildCrmMirrorFromSequenceStep(
  step: SequenceStep,
  personalized: Record<string, unknown>
): { messageType: string; content: string; mediaUrl: string | null } {
  return buildCrmMirrorFromTemplateType(step.type as TemplateType, personalized);
}

/**
 * Chama o Backend para gravar a mensagem outbound no CRM (idempotente no PG).
 * Não propaga erro ao fluxo do disparo — só regista em log.
 */
export async function mirrorDispatchMessageToCrmIfEnabled(params: MirrorDispatchCrmParams): Promise<void> {
  if (!params.showInChat) {
    return;
  }

  const secret = DISPATCH_CRM_MIRROR.SECRET;
  if (!secret) {
    console.warn(
      '[CRM disparo] DISPATCH_CRM_MIRROR_SECRET não definido no Disparo-Clerky — espelho CRM ignorado. Defina o mesmo valor no Backend.'
    );
    return;
  }

  const base = DISPATCH_CRM_MIRROR.BACKEND_URL;
  const url = `${base}/api/internal/dispatch-crm-mirror`;

  try {
    const response = await axios.post(
      url,
      {
        userId: params.userId,
        instanceId: params.instanceId,
        remoteJid: params.remoteJid,
        messageId: params.messageId,
        messageType: params.messageType,
        content: params.content,
        mediaUrl: params.mediaUrl,
        contactName: params.contactName,
        contactPhone: params.contactPhone,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Dispatch-Crm-Mirror-Secret': secret,
        },
        timeout: 15_000,
        validateStatus: () => true,
      }
    );

    if (response.status >= 400) {
      const msg =
        response.data && typeof response.data === 'object' && 'message' in response.data
          ? String((response.data as { message?: string }).message)
          : response.statusText;
      console.error(`[CRM disparo] Backend respondeu ${response.status}: ${msg}`);
    }
  } catch (e) {
    console.error('[CRM disparo] Falha ao chamar espelho CRM no Backend:', e);
  }
}
