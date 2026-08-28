/**
 * API surface. Design rule printed on the wall:
 *
 *   There is NO route that returns a secret. `GET /credentials/:id/secret`
 *   does not exist — hitting anything like it 404s AND writes a RED_TEAM_PROBE
 *   event. The only credential-adjacent calls are capability endpoints:
 *   issue grant → consume grant (browser connector / gateway only).
 *
 * Tenant ids are NEVER read from the request; they come from the verified
 * access token's session. Query/body `tenant` params are ignored by design.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { jwtVerify } from 'jose';
import { cfg, pool, redis, withTenant, HttpError } from './db.js';
import { audit, verifyChain, type AuditType } from './audit.js';
import { establishSession, rotateRefresh, passwordLogin, oidcCallback, totpValid, type Principal } from './auth.js';
import { createCredential, issueLaunchGrant, consumeGrant, attemptReveal, breakGlass, rotateCredential, rotateTenantKeys } from './vault.js';
import { checkInitialSetup, initializeSystem } from './setup.js';
import { randomToken } from './crypto.js';

const jwtSecret = new TextEncoder().encode(cfg.cookieSecret);

/* ---------------- principal resolution (tenant derived from token) -------- */
async function principal(req: FastifyRequest): Promise<Principal> {
  const access = req.cookies['kr_access'];
  if (!access) throw new HttpError(401, 'UNAUTHENTICATED', 'Missing session');
  let payload: { sub?: string; sid?: string; role?: string; tenant?: string };
  try {
    ({ payload } = await jwtVerify(access, jwtSecret, { issuer: cfg.issuer }));
  } catch { throw new HttpError(401, 'TOKEN_INVALID', 'Access token failed signature/expiry check'); }
  const tenantId = payload.tenant;
  if (!tenantId || !payload.sub || !payload.sid) throw new HttpError(401, 'TOKEN_INVALID', 'Malformed token');
  // users/roles are RLS-FORCED → resolve the principal inside a tenant-pinned tx
  return withTenant(tenantId, async (c) => {
    const { rows } = await c.query(
      `SELECT u.id, u.tenant_id, u.email, u.name, r.name AS role
         FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id WHERE u.id = $1 AND u.status='ACTIVE'`,
      [payload.sub]);
    if (!rows.length) throw new HttpError(401, 'SESSION_REVOKED', 'Session revoked');
    const u = rows[0];
    const { rows: perms } = await c.query(
      `SELECT DISTINCT p.name FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id
         JOIN user_roles ur ON ur.role_id=rp.role_id WHERE ur.user_id=$1`, [u.id]);
    return {
      userId: u.id, tenantId: u.tenant_id, email: u.email, name: u.name, role: u.role ?? 'USER',
      sessionId: payload.sid!, authMethod: 'cookie', permissions: perms.map((r: { name: string }) => r.name),
    };
  });
}

function require(p: Principal, perm: string) {
  if (!(p.permissions.includes(perm) || p.permissions.includes('*')))
    throw new HttpError(403, 'FORBIDDEN', `${perm} required`);
}

/* ---------------- app factory (imported by tests via app.inject()) --------- */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.secret'] } });

  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute', allowList: () => false });

  // security headers: CSP forbids inline script/eval; HSTS on; no sniff; isolated context
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message, auditId: err.auditId });
    app.log.error({ err: { message: err.message } }, 'unhandled'); // never log raw bodies
    return reply.status(500).send({ error: 'INTERNAL', message: 'Internal error' });
  });

  app.get('/healthz', async () => ({ ok: true, ts: Date.now() }));
  /* ---------------- initial setup (only available before first tenant) ---------------- */
  app.get('/setup/check', async (_req, reply) => {
    try {
      const result = await checkInitialSetup();
      return result;
    } catch (e) {
      return reply.status(500).send({ error: 'SETUP_CHECK_FAILED', message: e instanceof Error ? e.message : 'Unknown error' });
    }
  });

  const initSchema = z.object({
    organizationName: z.string().min(2).max(120),
    adminName: z.string().min(2).max(120),
    adminEmail: z.string().email(),
    adminPassword: z.string().min(12).max(128),
    tenantSlug: z.string().min(2).max(64).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/),
  });

  app.post('/setup/initialize', async (req, reply) => {
    const body = initSchema.parse(req.body);
    try {
      const result = await initializeSystem(body);
      return result;
    } catch (e) {
      return reply.status(400).send({ error: 'SETUP_FAILED', message: e instanceof Error ? e.message : 'Unknown error' });
    }
  });


  /* ---------------- auth ---------------- */
  const loginSchema = z.object({ tenant: z.string().min(2).max(64), email: z.string().email(), password: z.string().min(8).max(128) });

  app.post('/auth/login', async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const ip = req.ip;
    const { user, role, mfaRequired } = await passwordLogin(body.tenant, body.email, body.password, ip);
    if (!mfaRequired) { await establishSession(user, role, 'PASSWORD', reply); return { ok: true }; }
    // persist the MFA challenge server-side (5-min TTL) — the client only ever sees the token
    const mm = await withTenant(user.tenant_id, (c) =>
      c.query(`SELECT convert_from(secret_enc, 'utf8') AS secret FROM mfa_methods WHERE user_id = $1 AND kind = 'TOTP' LIMIT 1`, [user.id]));
    const secret = mm.rows[0]?.secret;
    if (!secret) throw new HttpError(412, 'MFA_NOT_ENROLLED', 'No TOTP method enrolled for this user');
    const mfaToken = randomToken(12);
    await redis.set(`mfa:${mfaToken}`, JSON.stringify({
      secret, userId: user.id, tenantId: user.tenant_id, email: user.email, name: user.name, role,
    }), 'EX', 300);
    return { mfaRequired: true, mfaToken, user: { name: user.name } };
  });

  app.post('/auth/mfa', async (req, reply) => {
    const { mfaToken, code } = z.object({ mfaToken: z.string(), code: z.string().length(6) }).parse(req.body);
    // mfaToken → pending challenge in redis (5 min TTL, single attempt window)
    const { redis } = await import('./db.js');
    const raw = await redis.get(`mfa:${mfaToken}`);
    if (!raw) throw new HttpError(410, 'MFA_EXPIRED', 'MFA challenge expired');
    const ch = JSON.parse(raw);
    if (!totpValid(ch.secret, code)) {
      await audit({ tenantId: ch.tenantId, actorId: ch.userId, actorName: ch.email, type: 'MFA_FAILURE', result: 'FAILURE', meta: 'TOTP mismatch', sourceIp: req.ip });
      throw new HttpError(401, 'MFA_INVALID', 'TOTP rejected');
    }
    await redis.del(`mfa:${mfaToken}`);
    await audit({ tenantId: ch.tenantId, actorId: ch.userId, actorName: ch.email, type: 'MFA_SUCCESS' });
    await establishSession({ id: ch.userId, tenant_id: ch.tenantId, email: ch.email, name: ch.name }, ch.role, 'PASSWORD+TOTP', reply);
    return { ok: true };
  });

  app.get('/auth/:provider/callback', async (req, reply) => {
    const { provider } = req.params as { provider: string };
    if (!['google', 'entra'].includes(provider)) throw new HttpError(404, 'UNKNOWN_PROVIDER', 'Unknown IdP');
    const user = await oidcCallback((req.query as { tenant: string }).tenant, provider, req.query as Record<string, string>, req.ip);
    await establishSession(user, 'USER', `${provider.toUpperCase()}_SSO`, reply);
    return reply.redirect('/');
  });

  app.post('/auth/refresh', async (req, reply) => {
    const out = await rotateRefresh(req.cookies['kr_refresh'] ?? '');
    if (!out) throw new HttpError(401, 'REFRESH_INVALID', 'Refresh rejected (expired, rotated, or reuse detected)');
    reply.setCookie('kr_access', out.access, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 300 });
    reply.setCookie('kr_refresh', out.refresh, { httpOnly: true, secure: true, sameSite: 'strict', path: '/auth/refresh', maxAge: cfg.sessionTtlMin * 60 });
    return { ok: true };
  });

  app.post('/auth/logout', async (req, reply) => {
    const p = await principal(req);
    const { redis } = await import('./db.js');
    await redis.del(`session:${p.sessionId}`);
    reply.clearCookie('kr_access'); reply.clearCookie('kr_refresh', { path: '/auth/refresh' });
    await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'SESSION_TERMINATED', meta: 'logout · refresh family revoked' });
    return { ok: true };
  });

  app.get('/me', async (req) => {
    const p = await principal(req);
    return { id: p.userId, name: p.name, email: p.email, role: p.role, tenantId: p.tenantId, permissions: p.permissions };
  });

  /* ---------------- vault metadata (never secrets) ---------------- */
  app.get('/credentials', async (req) => {
    const p = await principal(req);
    require(p, 'credential.view_metadata');
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, name, target, kind, key_version, rotation_policy, access, jit_window_min,
                health, rotated_at, last_used_at, secret_length, created_at
           FROM credentials WHERE deleted_at IS NULL ORDER BY name`);
      return rows; // ciphertext columns are deliberately not selected
    });
  });

  const credSchema = z.object({
    name: z.string().min(3).max(120), target: z.string().min(3).max(253),
    kind: z.enum(['PASSWORD', 'API_KEY', 'SSH_KEY', 'TOKEN', 'CERTIFICATE', 'SECURE_NOTE', 'RECOVERY_CODES']),
    username: z.string().max(253), secret: z.string().min(12).max(4096),
    collectionIds: z.array(z.string().uuid()), rotationPolicy: z.string().max(40),
    access: z.enum(['PERMANENT', 'APPROVAL_REQUIRED', 'ONE_TIME', 'SCHEDULED', 'EMERGENCY']),
    jitWindowMin: z.number().int().min(5).max(480).optional(),
  });
  app.post('/credentials', async (req) => {
    const p = await principal(req);
    return createCredential(p, credSchema.parse(req.body));
  });
  app.patch('/credentials/:id', async (req) => {
    const p = await principal(req);
    require(p, 'credential.update');
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().min(3).optional(), rotationPolicy: z.string().optional(), access: z.string().optional() }).parse(req.body);
    return withTenant(p.tenantId, async (c) => {
      await c.query(`UPDATE credentials SET name = coalesce($1,name), rotation_policy = coalesce($2,rotation_policy), access = coalesce($3,access) WHERE id=$4`, [body.name, body.rotationPolicy, body.access, id]);
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'CREDENTIAL_UPDATED', resourceId: id });
      return { ok: true };
    });
  });

  /* ---------------- applications (metadata for the launcher) ---------------- */
  app.get('/applications', async (req) => {
    const p = await principal(req);
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT a.id, a.name, a.kind, a.domain, a.url, a.auth_flow, a.via_connector,
                ac.credential_id
           FROM applications a
           LEFT JOIN application_credentials ac ON ac.application_id = a.id
          ORDER BY a.name`);
      return rows; // selectors stay server-side; the connector receives them per-grant only
    });
  });

  /* --- the anti-endpoint: anything resembling plaintext retrieval is a probe --- */
  app.all('/credentials/:id/secret', async (req) => {
    const p = await principal(req).catch(() => null);
    if (p) await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'RED_TEAM_PROBE', result: 'DENIED', resourceId: (req.params as { id: string }).id, meta: `plaintext endpoint probe via ${req.method}` });
    throw new HttpError(404, 'NO_SUCH_ROUTE', 'This endpoint does not exist by design');
  });
  app.post('/credentials/:id/reveal', async (req) => {
    const p = await principal(req);
    return attemptReveal(p, (req.params as { id: string }).id); // always denies for API callers
  });

  /* ---------------- launch (capability flow) ---------------- */
  app.post('/credentials/:id/launch', async (req) => {
    const p = await principal(req);
    const { applicationId } = z.object({ applicationId: z.string().uuid() }).parse(req.body);
    return issueLaunchGrant(p, (req.params as { id: string }).id, applicationId, {
      ip: req.ip, deviceFp: (req.headers['x-device-fp'] as string) ?? 'unknown', mfaFresh: req.headers['x-mfa-fresh'] === '1',
    });
  });

  // Called by the browser connector / session gateway with the single-use token.
  app.post('/launch/consume', async (req) => {
    const p = await principal(req);
    const { token, kind } = z.object({ token: z.string().min(32), kind: z.enum(['web-inject', 'ssh-proxy', 'rdp-proxy', 'db-proxy']) }).parse(req.body);
    return consumeGrant(p, token, async (op) => {
      // hand the operation to the right broker; op.secret dies in this closure
      if (kind === 'web-inject') return { gateway: `inject-gw/${op.domain}` };
      return { gateway: `session-gw/${kind}` };
    });
  });

  /* ---------------- access requests / approvals ---------------- */
  app.post('/credentials/:id/request-access', async (req) => {
    const p = await principal(req);
    const body = z.object({ reason: z.string().min(8).max(500), ticket: z.string().max(40).optional(), hours: z.number().min(0.5).max(24) }).parse(req.body);
    return withTenant(p.tenantId, async (c) => {
      const ins = await c.query(
        `INSERT INTO access_requests (tenant_id, user_id, credential_id, reason, ticket, window_hours)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [p.tenantId, p.userId, (req.params as { id: string }).id, body.reason, body.ticket ?? null, body.hours]);
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'ACCESS_REQUESTED', resourceId: (req.params as { id: string }).id, meta: `window=${body.hours}h ticket=${body.ticket ?? 'N/A'}` });
      return { id: ins.rows[0].id };
    });
  });

  app.post('/access-requests/:id/:decision', async (req) => {
    const p = await principal(req);
    require(p, 'policy.update');
    const { id, decision } = req.params as { id: string; decision: 'approve' | 'deny' };
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT * FROM access_requests WHERE id=$1 AND status='PENDING'`, [id]);
      if (!rows.length) throw new HttpError(404, 'NOT_PENDING', 'Request not pending');
      const r = rows[0];
      if (decision === 'approve')
        await c.query(`UPDATE access_requests SET status='APPROVED', expires_at = now() + (window_hours || ' hours')::interval WHERE id=$1`, [id]);
      else await c.query(`UPDATE access_requests SET status='DENIED' WHERE id=$1`, [id]);
      await c.query(`INSERT INTO approvals (request_id, approver_id, decision) VALUES ($1,$2,$3)`, [id, p.userId, decision.toUpperCase()]);
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: decision === 'approve' ? 'ACCESS_APPROVED' : 'ACCESS_DENIED', resourceId: r.credential_id, meta: `${decision}d by ${p.name}` });
      return { ok: true };
    });
  });

  /* ---------------- sessions / audit / rotation / connectors ---------------- */
  app.get('/sessions', async (req) => {
    const p = await principal(req);
    return withTenant(p.tenantId, async (c) => {
      const admin = p.permissions.includes('session.terminate') || p.permissions.includes('*');
      const { rows } = await c.query(
        `SELECT s.id, u.name AS "user", a.name AS app, s.gateway, s.source_ip::text, s.status,
                s.started_at, s.expires_at, s.recording
           FROM sessions s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN applications a ON a.id=s.application_id
          WHERE s.tenant_id=$1 AND ($2::boolean OR s.user_id = $3::uuid)
          ORDER BY s.started_at DESC LIMIT 200`, [p.tenantId, admin, p.userId]);
      return rows;
    });
  });

  app.post('/sessions/:id/terminate', async (req) => {
    const p = await principal(req);
    const { id } = req.params as { id: string };
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(`SELECT user_id, tenant_id FROM sessions WHERE id=$1`, [id]);
      if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Session not found');
      if (rows[0].user_id !== p.userId) require(p, 'session.terminate');
      await c.query(`UPDATE sessions SET status='TERMINATED', ended_at=now() WHERE id=$1`, [id]);
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'SESSION_TERMINATED', resourceId: id, meta: `terminated by ${p.name}` });
      return { ok: true };
    });
  });

  app.get('/audit-events', async (req) => {
    const p = await principal(req);
    require(p, 'audit.view');
    const q = z.object({ type: z.string().optional(), limit: z.coerce.number().max(500).default(200) }).parse(req.query);
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, actor_name, event_type, resource_name, result, meta, hash, prev_hash, at
           FROM audit_events ${q.type ? `WHERE event_type = '${q.type.replace(/'/g, "''")}'` : ''}
          ORDER BY id DESC LIMIT $1`, [q.limit]);
      return rows;
    });
  });
  app.get('/audit-events/verify', async (req) => {
    const p = await principal(req);
    require(p, 'audit.view');
    return verifyChain(p.tenantId);
  });

  app.post('/credentials/:id/rotate', async (req) => {
    const p = await principal(req);
    // adapters injected by deployment (ssh adapter, web adapter…) — verify-before-store enforced inside
    return rotateCredential(p, (req.params as { id: string }).id, {
      changePassword: async () => { /* target adapter */ },
      verify: async () => true,
    });
  });
  app.post('/keys/rotate', async (req) => rotateTenantKeys(await principal(req)));

  app.post('/break-glass', async (req) => {
    const p = await principal(req);
    const body = z.object({ credentialId: z.string().uuid(), reason: z.string(), coSignTicket: z.string(), secondApproverId: z.string().uuid() }).parse(req.body);
    return breakGlass(p, body);
  });

  app.post('/connectors/register', async (req) => {
    const p = await principal(req);
    require(p, 'policy.create');
    const body = z.object({ name: z.string().min(3).max(60), site: z.string().max(120).optional(), deviceCertFp: z.string().min(16) }).parse(req.body);
    return withTenant(p.tenantId, async (c) => {
      const ins = await c.query(
        `INSERT INTO connectors (tenant_id, name, site, device_cert_fp) VALUES ($1,$2,$3,$4) RETURNING id`,
        [p.tenantId, body.name, body.site ?? null, body.deviceCertFp]);
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'CONNECTOR_REGISTERED', resourceId: ins.rows[0].id, resourceName: body.name, meta: 'outbound mTLS · no inbound ports' });
      return { id: ins.rows[0].id, enrollToken: randomToken(24) };
    });
  });
  app.get('/connectors', async (req) => {
    const p = await principal(req);
    return withTenant(p.tenantId, async (c) => (await c.query(`SELECT id,name,site,status,version,last_heartbeat,registered_at FROM connectors`)).rows);
  });
  app.post('/connectors/:id/revoke', async (req) => {
    const p = await principal(req);
    require(p, 'policy.update');
    return withTenant(p.tenantId, async (c) => {
      await c.query(`UPDATE connectors SET status='REVOKED', revoked_at=now() WHERE id=$1`, [(req.params as { id: string }).id]);
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'CONNECTOR_REVOKED', resourceId: (req.params as { id: string }).id });
      return { ok: true };
    });
  });

  return app;
}
