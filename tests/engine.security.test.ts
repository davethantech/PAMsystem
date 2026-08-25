/**
 * Security suite — replays the adversarial checklist from the brief against
 * the live engine. Run: `npx vitest run`.
 *
 * Attacker model: an authorized user (Chetan, role USER) deliberately trying
 * to retrieve a privileged secret by any available path.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { pam, isPamError } from '../src/engine/pam';

const login = (email = 'chetan@meridian.dev') => {
  const { mfaToken, expectedCode } = pam.login(email, 'correct-horse-99');
  return pam.verifyTotp(mfaToken, expectedCode);
};

beforeEach(() => {
  pam.logout();
});

describe('authentication', () => {
  it('rejects invalid login and audits it', () => {
    expect(() => pam.login('chetan@meridian.dev', 'x')).toThrow();
    const denied = pam.snapshot().audit.find((e) => e.type === 'USER_LOGIN' && e.result !== 'SUCCESS');
    expect(denied).toBeTruthy();
  });

  it('rejects a wrong TOTP code', () => {
    const { mfaToken } = pam.login('chetan@meridian.dev', 'correct-horse-99');
    expect(() => pam.verifyTotp(mfaToken, '000000')).toThrow();
  });

  it('session expires after logout — all APIs refuse', () => {
    login();
    pam.logout();
    expect(() => pam.createGrant('cred_ebay')).toThrow();
  });
});

describe('launch — the happy path is the ONLY path', () => {
  it('issues a grant, consumes it once, creates a session', () => {
    login();
    const g = pam.createGrant('cred_ebay');
    expect(g.grantId).toBeTruthy();
    expect(g.expiresAt - g.issuedAt).toBe(30_000);
    const rec = pam.consumeGrant(g.grantId);
    expect(rec.status).toBe('ACTIVE');
    expect(rec.recording).toBe(true);
  });

  it('blocks grant replay — secret is never decrypted twice', () => {
    login();
    const g = pam.createGrant('cred_ebay');
    pam.consumeGrant(g.grantId);
    expect(() => pam.consumeGrant(g.grantId)).toThrow(/already consumed|Replay/i);
    const ev = pam.snapshot().audit.find((e) => e.type === 'GRANT_REPLAY_BLOCKED');
    expect(ev?.result).toBe('DENIED');
  });

  it('blocks grants replayed via the adversarial endpoint', () => {
    login();
    const g = pam.createGrant('cred_cloudflare');
    pam.consumeGrant(g.grantId);
    expect(() => pam.attemptReplay(g.grantId)).toThrow();
  });

  it('rejects unknown / forged grant ids', () => {
    login();
    expect(() => pam.consumeGrant('grt_forged_123')).toThrow();
  });

  it('rejects a grant consumed by a different principal', () => {
    login('chetan@meridian.dev');
    const g = pam.createGrant('cred_ebay');
    pam.switchPersona('usr_john'); // different user, same tenant
    expect(() => pam.consumeGrant(g.grantId)).toThrow();
  });

  it('denies launch for JIT-gated credentials without an approved window', () => {
    login(); // Chetan has no live approval for cred_pg (and no infra collection)
    expect(() => pam.createGrant('cred_pg')).toThrow(/just-in-time|JIT|collections/i);
  });

  it('allows launch after approval — full JIT lifecycle', () => {
    login('chetan@meridian.dev');
    pam.requestAccess('cred_pg', 'Replication lag investigation during AU peak', 1, 'CHG-2214');
    pam.switchPersona('usr_priya'); // PAM admin approves
    const req = pam.snapshot().requests.find((r) => r.credentialId === 'cred_pg' && r.status === 'PENDING')!;
    pam.decideRequest(req.id, true);
    pam.switchPersona('usr_chetan');
    const g = pam.createGrant('cred_pg');
    expect(pam.consumeGrant(g.grantId).status).toBe('ACTIVE');
  });
});

describe('no plaintext surface', () => {
  it('reveal is denied for a regular user — and audited', () => {
    const u = login();
    expect(() => pam.attemptReveal('cred_ebay')).toThrow(/Denied/i);
    const ev = pam.snapshot().audit.find((e) => e.type === 'CREDENTIAL_REVEAL' && e.result === 'DENIED' && e.actorId === u.id);
    expect(ev).toBeTruthy();
  });

  it('reveal is denied even for PAM admins (use ≠ reveal)', () => {
    login('priya@meridian.dev');
    expect(() => pam.attemptReveal('cred_cloudflare')).toThrow();
  });

  it('break-glass denies without credential.reveal, short reason, or bad co-sign', () => {
    login('priya@meridian.dev'); // PAM_ADMIN — no reveal right
    expect(() => pam.breakGlass('cred_root', 'Legitimate recovery need', 'INC-1234')).toThrow(/reveal/i);

    pam.switchPersona('usr_marcus'); // SECURITY_ADMIN — has reveal right
    expect(() => pam.breakGlass('cred_root', 'short', 'INC-1234')).toThrow(/justification/i);
    expect(() => pam.breakGlass('cred_root', 'DC01 recovery after isolation event', 'nope')).toThrow(/ticket/i);
  });

  it('the snapshot — everything the UI can see — carries no secret material', () => {
    login();
    const json = JSON.stringify(pam.snapshot());
    expect(json).not.toMatch(/"value":\s*"[A-Za-z0-9#$%&*+\-]{16,}"/);
    expect(json.toLowerCase()).not.toContain('plaintext');
    expect(json).not.toContain('password":');
  });

  it('red-team probes: every exfil vector is denied + audited', () => {
    login();
    for (const v of ['GET_CRED', 'IDOR', 'REPLAY', 'LOCALSTORAGE', 'DEVTOOLS_DOM', 'XSS_EXFIL', 'CLIPBOARD', 'DOWNLOAD']) {
      const r = pam.redTeamProbe(v);
      expect(r.outcome).toMatch(/404|DENIED|EMPTY|OPAQUE|BLOCKED|ABSENT|REDACTED|MASKED|REJECTED|IGNORED|TLS/i);
      expect(r.auditId).toBeTruthy();
    }
  });
});

describe('tenant & collection isolation', () => {
  it('a credential outside the tenant scope is a 404-style denial (IDOR)', () => {
    login();
    expect(() => pam.createGrant('cred_foreign_tenant_x')).toThrow(/tenant|scope/i);
  });

  it('credentials outside authorized collections stay invisible and unlaunchable', () => {
    login('john@meridian.dev'); // John: cloud collection only
    const visible = pam.snapshot().credentials.filter((c) => c.collectionIds.includes('col_cloud'));
    expect(visible.length).toBeGreaterThan(0);
    expect(() => pam.createGrant('cred_cpanel')).toThrow(/collection/i); // webops — not his
  });
});

describe('audit chain integrity', () => {
  it('every event links to the previous hash (tamper evidence)', () => {
    login();
    pam.createGrant('cred_ebay');
    const events = pam.snapshot().audit; // newest first
    for (let i = 0; i < events.length - 1; i++) {
      expect(events[i].prevHash).toBe(events[i + 1].hash);
    }
  });

  it('never logs secret material in event metadata', () => {
    login();
    const metas = pam.snapshot().audit.map((e) => `${e.meta ?? ''} ${e.resourceName ?? ''}`).join(' ');
    expect(metas).not.toMatch(/password\s*[:=]/i);
  });
});
