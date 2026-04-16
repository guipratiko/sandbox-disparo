/**
 * Marca message_id para o webhook do Backend não gravar a outbound no CRM (disparo sem espelhar no chat).
 */

import { pgQuery } from '../config/databases';

export async function registerDispatchCrmOutboundSuppress(
  instanceId: string,
  messageId: string
): Promise<void> {
  if (!instanceId?.trim() || !messageId?.trim()) {
    return;
  }
  try {
    await pgQuery(
      `INSERT INTO dispatch_crm_outbound_suppress (instance_id, message_id)
       VALUES ($1, $2)
       ON CONFLICT (instance_id, message_id) DO UPDATE SET created_at = NOW()`,
      [instanceId.trim(), messageId.trim()]
    );
  } catch (e) {
    console.warn('[dispatch CRM suppress] Falha ao registar (tabela existe? migrate o Backend):', e);
  }
}
