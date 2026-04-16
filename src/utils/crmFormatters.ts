/**
 * Formatação alinhada ao Backend (webhook CRM) para espelho do disparo.
 */

/**
 * Telefone para exibição no card do CRM (sem DDI 55 na UI).
 * Igual a `formatWhatsAppPhone` do Backend.
 */
export const formatWhatsAppPhone = (remoteJid: string): string => {
  if (!remoteJid) return '';

  let phone = remoteJid.replace(/@.*$/, '');
  phone = phone.replace(/\D/g, '');

  if (phone.length >= 2 && phone.startsWith('55')) {
    phone = phone.substring(2);
  }

  if (phone.length === 10) {
    return `${phone.substring(0, 2)} ${phone.substring(2, 6)}-${phone.substring(6)}`;
  }
  if (phone.length === 11) {
    return `${phone.substring(0, 2)} ${phone.substring(2, 7)}-${phone.substring(7)}`;
  }

  return phone;
};

/**
 * Normaliza timestamp do WhatsApp / Evolution para Date (segundos ou ms).
 * Igual a `normalizeWhatsAppTimestamp` do Backend.
 */
export const normalizeWhatsAppTimestamp = (timestamp: unknown): Date => {
  if (timestamp == null || timestamp === '') {
    return new Date();
  }

  if (timestamp instanceof Date) {
    return timestamp;
  }

  const ts = Number(timestamp);
  if (Number.isNaN(ts)) {
    return new Date();
  }

  if (ts < 10000000000) {
    return new Date(ts * 1000);
  }

  return new Date(ts);
};

/**
 * Timestamp devolvido pela Evolution no envio (resposta sendText/sendMedia).
 */
export function parseEvolutionOutboundTimestamp(
  responseData: Record<string, unknown> | null | undefined
): Date | undefined {
  if (!responseData || typeof responseData !== 'object') return undefined;
  const key = responseData.key as Record<string, unknown> | undefined;
  const innerMsg = responseData.message as Record<string, unknown> | undefined;
  const raw =
    key?.timestamp ??
    responseData.messageTimestamp ??
    responseData.messageTimestampLong ??
    responseData.timestamp ??
    innerMsg?.messageTimestamp ??
    innerMsg?.timestamp;
  if (raw == null || raw === '') return undefined;
  return normalizeWhatsAppTimestamp(raw);
}
