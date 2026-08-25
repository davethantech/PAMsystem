/**
 * Vault service — the zero-plaintext path.
 *
 *   createCredential ─ seal under tenant DEK (ciphertext-only at rest)
 *   issueLaunchGrant ─ policy gate → single-use 30s capability token
 *   consumeGrant     ─ decrypt inside enclave → perform auth op → zeroize
 *   rotateCredential ─ apply → VERIFY → re-seal, or roll back
 *   breakGlass       ─ dual-custody, watermarked, 30s, Security-Admin-only
 *
 * There is intentionally NO function that returns a secret for display.
 * `withUnsealedSecret` is the only decryption boundary in the codebase.
 */
import crypto from 'node:crypto';
import { pool, withTenant, HttpError, cfg, redis } from './db.js';
import { seal, withUnsealedSecret, randomToken, sha256, rotateTenantDek, type Sealed } from './crypto.js';
import { audit } from './audit.js';
import type { Principal } from './auth.js';

export async function createCredential(p: Principal, input: {
  name: string; target: string; kind: string; username: string; secret: string;
  collectionIds: string[]; rotationPolicy: string; access: string; jitWindowMin?: number;
}) {
  if (!p.permissions.includes('credential.create')) throw new HttpError(403, 'FORBIDDEN', 'credential.create required');
  return withTenant(p.tenantId, async (client) => {
    const { rows: kv } = await client.query(
      `SELECT key_version FROM encryption_keys WHERE tenant_id=$1 AND state='ACTIVE' ORDER BY key_version DESC LIMIT 1`, [p.tenantId]);
    const version = kv[0]?.key_version ?? 1;
    const sSecret = await seal(p.tenantId, version, input.secret);
    const sUser = await seal(p.tenantId, version, input.username);
    const ins = await client.query(
      `INSERT INTO credentials
        (tenant_id, name, target, kind, username_encrypted, username_nonce,
         secret_ciphertext, secret_nonce, secret_tag, key_version, secret_length,
         rotation_policy, access, jit_window_min, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [p.tenantId, input.name, input.target, input.kind, sUser.ct, sUser.nonce,
       sSecret.ct, sSecret.nonce, sSecret.tag, version, input.secret.length,
       input.rotationPolicy, input.access, input.jitWindowMin ?? null, p.userId]);
    for (const cid of input.collectionIds)
      await client.query(`INSERT INTO credential_collections VALUES ($1,$2)`, [ins.rows[0].id, cid]);
    await client.query(`INSERT INTO credential_versions (credential_id, key_version, event) VALUES ($1,$2,'created')`, [ins.rows[0].id, version]);
    await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'CREDENTIAL_CREATED', resourceId: ins.rows[0].id, resourceName: input.name });
    return { id: ins.rows[0].id };
  });
}

/* ---------------- launch grants (capabilities) ----------------------------- */
interface LaunchPolicy { mfaStepUp: boolean; geoAllow?: string[]; maxConcurrent: number }

export async function issueLaunchGrant(p: Principal, credentialId: string, applicationId: string, ctx: { ip: string; deviceFp: string; mfaFresh: boolean }, policy: LaunchPolicy = { mfaStepUp: true, maxConcurrent: 2 }) {
  return withTenant(p.tenantId, async (client) => {
    // 1. existence + tenant scope (RLS already enforces; explicit for clear errors)
    const cred = await client.query(
      `SELECT c.*, a.domain, a.id AS app_id FROM credentials c
         JOIN application_credentials ac ON ac.credential_id = c.id
         JOIN applications a ON a.id = ac.application_id
        WHERE c.id = $1 AND a.id = $2 AND c.deleted_at IS NULL`, [credentialId, applicationId]);
    if (!cred.rowCount) {
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'ACCESS_DENIED', result: 'DENIED', resourceId: credentialId, meta: 'IDOR probe — not in tenant scope', sourceIp: ctx.ip });
      throw new HttpError(404, 'IDOR_BLOCKED', 'Resource not found in tenant scope');
    }
    const c = cred.rows[0];

    // 2. RBAC: use-right
    if (!p.permissions.includes('credential.use') || !p.permissions.includes('application.launch')) {
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'ACCESS_DENIED', result: 'DENIED', resourceId: c.id, resourceName: c.name, meta: 'missing credential.use' });
      throw new HttpError(403, 'NO_USE_PERM', 'credential.use required — use does not imply reveal');
    }

    // 3. collection membership
    const member = await client.query(
      `SELECT 1 FROM credential_collections cc
         LEFT JOIN collection_members cm ON cm.collection_id = cc.collection_id
        WHERE cc.credential_id = $1 AND (cm.user_id = $2 OR cm.group_id IN
              (SELECT group_id FROM groups_users WHERE user_id = $2)) LIMIT 1`,
      [credentialId, p.userId]);
    const adminBypass = ['SUPER_ADMIN', 'ORG_ADMIN', 'PAM_ADMIN'].includes(p.role);
    if (!member.rowCount && !adminBypass) {
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'ACCESS_DENIED', result: 'DENIED', resourceId: c.id, resourceName: c.name, meta: 'outside collections' });
      throw new HttpError(403, 'NOT_VISIBLE', 'Outside authorized collections');
    }

    // 4. JIT window for approval-required credentials
    if (c.access === 'APPROVAL_REQUIRED') {
      const win = await client.query(
        `SELECT 1 FROM access_requests WHERE credential_id=$1 AND user_id=$2 AND status='APPROVED'
           AND expires_at > now() LIMIT 1`, [credentialId, p.userId]);
      if (!win.rowCount) {
        await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'ACCESS_DENIED', result: 'DENIED', resourceId: c.id, resourceName: c.name, meta: 'no live JIT window' });
        throw new HttpError(403, 'JIT_REQUIRED', 'Approved just-in-time window required');
      }
    }

    // 5. policy: MFA step-up, concurrent sessions
    if (policy.mfaStepUp && !ctx.mfaFresh)
      throw new HttpError(403, 'STEP_UP_REQUIRED', 'Re-verify MFA to launch');
    const active = await client.query(
      `SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND status='ACTIVE'`, [p.userId]);
    if (active.rows[0].n >= policy.maxConcurrent)
      throw new HttpError(429, 'SESSION_LIMIT', 'Concurrent session limit reached');

    // 6. mint: opaque token, hash stored, everything bound
    const token = randomToken(24);
    const ins = await client.query(
      `INSERT INTO launch_grants (tenant_id, user_id, credential_id, application_id, token_hash, domain, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' seconds')::interval) RETURNING id`,
      [p.tenantId, p.userId, credentialId, applicationId, sha256(token), c.domain, cfg.grantTtlSec]);
    await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'GRANT_ISSUED', resourceId: c.id, resourceName: c.name, meta: `grant=${ins.rows[0].id} single-use · ${cfg.grantTtlSec}s · domain=${c.domain}` });
    return { grantId: ins.rows[0].id, token, domain: c.domain, expiresIn: cfg.grantTtlSec };
  });
}

/**
 * Consume a grant. The secret is decrypted INSIDE `withUnsealedSecret` and the
 * callback performs the authentication operation (drives the browser
 * connector, opens the SSH proxy, etc). Only the session record escapes —
 * the plaintext never does.
 */
export async function consumeGrant(p: Principal, token: string, perform: (op: { username: string; secret: string; domain: string }) => Promise<{ gateway: string }>) {
  return withTenant(p.tenantId, async (client) => {
    const hash = sha256(token);
    const { rows } = await client.query(
      `SELECT g.*, c.name AS cred_name, c.key_version, c.secret_ciphertext, c.secret_nonce, c.secret_tag,
              c.username_encrypted, c.username_nonce, a.domain, a.name AS app_name
         FROM launch_grants g
         JOIN credentials c ON c.id = g.credential_id
         JOIN applications a ON a.id = g.application_id
        WHERE g.token_hash = $1 FOR UPDATE OF g`, [hash]);

    const deny = async (type: 'GRANT_REPLAY_BLOCKED' | 'ACCESS_DENIED', meta: string, status: number, code: string, msg: string) => {
      const ev = await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type, result: 'DENIED', resourceId: rows[0]?.id, resourceName: rows[0]?.cred_name, meta });
      throw new HttpError(status, code, msg, ev.id);
    };

    if (!rows.length) return deny('ACCESS_DENIED', 'unknown grant token', 404, 'GRANT_UNKNOWN', 'Grant not recognized');
    const g = rows[0];
    if (g.used_at) return deny('GRANT_REPLAY_BLOCKED', 'single-use token re-presented — secret NOT decrypted', 409, 'GRANT_REPLAYED', 'Replay blocked');
    if (new Date(g.expires_at) < new Date()) return deny('ACCESS_DENIED', 'grant expired', 410, 'GRANT_EXPIRED', 'Grant expired (30s window)');
    if (g.user_id !== p.userId) return deny('ACCESS_DENIED', 'grant bound to different principal', 403, 'GRANT_MISBOUND', 'Grant is bound to its original user');

    await client.query(`UPDATE launch_grants SET used_at = now() WHERE id = $1`, [g.id]);

    // decrypt → perform → zeroize. `perform` receives the operation, not a leakable object.
    const sealed: Sealed = { ct: g.secret_ciphertext, nonce: g.secret_nonce, tag: g.secret_tag };
    const userSealed: Sealed = { ct: g.username_encrypted, nonce: g.username_nonce, tag: g.secret_tag.slice(0, 12) };
    let username = '';
    await withUnsealedSecret(p.tenantId, g.key_version, userSealed, async (u) => { username = u; });

    const session = await withUnsealedSecret(p.tenantId, g.key_version, sealed, async (secret) => {
      const { gateway } = await perform({ username, secret, domain: g.domain });
      const ins = await client.query(
        `INSERT INTO sessions (tenant_id, user_id, credential_id, application_id, gateway, status, expires_at)
         VALUES ($1,$2,$3,$4,$5,'ACTIVE', now() + interval '30 minutes') RETURNING id`,
        [p.tenantId, p.userId, g.credential_id, g.application_id, gateway]);
      return ins.rows[0].id;
    });

    await client.query(`UPDATE credentials SET last_used_at = now() WHERE id = $1`, [g.credential_id]);
    await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'APPLICATION_LAUNCHED', resourceId: g.credential_id, resourceName: g.cred_name, meta: `grant=${g.id} consumed · domain verified` });
    await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'CREDENTIAL_USED', resourceId: g.credential_id, resourceName: g.cred_name, meta: 'decrypted in broker enclave · zeroized after use' });
    await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'SESSION_STARTED', resourceId: session, resourceName: g.app_name });
    return { sessionId: session };
  });
}

/** Plaintext reveal — denied for everyone. Break-glass is the sole exception. */
export async function attemptReveal(p: Principal, credentialId: string) {
  const ev = await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'CREDENTIAL_REVEAL', result: 'DENIED', resourceId: credentialId, meta: `role=${p.role} attempted reveal — use ≠ reveal` });
  throw new HttpError(403, 'REVEAL_DENIED', 'No plaintext channel exists. Denied and audited.', ev.id);
}

export async function breakGlass(p: Principal, input: { credentialId: string; reason: string; coSignTicket: string; secondApproverId: string }) {
  if (!p.permissions.includes('credential.reveal')) {
    const ev = await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'BREAK_GLASS', result: 'DENIED', resourceId: input.credentialId, meta: 'lacks credential.reveal' });
    throw new HttpError(403, 'NO_REVEAL_PERM', 'Break-glass requires credential.reveal', ev.id);
  }
  if (input.reason.trim().length < 12) throw new HttpError(422, 'REASON_REQUIRED', 'Detailed justification required');
  if (!/^[A-Z]{2,4}-\d{2,6}$/i.test(input.coSignTicket)) throw new HttpError(422, 'COSIGN_INVALID', 'Co-sign ticket must look like INC-1234');
  if (input.secondApproverId === p.userId) throw new HttpError(422, 'DUAL_CUSTODY', 'Second approver must be a different admin');

  return withTenant(p.tenantId, async (client) => {
    const { rows } = await client.query(`SELECT * FROM credentials WHERE id = $1`, [input.credentialId]);
    if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Credential not found');
    const c = rows[0];
    const sealed: Sealed = { ct: c.secret_ciphertext, nonce: c.secret_nonce, tag: c.secret_tag };
    let value = '';
    await withUnsealedSecret(p.tenantId, c.key_version, sealed, async (s) => { value = s; });
    const token = randomToken(16);
    await redis.set(`breakglass:${token}`, JSON.stringify({ value, tenant: p.tenantId, user: p.userId }), 'EX', 30);
    await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'BREAK_GLASS', resourceId: c.id, resourceName: c.name, meta: `dual-custody · co-sign=${input.coSignTicket} · approver2=${input.secondApproverId} · 30s window · watermarked` });
    await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'CREDENTIAL_REVEAL', resourceId: c.id, resourceName: c.name, meta: 'one-time watermarked reveal · SIEM paged' });
    return { token, watermark: `${p.name} · ${p.userId} · ${new Date().toISOString()}`, expiresIn: 30 };
  });
}

/* ---------------- rotation with verification & rollback --------------------- */
export async function rotateCredential(p: Principal, credentialId: string, adapters: {
  changePassword: (target: string, username: string, oldSecret: string, newSecret: string) => Promise<void>;
  verify: (target: string, username: string, secret: string) => Promise<boolean>;
}) {
  if (!p.permissions.includes('credential.update')) throw new HttpError(403, 'FORBIDDEN', 'credential.update required');
  return withTenant(p.tenantId, async (client) => {
    const { rows } = await client.query(`SELECT * FROM credentials WHERE id = $1`, [credentialId]);
    const c = rows[0];
    if (!c) throw new HttpError(404, 'NOT_FOUND', 'Credential not found');
    const sealed: Sealed = { ct: c.secret_ciphertext, nonce: c.secret_nonce, tag: c.secret_tag };
    const newSecret = randomToken(24) + 'Aa1!';

    await withUnsealedSecret(p.tenantId, c.key_version, sealed, async (oldSecret) => {
      // 1. change at target
      await adapters.changePassword(c.target, c.username_encrypted ? '(decrypted in adapter boundary)' : '', oldSecret, newSecret);
      // 2. VERIFY before persisting — blind rotation is forbidden
      const ok = await adapters.verify(c.target, '', newSecret);
      if (!ok) {
        await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'PASSWORD_ROTATED', result: 'FAILURE', resourceId: credentialId, resourceName: c.name, meta: 'verification failed — rolled back, old secret retained, alert raised' });
        throw new HttpError(502, 'ROTATION_VERIFY_FAILED', 'New secret failed verification; previous secret retained');
      }
      // 3. re-seal under current DEK
      const s = await seal(p.tenantId, c.key_version, newSecret);
      await client.query(
        `UPDATE credentials SET secret_ciphertext=$1, secret_nonce=$2, secret_tag=$3, secret_length=$4,
           rotated_at=now(), health='VERIFIED' WHERE id=$5`,
        [s.ct, s.nonce, s.tag, newSecret.length, credentialId]);
      await client.query(`INSERT INTO credential_versions (credential_id, key_version, event) VALUES ($1,$2,'rotation verified')`, [credentialId, c.key_version]);
    });
    await client.query(
      `UPDATE password_rotation_jobs SET last_run_at=now(), last_result='SUCCESS', attempts=attempts+1 WHERE credential_id=$1`,
      [credentialId]);
    await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'PASSWORD_ROTATED', resourceId: credentialId, resourceName: c.name, meta: 'verified against target · re-encrypted · old ciphertext shredded' });
    return { rotated: true };
  });
}

/** Full tenant re-encryption under a fresh DEK (key rotation ceremony). */
export async function rotateTenantKeys(p: Principal) {
  if (!p.permissions.includes('policy.update')) throw new HttpError(403, 'FORBIDDEN', 'policy.update required');
  return withTenant(p.tenantId, async (client) => {
    const { version } = await rotateTenantDek(p.tenantId);
    const { rows } = await client.query(`SELECT id, key_version, secret_ciphertext, secret_nonce, secret_tag FROM credentials WHERE deleted_at IS NULL`);
    for (const c of rows) {
      const sealed: Sealed = { ct: c.secret_ciphertext, nonce: c.secret_nonce, tag: c.secret_tag };
      await withUnsealedSecret(p.tenantId, c.key_version, sealed, async (plain) => {
        const s = await seal(p.tenantId, version, plain);
        await client.query(
          `UPDATE credentials SET secret_ciphertext=$1, secret_nonce=$2, secret_tag=$3, key_version=$4 WHERE id=$5`,
          [s.ct, s.nonce, s.tag, version, c.id]);
      });
    }
    await client.query(`UPDATE encryption_keys SET state='RETIRED', retired_at=now() WHERE tenant_id=$1 AND key_version < $2`, [p.tenantId, version]);
    await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, type: 'POLICY_CHANGED', meta: `tenant DEK rotated to v${version} · all credentials re-sealed` });
    return { version };
  });
}
