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

export const pool = new pg.Pool({
  connectionString: cfg.databaseUrl,
  max: 20,
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

export const redis = new Redis(cfg.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });

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
