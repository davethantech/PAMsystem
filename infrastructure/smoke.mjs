#!/usr/bin/env node
/**
 * End-to-end smoke test against a LIVE stack.
 *
 *   1. cd infrastructure && docker compose up --build -d
 *   2. docker compose exec backend npm run seed:dev     (or it ran at boot)
 *   3. node infrastructure/smoke.mjs
 *
 * Exercises the full zero-plaintext path: login → TOTP → RBAC → grant →
 * consume → replay-block → audit chain verification. Exits non-zero on any
 * failure, so CI / deploy pipelines can gate on it.
 */
import crypto from 'node:crypto';

const API = process.env.KEYRAIL_API ?? 'http://127.0.0.1:8081';
const TENANT = 'meridian';
const EMAIL = 'priya@meridian.dev';
const PASSWORD = 'Dev-Password-2024!';
const TOTP_SEED = 'KEYRAILDEVSEED234567ABCDEFGHIJKLMN';

/* ---- RFC 6238 (matches backend/src/auth.ts) ---- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(s) {
  let bits = 0, value = 0; const out = [];
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24 | h[off + 1] << 16 | h[off + 2] << 8 | h[off + 3]) % 1e6;
  return String(code).padStart(6, '0');
}

let cookies = '';
const results = [];
async function step(name, fn) {
  try { const detail = await fn(); results.push({ name, ok: true, detail: detail ?? '' }); }
  catch (e) { results.push({ name, ok: false, detail: e.message }); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function api(method, path, body, headers = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookies ? { Cookie: cookies } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) {
    const jar = new Map(cookies ? cookies.split('; ').map((c) => [c.split('=')[0], c]) : []);
    for (const c of sc) { const [pair] = c.split(';'); jar.set(pair.split('=')[0], pair); }
    cookies = [...jar.values()].join('; ');
  }
  let json = null; try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

/* ---------------- the run ---------------- */
let mfaToken = '', grantToken = '', ebayCred = '', ebayApp = '';

await step('GET /healthz', async () => {
  const r = await api('GET', '/healthz');
  assert(r.status === 200 && r.json?.ok, `status=${r.status}`);
});

await step('POST /auth/login → MFA challenge', async () => {
  const r = await api('POST', '/auth/login', { tenant: TENANT, email: EMAIL, password: PASSWORD });
  assert(r.status === 200 && r.json?.mfaRequired, `status=${r.status} body=${JSON.stringify(r.json)}`);
  mfaToken = r.json.mfaToken;
  return `challenge ${mfaToken.slice(0, 8)}…`;
});

await step('wrong TOTP is rejected (401)', async () => {
  const r = await api('POST', '/auth/mfa', { mfaToken, code: '000000' });
  assert(r.status === 401, `status=${r.status}`);
});

await step('correct TOTP → HttpOnly session cookies', async () => {
  const r = await api('POST', '/auth/mfa', { mfaToken, code: totp(TOTP_SEED) });
  assert(r.status === 200, `status=${r.status} body=${JSON.stringify(r.json)}`);
  assert(cookies.includes('kr_access'), 'kr_access cookie missing');
});

await step('GET /me → principal + permissions', async () => {
  const r = await api('GET', '/me');
  assert(r.status === 200 && r.json?.role === 'PAM_ADMIN', `status=${r.status}`);
  return `${r.json.name} · ${r.json.permissions.length} perms`;
});

await step('metadata list contains no ciphertext/secret fields', async () => {
  const r = await api('GET', '/credentials');
  assert(r.status === 200 && Array.isArray(r.json) && r.json.length >= 4, `status=${r.status}`);
  const blob = JSON.stringify(r.json).toLowerCase();
  assert(!blob.includes('ciphertext') && !blob.includes('"secret"'), 'secret material leaked in metadata');
  const ebay = r.json.find((c) => c.name.includes('eBay'));
  assert(ebay, 'eBay credential missing from seed');
  ebayCred = ebay.id;
  return `${r.json.length} credentials`;
});

await step('?tenant=other-org is ignored', async () => {
  const a = await api('GET', '/credentials');
  const b = await api('GET', '/credentials?tenant=other-org');
  assert(JSON.stringify(a.json?.map((c) => c.id)) === JSON.stringify(b.json?.map((c) => c.id)), 'tenant param changed the result');
});

await step('GET /credentials/:id/secret → 404 NO_SUCH_ROUTE', async () => {
  const r = await api('GET', `/credentials/${ebayCred}/secret`);
  assert(r.status === 404 && r.json?.error === 'NO_SUCH_ROUTE', `status=${r.status} error=${r.json?.error}`);
});

await step('POST /credentials/:id/reveal → 403 REVEAL_DENIED', async () => {
  const r = await api('POST', `/credentials/${ebayCred}/reveal`);
  assert(r.status === 403 && r.json?.error === 'REVEAL_DENIED', `status=${r.status} error=${r.json?.error}`);
});

await step('POST /credentials/:id/launch → single-use grant', async () => {
  const apps = await api('GET', '/applications');
  assert(apps.status === 200, `apps status=${apps.status}`);
  const app = apps.json.find((a) => a.credential_id === ebayCred);
  assert(app, 'no application mapped to the eBay credential');
  ebayApp = app.id;
  const r = await api('POST', `/credentials/${ebayCred}/launch`, { applicationId: app.id }, { 'x-mfa-fresh': '1' });
  assert(r.status === 200 && r.json?.token, `status=${r.status} body=${JSON.stringify(r.json)}`);
  grantToken = r.json.token;
  return `domain=${r.json.domain} · ${r.json.expiresIn}s`;
});

await step('consume grant → proxied session', async () => {
  const r = await api('POST', '/launch/consume', { token: grantToken, kind: 'web-inject' });
  assert(r.status === 200 && r.json?.sessionId, `status=${r.status} body=${JSON.stringify(r.json)}`);
  return `session ${r.json.sessionId.slice(0, 8)}…`;
});

await step('replay the SAME grant → 409, secret never decrypted', async () => {
  const r = await api('POST', '/launch/consume', { token: grantToken, kind: 'web-inject' });
  assert(r.status === 409 && r.json?.error === 'GRANT_REPLAYED', `status=${r.status} error=${r.json?.error}`);
});

await step('GRANT_REPLAY_BLOCKED present in audit log', async () => {
  const r = await api('GET', '/audit-events?type=GRANT_REPLAY_BLOCKED');
  assert(r.status === 200 && r.json?.length >= 1, `status=${r.status} count=${r.json?.length}`);
});

await step('audit chain verifies (tamper-evident)', async () => {
  const r = await api('GET', '/audit-events/verify');
  assert(r.status === 200 && r.json?.ok === true, `status=${r.status} body=${JSON.stringify(r.json)}`);
});

/* ---------------- report ---------------- */
console.log('\n  KEYRAIL SMOKE — ' + API);
const w = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  const mark = r.ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${mark}  ${r.name.padEnd(w + 2)}${r.detail}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n  ${results.length - failed}/${results.length} passed${failed ? ' — deployment gate FAILED' : ' — deployment gate green'}\n`);
process.exit(failed ? 1 : 0);
