/**
 * Erros de rede/DNS frequentes em Docker/cloud (EAI_AGAIN, etc.) — retentativa com backoff ajuda.
 */

const TRANSIENT_CODES = new Set([
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EPIPE',
  'ESOCKETTIMEDOUT',
]);

export function isTransientDbNetworkError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as NodeJS.ErrnoException & { code?: string };
  if (e.code && TRANSIENT_CODES.has(e.code)) return true;
  const msg = String((e as Error).message || '');
  if (msg.includes('getaddrinfo')) return true;
  if (msg.includes('Connection terminated')) return true;
  if (msg.includes('timeout') && msg.includes('connect')) return true;
  return false;
}

export async function retryTransientAsync<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; baseDelayMs?: number }
): Promise<T> {
  const attempts = Math.max(1, opts?.attempts ?? 4);
  const base = Math.max(50, opts?.baseDelayMs ?? 800);
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isTransientDbNetworkError(e) || i === attempts - 1) {
        throw e;
      }
      const delay = base * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw last;
}
