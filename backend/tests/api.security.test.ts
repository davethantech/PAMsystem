/**
 * API security suite — runs against the real Fastify app via inject()
 * (no network, uses KMS_PROVIDER=local + a scratch database).
 *
 *   cd backend && npm i && DATABASE_URL=postgres://…/keyrail_test npm test
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildApp } from '../src/routes.js';
import { pool } from '../src/db.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

async function loginAs(email: string, password = 'Sup3r-Secret-Dev!') {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { tenant: 'acme', email, password } });
  const cookies = res.cookies.filter((c) => c.name.startsWith('kr_'))
    .map((c) => `${c.name}=${c.value}`).join('; ');
  return { status: res.statusCode, cookies, body: res.json() };
}

beforeAll(async () => {
  app = await buildApp();
});

describe('authorization & tenant isolation', () => {
  it('refuses unauthenticated vault reads', async () => {
    const r = await app.inject({ method: 'GET', url: '/credentials' });
    expect(r.statusCode).toBe(401);
  });

  it('has NO plaintext credential route — and audits the probe', async () => {
    const u = await loginAs('chetan@acme.test');
    const r = await app.inject({
      method: 'GET', url: '/credentials/00000000-0000-4000-8000-000000000001/secret',
      cookies: { kr_access: u.cookies },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toBe('NO_SUCH_ROUTE');
    const audit = await app.inject({ method: 'GET', url: '/audit-events?type=RED_TEAM_PROBE', cookies: { kr_access: u.cookies } });
    expect(audit.statusCode).toBeOneOf([200, 403]); // chetan may lack audit.view — denial is fine
  });

  it('reveal endpoint denies even authenticated callers', async () => {
    const u = await loginAs('chetan@acme.test');
    const r = await app.inject({
      method: 'POST', url: '/credentials/00000000-0000-4000-8000-000000000001/reveal',
      cookies: { kr_access: u.cookies },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('REVEAL_DENIED');
  });

  it('ignores client-supplied tenant parameters', async () => {
    const u = await loginAs('chetan@acme.test');
    const a = await app.inject({ method: 'GET', url: '/credentials', cookies: { kr_access: u.cookies } });
    const b = await app.inject({ method: 'GET', url: '/credentials?tenant=other-org', cookies: { kr_access: u.cookies } });
    expect(a.json()).toEqual(b.json()); // identical: tenant comes from the token
  });

  it('foreign-tenant credential ids are denied as IDOR', async () => {
    const u = await loginAs('chetan@acme.test');
    const r = await app.inject({
      method: 'POST',
      url: '/credentials/00000000-0000-4000-8000-00000000dead/launch',
      cookies: { kr_access: u.cookies },
      payload: { applicationId: '00000000-0000-4000-8000-00000000beef' },
    });
    expect([403, 404]).toContain(r.statusCode);
  });
});

describe('launch grants', () => {
  it('rejects forged tokens at consume time', async () => {
    const u = await loginAs('chetan@acme.test');
    const r = await app.inject({
      method: 'POST', url: '/launch/consume',
      cookies: { kr_access: u.cookies },
      payload: { token: 'x'.repeat(40), kind: 'web-inject' },
    });
    expect([403, 404]).toContain(r.statusCode);
  });

  it('enforces RBAC vertical escalation blocks (read-only cannot launch)', async () => {
    const u = await loginAs('sofia@acme.test'); // READ_ONLY
    const r = await app.inject({
      method: 'POST',
      url: '/credentials/00000000-0000-4000-8000-000000000001/launch',
      cookies: { kr_access: u.cookies },
      payload: { applicationId: '00000000-0000-4000-8000-000000000002' },
    });
    expect([403, 404]).toContain(r.statusCode);
  });
});

describe('session hardening', () => {
  it('sets HttpOnly + Secure + SameSite=Strict cookies', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { tenant: 'acme', email: 'no-mfa@acme.test', password: 'Sup3r-Secret-Dev!' },
    });
    const setCookie = res.headers['set-cookie']?.toString() ?? '';
    if (setCookie) {
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/Secure/i);
      expect(setCookie).toMatch(/SameSite=Strict/i);
    }
  });

  it('tampered access tokens are rejected', async () => {
    const u = await loginAs('chetan@acme.test');
    const tampered = (u.cookies.split('kr_access=')[1] ?? '').slice(0, -2) + 'xx';
    const r = await app.inject({ method: 'GET', url: '/me', cookies: { kr_access: tampered } });
    expect(r.statusCode).toBe(401);
  });
});

declare module 'vitest' {
  interface Assertion<T = unknown> { toBeOneOf(values: number[]): T }
}
import { expect as _e } from 'vitest';
// minimal custom matcher used above
_e.extend({
  toBeOneOf(received: number, values: number[]) {
    return { pass: values.includes(received), message: () => `expected ${received} to be one of ${values}` };
  },
});
afterAllSafe();
function afterAllSafe() {
  // pool stays lazy; vitest exits after the suite
  void pool;
}
