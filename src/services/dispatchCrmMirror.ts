/**
 * Espelha mensagens enviadas pelo disparo no CRM (OnlyFlow Backend / Postgres).
 */

import axios from 'axios';
import type { SequenceStep, TemplateType } from '../types/dispatch';

const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:4331').replace(/\/$/, '');
const MIRROR_HEADER = 'x-disparo-mirror-secret';

function secret(): string {
  return (process.env.DISPATCH_CRM_MIRROR_SECRET || '').trim();
}

export function crmMirrorFieldsFromTemplate(
  templateType: TemplateType,
  personalized: Record<string, unknown>
): { messageType: string; content: string; mediaUrl: string | null } {
  const p = personalized as Record<string, string | undefined>;
  switch (templateType) {
    case 'text':
      return { messageType: 'conversation', content: String(p.text ?? ''), mediaUrl: null };
    case 'image':
      return {
        messageType: 'imageMessage',
        content: '[Mídia]',
        mediaUrl: p.imageUrl ? String(p.imageUrl) : null,
      };
    case 'image_caption':
      return {
        messageType: 'imageMessage',
        content: String(p.caption ?? '[Mídia]'),
        mediaUrl: p.imageUrl ? String(p.imageUrl) : null,
      };
    case 'video':
      return {
        messageType: 'videoMessage',
        content: '[Mídia]',
        mediaUrl: p.videoUrl ? String(p.videoUrl) : null,
      };
    case 'video_caption':
      return {
        messageType: 'videoMessage',
        content: String(p.caption ?? '[Mídia]'),
        mediaUrl: p.videoUrl ? String(p.videoUrl) : null,
      };
    case 'audio':
      return {
        messageType: 'audioMessage',
        content: '[Mídia]',
        mediaUrl: p.audioUrl ? String(p.audioUrl) : null,
      };
    case 'file':
      return {
        messageType: 'documentMessage',
        content: String(p.fileName || '[Mídia]'),
        mediaUrl: p.fileUrl ? String(p.fileUrl) : null,
      };
    default:
      return { messageType: 'conversation', content: '[Mensagem]', mediaUrl: null };
  }
}

export function crmMirrorFieldsFromSequenceStep(step: SequenceStep): {
  messageType: string;
  content: string;
  mediaUrl: string | null;
} {
  const c = step.content as unknown as Record<string, string | undefined>;
  switch (step.type) {
    case 'text':
      return { messageType: 'conversation', content: String(c.text ?? ''), mediaUrl: null };
    case 'image':
      return {
        messageType: 'imageMessage',
        content: '[Mídia]',
        mediaUrl: c.imageUrl ? String(c.imageUrl) : null,
      };
    case 'image_caption':
      return {
        messageType: 'imageMessage',
        content: String(c.caption ?? '[Mídia]'),
        mediaUrl: c.imageUrl ? String(c.imageUrl) : null,
      };
    case 'video':
      return {
        messageType: 'videoMessage',
        content: '[Mídia]',
        mediaUrl: c.videoUrl ? String(c.videoUrl) : null,
      };
    case 'video_caption':
      return {
        messageType: 'videoMessage',
        content: String(c.caption ?? '[Mídia]'),
        mediaUrl: c.videoUrl ? String(c.videoUrl) : null,
      };
    case 'audio':
      return {
        messageType: 'audioMessage',
        content: '[Mídia]',
        mediaUrl: c.audioUrl ? String(c.audioUrl) : null,
      };
    case 'file':
      return {
        messageType: 'documentMessage',
        content: String(c.fileName || '[Mídia]'),
        mediaUrl: c.fileUrl ? String(c.fileUrl) : null,
      };
    default:
      return { messageType: 'conversation', content: '[Mensagem]', mediaUrl: null };
  }
}

export async function mirrorOutboundToCrmIfEnabled(opts: {
  enabled: boolean;
  userId: string;
  instanceId: string;
  phone: string;
  remoteJid: string;
  messageId: string;
  messageType: string;
  content: string;
  mediaUrl: string | null;
  timestamp: Date;
}): Promise<void> {
  if (!opts.enabled) return;
  const s = secret();
  if (!s) {
    console.warn(
      '[dispatch CRM mirror] DISPATCH_CRM_MIRROR_SECRET não definido; mensagem não espelhada no CRM.'
    );
    return;
  }

  try {
    const r = await axios.post(
      `${BACKEND_URL}/api/internal/dispatch-crm-mirror`,
      {
        userId: opts.userId,
        instanceId: opts.instanceId,
        phone: opts.phone,
        remoteJid: opts.remoteJid,
        messageId: opts.messageId,
        messageType: opts.messageType,
        content: opts.content,
        mediaUrl: opts.mediaUrl,
        timestamp: opts.timestamp.toISOString(),
      },
      {
        headers: { [MIRROR_HEADER]: s, 'Content-Type': 'application/json' },
        timeout: 20_000,
        validateStatus: () => true,
      }
    );
    if (r.status < 200 || r.status >= 300) {
      console.warn(
        '[dispatch CRM mirror] resposta HTTP',
        r.status,
        typeof r.data === 'object' ? JSON.stringify(r.data) : r.data
      );
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[dispatch CRM mirror] falha de rede:', msg);
  }
}
