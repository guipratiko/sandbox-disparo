/**
 * Espelha envios do disparo nas tabelas CRM (contacts / messages) do mesmo Postgres,
 * quando o utilizador ativa a opção no disparo.
 */

import { pgPool } from '../config/databases';
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
 * Insere mensagem outbound no CRM (idempotente por message_id + instance_id).
 * Não propaga erro ao fluxo do disparo — só regista em log.
 */
export async function mirrorDispatchMessageToCrmIfEnabled(params: MirrorDispatchCrmParams): Promise<void> {
  if (!params.showInChat) {
    return;
  }

  const {
    userId,
    instanceId,
    remoteJid,
    messageId,
    messageType,
    content,
    mediaUrl,
    contactName,
    contactPhone,
  } = params;

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    const colRes = await client.query<{ id: string }>(
      `SELECT id FROM crm_columns WHERE user_id = $1 ORDER BY order_index ASC LIMIT 1`,
      [userId]
    );
    const columnId = colRes.rows[0]?.id;
    if (!columnId) {
      await client.query('ROLLBACK');
      console.warn('[CRM disparo] Sem colunas CRM — abra o Kanban no OnlyFlow uma vez.');
      return;
    }

    let contactId: string;
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM contacts WHERE user_id = $1 AND instance_id = $2 AND remote_jid = $3`,
      [userId, instanceId, remoteJid]
    );

    if (existing.rows.length > 0) {
      contactId = existing.rows[0].id;
    } else {
      const name = (contactName || contactPhone || 'Contato').slice(0, 255);
      const phone = (contactPhone || remoteJid.replace(/@.+$/, '')).slice(0, 20);
      try {
        const ins = await client.query<{ id: string }>(
          `INSERT INTO contacts (user_id, instance_id, remote_jid, phone, name, profile_picture, column_id, unread_count)
           VALUES ($1, $2, $3, $4, $5, NULL, $6, 0)
           RETURNING id`,
          [userId, instanceId, remoteJid, phone, name, columnId]
        );
        contactId = ins.rows[0].id;
      } catch (err: unknown) {
        const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : '';
        if (code !== '23505') {
          throw err;
        }
        const again = await client.query<{ id: string }>(
          `SELECT id FROM contacts WHERE user_id = $1 AND instance_id = $2 AND remote_jid = $3`,
          [userId, instanceId, remoteJid]
        );
        if (again.rows.length === 0) {
          throw err;
        }
        contactId = again.rows[0].id;
      }
    }

    const ts = new Date();
    const safeContent = content != null && String(content).trim() !== '' ? String(content) : ' ';
    const safeMedia = mediaUrl && String(mediaUrl).trim() !== '' ? String(mediaUrl).trim() : null;

    await client.query(
      `INSERT INTO messages (
        user_id, instance_id, contact_id, remote_jid, message_id, from_me, message_type, content, media_url, timestamp, read, automated_outbound
      ) VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9, true, true)
      ON CONFLICT (message_id, instance_id) DO NOTHING`,
      [userId, instanceId, contactId, remoteJid, messageId, messageType, safeContent, safeMedia, ts]
    );

    await client.query(
      `UPDATE contacts SET
        last_message = LEFT($1::text, 100),
        last_message_at = $2,
        updated_at = NOW()
       WHERE id = $3::uuid`,
      [safeContent, ts, contactId]
    );

    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('[CRM disparo] Falha ao espelhar mensagem no CRM:', e);
  } finally {
    client.release();
  }
}
