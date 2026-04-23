/**
 * Grava no Postgres do CRM a mensagem outbound do disparo quando o utilizador quer vê-la no chat.
 * Complementa o webhook fromMe (Evolution), que por vezes não chega ou chega sem dados alinhados.
 */

import { pgQuery } from '../config/databases';
import { toStorageWhatsappRemoteJid, whatsappRemoteJidLookupVariants } from '../utils/numberNormalizer';
import { formatWhatsAppPhone } from '../utils/crmFormatters';
import { emitDispatchCrmOutboundMirrored } from '../socket/socketClient';
import { registerDispatchCrmOutboundSuppress } from './dispatchCrmSuppressRegistration';
import type { DispatchSettings } from '../types/dispatch';

const WHATSAPP_NET_SUFFIX = '@s.whatsapp.net';

/**
 * Mesmas variantes que o Backend (ContactService) + JID nacional sem DDI 55
 * (ex.: 6293557070@s.whatsapp.net vs 556293557070@s.whatsapp.net da Evolution).
 */
function remoteJidLookupList(remoteJid: string): string[] {
  const s = remoteJid?.trim();
  if (!s) return [];
  const set = new Set<string>();
  for (const v of whatsappRemoteJidLookupVariants(s)) {
    set.add(v);
  }
  const lower = s.toLowerCase();
  if (lower.endsWith(WHATSAPP_NET_SUFFIX)) {
    const local = s.split('@')[0]?.replace(/\D/g, '') ?? '';
    if (local.startsWith('55') && local.length >= 12) {
      set.add(`${local.slice(2)}${WHATSAPP_NET_SUFFIX}`);
    }
    if (!local.startsWith('55') && (local.length === 10 || local.length === 11)) {
      const with55 = `55${local}`;
      set.add(`${with55}${WHATSAPP_NET_SUFFIX}`);
      for (const v of whatsappRemoteJidLookupVariants(`${with55}${WHATSAPP_NET_SUFFIX}`)) {
        set.add(v);
      }
    }
  }
  return [...set];
}

async function findContactRow(
  userId: string,
  instanceId: string,
  remoteJid: string
): Promise<{ id: string; remote_jid: string } | null> {
  const jids = remoteJidLookupList(remoteJid);
  if (jids.length === 0) return null;
  /** Vários cards (Enterprise por departamento): preferir o mais “ativo” e cartões com departamento. */
  const r = await pgQuery(
    `SELECT id, remote_jid FROM contacts
     WHERE user_id = $1 AND instance_id = $2 AND remote_jid = ANY($3::text[])
     ORDER BY
       last_message_at DESC NULLS LAST,
       (department_id IS NULL) ASC,
       updated_at DESC
     LIMIT 1`,
    [userId, instanceId, jids]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0] as { id: string; remote_jid: string };
  return { id: row.id, remote_jid: row.remote_jid };
}

/** Coluna inicial para novo contato: legado (sem dept) primeiro; senão primeira coluna com o respetivo department_id. */
async function getFirstColumnForNewContact(
  userId: string
): Promise<{ columnId: string; departmentId: string | null } | null> {
  const legacy = await pgQuery<{ id: string; department_id: string | null }>(
    `SELECT id, department_id FROM crm_columns
     WHERE user_id = $1 AND department_id IS NULL
     ORDER BY order_index ASC
     LIMIT 1`,
    [userId]
  );
  if (legacy.rows.length > 0) {
    const row = legacy.rows[0] as { id: string; department_id: string | null };
    return { columnId: String(row.id), departmentId: null };
  }
  const anyCol = await pgQuery<{ id: string; department_id: string | null }>(
    `SELECT id, department_id FROM crm_columns
     WHERE user_id = $1
     ORDER BY order_index ASC
     LIMIT 1`,
    [userId]
  );
  if (anyCol.rows.length === 0) return null;
  const row = anyCol.rows[0] as { id: string; department_id: string | null };
  const dept = row.department_id != null && String(row.department_id).trim() ? String(row.department_id).trim() : null;
  return { columnId: String(row.id), departmentId: dept };
}

async function insertContact(
  userId: string,
  instanceId: string,
  storageRemoteJid: string,
  phone: string,
  columnId: string,
  departmentId: string | null
): Promise<{ id: string; remote_jid: string }> {
  const ins = await pgQuery(
    `INSERT INTO contacts (
      user_id, instance_id, remote_jid, phone, name,
      profile_picture, column_id, department_id, unread_count
    )
    VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, 0)
    RETURNING id, remote_jid`,
    [userId, instanceId, storageRemoteJid, phone, phone, columnId, departmentId]
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
    /** Horário da mensagem (Evolution); fallback no mirror se omitido. */
    sentAt?: Date;
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
    sentAt: args.sentAt,
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
  sentAt?: Date;
}): Promise<void> {
  const mid = params.messageId?.trim();
  if (!mid || !params.userId?.trim() || !params.instanceId?.trim()) return;

  const rjid = params.remoteJid?.trim();
  if (!rjid || rjid.includes('@lid')) return;

  try {
    let contact = await findContactRow(params.userId, params.instanceId, rjid);
    if (!contact) {
      const col = await getFirstColumnForNewContact(params.userId);
      if (!col) {
        console.warn('[dispatch CRM mirror] Sem coluna CRM para criar contato; ignorando espelho.');
        return;
      }
      const storageJid = toStorageWhatsappRemoteJid(rjid);
      const phone = formatWhatsAppPhone(storageJid);
      try {
        contact = await insertContact(
          params.userId,
          params.instanceId,
          storageJid,
          phone,
          col.columnId,
          col.departmentId
        );
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

    const messageTs = params.sentAt instanceof Date && !Number.isNaN(params.sentAt.getTime())
      ? params.sentAt
      : new Date();

    const ins = await pgQuery(
      `INSERT INTO messages (
        user_id, instance_id, contact_id, remote_jid,
        message_id, from_me, message_type, content,
        media_url, timestamp, read, automated_outbound
      ) VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8, $9, TRUE, FALSE)
      ON CONFLICT (message_id, instance_id, contact_id) DO NOTHING
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
        messageTs,
      ]
    );

    let crmUuid: string | null =
      ins.rows.length > 0 ? String((ins.rows[0] as { id: string }).id) : null;
    if (!crmUuid) {
      const ex = await pgQuery<{ id: string }>(
        `SELECT id FROM messages
         WHERE message_id = $1 AND instance_id = $2 AND contact_id = $3::uuid
         LIMIT 1`,
        [mid, params.instanceId, contact.id]
      );
      if (ex.rows.length > 0) {
        crmUuid = String(ex.rows[0].id);
      }
    }

    if (!crmUuid) {
      return;
    }

    emitDispatchCrmOutboundMirrored(params.userId, {
      instanceId: params.instanceId,
      contactId: contact.id,
      crmMessageUuid: crmUuid,
    });
  } catch (e) {
    console.warn('[dispatch CRM mirror] Falha ao espelhar outbound no CRM:', e);
  }
}
