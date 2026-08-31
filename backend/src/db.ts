/**
 * Keyrail data access.
 * Production is PostgreSQL + Redis only.
 * pg-mem exists solely for explicit development/test mode and is never selected
 * silently when production PostgreSQL is unavailable.
 */
import pg from 'pg';
import Redis from 'ioredis';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { newDb, DataType } from 'pg-mem';

export const cfg = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://keyrail:keyrail@localhost:5432/keyrail',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  kmsProvider: (process.env.KMS_PROVIDER ?? 'local') as 'aws' | 'local',
  kmsKeyId: process.env.KMS_KEY_ID ?? '',
  cookieSecret: process.env.COOKIE_SECRET ?? '',
  sessionTtlMin: Number(process.env.SESSION_TTL_MIN ?? 120),
  idleTimeoutMin: Number(process.env.IDLE_TIMEOUT_MIN ?? 15),
  grantTtlSec: 30,
  issuer: process.env.ISSUER ?? 'https://pam.keyrail.cloud',
  nodeEnv: process.env.NODE_ENV ?? 'development',
};

const isProduction = cfg.nodeEnv === 'production';
if (isProduction) {
  if (!cfg.cookieSecret || cfg.cookieSecret === 'change-me-64-bytes') {
    throw new Error('COOKIE_SECRET must be set to a strong random value in production');
  }
  if (cfg.kmsProvider === 'aws' && !cfg.kmsKeyId) {
    throw new Error('KMS_KEY_ID is required when KMS_PROVIDER=aws');
  }
}

const realPool = new pg.Pool({
  connectionString: cfg.databaseUrl,
  max: Number(process.env.PG_POOL_MAX ?? 20),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 2000),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30000),
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
  application_name: 'keyrail-api',
});

let memPool: any = null;
let isUsingFallback = false;

async function getMemPool() {
  if (!memPool) {
    const db = newDb({ autoCreateForeignKeyIndices: true });
    db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, implementation: () => crypto.randomUUID(), impure: true });
    db.public.registerFunction({ name: 'uuid_generate_v4', returns: DataType.uuid, implementation: () => crypto.randomUUID(), impure: true });
    db.public.registerFunction({ name: 'set_config', args: [DataType.text, DataType.text, DataType.bool], returns: DataType.text, implementation: (_s, v) => v });
    db.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (s: string) => (s ? s.length : 0) });
    db.public.registerFunction({ name: 'convert_from', args: [DataType.bytea, DataType.text], returns: DataType.text, implementation: (b: any) => (b ? Buffer.from(b).toString('utf8') : '') });
    db.public.registerFunction({ name: 'hashtext', args: [DataType.text], returns: DataType.integer, implementation: () => 12345 });
    db.public.registerFunction({ name: 'pg_advisory_xact_lock', args: [DataType.integer], returns: DataType.null, implementation: () => null });
    const migrationsDir = path.resolve(process.cwd(), '../database/migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
      for (const f of files) {
        let sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
        sql = sql
          .replace(/CREATE EXTENSION IF NOT EXISTS [^;]+;/gi, '')
          .replace(/CREATE OR REPLACE FUNCTION [\s\S]*?LANGUAGE plpgsql;/gi, '')
          .replace(/CREATE TRIGGER [^;]+;/gi, '')
          .replace(/EXECUTE FUNCTION [^;]+;/gi, '')
          .replace(/CREATE POLICY [^;]+;/gi, '')
          .replace(/ALTER TABLE [^;]+ (ENABLE|FORCE) ROW LEVEL SECURITY;/gi, '');
        try { db.public.none(sql); } catch (e) { console.warn(`[DB] dev pg-mem migration note (${f}):`, e instanceof Error ? e.message : e); }
      }
    }
    memPool = db.adapters.createPg().Pool;
    console.warn('[DB] DEVELOPMENT fallback active: pg-mem. Persistent JSON state is development-only.');
    await loadDiskState();
  }
  return memPool;
}

const DUMP_PATH = path.resolve(process.cwd(), 'data', 'db_state.json');
export async function saveDiskState() {
  if (isProduction || !memPool) return;
  const dataDir = path.dirname(DUMP_PATH);
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const tables = ['tenants','roles','permissions','role_permissions','users','user_roles','encryption_keys','collections','collection_members','credentials','credential_versions','credential_collections','connectors','applications','application_credentials','access_policies','access_requests','approvals','launch_grants','sessions','session_events','audit_events','devices','mfa_methods','api_keys','password_rotation_jobs','notifications'];
    const dump: Record<string, any[]> = {};
    for (const table of tables) {
      try { const { rows } = await memPool.query(`SELECT * FROM ${table}`); if (rows?.length) dump[table] = rows; } catch {}
    }
    const tmp = `${DUMP_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(dump), 'utf8');
    fs.renameSync(tmp, DUMP_PATH);
  } catch (e) { console.warn('[DB] Development persistence save failed:', e instanceof Error ? e.message : e); }
}
let saveTimer: NodeJS.Timeout | null = null;
export function scheduleSave() {
  if (isProduction || !memPool) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveDiskState(); }, 100);
}

export async function loadDiskState() {
  if (isProduction || !memPool || !fs.existsSync(DUMP_PATH)) return;
  try {
    const dump: Record<string, any[]> = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8'));
    const tables = ['tenants','roles','permissions','role_permissions','users','user_roles','encryption_keys','collections','collection_members','credentials','credential_versions','credential_collections','connectors','applications','application_credentials','access_policies','access_requests','approvals','launch_grants','sessions','session_events','audit_events','devices','mfa_methods','api_keys','password_rotation_jobs','notifications'];
    for (const table of tables) {
      for (const r of dump[table] ?? []) {
        try {
          const keys = Object.keys(r);
          const values = Object.values(r).map((v: any) => v && typeof v === 'object' && (v.type === 'Buffer' || Array.isArray(v.data)) ? '\\x' + Buffer.from(v.data ?? v).toString('hex') : v);
          await memPool.query(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT DO NOTHING`, values);
        } catch {}
      }
    }
  } catch (e) { throw new Error(`Unable to restore development state: ${e instanceof Error ? e.message : e}`); }
}

function wrapClient(client: any) {
  if (!client || client._wrapped) return client;
  const origQuery = client.query.bind(client);
  client.query = async (...args: any[]) => {
    const res = await origQuery(...args);
    if (!isProduction && typeof args[0] === 'string') {
      const sql = args[0].trim().toUpperCase();
      if (/^(INSERT|UPDATE|DELETE|TRUNCATE|COMMIT)\b/.test(sql)) scheduleSave();
    }
    return res;
  };
  client._wrapped = true;
  return client;
}

export const pool: pg.Pool = new Proxy(realPool as any, {
  get(target, prop, receiver) {
    if (prop !== 'connect' && prop !== 'query') return Reflect.get(target, prop, receiver);
    return async (...args: any[]) => {
      if (isUsingFallback) {
        const fallback = await getMemPool();
        if (prop === 'query') return fallback.query(...args);
        return wrapClient(await fallback.connect());
      }
      try {
        return prop === 'query' ? await target.query(...args) : await target.connect();
      } catch (err) {
        if (isProduction) {
          throw new Error('PostgreSQL is unavailable in production; no fallback database is permitted');
        }
        console.warn('[DB] PostgreSQL unavailable — enabling development pg-mem fallback');
        isUsingFallback = true;
        const fallback = await getMemPool();
        if (prop === 'query') return fallback.query(...args);
        return wrapClient(await fallback.connect());
      }
    };
  },
});

export const redis = new (Redis as any)(cfg.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
redis.on('error', (err: Error) => { if (isProduction) console.error('[Redis] error:', err.message); });

export async function withTenant<T>(tenantId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public auditId?: string) { super(message); }
}

export async function migrate() {
  if (isProduction && isUsingFallback) throw new Error('Cannot migrate production with fallback database');
  const dir = path.resolve(process.cwd(), '../database/migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) { await pool.query(fs.readFileSync(path.join(dir, f), 'utf8')); console.log(`migrated ${f}`); }
}

if (process.argv.includes('--migrate')) migrate().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
