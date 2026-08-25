/**
 * Keyrail backend entrypoint.
 * Listens on 8080 inside the private API subnet; the public edge (LB/ingress)
 * terminates TLS 1.3 and never routes here directly from the internet.
 */
import { buildApp } from './routes.js';
import { pool, redis, cfg } from './db.js';

async function main() {
  const app = await buildApp();
  await redis.connect().catch(() => app.log.warn('redis unavailable — session store degraded'));

  // periodic: expire grants, JIT windows, idle sessions
  const janitor = setInterval(async () => {
    await pool.query(`DELETE FROM launch_grants WHERE expires_at < now() - interval '1 hour'`);
    await pool.query(`UPDATE access_requests SET status='EXPIRED' WHERE status='APPROVED' AND expires_at < now()`);
    await pool.query(`UPDATE sessions SET status='EXPIRED', ended_at=expires_at WHERE status='ACTIVE' AND expires_at < now()`);
  }, 30_000);

  const shutdown = async (sig: string) => {
    app.log.info(`${sig} — draining`);
    clearInterval(janitor);
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ host: '0.0.0.0', port: cfg.port });
}

main().catch((e) => { console.error('fatal', e.message); process.exit(1); });
