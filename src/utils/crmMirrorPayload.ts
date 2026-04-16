/**
 * Metadados para gravar no CRM o outbound do disparo (espelho quando o webhook não chega a tempo).
 */

import type { SequenceStep, TemplateType } from '../types/dispatch';
import type { ContactData } from './variableReplacer';
import { replaceVariablesInContent } from './variableReplacer';

export type CrmMirrorPayload = {
  messageType: string;
  content: string;
  mediaUrl: string | null;
};

export function crmMirrorPayloadFromSequenceStep(
  step: SequenceStep,
  contact: ContactData,
  defaultName: string | undefined
): CrmMirrorPayload {
  const pc = replaceVariablesInContent(step.content, contact, defaultName || 'Cliente');
  switch (step.type) {
    case 'text':
      return { messageType: 'conversation', content: String((pc as { text?: string }).text ?? ''), mediaUrl: null };
    case 'image':
    case 'image_caption': {
      const img = pc as { imageUrl?: string; caption?: string };
      return {
        messageType: 'imageMessage',
        content: (img.caption && String(img.caption).trim()) || '[Mídia]',
        mediaUrl: img.imageUrl || null,
      };
    }
    case 'video':
    case 'video_caption': {
      const vid = pc as { videoUrl?: string; caption?: string };
      return {
        messageType: 'videoMessage',
        content: (vid.caption && String(vid.caption).trim()) || '[Mídia]',
        mediaUrl: vid.videoUrl || null,
      };
    }
    case 'audio': {
      const a = pc as { audioUrl?: string };
      return { messageType: 'audioMessage', content: '[Mídia]', mediaUrl: a.audioUrl || null };
    }
    case 'file': {
      const f = pc as { fileUrl?: string; fileName?: string };
      return {
        messageType: 'documentMessage',
        content: f.fileName ? String(f.fileName) : '[Mídia]',
        mediaUrl: f.fileUrl || null,
      };
    }
    default:
      return { messageType: 'conversation', content: '[Mensagem]', mediaUrl: null };
  }
}

export function crmMirrorPayloadFromDispatchTemplate(
  templateType: TemplateType,
  personalizedContent: Record<string, unknown>
): CrmMirrorPayload {
  switch (templateType) {
    case 'text':
      return {
        messageType: 'conversation',
        content: String((personalizedContent as { text?: string }).text ?? ''),
        mediaUrl: null,
      };
    case 'image':
    case 'image_caption': {
      const img = personalizedContent as { imageUrl?: string; caption?: string };
      return {
        messageType: 'imageMessage',
        content: (img.caption && String(img.caption).trim()) || '[Mídia]',
        mediaUrl: img.imageUrl || null,
      };
    }
    case 'video':
    case 'video_caption': {
      const vid = personalizedContent as { videoUrl?: string; caption?: string };
      return {
        messageType: 'videoMessage',
        content: (vid.caption && String(vid.caption).trim()) || '[Mídia]',
        mediaUrl: vid.videoUrl || null,
      };
    }
    case 'audio': {
      const a = personalizedContent as { audioUrl?: string };
      return { messageType: 'audioMessage', content: '[Mídia]', mediaUrl: a.audioUrl || null };
    }
    case 'file': {
      const f = personalizedContent as { fileUrl?: string; fileName?: string };
      return {
        messageType: 'documentMessage',
        content: f.fileName ? String(f.fileName) : '[Mídia]',
        mediaUrl: f.fileUrl || null,
      };
    }
    default:
      return { messageType: 'conversation', content: '[Mensagem]', mediaUrl: null };
  }
}
