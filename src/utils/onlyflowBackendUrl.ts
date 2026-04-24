/**
 * Base URL do Backend OnlyFlow (HTTP) para chamadas internas entre microserviços.
 * Uma única fonte evita divergência de default entre helpers.
 */
export function getOnlyflowBackendBaseUrl(): string {
  return (process.env.BACKEND_URL || 'http://localhost:4331').replace(/\/$/, '');
}

export const ONLYFLOW_BACKEND_HTTP_TIMEOUT_MS = 5000;

export function onlyflowBackendAuthHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
