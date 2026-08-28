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
  /* ---------------- users ---------------- */
  app.get('/users', async (req) => {
    const p = await principal(req);
    require(p, 'user.create');
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, email, name, title, status, mfa_required, last_login_at, created_at
           FROM users WHERE deleted_at IS NULL ORDER BY name`);
      return rows;
    });
  });

  app.post('/users', async (req) => {
    const p = await principal(req);
    require(p, 'user.create');
    const body = z.object({
      email: z.string().email(),
      name: z.string().min(2).max(120),
      title: z.string().max(120).optional(),
      role: z.string().min(2).max(40),
      collectionIds: z.array(z.string().uuid()).default([]),
      password: z.string().min(12).max(128).optional(),
    }).parse(req.body);
    return withTenant(p.tenantId, async (c) => {
      // Check if user exists
      const { rows: existing } = await c.query(
        `SELECT id FROM users WHERE tenant_id = $1 AND email = $2`,
        [p.tenantId, body.email.trim().toLowerCase()]);
      if (existing.length > 0) {
        throw new HttpError(409, 'USER_EXISTS', 'User with this email already exists');
      }
      // Get role ID
      const { rows: roleRows } = await c.query(
        `SELECT id FROM roles WHERE name = $1 AND (tenant_id IS NULL OR tenant_id = $2)`,
        [body.role, p.tenantId]);
      if (roleRows.length === 0) {
        throw new HttpError(400, 'INVALID_ROLE', 'Role does not exist');
      }
      const roleId = roleRows[0].id;
      // Hash password if provided
      let passwordHash = null;
      if (body.password) {
        const argon2 = await import('argon2');
        passwordHash = await argon2.hash(body.password);
      }
      // Create user
      const { rows: userRows } = await c.query(
        `INSERT INTO users (tenant_id, email, name, title, password_hash, status, mfa_required)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', true)
         RETURNING id`,
        [p.tenantId, body.email.trim().toLowerCase(), body.name.trim(), body.title?.trim() || null, passwordHash]);
      const userId = userRows[0].id;
      // Assign role
      await c.query(
        `INSERT INTO user_roles (user_id, role_id, granted_by) VALUES ($1, $2, $3)`,
        [userId, roleId, p.userId]);
      // Add to collections
      for (const colId of body.collectionIds) {
        await c.query(
          `INSERT INTO collection_members (collection_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [colId, userId]);
      }
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'USER_CREATED', resourceId: userId, resourceName: body.name, meta: `role=${body.role}` });
      return { id: userId };
    });
  });

  app.get('/users/:id', async (req) => {
    const p = await principal(req);
    require(p, 'user.create');
    const { id } = req.params as { id: string };
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, email, name, title, status, mfa_required, last_login_at, created_at
           FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [id]);
      if (rows.length === 0) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
      // Get user's roles
      const { rows: roleRows } = await c.query(
        `SELECT r.name as role FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`,
        [id]);
      // Get user's collections
      const { rows: colRows } = await c.query(
        `SELECT collection_id as id FROM collection_members WHERE user_id = $1`,
        [id]);
      return {
        ...rows[0],
        roles: roleRows.map((r: any) => r.role),
        collectionIds: colRows.map((c: any) => c.id),
      };
    });
  });

  app.patch('/users/:id', async (req) => {
    const p = await principal(req);
    require(p, 'user.create');
    const { id } = req.params as { id: string };
    const body = z.object({
      name: z.string().min(2).max(120).optional(),
      title: z.string().max(120).optional(),
      status: z.enum(['ACTIVE', 'DISABLED']).optional(),
      collectionIds: z.array(z.string().uuid()).optional(),
    }).parse(req.body);
    return withTenant(p.tenantId, async (c) => {
      const { rows: existing } = await c.query(
        `SELECT tenant_id FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [id]);
      if (existing.length === 0) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
      if (existing[0].tenant_id !== p.tenantId) throw new HttpError(403, 'FORBIDDEN', 'Cross-tenant access denied');
      const updates: string[] = [];
      const values: (string | null)[] = [];
      let paramIdx = 1;
      if (body.name !== undefined) { updates.push(`name = $${paramIdx++}`); values.push(body.name.trim()); }
      if (body.title !== undefined) { updates.push(`title = $${paramIdx++}`); values.push(body.title?.trim() || null); }
      if (body.status !== undefined) { updates.push(`status = $${paramIdx++}`); values.push(body.status); }
      values.push(id);
      if (updates.length > 0) {
        await c.query(
          `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
          values);
      }
      // Update collections
      if (body.collectionIds !== undefined) {
        await c.query(`DELETE FROM collection_members WHERE user_id = $1`, [id]);
        for (const colId of body.collectionIds) {
          await c.query(
            `INSERT INTO collection_members (collection_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [colId, id]);
        }
      }
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'USER_UPDATED', resourceId: id, meta: Object.keys(body).join(',') });
      return { ok: true };
    });
  });

  app.delete('/users/:id', async (req, reply) => {
    const p = await principal(req);
    require(p, 'user.disable');
    const { id } = req.params as { id: string };
    return withTenant(p.tenantId, async (c) => {
      const { rows: existing } = await c.query(
        `SELECT tenant_id FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [id]);
      if (existing.length === 0) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
      if (existing[0].tenant_id !== p.tenantId) throw new HttpError(403, 'FORBIDDEN', 'Cross-tenant access denied');
      await c.query(
        `UPDATE users SET deleted_at = now(), status = 'DISABLED' WHERE id = $1`,
        [id]);
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'USER_DELETED', resourceId: id });
      return { ok: true };
    });
  });

  /* ---------------- collections ---------------- */
  app.get('/collections', async (req) => {
    const p = await principal(req);
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, name, description, created_at
           FROM collections WHERE tenant_id = $1 ORDER BY name`,
        [p.tenantId]);
      const collections = await Promise.all(rows.map(async (col: any) => {
        const { rows: members } = await c.query(
          `SELECT user_id as id FROM collection_members WHERE collection_id = $1`,
          [col.id]);
        return { ...col, memberUserIds: members.map((m: any) => m.id) };
      }));
      return collections;
    });
  });

  app.post('/collections', async (req) => {
    const p = await principal(req);
    require(p, 'policy.create');
    const body = z.object({
      name: z.string().min(2).max(120),
      description: z.string().max(500).optional(),
      memberUserIds: z.array(z.string().uuid()).default([]),
    }).parse(req.body);
    return withTenant(p.tenantId, async (c) => {
      const { rows: existing } = await c.query(
        `SELECT id FROM collections WHERE tenant_id = $1 AND name = $2`,
        [p.tenantId, body.name.trim()]);
      if (existing.length > 0) {
        throw new HttpError(409, 'COLLECTION_EXISTS', 'Collection with this name already exists');
      }
      const { rows: colRows } = await c.query(
        `INSERT INTO collections (tenant_id, name, description)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [p.tenantId, body.name.trim(), body.description?.trim() || null]);
      const collectionId = colRows[0].id;
      for (const userId of body.memberUserIds) {
        await c.query(
          `INSERT INTO collection_members (collection_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [collectionId, userId]);
      }
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'COLLECTION_CREATED', resourceId: collectionId, resourceName: body.name, meta: `${body.memberUserIds.length} members` });
      return { id: collectionId };
    });
  });

  app.get('/collections/:id', async (req) => {
    const p = await principal(req);
    const { id } = req.params as { id: string };
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, name, description, created_at
           FROM collections WHERE id = $1 AND tenant_id = $2`,
        [id, p.tenantId]);
      if (rows.length === 0) throw new HttpError(404, 'COLLECTION_NOT_FOUND', 'Collection not found');
      const { rows: members } = await c.query(
        `SELECT user_id as id FROM collection_members WHERE collection_id = $1`,
        [id]);
      return { ...rows[0], memberUserIds: members.map((m: any) => m.id) };
    });
  });

  app.patch('/collections/:id', async (req) => {
    const p = await principal(req);
    require(p, 'policy.create');
    const { id } = req.params as { id: string };
    const body = z.object({
      name: z.string().min(2).max(120).optional(),
      description: z.string().max(500).optional(),
      memberUserIds: z.array(z.string().uuid()).optional(),
    }).parse(req.body);
    return withTenant(p.tenantId, async (c) => {
      const { rows: existing } = await c.query(
        `SELECT tenant_id FROM collections WHERE id = $1`,
        [id]);
      if (existing.length === 0) throw new HttpError(404, 'COLLECTION_NOT_FOUND', 'Collection not found');
      if (existing[0].tenant_id !== p.tenantId) throw new HttpError(403, 'FORBIDDEN', 'Cross-tenant access denied');
      const updates: string[] = [];
      const values: (string | null)[] = [];
      let paramIdx = 1;
      if (body.name !== undefined) { updates.push(`name = $${paramIdx++}`); values.push(body.name.trim()); }
      if (body.description !== undefined) { updates.push(`description = $${paramIdx++}`); values.push(body.description?.trim() || null); }
      values.push(id);
      if (updates.length > 0) {
        await c.query(
          `UPDATE collections SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
          values);
      }
      if (body.memberUserIds !== undefined) {
        await c.query(`DELETE FROM collection_members WHERE collection_id = $1`, [id]);
        for (const userId of body.memberUserIds) {
          await c.query(
            `INSERT INTO collection_members (collection_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [id, userId]);
        }
      }
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'COLLECTION_UPDATED', resourceId: id, meta: Object.keys(body).join(',') });
      return { ok: true };
    });
  });

  app.delete('/collections/:id', async (req, reply) => {
    const p = await principal(req);
    require(p, 'policy.create');
    const { id } = req.params as { id: string };
    return withTenant(p.tenantId, async (c) => {
      const { rows: existing } = await c.query(
        `SELECT tenant_id FROM collections WHERE id = $1`,
        [id]);
      if (existing.length === 0) throw new HttpError(404, 'COLLECTION_NOT_FOUND', 'Collection not found');
      if (existing[0].tenant_id !== p.tenantId) throw new HttpError(403, 'FORBIDDEN', 'Cross-tenant access denied');
      await c.query(`DELETE FROM collections WHERE id = $1`, [id]);
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'COLLECTION_DELETED', resourceId: id });
      return { ok: true };
    });
  });

  /* ---------------- tenant info ---------------- */
  app.get('/tenant', async (req) => {
    const p = await principal(req);
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, name, slug, region, plan, created_at FROM tenants WHERE id = $1`,
        [p.tenantId]);
      if (rows.length === 0) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found');
      return rows[0];
    });
  });

  /* ---------------- user roles ---------------- */
  app.get('/roles', async (req) => {
    const p = await principal(req);
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT r.id, r.name, r.is_system, array_agg(p.name) as permissions
           FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
           LEFT JOIN permissions p ON p.id = rp.permission_id
           WHERE r.tenant_id IS NULL OR r.tenant_id = $1
           GROUP BY r.id, r.name, r.is_system
           ORDER BY r.name`,
        [p.tenantId]);
      return rows;
    });
  });

  /* ---------------- user count for dashboard ---------------- */
  app.get('/dashboard/stats', async (req) => {
    const p = await principal(req);
    return withTenant(p.tenantId, async (c) => {
      const [usersResult, credsResult, appsResult, sessionsResult, requestsResult, alertsResult] = await Promise.all([
        c.query(`SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL`),
        c.query(`SELECT COUNT(*) as count FROM credentials WHERE deleted_at IS NULL`),
        c.query(`SELECT COUNT(*) as count FROM applications`),
        c.query(`SELECT COUNT(*) as count FROM sessions WHERE status = 'ACTIVE'`),
        c.query(`SELECT COUNT(*) as count FROM access_requests WHERE status = 'PENDING'`),
        c.query(`SELECT COUNT(*) as count FROM audit_events WHERE event_type = 'RED_TEAM_PROBE' AND ts > now() - interval '24 hours'`),
      ]);
      return {
        totalUsers: parseInt(usersResult.rows[0].count),
        totalCredentials: parseInt(credsResult.rows[0].count),
        totalApplications: parseInt(appsResult.rows[0].count),
        activeSessions: parseInt(sessionsResult.rows[0].count),
        pendingApprovals: parseInt(requestsResult.rows[0].count),
        securityAlerts: parseInt(alertsResult.rows[0].count),
      };
    });
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


  /* ---------------- applications ---------------- */
  app.get('/applications', async (req) => {
    const p = await principal(req);
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, tenant_id, name, description, kind, target_url, collection_id, credential_id, access_policy, created_at, updated_at 
           FROM applications WHERE tenant_id = $1 ORDER BY name`,
        [p.tenantId]);
      return rows;
    });
  });

  app.post('/applications', async (req) => {
    const p = await principal(req);
    require(p, 'application.create');
    const body = z.object({
      name: z.string().min(2).max(120),
      description: z.string().max(500).optional(),
      kind: z.enum(['WEB', 'SSH', 'RDP', 'DB', 'API']),
      targetUrl: z.string().url().optional(),
      collectionId: z.string().uuid().optional(),
      credentialId: z.string().uuid().optional(),
      accessPolicy: z.enum(['DIRECT', 'APPROVAL_REQUIRED', 'JIT']).default('DIRECT'),
    }).parse(req.body);
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO applications (tenant_id, name, description, kind, target_url, collection_id, credential_id, access_policy, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
           RETURNING id, tenant_id, name, description, kind, target_url, collection_id, credential_id, access_policy, created_at, updated_at`,
        [p.tenantId, body.name, body.description, body.kind, body.targetUrl, body.collectionId, body.credentialId, body.accessPolicy]);
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'APPLICATION_CREATED', resourceId: rows[0].id });
      return rows[0];
    });
  });

  app.get('/applications/:id', async (req) => {
    const p = await principal(req);
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, tenant_id, name, description, kind, target_url, collection_id, credential_id, access_policy, created_at, updated_at 
           FROM applications WHERE id = $1 AND tenant_id = $2`,
        [(req.params as { id: string }).id, p.tenantId]);
      if (rows.length === 0) throw new HttpError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
      return rows[0];
    });
  });

  app.patch('/applications/:id', async (req) => {
    const p = await principal(req);
    require(p, 'application.update');
    const body = z.object({
      name: z.string().min(2).max(120).optional(),
      description: z.string().max(500).optional(),
      targetUrl: z.string().url().optional(),
      collectionId: z.string().uuid().optional(),
      credentialId: z.string().uuid().optional(),
      accessPolicy: z.enum(['DIRECT', 'APPROVAL_REQUIRED', 'JIT']).optional(),
    }).parse(req.body);
    return withTenant(p.tenantId, async (c) => {
      const updates: string[] = [];
      const values: (string | null)[] = [];
      let i = 1;
      if (body.name !== undefined) { updates.push(`name = $${i++}`); values.push(body.name); }
      if (body.description !== undefined) { updates.push(`description = $${i++}`); values.push(body.description); }
      if (body.targetUrl !== undefined) { updates.push(`target_url = $${i++}`); values.push(body.targetUrl); }
      if (body.collectionId !== undefined) { updates.push(`collection_id = $${i++}`); values.push(body.collectionId); }
      if (body.credentialId !== undefined) { updates.push(`credential_id = $${i++}`); values.push(body.credentialId); }
      if (body.accessPolicy !== undefined) { updates.push(`access_policy = $${i++}`); values.push(body.accessPolicy); }
      updates.push(`updated_at = now()`);
      
      const { rows } = await c.query(
        `UPDATE applications SET ${updates.join(', ')} WHERE id = $${i} AND tenant_id = $${i+1} RETURNING *`,
        [...values, (req.params as { id: string }).id, p.tenantId]);
      if (rows.length === 0) throw new HttpError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'APPLICATION_UPDATED', resourceId: rows[0].id });
      return rows[0];
    });
  });

  app.delete('/applications/:id', async (req, reply) => {
    const p = await principal(req);
    require(p, 'application.delete');
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `DELETE FROM applications WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [(req.params as { id: string }).id, p.tenantId]);
      if (rows.length === 0) throw new HttpError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'APPLICATION_DELETED', resourceId: rows[0].id });
      return reply.status(204).send();
    });
  });

  /* ---------------- credentials ---------------- */
  app.get('/credentials', async (req) => {
    const p = await principal(req);
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, tenant_id, name, description, kind, target, username, collection_id, access_policy, rotation_policy, key_version, created_at, updated_at 
           FROM credentials WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY name`,
        [p.tenantId]);
      return rows;
    });
  });

  app.post('/credentials', async (req) => {
    const p = await principal(req);
    require(p, 'credential.create');
    const body = z.object({
      name: z.string().min(2).max(120),
      description: z.string().max(500).optional(),
      kind: z.enum(['PASSWORD', 'API_KEY', 'SSH_KEY', 'TOKEN', 'CERT', 'NOTE', 'SECRET']).default('PASSWORD'),
      target: z.string().max(500),
      username: z.string().max(255).optional(),
      secret: z.string().min(1),
      collectionId: z.string().uuid(),
      accessPolicy: z.enum(['PERMANENT', 'JIT', 'APPROVAL_REQUIRED']).default('PERMANENT'),
      rotationPolicy: z.enum(['manual', '30d', '90d', '180d']).default('manual'),
    }).parse(req.body);
    return withTenant(p.tenantId, async (c) => {
      // Use the vault to create encrypted credential
      const cred = await createCredential({
        tenantId: p.tenantId,
        name: body.name,
        description: body.description,
        kind: body.kind,
        target: body.target,
        username: body.username,
        secret: body.secret,
        collectionId: body.collectionId,
        accessPolicy: body.accessPolicy,
        rotationPolicy: body.rotationPolicy,
      });
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'CREDENTIAL_CREATED', resourceId: cred.id });
      return cred;
    });
  });

  app.get('/credentials/:id', async (req) => {
    const p = await principal(req);
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, tenant_id, name, description, kind, target, username, collection_id, access_policy, rotation_policy, key_version, created_at, updated_at 
           FROM credentials WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [(req.params as { id: string }).id, p.tenantId]);
      if (rows.length === 0) throw new HttpError(404, 'CREDENTIAL_NOT_FOUND', 'Credential not found');
      return rows[0];
    });
  });

  app.patch('/credentials/:id', async (req) => {
    const p = await principal(req);
    require(p, 'credential.update');
    const body = z.object({
      name: z.string().min(2).max(120).optional(),
      description: z.string().max(500).optional(),
      target: z.string().max(500).optional(),
      username: z.string().max(255).optional(),
      collectionId: z.string().uuid().optional(),
      accessPolicy: z.enum(['PERMANENT', 'JIT', 'APPROVAL_REQUIRED']).optional(),
      rotationPolicy: z.enum(['manual', '30d', '90d', '180d']).optional(),
    }).parse(req.body);
    return withTenant(p.tenantId, async (c) => {
      const updates: string[] = [];
      const values: (string | null)[] = [];
      let i = 1;
      if (body.name !== undefined) { updates.push(`name = $${i++}`); values.push(body.name); }
      if (body.description !== undefined) { updates.push(`description = $${i++}`); values.push(body.description); }
      if (body.target !== undefined) { updates.push(`target = $${i++}`); values.push(body.target); }
      if (body.username !== undefined) { updates.push(`username = $${i++}`); values.push(body.username); }
      if (body.collectionId !== undefined) { updates.push(`collection_id = $${i++}`); values.push(body.collectionId); }
      if (body.accessPolicy !== undefined) { updates.push(`access_policy = $${i++}`); values.push(body.accessPolicy); }
      if (body.rotationPolicy !== undefined) { updates.push(`rotation_policy = $${i++}`); values.push(body.rotationPolicy); }
      updates.push(`updated_at = now()`);
      
      const { rows } = await c.query(
        `UPDATE credentials SET ${updates.join(', ')} WHERE id = $${i} AND tenant_id = $${i+1} RETURNING *`,
        [...values, (req.params as { id: string }).id, p.tenantId]);
      if (rows.length === 0) throw new HttpError(404, 'CREDENTIAL_NOT_FOUND', 'Credential not found');
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'CREDENTIAL_UPDATED', resourceId: rows[0].id });
      return rows[0];
    });
  });

  app.delete('/credentials/:id', async (req, reply) => {
    const p = await principal(req);
    require(p, 'credential.delete');
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `UPDATE credentials SET deleted_at = now() WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [(req.params as { id: string }).id, p.tenantId]);
      if (rows.length === 0) throw new HttpError(404, 'CREDENTIAL_NOT_FOUND', 'Credential not found');
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'CREDENTIAL_DELETED', resourceId: rows[0].id });
      return reply.status(204).send();
    });
  });

  /* ---------------- sessions ---------------- */
  app.get('/sessions', async (req) => {
    const p = await principal(req);
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT s.id, s.tenant_id, s.user_id, u.name as user_name, s.application_id, a.name as application_name, 
                s.credential_id, cr.name as credential_name, s.status, s.started_at, s.expires_at, s.ip_address, s.user_agent
           FROM sessions s 
           LEFT JOIN users u ON u.id = s.user_id
           LEFT JOIN applications a ON a.id = s.application_id
           LEFT JOIN credentials cr ON cr.id = s.credential_id
           WHERE s.tenant_id = $1 ORDER BY s.started_at DESC`,
        [p.tenantId]);
      return rows;
    });
  });

  app.post('/sessions', async (req) => {
    const p = await principal(req);
    require(p, 'session.start');
    const body = z.object({
      applicationId: z.string().uuid(),
      credentialId: z.string().uuid(),
    }).parse(req.body);
    return withTenant(p.tenantId, async (c) => {
      // Issue a launch grant
      const grant = await issueLaunchGrant({
        tenantId: p.tenantId,
        userId: p.userId,
        applicationId: body.applicationId,
        credentialId: body.credentialId,
      });
      
      // Create session record
      const { rows } = await c.query(
        `INSERT INTO sessions (tenant_id, user_id, application_id, credential_id, status, started_at, expires_at, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, 'ACTIVE', now(), now() + interval '1 hour', $5, $6)
           RETURNING id, tenant_id, user_id, application_id, credential_id, status, started_at, expires_at`,
        [p.tenantId, p.userId, body.applicationId, body.credentialId, req.ip, req.headers['user-agent'] || 'unknown']);
      
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'SESSION_STARTED', resourceId: rows[0].id });
      
      return {
        session: rows[0],
        grant,
      };
    });
  });

  app.patch('/sessions/:id/terminate', async (req, reply) => {
    const p = await principal(req);
    require(p, 'session.terminate');
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `UPDATE sessions SET status = 'TERMINATED', ended_at = now() WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [(req.params as { id: string }).id, p.tenantId]);
      if (rows.length === 0) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found');
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'SESSION_TERMINATED', resourceId: rows[0].id });
      return reply.status(204).send();
    });
  });

  /* ---------------- access requests ---------------- */
  app.get('/access-requests', async (req) => {
    const p = await principal(req);
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT ar.id, ar.tenant_id, ar.requester_id, u.name as requester_name, ar.credential_id, cr.name as credential_name, 
                ar.reason, ar.ticket_reference, ar.status, ar.requested_at, ar.expires_at, ar.approved_by, ar.approved_at, ar.denied_reason
           FROM access_requests ar 
           LEFT JOIN users u ON u.id = ar.requester_id
           LEFT JOIN credentials cr ON cr.id = ar.credential_id
           WHERE ar.tenant_id = $1 ORDER BY ar.requested_at DESC`,
        [p.tenantId]);
      return rows;
    });
  });

  app.post('/access-requests', async (req) => {
    const p = await principal(req);
    const body = z.object({
      credentialId: z.string().uuid(),
      reason: z.string().min(10).max(1000),
      durationHours: z.number().int().min(1).max(24).default(1),
      ticketReference: z.string().max(100).optional(),
    }).parse(req.body);
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO access_requests (tenant_id, requester_id, credential_id, reason, ticket_reference, status, requested_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, 'PENDING', now(), now() + interval '${body.durationHours} hours')
           RETURNING *`,
        [p.tenantId, p.userId, body.credentialId, body.reason, body.ticketReference]);
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'ACCESS_REQUESTED', resourceId: rows[0].id });
      return rows[0];
    });
  });

  app.post('/access-requests/:id/approve', async (req) => {
    const p = await principal(req);
    require(p, 'access_request.approve');
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `UPDATE access_requests SET status = 'APPROVED', approved_by = $1, approved_at = now() 
           WHERE id = $2 AND tenant_id = $3 AND status = 'PENDING' RETURNING *`,
        [p.userId, (req.params as { id: string }).id, p.tenantId]);
      if (rows.length === 0) throw new HttpError(404, 'REQUEST_NOT_FOUND', 'Request not found or already processed');
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'ACCESS_APPROVED', resourceId: rows[0].id });
      return rows[0];
    });
  });

  app.post('/access-requests/:id/deny', async (req) => {
    const p = await principal(req);
    require(p, 'access_request.deny');
    const body = z.object({ reason: z.string().max(500).optional() }).parse(req.body);
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `UPDATE access_requests SET status = 'DENIED', denied_by = $1, denied_at = now(), denied_reason = $2 
           WHERE id = $3 AND tenant_id = $4 AND status = 'PENDING' RETURNING *`,
        [p.userId, body.reason, (req.params as { id: string }).id, p.tenantId]);
      if (rows.length === 0) throw new HttpError(404, 'REQUEST_NOT_FOUND', 'Request not found or already processed');
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'ACCESS_DENIED', resourceId: rows[0].id });
      return rows[0];
    });
  });

  /* ---------------- audit events ---------------- */
  app.get('/audit-events', async (req) => {
    const p = await principal(req);
    require(p, 'audit.view');
    const query = z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
      eventType: z.string().optional(),
      userId: z.string().optional(),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
    }).parse(req.query);
    
    return withTenant(p.tenantId, async (c) => {
      let whereClause = 'WHERE tenant_id = $1';
      const params: (string | number)[] = [p.tenantId];
      let paramIndex = 2;
      
      if (query.eventType) {
        whereClause += ` AND event_type = $${paramIndex++}`;
        params.push(query.eventType);
      }
      if (query.userId) {
        whereClause += ` AND actor_id = $${paramIndex++}`;
        params.push(query.userId);
      }
      if (query.startDate) {
        whereClause += ` AND ts >= $${paramIndex++}`;
        params.push(query.startDate);
      }
      if (query.endDate) {
        whereClause += ` AND ts <= $${paramIndex++}`;
        params.push(query.endDate);
      }
      
      const offset = (query.page - 1) * query.limit;
      
      const [eventsResult, countResult] = await Promise.all([
        c.query(`SELECT * FROM audit_events ${whereClause} ORDER BY ts DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`, 
          [...params, query.limit, offset]),
        c.query(`SELECT COUNT(*) FROM audit_events ${whereClause}`, params),
      ]);
      
      return {
        events: eventsResult.rows,
        total: parseInt(countResult.rows[0].count),
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(parseInt(countResult.rows[0].count) / query.limit),
      };
    });
  });

  /* ---------------- collections ---------------- */
  app.get('/collections', async (req) => {
    const p = await principal(req);
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, tenant_id, name, description, created_at, updated_at 
           FROM collections WHERE tenant_id = $1 ORDER BY name`,
        [p.tenantId]);
      return rows;
    });
  });

  app.post('/collections', async (req) => {
    const p = await principal(req);
    require(p, 'collection.create');
    const body = z.object({
      name: z.string().min(2).max(120),
      description: z.string().max(500).optional(),
    }).parse(req.body);
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO collections (tenant_id, name, description, created_at, updated_at)
           VALUES ($1, $2, $3, now(), now())
           RETURNING id, tenant_id, name, description, created_at, updated_at`,
        [p.tenantId, body.name, body.description]);
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'COLLECTION_CREATED', resourceId: rows[0].id });
      return rows[0];
    });
  });

  app.get('/collections/:id', async (req) => {
    const p = await principal(req);
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, tenant_id, name, description, created_at, updated_at 
           FROM collections WHERE id = $1 AND tenant_id = $2`,
        [(req.params as { id: string }).id, p.tenantId]);
      if (rows.length === 0) throw new HttpError(404, 'COLLECTION_NOT_FOUND', 'Collection not found');
      return rows[0];
    });
  });

  app.patch('/collections/:id', async (req) => {
    const p = await principal(req);
    require(p, 'collection.update');
    const body = z.object({
      name: z.string().min(2).max(120).optional(),
      description: z.string().max(500).optional(),
    }).parse(req.body);
    return withTenant(p.tenantId, async (c) => {
      const updates: string[] = [];
      const values: (string | null)[] = [];
      let i = 1;
      if (body.name !== undefined) { updates.push(`name = $${i++}`); values.push(body.name); }
      if (body.description !== undefined) { updates.push(`description = $${i++}`); values.push(body.description); }
      updates.push(`updated_at = now()`);
      
      const { rows } = await c.query(
        `UPDATE collections SET ${updates.join(', ')} WHERE id = $${i} AND tenant_id = $${i+1} RETURNING *`,
        [...values, (req.params as { id: string }).id, p.tenantId]);
      if (rows.length === 0) throw new HttpError(404, 'COLLECTION_NOT_FOUND', 'Collection not found');
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'COLLECTION_UPDATED', resourceId: rows[0].id });
      return rows[0];
    });
  });

  app.delete('/collections/:id', async (req, reply) => {
    const p = await principal(req);
    require(p, 'collection.delete');
    return withTenant(p.tenantId, async (c) => {
      const { rows } = await c.query(
        `DELETE FROM collections WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [(req.params as { id: string }).id, p.tenantId]);
      if (rows.length === 0) throw new HttpError(404, 'COLLECTION_NOT_FOUND', 'Collection not found');
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'COLLECTION_DELETED', resourceId: rows[0].id });
      return reply.status(204).send();
    });
  });


  return app;
}
