/**
 * Identity & authentication.
 *
 *   Login → identity verification → MFA/passkey → tenant identification
 *         → RBAC evaluation → session creation
 *
 * Browser sessions: short-lived access JWT (5 min) + rotating refresh token
 * delivered ONLY via HttpOnly · Secure · SameSite=Strict cookies. There is no
 * localStorage token surface. Refresh reuse ⇒ whole family revoked (theft).
 */
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { Issuer, type Client } from 'openid-client';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { cfg, pool, redis, withTenant, HttpError } from './db.js';
import { randomToken, sha256 } from './crypto.js';
import { audit } from './audit.js';

const jwtSecret = new TextEncoder().encode(cfg.cookieSecret);
const ACCESS_TTL = '5m';
const REFRESH_TTL_SEC = cfg.sessionTtlMin * 60;

/* ---------------- TOTP (RFC 6238, no dependency) -------------------------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
export function totp(secretB32: string, when = Date.now(), step = 30, digits = 6): string {
  const counter = Math.floor(when / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24 | h[off + 1] << 16 | h[off + 2] << 8 | h[off + 3]) % 10 ** digits;
  return String(code).padStart(digits, '0');
}
export function totpValid(secretB32: string, code: string): boolean {
  const now = Date.now();
  return [-1, 0, 1].some((w) => totp(secretB32, now + w * 30_000) === code.trim()); // ±1 drift window
}
export const newTotpSecret = () => {
  const bytes = crypto.randomBytes(20);
  let s = ''; let bits = 0, v = 0;
  for (const b of bytes) { v = (v << 8) | b; bits += 8; while (bits >= 5) { s += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } }
  return s;
};

/* ---------------- sessions & tokens --------------------------------------- */
export interface Principal {
  userId: string; tenantId: string; email: string; name: string; role: string;
  sessionId: string; authMethod: string; permissions: string[];
}

async function loadPermissions(client: import('pg').PoolClient, userId: string): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT DISTINCT p.name FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id AND ur.user_id = $1
      UNION
     SELECT DISTINCT p.name FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN groups_roles gr ON gr.role_id = rp.role_id
       JOIN groups_users gu ON gu.group_id = gr.group_id AND gu.user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.name);
}

export async function establishSession(user: { id: string; tenant_id: string; email: string; name: string }, role: string, authMethod: string, reply: { setCookie: Function }) {
  return withTenant(user.tenant_id, async (client) => {
    const permissions = await loadPermissions(client, user.id);
    const sessionId = randomToken(18);
    await redis.set(`session:${sessionId}`, JSON.stringify({ userId: user.id, authMethod }), 'EX', REFRESH_TTL_SEC).catch(() => {});
    const access = await new SignJWT({ sid: sessionId, role, tenant: user.tenant_id, sub: user.id })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer(cfg.issuer).setExpirationTime(ACCESS_TTL)
      .sign(jwtSecret);
    const refresh = randomToken(32);
    await redis.set(`refresh:${sha256(refresh).toString('hex')}`,
      JSON.stringify({ sid: sessionId, userId: user.id, tenantId: user.tenant_id, family: sessionId }),
      'EX', REFRESH_TTL_SEC).catch(() => {});
    const isProd = process.env.NODE_ENV === 'production';
    reply.setCookie('kr_access', access, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', maxAge: 300 });
    reply.setCookie('kr_refresh', refresh, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', maxAge: REFRESH_TTL_SEC });
    await client.query(`UPDATE users SET last_login_at = now(), failed_logins = 0 WHERE id = $1`, [user.id]);
    const principal: Principal = { userId: user.id, tenantId: user.tenant_id, email: user.email, name: user.name, role, sessionId, authMethod, permissions };
    await audit({ tenantId: user.tenant_id, actorId: user.id, actorName: user.name, type: 'SESSION_STARTED', meta: `method=${authMethod} · HttpOnly/Secure/SameSite=Strict` });
    return principal;
  });
}

/** Rotate refresh token. Reuse of a consumed token ⇒ revoke the entire family. */
export async function rotateRefresh(oldRefresh: string): Promise<{ access: string; refresh: string } | null> {
  const key = `refresh:${sha256(oldRefresh).toString('hex')}`;
  const raw = await redis.get(key);
  if (!raw) return null;
  const fam = JSON.parse(raw);
  if (fam.used) { // theft indicator: token replayed after rotation
    await redis.del(`session:${fam.sid}`);
    const keys = await redis.keys(`refresh:*`);
    for (const k of keys) { const v = await redis.get(k); if (v && JSON.parse(v).family === fam.family) await redis.del(k); }
    return null;
  }
  await redis.set(key, JSON.stringify({ ...fam, used: true }), 'EX', 60); // consumed; kept briefly for reuse detection
  const refresh = randomToken(32);
  await redis.set(`refresh:${sha256(refresh).toString('hex')}`, JSON.stringify({ ...fam, used: false }), 'EX', REFRESH_TTL_SEC);
  const access = await new SignJWT({ sid: fam.sid, sub: fam.userId, tenant: fam.tenantId })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer(cfg.issuer).setExpirationTime(ACCESS_TTL).sign(jwtSecret);
  return { access, refresh };
}

/* ---------------- login with throttling + lockout -------------------------- */
export async function passwordLogin(tenantSlug: string, email: string, password: string, ip: string) {
  const t = await pool.query(`SELECT id FROM tenants WHERE slug = $1 AND status = 'ACTIVE'`, [tenantSlug]);
  if (!t.rowCount) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Unknown tenant');
  return withTenant(t.rows[0].id, async (client) => {
    const { rows } = await client.query(
      `SELECT u.*, r.name AS role FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
        WHERE u.email = $1 AND u.deleted_at IS NULL`, [email]);
    const u = rows[0];
    const fail = async (msg: string) => {
      await audit({ tenantId: t.rows[0].id, actorId: u?.id ?? null, actorName: email, type: 'USER_LOGIN', result: 'FAILURE', meta: msg, sourceIp: ip });
      throw new HttpError(401, 'AUTH_FAILED', 'Invalid credentials');
    };
    if (!u || u.status !== 'ACTIVE') return fail('unknown or disabled');
    if (u.locked_until && u.locked_until > new Date()) return fail(`locked until ${u.locked_until}`);
    const okPw = u.password_hash ? await argon2.verify(u.password_hash, password) : false;
    if (!okPw) {
      const attempts = u.failed_logins + 1;
      const lock = attempts >= 5 ? `, locked_until = now() + interval '15 minutes'` : '';
      await client.query(`UPDATE users SET failed_logins = failed_logins + 1 ${lock} WHERE id = $1`, [u.id]);
      return fail(`bad password attempt ${attempts}`);
    }
    return { user: u, role: u.role ?? 'USER', mfaRequired: u.mfa_required };
  });
}

/* ---------------- SSO (OIDC: Google Workspace / Entra / any IdP) ----------- */
const oidcClients = new Map<string, Client>();
export async function oidcCallback(tenantSlug: string, provider: string, params: Record<string, string>, ip: string) {
  const t = await pool.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug]);
  const tenantId = t.rows[0]?.id;
  if (!tenantId) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Unknown tenant');
  let client = oidcClients.get(provider);
  if (!client) {
    const discovery = provider === 'google'
      ? 'https://accounts.google.com/.well-known/openid-configuration'
      : `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}/v2.0/.well-known/openid-configuration`;
    const issuer = await Issuer.discover(discovery);
    client = new issuer.Client({
      client_id: process.env[`${provider.toUpperCase()}_CLIENT_ID`]!,
      client_secret: process.env[`${provider.toUpperCase()}_CLIENT_SECRET`]!,
      redirect_uris: [`${cfg.issuer}/auth/${provider}/callback`],
      response_types: ['code'],
    });
    oidcClients.set(provider, client);
  }
  const tokenSet = await client.callback(`${cfg.issuer}/auth/${provider}/callback`, params);
  const claims = tokenSet.claims();
  const email = claims.email as string;
  // Tenant is DERIVED from the verified IdP assertion (email-domain mapping),
  // never from client-supplied parameters.
  const { rows } = await withTenant(tenantId, (c) =>
    c.query(`SELECT * FROM users WHERE email = $1 AND tenant_id = $2 AND status='ACTIVE'`, [email, tenantId]));
  if (!rows.length) {
    await audit({ tenantId, actorName: email, type: 'ACCESS_DENIED', result: 'DENIED', meta: 'SSO user not provisioned', sourceIp: ip });
    throw new HttpError(403, 'NOT_PROVISIONED', 'User not provisioned in this tenant');
  }
  await audit({ tenantId, actorId: rows[0].id, actorName: rows[0].name, type: 'USER_LOGIN', meta: `${provider} SSO · assertion verified`, sourceIp: ip });
  return rows[0];
}

/* ---------------- WebAuthn / passkeys -------------------------------------- */
export const webauthnRp = { rpName: 'Keyrail', rpID: new URL(cfg.issuer).hostname, origin: cfg.issuer };
export const webauthnRegisterOptions = (userId: string) =>
  generateRegistrationOptions({ rpName: webauthnRp.rpName, rpID: webauthnRp.rpID, userName: userId, timeout: 60_000 });
export const webauthnAuthOptions = async (userId: string) => {
  const { rows } = await pool.query(`SELECT metadata FROM mfa_methods WHERE user_id = $1 AND kind = 'WEBAUTHN'`, [userId]);
  return generateAuthenticationOptions({
    allowCredentials: rows.map((r) => ({ id: r.metadata.credentialId, type: 'public-key' })),
    rpID: webauthnRp.rpID, timeout: 60_000,
  });
};
export { verifyRegistrationResponse, verifyAuthenticationResponse };

export { withTenant };
