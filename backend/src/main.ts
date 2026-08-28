/**
 * Keyrail backend entrypoint.
 * Can run as:
 * 1. Standalone server (listen on port)
 * 2. Vercel Serverless Function (export handler)
 * 
 * Listens on 8080 inside the private API subnet; the public edge (LB/ingress)
 * terminates TLS 1.3 and never routes here directly from the internet.
 */
import { buildApp } from './routes.js';
import { pool, redis, cfg, withTenant } from './db.js';

let appPromise: Promise<any> | null = null;

async function getApp() {
  if (!appPromise) {
    appPromise = buildApp();
  }
  return appPromise;
}

// Standalone server mode
async function main() {
  const app = await getApp();
  await redis.connect().catch(() => app.log.warn('redis unavailable \u2014 session store degraded'));

  // periodic: expire grants, JIT windows, idle sessions.
  // All targets are RLS-FORCED, so sweep per tenant inside a pinned transaction.
  const janitor = setInterval(async () => {
    const { rows: tenants } = await pool.query(`SELECT id FROM tenants WHERE status = 'ACTIVE'`);
    for (const t of tenants) {
      await withTenant(t.id, async (c) => {
        await c.query(`DELETE FROM launch_grants WHERE expires_at < now() - interval '1 hour'`);
        await c.query(`UPDATE access_requests SET status='EXPIRED' WHERE status='APPROVED' AND expires_at < now()`);
        await c.query(`UPDATE sessions SET status='EXPIRED', ended_at=expires_at WHERE status='ACTIVE' AND expires_at < now()`);
      }).catch((e: any) => app.log.warn({ err: e.message }, 'janitor sweep failed'));
    }
  }, 30_000);

  const shutdown = async (sig: string) => {
    app.log.info(`${sig} \u2014 draining`);
    clearInterval(janitor);
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ host: '0.0.0.0', port: cfg.port });
}

// Vercel Serverless Function mode
export const handler = async (req: any, res: any) => {
  const app = await getApp();
  await redis.connect().catch(() => {});
  
  // Handle the request
  await app.ready();
  app.server.emit('request', req, res);
};

// Export for Vercel
module.exports = { handler };

// Start standalone server if not in Vercel
if (process.env.VERCEL !== '1') {
  main().catch((e) => { console.error('fatal', e.message); process.exit(1); });
}
