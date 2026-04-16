/**
 * Grava no Postgres do CRM a mensagem outbound do disparo quando o utilizador quer vê-la no chat.
 * Complementa o webhook fromMe (Evolution), que por vezes não chega ou chega sem dados alinhados.
 */

import { pgQuery } from '../config/databases';
import { extractPhoneFromJid, normalizePhone } from '../utils/numberNormalizer';
import { emitDispatchCrmOutboundMirrored } from '../socket/socketClient';
import { registerDispatchCrmOutboundSuppress } from './dispatchCrmSuppressRegistration';
import type { DispatchSettings } from '../types/dispatch';

function remoteJidLookupList(remoteJid: string): string[] {
  const s = remoteJid?.trim();
  if (!s) return [];
  const uniq = new Set<string>([s]);
  const digits = extractPhoneFromJid(s);
  const n = normalizePhone(digits, '55');
  if (n) {
    const alt = `${n}@s.whatsapp.net`;
    if (alt !== s) uniq.add(alt);
  }
  return [...uniq];
}

async function findContactRow(
  userId: string,
  instanceId: string,
  remoteJid: string
): Promise<{ id: string; remote_jid: string } | null> {
  const jids = remoteJidLookupList(remoteJid);
  if (jids.length === 0) return null;
  const r = await pgQuery(
    `SELECT id, remote_jid FROM contacts
     WHERE user_id = $1 AND instance_id = $2 AND remote_jid = ANY($3::text[])
     LIMIT 1`,
    [userId, instanceId, jids]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0] as { id: string; remote_jid: string };
  return { id: row.id, remote_jid: row.remote_jid };
}

async function getFirstColumnId(userId: string): Promise<string | null> {
  const r = await pgQuery(
    `SELECT id FROM crm_columns WHERE user_id = $1 ORDER BY order_index ASC LIMIT 1`,
    [userId]
  );
  if (r.rows.length === 0) return null;
  return String((r.rows[0] as { id: string }).id);
}

async function insertContact(
  userId: string,
  instanceId: string,
  storageRemoteJid: string,
  phone: string,
  columnId: string
): Promise<{ id: string; remote_jid: string }> {
  const ins = await pgQuery(
    `INSERT INTO contacts (
      user_id, instance_id, remote_jid, phone, name,
      profile_picture, column_id, unread_count
    )
    VALUES ($1, $2, $3, $4, $5, NULL, $6, 0)
    RETURNING id, remote_jid`,
    [userId, instanceId, storageRemoteJid, phone, phone, columnId]
  );
  const row = ins.rows[0] as { id: string; remote_jid: string };
  return { id: row.id, remote_jid: row.remote_jid };
}

/**
 * Se o utilizador oculta outbound no CRM → registo na tabela de supressão (consumo no webhook).
 * Caso contrário → espelha a mensagem no Postgres do CRM (o webhook fará ON CONFLICT se também gravar).
 */
export async function applyDispatchOutboundCrmVisibility(
  settings: DispatchSettings,
  args: {
    userId: string;
    instanceId: string;
    remoteJid: string;
    messageId: string | undefined;
    messageType: string;
    content: string;
    mediaUrl?: string | null;
  }
): Promise<void> {
  const iid = args.instanceId?.trim();
  const mid = args.messageId?.trim();
  if (!iid || !mid) return;

  if (settings.showMessagesInCrmChat === false) {
    await registerDispatchCrmOutboundSuppress(iid, mid);
    return;
  }

  await mirrorDispatchOutboundToCrm({
    userId: args.userId,
    instanceId: iid,
    remoteJid: args.remoteJid,
    messageId: mid,
    messageType: args.messageType,
    content: args.content,
    mediaUrl: args.mediaUrl,
  });
}

export async function mirrorDispatchOutboundToCrm(params: {
  userId: string;
  instanceId: string;
  remoteJid: string;
  messageId: string;
  messageType: string;
  content: string;
  mediaUrl?: string | null;
}): Promise<void> {
  const mid = params.messageId?.trim();
  if (!mid || !params.userId?.trim() || !params.instanceId?.trim()) return;

  const rjid = params.remoteJid?.trim();
  if (!rjid || rjid.includes('@lid')) return;

  try {
    let contact = await findContactRow(params.userId, params.instanceId, rjid);
    if (!contact) {
      const columnId = await getFirstColumnId(params.userId);
      if (!columnId) {
        console.warn('[dispatch CRM mirror] Sem coluna CRM para criar contato; ignorando espelho.');
        return;
      }
      const digits = extractPhoneFromJid(rjid);
      const phone = normalizePhone(digits, '55') || digits;
      try {
        contact = await insertContact(params.userId, params.instanceId, rjid, phone, columnId);
      } catch (e: unknown) {
        const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : '';
        if (code === '23505') {
          contact = await findContactRow(params.userId, params.instanceId, rjid);
        } else {
          throw e;
        }
      }
    }
    if (!contact) return;

    const storageRemoteJid = contact.remote_jid;
    const content = params.content ?? '';
    const mt = params.messageType || 'conversation';
    const media = params.mediaUrl ?? null;

    const ins = await pgQuery(
      `INSERT INTO messages (
        user_id, instance_id, contact_id, remote_jid,
        message_id, from_me, message_type, content,
        media_url, timestamp, read, automated_outbound
      ) VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8, NOW(), TRUE, FALSE)
      ON CONFLICT (message_id, instance_id) DO NOTHING
      RETURNING id`,
      [
        params.userId,
        params.instanceId,
        contact.id,
        storageRemoteJid,
        mid,
        mt,
        content,
        media,
      ]
    );

    if (ins.rows.length === 0) {
      return;
    }

    const crmUuid = String((ins.rows[0] as { id: string }).id);
    emitDispatchCrmOutboundMirrored(params.userId, {
      instanceId: params.instanceId,
      contactId: contact.id,
      crmMessageUuid: crmUuid,
    });
  } catch (e) {
    console.warn('[dispatch CRM mirror] Falha ao espelhar outbound no CRM:', e);
  }
}
