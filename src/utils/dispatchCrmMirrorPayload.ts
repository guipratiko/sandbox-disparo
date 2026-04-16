import type { SequenceStep, TemplateType } from '../types/dispatch';

export type CrmMirrorPayload = {
  messageType: string;
  content: string;
  mediaUrl: string | null;
};

/** Conteúdo já personalizado (replaceVariablesInContent). */
export function mirrorPayloadForTemplate(
  templateType: TemplateType,
  personalized: Record<string, unknown>
): CrmMirrorPayload {
  switch (templateType) {
    case 'text':
      return {
        messageType: 'conversation',
        content: String(personalized.text ?? '').trim(),
        mediaUrl: null,
      };
    case 'image':
      return {
        messageType: 'imageMessage',
        content: '[Mídia]',
        mediaUrl: String(personalized.imageUrl ?? '').trim() || null,
      };
    case 'image_caption': {
      const cap = String(personalized.caption ?? '').trim();
      return {
        messageType: 'imageMessage',
        content: cap || '[Mídia]',
        mediaUrl: String(personalized.imageUrl ?? '').trim() || null,
      };
    }
    case 'video':
      return {
        messageType: 'videoMessage',
        content: '[Mídia]',
        mediaUrl: String(personalized.videoUrl ?? '').trim() || null,
      };
    case 'video_caption': {
      const cap = String(personalized.caption ?? '').trim();
      return {
        messageType: 'videoMessage',
        content: cap || '[Mídia]',
        mediaUrl: String(personalized.videoUrl ?? '').trim() || null,
      };
    }
    case 'audio':
      return {
        messageType: 'audioMessage',
        content: '[Mídia]',
        mediaUrl: String(personalized.audioUrl ?? '').trim() || null,
      };
    case 'file':
      return {
        messageType: 'documentMessage',
        content: String(personalized.fileName ?? 'Arquivo').trim() || '[Mídia]',
        mediaUrl: String(personalized.fileUrl ?? '').trim() || null,
      };
    case 'sequence':
    default:
      return { messageType: 'conversation', content: '', mediaUrl: null };
  }
}

export function mirrorPayloadForSequenceStep(
  step: SequenceStep,
  personalized: Record<string, unknown>
): CrmMirrorPayload {
  return mirrorPayloadForTemplate(step.type as TemplateType, personalized);
}
