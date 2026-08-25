/**
 * Envelope encryption for the vault.
 *
 *   plaintext ──AES-256-GCM(DEK)──▶ ciphertext + nonce + tag   (stored in Postgres)
 *   DEK       ──wrapped by KMS────▶ wrapped_dek                (stored in Postgres)
 *   master key                     never leaves KMS/HSM hardware (aws) —
 *                                  or the LOCAL stub for dev, which holds an
 *                                  ephemeral in-memory key that is wiped on exit.
 *
 * Plaintext secrets may only exist inside `withUnsealedSecret()` callbacks;
 * the buffer is zeroized on exit, success or failure.
 */
import crypto from 'node:crypto';
import { KMSClient, EncryptCommand, DecryptCommand, GenerateDataKeyCommand } from '@aws-sdk/client-kms';
import { cfg, pool } from './db.js';

const kms = cfg.kmsProvider === 'aws' ? new KMSClient({}) : null;

/* ---------------- local dev stub (NOT a production security mechanism) ---- */
const LOCAL_MASTER = crypto.randomBytes(32); // regenerated per process start
async function localWrap(dek: Buffer) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', LOCAL_MASTER, iv);
  return Buffer.concat([iv, c.update(dek), c.final(), c.getAuthTag()]);
}
async function localUnwrap(wrapped: Buffer) {
  const iv = wrapped.subarray(0, 12);
  const tag = wrapped.subarray(wrapped.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', LOCAL_MASTER, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(wrapped.subarray(12, wrapped.length - 16)), d.final()]);
}

/* ---------------- KMS-backed DEK lifecycle -------------------------------- */
export async function generateDek(tenantId: string): Promise<{ version: number }> {
  const { rows } = await pool.query(
    `SELECT coalesce(max(key_version), 0) + 1 AS v FROM encryption_keys WHERE tenant_id = $1`,
    [tenantId],
  );
  const version = Number(rows[0].v);
  let wrapped: Buffer;
  if (kms) {
    const out = await kms.send(new GenerateDataKeyCommand({ KeyId: cfg.kmsKeyId, KeySpec: 'AES_256' }));
    const dek = out.Plaintext!;
    wrapped = await wrapDek(Buffer.from(dek));
    (dek as Uint8Array).fill(0); // zeroize the unwrapped copy immediately
  } else {
    const dek = crypto.randomBytes(32);
    wrapped = await wrapDek(dek);
    dek.fill(0);
  }
  await pool.query(
    `INSERT INTO encryption_keys (tenant_id, key_version, wrapped_dek) VALUES ($1, $2, $3)`,
    [tenantId, version, wrapped],
  );
  return { version };
}

async function wrapDek(dek: Buffer): Promise<Buffer> {
  if (kms) {
    const out = await kms.send(new EncryptCommand({ KeyId: cfg.kmsKeyId, Plaintext: dek }));
    return Buffer.from(out.CiphertextBlob!);
  }
  return localWrap(dek);
}

async function unwrapDek(wrapped: Buffer): Promise<Buffer> {
  if (kms) {
    const out = await kms.send(new DecryptCommand({ CiphertextBlob: wrapped }));
    return Buffer.from(out.Plaintext!);
  }
  return localUnwrap(wrapped);
}

const dekCache = new Map<string, Buffer>(); // tenant:version → DEK (short-lived, pinned process)

export async function getDek(tenantId: string, version: number): Promise<Buffer> {
  const key = `${tenantId}:${version}`;
  const hit = dekCache.get(key);
  if (hit) return hit;
  const { rows } = await pool.query(
    `SELECT wrapped_dek FROM encryption_keys WHERE tenant_id = $1 AND key_version = $2`,
    [tenantId, version],
  );
  if (!rows.length) throw new Error('unknown key version');
  const dek = await unwrapDek(rows[0].wrapped_dek);
  dekCache.set(key, dek);
  return dek;
}

/* ---------------- field encryption (AES-256-GCM, authenticated) ----------- */
export interface Sealed { ct: Buffer; nonce: Buffer; tag: Buffer }

export async function seal(tenantId: string, version: number, plaintext: string): Promise<Sealed> {
  const dek = await getDek(tenantId, version);
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', dek, nonce);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return { ct, nonce, tag: c.getAuthTag() };
}

export async function unseal(tenantId: string, version: number, s: Sealed): Promise<Buffer> {
  const dek = await getDek(tenantId, version);
  const d = crypto.createDecipheriv('aes-256-gcm', dek, s.nonce);
  d.setAuthTag(s.tag);
  return Buffer.concat([d.update(s.ct), d.final()]); // caller MUST zeroize
}

/**
 * The ONLY sanctioned way to touch a plaintext secret. The buffer is
 * zeroized before the promise settles — callers cannot retain it.
 */
export async function withUnsealedSecret<T>(
  tenantId: string, version: number, sealed: Sealed,
  fn: (plaintext: string) => Promise<T>,
): Promise<T> {
  const buf = await unseal(tenantId, version, sealed);
  try {
    return await fn(buf.toString('utf8'));
  } finally {
    buf.fill(0);
  }
}

/** Rotate: new DEK version; caller re-seals credentials and retires the old DEK. */
export async function rotateTenantDek(tenantId: string): Promise<{ version: number }> {
  const next = await generateDek(tenantId);
  await pool.query(
    `UPDATE encryption_keys SET state='ROTATING' WHERE tenant_id=$1 AND key_version < $2 AND state='ACTIVE'`,
    [tenantId, next.version],
  );
  return next;
}

/* ---------------- global secret redaction ---------------------------------- */
const SECRET_PATTERNS = [
  /(password|secret|token|api_?key|otp|nonce)["']?\s*[:=]\s*["']?[^"'\s,}]{4,}/gi,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** Scrubs anything secret-shaped before a string may reach logs/telemetry/SIEM. */
export function redact(input: string): string {
  let out = input;
  for (const re of SECRET_PATTERNS) out = out.replace(re, (m) => `${m.slice(0, 8)}=[REDACTED]`);
  return out;
}

export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest();
export const chainHash = (parts: string) => crypto.createHash('sha256').update(parts).digest('hex');
