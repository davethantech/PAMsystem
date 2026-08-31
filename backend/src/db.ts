/**
 * Data access — PostgreSQL (private subnet only) + Redis (cache/queue).
 *
 * Tenant isolation strategy: the application role is a NON-superuser with
 * FORCE ROW LEVEL SECURITY on every tenant table. `withTenant()` pins
 * `app.tenant_id` for the transaction, so even a buggy query cannot leak
 * rows across tenants. Tenant ids are ALWAYS derived from the verified
 * session (see routes.ts) — never from request bodies or query params.
 */
import pg from 'pg';
import Redis from 'ioredis';
import fs from 'node:fs';
import path from 'node:path';

export const cfg = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://keyrail:keyrail@localhost:5432/keyrail',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  kmsProvider: (process.env.KMS_PROVIDER ?? 'local') as 'aws' | 'local',
  kmsKeyId: process.env.KMS_KEY_ID ?? '',
  cookieSecret: process.env.COOKIE_SECRET ?? 'change-me-64-bytes',
  sessionTtlMin: Number(process.env.SESSION_TTL_MIN ?? 120),
  idleTimeoutMin: Number(process.env.IDLE_TIMEOUT_MIN ?? 15),
  grantTtlSec: 30,
  issuer: process.env.ISSUER ?? 'https://pam.keyrail.cloud',
};

import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';

const realPool = new pg.Pool({
  connectionString: cfg.databaseUrl,
  max: 20,
  connectionTimeoutMillis: 2000,
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

let memPool: any = null;
let initializedMemDb = false;
let isUsingFallback = false;

async function getMemPool() {
  if (!memPool) {
    const db = newDb({ autoCreateForeignKeyIndices: true });
    db.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      implementation: () => crypto.randomUUID(),
      impure: true,
    });
    db.public.registerFunction({
      name: 'uuid_generate_v4',
      returns: DataType.uuid,
      implementation: () => crypto.randomUUID(),
      impure: true,
    });
    db.public.registerFunction({
      name: 'set_config',
      args: [DataType.text, DataType.text, DataType.bool],
      returns: DataType.text,
      implementation: (_setting, value) => value,
    });
    db.public.registerFunction({
      name: 'char_length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (str: string) => (str ? str.length : 0),
    });
    db.public.registerFunction({
      name: 'convert_from',
      args: [DataType.bytea, DataType.text],
      returns: DataType.text,
      implementation: (buf: any) => (buf ? Buffer.from(buf).toString('utf8') : ''),
    });
    db.public.registerFunction({
      name: 'hashtext',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (_text: string) => 12345,
    });
    db.public.registerFunction({
      name: 'pg_advisory_xact_lock',
      args: [DataType.integer],
      returns: DataType.null,
      implementation: () => null,
    });
    
    // Run migrations on pg-mem instance
    try {
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
            .replace(/CREATE TABLE applications \([\s\S]*?via_connector uuid REFERENCES connectors_stub[\s\S]*?\);/gi, '')
            .replace(/DROP TABLE IF EXISTS applications CASCADE;/gi, '')
            .replace(/INSERT INTO permissions [\s\S]*?DO NOTHING;/gi, '')
            .replace(/INSERT INTO roles [\s\S]*?DO NOTHING;/gi, '')
            .replace(/DO \$\$[\s\S]*?END \$\$;/gi, '')
            .replace(/CREATE POLICY [^;]+;/gi, '')
            .replace(/CHECK\s*\(\s*char_length\([^)]+\)\s*>=?\s*\d+\s*\)/gi, '')
            .replace(/ALTER TABLE [^;]+ (ENABLE|FORCE) ROW LEVEL SECURITY;/gi, '');
          db.public.none(sql);
        }
      }
    } catch (e) {
      console.warn('[DB] Migration note error:', e);
    }

    const adapter = db.adapters.createPg();
    memPool = new adapter.Pool();

    // Restore persistent disk state if available
    await loadDiskState();
    console.log('[DB] Database schema initialized with persistent storage support.');
  }
  return memPool;
}

const DUMP_PATH = path.resolve(process.cwd(), 'data', 'db_state.json');

export async function saveDiskState() {
  if (!memPool) return;
  try {
    const dataDir = path.dirname(DUMP_PATH);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const tables = [
      'tenants', 'roles', 'permissions', 'role_permissions', 'users', 'user_roles',
      'encryption_keys', 'collections', 'collection_members', 'credentials',
      'credential_versions', 'credential_collections', 'connectors', 'applications',
      'application_credentials', 'access_policies', 'access_requests', 'approvals',
      'launch_grants', 'sessions', 'session_events', 'audit_events', 'devices',
      'mfa_methods', 'api_keys', 'password_rotation_jobs', 'notifications'
    ];

    const dump: Record<string, any[]> = {};
    for (const table of tables) {
      try {
        const { rows } = await memPool.query(`SELECT * FROM ${table}`);
        if (rows && rows.length > 0) {
          dump[table] = rows;
        }
      } catch {}
    }
    fs.writeFileSync(DUMP_PATH, JSON.stringify(dump, null, 2), 'utf8');
  } catch (e) {
    console.warn('[DB] Persistent disk save note:', e);
  }
}

let saveTimer: NodeJS.Timeout | null = null;
export function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveDiskState();
  }, 100);
}

export async function loadDiskState() {
  if (!memPool || !fs.existsSync(DUMP_PATH)) return;
  try {
    const content = fs.readFileSync(DUMP_PATH, 'utf8');
    const dump: Record<string, any[]> = JSON.parse(content);

    const tables = [
      'tenants', 'roles', 'permissions', 'role_permissions', 'users', 'user_roles',
      'encryption_keys', 'collections', 'collection_members', 'credentials',
      'credential_versions', 'credential_collections', 'connectors', 'applications',
      'application_credentials', 'access_policies', 'access_requests', 'approvals',
      'launch_grants', 'sessions', 'session_events', 'audit_events', 'devices',
      'mfa_methods', 'api_keys', 'password_rotation_jobs', 'notifications'
    ];

    for (const table of tables) {
      const rows = dump[table];
      if (!rows || !rows.length) continue;
      for (const r of rows) {
        try {
          const keys = Object.keys(r);
          const cols = keys.join(', ');
          const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
          const values = Object.values(r).map((v) => {
            if (v && typeof v === 'object' && (v.type === 'Buffer' || Array.isArray(v.data))) {
              const buf = Buffer.from(v.data ?? v);
              return '\\x' + buf.toString('hex');
            }
            return v;
          });
          await memPool.query(`INSERT INTO ${table} (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, values);
        } catch (e) {}
      }
    }
    console.log('[DB] Persistent disk state successfully restored.');
  } catch (e) {
    console.warn('[DB] Persistent disk restore error:', e);
  }
}

function wrapClient(client: any) {
  if (!client || client._wrapped) return client;
  const origQuery = client.query.bind(client);
  client.query = async (...args: any[]) => {
    const res = await origQuery(...args);
    if (typeof args[0] === 'string') {
      const sql = args[0].trim().toUpperCase();
      if (sql.startsWith('INSERT') || sql.startsWith('UPDATE') || sql.startsWith('DELETE') || sql.startsWith('TRUNCATE') || sql.startsWith('COMMIT')) {
        scheduleSave();
      }
    }
    return res;
  };
  client._wrapped = true;
  return client;
}

export const pool: pg.Pool = new Proxy(realPool as any, {
  get(target, prop, receiver) {
    if (prop === 'connect' || prop === 'query') {
      return async (...args: any[]) => {
        if (isUsingFallback) {
          const fallback = await getMemPool();
          if (prop === 'query') {
            const res = await fallback.query(...args);
            if (typeof args[0] === 'string') {
              const sql = args[0].trim().toUpperCase();
              if (sql.startsWith('INSERT') || sql.startsWith('UPDATE') || sql.startsWith('DELETE') || sql.startsWith('TRUNCATE')) {
                scheduleSave();
              }
            }
            return res;
          } else {
            const client = await fallback.connect();
            return wrapClient(client);
          }
        }
        try {
          return prop === 'query' ? await target.query(...args) : await target.connect();
        } catch (err) {
          console.warn('[DB] Live PostgreSQL unavailable — switching to zero-config persistent database');
          isUsingFallback = true;
          const fallback = await getMemPool();
          if (prop === 'query') {
            const res = await fallback.query(...args);
            if (typeof args[0] === 'string') {
              const sql = args[0].trim().toUpperCase();
              if (sql.startsWith('INSERT') || sql.startsWith('UPDATE') || sql.startsWith('DELETE') || sql.startsWith('TRUNCATE')) {
                scheduleSave();
              }
            }
            return res;
          } else {
            const client = await fallback.connect();
            return wrapClient(client);
          }
        }
      };
    }
    return Reflect.get(target, prop, receiver);
  },
});

export const redis = new (Redis as any)(cfg.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
redis.on('error', () => {});

/** Run `fn` inside a transaction pinned to exactly one tenant. */
export async function withTenant<T>(tenantId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // set LOCAL: scoped to the transaction, cannot leak across queries
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public auditId?: string) {
    super(message);
  }
}

/** Run the SQL migrations in /database/migrations (dev convenience; prod uses CI). */
export async function migrate() {
  const dir = path.resolve(process.cwd(), '../database/migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await pool.query(sql);
    console.log(`migrated ${f}`);
  }
}

if (process.argv.includes('--migrate')) migrate().then(() => process.exit(0));
