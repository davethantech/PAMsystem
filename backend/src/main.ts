/**
 * Keyrail backend entrypoint.
 * Production runtime is a persistent Fastify process. Vercel/serverless is not
 * supported for the control plane because Playwright sessions and the janitor
 * require process lifetime.
 */
import { buildApp } from './routes.js';
import { pool, redis, cfg, withTenant } from './db.js';

let appPromise: Promise<any> | null = null;
let shuttingDown = false;
let janitorRunning = false;

async function getApp() {
  if (!appPromise) appPromise = buildApp();
  return appPromise;
}

async function assertInfrastructure() {
  if (!cfg.cookieSecret || cfg.cookieSecret === 'change-me-64-bytes') {
    throw new Error('COOKIE_SECRET is not configured with a strong secret');
  }
  await pool.query('SELECT 1');
  await redis.connect();
  await redis.ping();
}

async function runJanitor(app: any) {
  if (janitorRunning || shuttingDown) return;
  janitorRunning = true;
  try {
    const { rows: tenants } = await pool.query(`SELECT id FROM tenants WHERE status = 'ACTIVE'`);
    for (const t of tenants) {
      await withTenant(t.id, async (c) => {
        await c.query(`DELETE FROM launch_grants WHERE expires_at < now() - interval '1 hour'`);
        await c.query(`UPDATE access_requests SET status='EXPIRED' WHERE status='APPROVED' AND expires_at < now()`);
        await c.query(`UPDATE sessions SET status='EXPIRED', ended_at=COALESCE(ended_at, expires_at) WHERE status='ACTIVE' AND expires_at < now()`);
      }).catch((e: any) => app.log.warn({ err: e.message }, 'janitor tenant sweep failed'));
    }
  } finally {
    janitorRunning = false;
  }
}

async function main() {
  const app = await getApp();
  await assertInfrastructure();

  const janitor = setInterval(() => { void runJanitor(app); }, 30_000);
  await runJanitor(app);

  const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${sig} — draining`);
    clearInterval(janitor);
    await app.close().catch(() => {});
    await redis.quit().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });

  await app.listen({ host: '0.0.0.0', port: cfg.port });
  app.log.info({ port: cfg.port, nodeEnv: cfg.nodeEnv }, 'Keyrail API ready');
}

main().catch((e) => {
  console.error('Keyrail fatal startup error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
