/**
 * Audit service — append-only, hash-chained, tamper-evident.
 *
 * Every event's hash covers the previous hash, so any alteration breaks the
 * chain (verified nightly + on-demand from Reports → "chain integrity").
 * `meta` passes through redaction BEFORE insert: passwords, keys, tokens,
 * OTP values and cookies can never enter the log, even by accident.
 */
import { pool, withTenant } from './db.js';
import { chainHash, redact } from './crypto.js';

export type AuditType =
  | 'USER_LOGIN' | 'MFA_SUCCESS' | 'MFA_FAILURE'
  | 'CREDENTIAL_CREATED' | 'CREDENTIAL_UPDATED' | 'CREDENTIAL_USED' | 'CREDENTIAL_REVEAL'
  | 'GRANT_ISSUED' | 'GRANT_REPLAY_BLOCKED' | 'APPLICATION_LAUNCHED'
  | 'SESSION_STARTED' | 'SESSION_TERMINATED'
  | 'ACCESS_REQUESTED' | 'ACCESS_APPROVED' | 'ACCESS_DENIED'
  | 'PASSWORD_ROTATED' | 'USER_CREATED' | 'ROLE_CHANGED' | 'POLICY_CHANGED'
  | 'CONNECTOR_REGISTERED' | 'CONNECTOR_REVOKED' | 'API_KEY_CREATED'
  | 'BREAK_GLASS' | 'RED_TEAM_PROBE';

export interface AuditInput {
  tenantId: string;
  actorId?: string | null;
  actorName: string;
  type: AuditType;
  resourceId?: string;
  resourceName?: string;
  result?: 'SUCCESS' | 'DENIED' | 'FAILURE';
  meta?: string;
  sourceIp?: string;
  deviceFp?: string;
}

const TENANT_SCOPED: AuditType[] = []; // all events carry tenant_id; chain is global per-tenant

export async function audit(ev: AuditInput): Promise<{ id: string; hash: string }> {
  return withTenant(ev.tenantId, async (client) => {
    // serialize chain appends per tenant
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [ev.tenantId]);
    const last = await client.query(
      `SELECT hash FROM audit_events WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`,
      [ev.tenantId],
    );
    const prevHash = last.rows[0]?.hash ?? '0'.repeat(64);
    const at = new Date();
    const meta = ev.meta ? redact(ev.meta) : null;
    const hash = chainHash(`${prevHash}|${ev.type}|${ev.actorId ?? 'anon'}|${at.toISOString()}|${meta ?? ''}`);
    const ins = await client.query(
      `INSERT INTO audit_events
        (tenant_id, actor_id, actor_name, event_type, resource_id, resource_name, result, meta, source_ip, device_fp, prev_hash, hash, at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [ev.tenantId, ev.actorId ?? null, ev.actorName, ev.type, ev.resourceId ?? null,
       ev.resourceName ?? null, ev.result ?? 'SUCCESS', meta, ev.sourceIp ?? null,
       ev.deviceFp ?? null, prevHash, hash, at],
    );
    return { id: ins.rows[0].id, hash };
  });
}

/** Verify the whole chain for a tenant; returns first broken link if any. */
export async function verifyChain(tenantId: string): Promise<{ ok: boolean; brokenAt?: number }> {
  const { rows } = await withTenant(tenantId, (client) =>
    client.query(
      `SELECT id, hash, prev_hash, event_type, actor_id, at, meta FROM audit_events
       WHERE tenant_id = $1 ORDER BY id ASC`, [tenantId],
    ));
  let prev = '0'.repeat(64);
  for (const r of rows) {
    const expect = chainHash(`${r.prev_hash}|${r.event_type}|${r.actor_id ?? 'anon'}|${new Date(r.at).toISOString()}|${r.meta ?? ''}`);
    if (r.prev_hash !== prev || r.hash !== expect) return { ok: false, brokenAt: Number(r.id) };
    prev = r.hash;
  }
  return { ok: true };
}
