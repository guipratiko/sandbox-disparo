/**
 * Configuração e gerenciamento de conexões de banco de dados
 * - PostgreSQL: Templates, Dispatches
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { POSTGRES_CONFIG } from './constants';
import { retryTransientAsync } from '../utils/transientErrors';

function postgresPoolInt(envKey: string, fallback: number, min: number, max: number): number {
  const raw = process.env[envKey];
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const postgresConnectionString = POSTGRES_CONFIG.URI;
const connectionStringForLog = postgresConnectionString.replace(/:[^:@]+@/, ':****@');
console.log(`📡 Disparo PostgreSQL: ${connectionStringForLog}`);

const POSTGRES_POOL_MAX = postgresPoolInt('POSTGRES_POOL_MAX', 20, 2, 100);
const POSTGRES_POOL_CONNECTION_TIMEOUT_MS = postgresPoolInt(
  'POSTGRES_POOL_CONNECTION_TIMEOUT_MS',
  parseInt(process.env.PG_CONNECTION_TIMEOUT_MS || '30000', 10),
  3000,
  120_000
);
const POSTGRES_POOL_IDLE_MS = postgresPoolInt('POSTGRES_POOL_IDLE_TIMEOUT_MS', 30_000, 5000, 300_000);

console.log(
  `📡 Disparo pool: max=${POSTGRES_POOL_MAX}, connectionTimeout=${POSTGRES_POOL_CONNECTION_TIMEOUT_MS}ms, idle=${POSTGRES_POOL_IDLE_MS}ms`
);

// ============================================
// PostgreSQL (Templates, Dispatches)
// ============================================
export const pgPool = new Pool({
  connectionString: postgresConnectionString,
  max: POSTGRES_POOL_MAX,
  idleTimeoutMillis: POSTGRES_POOL_IDLE_MS,
  connectionTimeoutMillis: POSTGRES_POOL_CONNECTION_TIMEOUT_MS,
  keepAlive: true,
});

// Event listeners para PostgreSQL (sem log para evitar spam)

pgPool.on('error', (err: Error) => {
  console.error('❌ Erro inesperado no pool PostgreSQL:', err);
});

// Função para testar conexão PostgreSQL
export const testPostgreSQL = async (): Promise<boolean> => {
  try {
    const client = await getPostgreSQLClient();
    await client.query('SELECT NOW()');
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Erro ao testar conexão PostgreSQL:', error);
    return false;
  }
};

// Função para obter cliente PostgreSQL (para transações)
export const getPostgreSQLClient = async (): Promise<PoolClient> => {
  return await retryTransientAsync(() => pgPool.connect(), {
    attempts: parseInt(process.env.PG_CONNECT_RETRY_ATTEMPTS || '4', 10),
    baseDelayMs: parseInt(process.env.PG_CONNECT_RETRY_BASE_MS || '600', 10),
  });
};

/** Query com retentativa em falhas transitórias de DNS/rede (EAI_AGAIN, etc.). */
export async function pgQuery<T extends QueryResultRow = any>(
  queryText: string,
  values?: unknown[]
): Promise<QueryResult<T>> {
  return retryTransientAsync(() => pgPool.query<T>(queryText, values), {
    attempts: parseInt(process.env.PG_QUERY_RETRY_ATTEMPTS || '4', 10),
    baseDelayMs: parseInt(process.env.PG_QUERY_RETRY_BASE_MS || '800', 10),
  });
}

// ============================================
// Função para conectar todos os bancos
// ============================================
export const connectAllDatabases = async (): Promise<void> => {
  try {
    // Testar PostgreSQL
    const pgConnected = await testPostgreSQL();
    if (pgConnected) {
      console.log('✅ PostgreSQL conectado e testado');
    } else {
      console.warn('⚠️  PostgreSQL não conectado, mas continuando...');
    }
  } catch (error) {
    console.error('❌ Erro ao conectar bancos de dados:', error);
    throw error;
  }
};

// ============================================
// Função para fechar todas as conexões
// ============================================
export const closeAllDatabases = async (): Promise<void> => {
  try {
    // Fechar PostgreSQL
    await pgPool.end();
    console.log('✅ PostgreSQL desconectado');
  } catch (error) {
    console.error('❌ Erro ao fechar conexões:', error);
  }
};

