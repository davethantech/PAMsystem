/**
 * KEYRAIL PAM ENGINE — simulated control plane.
 *
 * Security model enforced at the module boundary:
 *  - Plaintext secrets live ONLY in the module-private SECRET_VAULT map.
 *    No exported function can read them, except a gated, watermarked,
 *    auto-expiring break-glass reveal (itself heavily audited).
 *  - No API accepts a user/tenant id from the caller. The actor is always
 *    derived from the engine-issued session — client-supplied ids are ignored.
 *  - There is no GET /credentials/:id equivalent. The only path to USE a
 *    credential is a single-use, 30s, tenant+user+credential+app-bound
 *    launch grant consumed by the injection broker.
 */
import type {
  AccessRequest, AlertMeta, ApiKeyMeta, AppMeta, AuditEvent, AuditType,
  CollectionMeta, ConnectorMeta, CredMeta, GrantMeta, PamError, ProbeResult,
  RevealWindow, RotationJob, SessionRec, SessionUser, Snapshot, TenantMeta, UserMeta,
} from './types';

/* ---------------- utils ---------------- */
const rnd = (n: number) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
};
const uid = (p: string) => `${p}_${rnd(6)}`;
const now = () => Date.now();
const MIN = 60_000;

function hashStr(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

const genSecret = (len = 24) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789#$%&*+-';
  const a = new Uint32Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, (v) => chars[v % chars.length]).join('');
};

function pamErr(code: string, message: string, auditId?: string): PamError {
  return { code, message, auditId };
}

/* ---------------- sealed secret store ---------------- */
const SECRET_VAULT = new Map<string, { ciphertextProxy: string; nonce: string; keyVersion: number; len: number }>();
const PLAINTEXT = new Map<string, string>(); // module-private. never exported.

function sealSecret(credId: string, keyVersion: number) {
  const plain = genSecret(24 + Math.floor(Math.random() * 8));
  PLAINTEXT.set(credId, plain);
  SECRET_VAULT.set(credId, {
    ciphertextProxy: rnd(32),
    nonce: rnd(12),
    keyVersion,
    len: plain.length,
  });
}

/* ---------------- seed data ---------------- */
const TENANT: TenantMeta = {
  id: 'tnt_meridian_01', name: 'Meridian Retail Group', slug: 'meridian',
  region: 'ap-southeast-2', plan: 'Enterprise · multi-tenant SaaS',
};

const USERS: UserMeta[] = [
  { id: 'usr_chetan', tenantId: TENANT.id, name: 'Chetan Nair', email: 'chetan@meridian.dev', role: 'USER', title: 'E-commerce Operator', hue: 168, mfaMethod: 'TOTP', status: 'ACTIVE', lastLogin: now() - 26 * MIN, collectionIds: ['col_cloud', 'col_webops'] },
  { id: 'usr_priya', tenantId: TENANT.id, name: 'Priya Sharma', email: 'priya@meridian.dev', role: 'PAM_ADMIN', title: 'PAM Administrator', hue: 210, mfaMethod: 'WEBAUTHN', status: 'ACTIVE', lastLogin: now() - 4 * MIN, collectionIds: ['col_cloud', 'col_webops', 'col_infra', 'col_critical', 'col_finance'] },
  { id: 'usr_marcus', tenantId: TENANT.id, name: 'Marcus Webb', email: 'marcus@meridian.dev', role: 'SECURITY_ADMIN', title: 'Head of Security', hue: 36, mfaMethod: 'WEBAUTHN', status: 'ACTIVE', lastLogin: now() - 52 * MIN, collectionIds: ['col_cloud', 'col_webops', 'col_infra', 'col_critical', 'col_finance'] },
  { id: 'usr_elena', tenantId: TENANT.id, name: 'Elena Petrova', email: 'elena@meridian.dev', role: 'AUDITOR', title: 'Compliance Auditor', hue: 268, mfaMethod: 'TOTP', status: 'ACTIVE', lastLogin: now() - 3 * 60 * MIN, collectionIds: [] },
  { id: 'usr_john', tenantId: TENANT.id, name: 'John Kowalski', email: 'john@meridian.dev', role: 'USER', title: 'Marketplace Analyst', hue: 340, mfaMethod: 'TOTP', status: 'ACTIVE', lastLogin: now() - 9 * 60 * MIN, collectionIds: ['col_cloud'] },
  { id: 'usr_sofia', tenantId: TENANT.id, name: 'Sofia Reyes', email: 'sofia@meridian.dev', role: 'READ_ONLY', title: 'Finance Controller', hue: 96, mfaMethod: 'TOTP', status: 'DISABLED', lastLogin: now() - 12 * 60 * 60 * MIN, collectionIds: ['col_finance'] },
];

const COLLECTIONS: CollectionMeta[] = [
  { id: 'col_cloud', name: 'Cloud Platform', hue: 195, description: 'Cloudflare, marketplace and SaaS admin consoles', memberUserIds: ['usr_chetan', 'usr_priya', 'usr_marcus', 'usr_john'] },
  { id: 'col_webops', name: 'Web Ops', hue: 160, description: 'Hosting panels and inventory systems', memberUserIds: ['usr_chetan', 'usr_priya', 'usr_marcus'] },
  { id: 'col_infra', name: 'Infrastructure', hue: 220, description: 'Databases, bastions and network devices', memberUserIds: ['usr_priya', 'usr_marcus'] },
  { id: 'col_critical', name: 'Critical Accounts', hue: 20, description: 'Break-glass and domain admin credentials', memberUserIds: ['usr_marcus'] },
  { id: 'col_finance', name: 'Finance', hue: 48, description: 'Payment and banking portals', memberUserIds: ['usr_priya', 'usr_marcus', 'usr_sofia'] },
];

const CREDENTIALS: CredMeta[] = [
  { id: 'cred_ebay', tenantId: TENANT.id, name: 'eBay AU — Seller Admin', target: 'ebay.com.au', kind: 'PASSWORD', username: 'meridian-ops-admin', collectionIds: ['col_cloud'], keyVersion: 7, rotationPolicy: 'every-30d', rotatedAt: now() - 12 * 24 * 60 * MIN, health: 'VERIFIED', access: 'PERMANENT', lastUsedAt: now() - 41 * MIN, versions: [{ v: 7, ts: now() - 12 * 24 * 60 * MIN, event: 'Scheduled rotation' }, { v: 6, ts: now() - 42 * 24 * 60 * MIN, event: 'Scheduled rotation' }, { v: 5, ts: now() - 72 * 24 * 60 * MIN, event: 'Post-incident rotation' }], secretLen: 28 },
  { id: 'cred_cloudflare', tenantId: TENANT.id, name: 'Cloudflare — Company Admin', target: 'dash.cloudflare.com', kind: 'PASSWORD', username: 'admin@meridian.dev', collectionIds: ['col_cloud'], keyVersion: 12, rotationPolicy: 'every-7d', rotatedAt: now() - 3 * 24 * 60 * MIN, health: 'VERIFIED', access: 'PERMANENT', lastUsedAt: now() - 4 * MIN, versions: [{ v: 12, ts: now() - 3 * 24 * 60 * MIN, event: 'Scheduled rotation' }, { v: 11, ts: now() - 10 * 24 * 60 * MIN, event: 'Scheduled rotation' }], secretLen: 30 },
  { id: 'cred_cpanel', tenantId: TENANT.id, name: 'cPanel — Hosting Master', target: 'cpanel.meridian.shop:2083', kind: 'PASSWORD', username: 'meridian_host', collectionIds: ['col_webops'], keyVersion: 4, rotationPolicy: 'every-90d', rotatedAt: now() - 31 * 24 * 60 * MIN, health: 'VERIFIED', access: 'PERMANENT', lastUsedAt: now() - 26 * 60 * MIN, versions: [{ v: 4, ts: now() - 31 * 24 * 60 * MIN, event: 'Scheduled rotation' }], secretLen: 26 },
  { id: 'cred_unleashed', tenantId: TENANT.id, name: 'Unleashed — Inventory Owner', target: 'app.unleashedsoftware.com', kind: 'PASSWORD', username: 'ops@meridian.dev', collectionIds: ['col_webops'], keyVersion: 5, rotationPolicy: 'every-30d', rotatedAt: now() - 18 * 24 * 60 * MIN, health: 'VERIFIED', access: 'PERMANENT', lastUsedAt: now() - 5 * 60 * MIN, versions: [{ v: 5, ts: now() - 18 * 24 * 60 * MIN, event: 'Scheduled rotation' }], secretLen: 27 },
  { id: 'cred_pg', tenantId: TENANT.id, name: 'Prod PostgreSQL — app_svc', target: 'db-int.meridian.local:5432', kind: 'PASSWORD', username: 'app_svc', collectionIds: ['col_infra'], keyVersion: 9, rotationPolicy: 'after-session', rotatedAt: now() - 2 * 24 * 60 * MIN, health: 'VERIFIED', access: 'APPROVAL_REQUIRED', jitWindowMin: 30, versions: [{ v: 9, ts: now() - 2 * 24 * 60 * MIN, event: 'Post-session rotation' }], secretLen: 32 },
  { id: 'cred_switch', tenantId: TENANT.id, name: 'Core Switch — netadmin (SSH)', target: 'sw-core-01.meridian.local', kind: 'SSH_KEY', username: 'netadmin', collectionIds: ['col_infra'], keyVersion: 3, rotationPolicy: 'every-90d', rotatedAt: now() - 44 * 24 * 60 * MIN, health: 'VERIFIED', access: 'APPROVAL_REQUIRED', jitWindowMin: 60, versions: [{ v: 3, ts: now() - 44 * 24 * 60 * MIN, event: 'Key rotation' }], secretLen: 64 },
  { id: 'cred_stripe', tenantId: TENANT.id, name: 'Stripe — Live API Key', target: 'api.stripe.com', kind: 'API_KEY', username: 'restricted key', collectionIds: ['col_finance'], keyVersion: 2, rotationPolicy: 'every-90d', rotatedAt: now() - 60 * 24 * 60 * MIN, health: 'PENDING', access: 'APPROVAL_REQUIRED', jitWindowMin: 15, versions: [{ v: 2, ts: now() - 60 * 24 * 60 * MIN, event: 'Key rotation' }], secretLen: 35 },
  { id: 'cred_root', tenantId: TENANT.id, name: 'Break-Glass — Domain Root', target: 'dc01.meridian.local', kind: 'PASSWORD', username: 'administrator', collectionIds: ['col_critical'], keyVersion: 15, rotationPolicy: 'every-30d + dual-custody', rotatedAt: now() - 9 * 24 * 60 * MIN, health: 'VERIFIED', access: 'APPROVAL_REQUIRED', jitWindowMin: 15, versions: [{ v: 15, ts: now() - 9 * 24 * 60 * MIN, event: 'Break-glass rotation' }], secretLen: 32 },
];
CREDENTIALS.forEach((c) => sealSecret(c.id, c.keyVersion));

const APPS: AppMeta[] = [
  { id: 'app_ebay', name: 'eBay Seller Hub', kind: 'WEB', domain: 'ebay.com.au', url: 'https://www.ebay.com.au/sh/ovw', hue: 8, glyph: 'ebay', credentialId: 'cred_ebay', viaConnector: false, blurb: 'AU marketplace admin · listings, orders, payouts' },
  { id: 'app_cloudflare', name: 'Cloudflare', kind: 'WEB', domain: 'dash.cloudflare.com', url: 'https://dash.cloudflare.com', hue: 24, glyph: 'cloudflare', credentialId: 'cred_cloudflare', viaConnector: false, blurb: 'DNS, WAF and edge configuration' },
  { id: 'app_cpanel', name: 'cPanel', kind: 'WEB', domain: 'cpanel.meridian.shop', url: 'https://cpanel.meridian.shop:2083', hue: 205, glyph: 'cpanel', credentialId: 'cred_cpanel', viaConnector: false, blurb: 'Shared hosting · meridian.shop storefront' },
  { id: 'app_unleashed', name: 'Unleashed', kind: 'WEB', domain: 'app.unleashedsoftware.com', url: 'https://app.unleashedsoftware.com', hue: 130, glyph: 'unleashed', credentialId: 'cred_unleashed', viaConnector: false, blurb: 'Inventory & order management' },
  { id: 'app_pg', name: 'Prod PostgreSQL', kind: 'DB', domain: 'db-int.meridian.local', url: 'psql://db-int.meridian.local:5432/orders', hue: 222, glyph: 'db', credentialId: 'cred_pg', viaConnector: true, blurb: 'Orders database · via on-prem connector' },
  { id: 'app_switch', name: 'Core Switch SSH', kind: 'SSH', domain: 'sw-core-01.meridian.local', url: 'ssh netadmin@sw-core-01', hue: 262, glyph: 'terminal', credentialId: 'cred_switch', viaConnector: true, blurb: 'Network edge · brokered SSH session' },
];

const ROTATION: RotationJob[] = CREDENTIALS.slice(0, 6).map((c, i) => ({
  credentialId: c.id,
  credentialName: c.name,
  policy: c.rotationPolicy,
  lastRun: c.rotatedAt,
  nextRun: c.rotatedAt + (i % 3 === 0 ? 6 : 2) * 24 * 60 * MIN,
  status: i === 2 ? 'DUE' : 'HEALTHY',
  history: c.versions.map((v) => ({ ts: v.ts, result: 'SUCCESS' as const, keyVersion: v.v })),
}));

const ALERTS: AlertMeta[] = [
  { id: 'alr_1', severity: 'HIGH', title: 'Launch grant replay blocked', detail: 'Grant grt_9f21… presented twice from 203.0.113.44 — token was already consumed. Session not created.', ts: now() - 47 * MIN },
  { id: 'alr_2', severity: 'MEDIUM', title: 'Impossible travel on user session', detail: 'Refresh token used from Sydney then Oslo within 6 min. Session revoked, re-authentication required.', ts: now() - 5 * 60 * MIN },
];

/* ---------------- mutable state ---------------- */
let session: SessionUser | null = null;
const grants = new Map<string, GrantMeta & { userId: string; tenantId: string }>();
const sessions: SessionRec[] = [
  { id: 'ses_a1b2', userId: 'usr_priya', userName: 'Priya Sharma', credentialId: 'cred_cloudflare', credentialName: 'Cloudflare — Company Admin', appId: 'app_cloudflare', appName: 'Cloudflare', appKind: 'WEB', startedAt: now() - 4 * MIN, expiresAt: now() + 26 * MIN, status: 'ACTIVE', ip: '203.0.113.18', device: 'Chrome 131 · macOS', gateway: 'gw-eu.keyrail.cloud', recording: true, injectedBy: 'isolated-world injector v3.2' },
  { id: 'ses_c3d4', userId: 'usr_john', userName: 'John Kowalski', credentialId: 'cred_ebay', credentialName: 'eBay AU — Seller Admin', appId: 'app_ebay', appName: 'eBay Seller Hub', appKind: 'WEB', startedAt: now() - 12 * MIN, expiresAt: now() + 18 * MIN, status: 'ACTIVE', ip: '198.51.100.7', device: 'Edge 131 · Windows 11', gateway: 'gw-ap.keyrail.cloud', recording: true, injectedBy: 'isolated-world injector v3.2' },
];
const requests: AccessRequest[] = [
  { id: 'req_001', userId: 'usr_chetan', userName: 'Chetan Nair', credentialId: 'cred_pg', credentialName: 'Prod PostgreSQL — app_svc', reason: 'Need to inspect orders table replication lag during AU peak window.', ticket: 'CHG-2214', hours: 1, status: 'PENDING', createdAt: now() - 14 * MIN },
];
const audit: AuditEvent[] = [];
const connectors: ConnectorMeta[] = [
  { id: 'conn_sydney_01', name: 'ON-PREM-CONN-01', site: 'Sydney DC · rack B4', status: 'HEALTHY', registeredAt: now() - 90 * 24 * 60 * MIN, mtls: true, lastHeartbeat: now() - 40_000, version: '2.4.1' },
];
const apiKeys: ApiKeyMeta[] = [
  { id: 'key_1', label: 'SIEM export (Splunk)', prefix: 'kr_live_9f3a', createdAt: now() - 40 * 24 * 60 * MIN, scopes: ['audit.read'], lastUsed: now() - 6 * MIN },
];
const mfaPending = new Map<string, { userId: string; code: string; ts: number }>();
const revealWindows = new Map<string, RevealWindow>();
const launchSeries = [14, 18, 11, 22, 27, 19, 31, 24, 29, 35, 26, 33, 38, 30];

let version = 0;
let seq = 0;
let prevHash = '0'.repeat(16);
const listeners = new Set<() => void>();

function bump() { version++; listeners.forEach((l) => l()); }

function auditLog(type: AuditType, opts: { actor?: UserMeta | null; result?: AuditEvent['result']; resourceId?: string; resourceName?: string; meta?: string } = {}): AuditEvent {
  const actor = opts.actor !== undefined ? opts.actor : session;
  const ev: AuditEvent = {
    id: uid('evt'), seq: ++seq, ts: now(),
    tenantId: TENANT.id,
    actorId: actor?.id ?? 'anonymous', actorName: actor?.name ?? 'anonymous',
    type, resourceId: opts.resourceId, resourceName: opts.resourceName,
    result: opts.result ?? 'SUCCESS', meta: opts.meta,
    ip: '203.0.113.21', prevHash, hash: '',
  };
  ev.hash = hashStr(`${ev.seq}|${ev.type}|${ev.actorId}|${ev.ts}|${prevHash}`);
  prevHash = ev.hash;
  audit.unshift(ev);
  return ev;
}

function requireSession(): SessionUser {
  if (!session) throw pamErr('UNAUTHENTICATED', 'No active session — authenticate first.');
  return session;
}

const ROLE_PERMS: Record<string, string[]> = {
  SUPER_ADMIN: ['*'],
  ORG_ADMIN: ['credential.view_metadata', 'credential.use', 'credential.create', 'credential.update', 'application.launch', 'session.start', 'session.terminate', 'user.create', 'user.disable', 'policy.create', 'policy.update', 'audit.view'],
  PAM_ADMIN: ['credential.view_metadata', 'credential.use', 'credential.create', 'credential.update', 'application.launch', 'session.start', 'session.terminate', 'user.create', 'policy.create', 'policy.update', 'audit.view'],
  SECURITY_ADMIN: ['credential.view_metadata', 'credential.use', 'credential.reveal', 'application.launch', 'session.start', 'session.terminate', 'session.record.view', 'policy.create', 'policy.update', 'audit.view'],
  AUDITOR: ['credential.view_metadata', 'session.record.view', 'audit.view'],
  USER: ['credential.view_metadata', 'credential.use', 'application.launch', 'session.start'],
  READ_ONLY: ['credential.view_metadata'],
};

function has(perm: string): boolean {
  if (!session) return false;
  const perms = ROLE_PERMS[session.role] ?? [];
  return perms.includes('*') || perms.includes(perm);
}

function credVisible(c: CredMeta): boolean {
  if (!session) return false;
  if (['SUPER_ADMIN', 'ORG_ADMIN', 'PAM_ADMIN', 'SECURITY_ADMIN', 'AUDITOR'].includes(session.role)) return true;
  // an approved JIT window temporarily grants visibility to its grantee
  return c.collectionIds.some((id) => session!.collectionIds.includes(id)) || hasLiveApproval(c);
}

function inCollection(c: CredMeta): boolean {
  if (!session) return false;
  if (['SUPER_ADMIN', 'ORG_ADMIN', 'PAM_ADMIN'].includes(session.role)) return true;
  return c.collectionIds.some((id) => session!.collectionIds.includes(id)) || hasLiveApproval(c);
}

function hasLiveApproval(c: CredMeta): boolean {
  if (!session) return false;
  return requests.some((r) => r.credentialId === c.id && r.userId === session!.id && r.status === 'APPROVED' && (r.expiresAt ?? 0) > now());
}

function jitAllowed(c: CredMeta): boolean {
  if (c.access !== 'APPROVAL_REQUIRED') return true;
  return hasLiveApproval(c);
}

/* ---------------- historical audit seed ---------------- */
(function seedAudit() {
  const hist: [AuditType, string, string, number, AuditEvent['result']][] = [
    ['PASSWORD_ROTATED', 'cred_cloudflare', 'Cloudflare — Company Admin', 3 * 24 * 60, 'SUCCESS'],
    ['USER_LOGIN', 'usr_john', 'John Kowalski', 9 * 60, 'SUCCESS'],
    ['APPLICATION_LAUNCHED', 'cred_ebay', 'eBay AU — Seller Admin', 12 * 60, 'SUCCESS'],
    ['ACCESS_REQUESTED', 'cred_pg', 'Prod PostgreSQL — app_svc', 14 * 60, 'SUCCESS'],
    ['SESSION_STARTED', 'ses_c3d4', 'eBay Seller Hub', 12 * 60, 'SUCCESS'],
    ['GRANT_REPLAY_BLOCKED', 'grt_9f21', 'single-use grant', 47 * 60, 'DENIED'],
    ['ACCESS_DENIED', 'cred_root', 'Break-Glass — Domain Root', 75 * 60, 'DENIED'],
    ['SESSION_STARTED', 'ses_a1b2', 'Cloudflare', 4 * 60, 'SUCCESS'],
    ['MFA_SUCCESS', 'usr_priya', 'Priya Sharma', 4 * 60 + 1, 'SUCCESS'],
    ['CREDENTIAL_UPDATED', 'cred_cpanel', 'cPanel — Hosting Master', 3 * 60 * 60, 'SUCCESS'],
    ['CONNECTOR_REGISTERED', 'conn_sydney_01', 'ON-PREM-CONN-01', 90 * 24 * 60, 'SUCCESS'],
    ['RED_TEAM_PROBE', 'GET /credentials/:id', 'API inspection', 26 * 60, 'DENIED'],
    ['POLICY_CHANGED', 'pol_launch', 'Launch policy: require MFA step-up', 8 * 60 * 60, 'SUCCESS'],
    ['USER_CREATED', 'usr_sofia', 'Sofia Reyes', 30 * 24 * 60, 'SUCCESS'],
  ];
  hist.reverse().forEach(([type, rid, rname, minAgo, result]) => {
    const actor = USERS.find((u) => rid === u.id) ?? USERS[1];
    seq++;
    const ev: AuditEvent = {
      id: uid('evt'), seq, ts: now() - minAgo * MIN, tenantId: TENANT.id,
      actorId: actor.id, actorName: actor.name, type, resourceId: rid, resourceName: rname,
      result, ip: '203.0.113.21', prevHash, hash: '',
    };
    ev.hash = hashStr(`${ev.seq}|${ev.type}|${ev.actorId}|${ev.ts}|${prevHash}`);
    prevHash = ev.hash;
    audit.push(ev);
  });
  audit.reverse();
})();

/* ---------------- public engine API ---------------- */
export const pam = {
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },

  login(email: string, password: string) {
    const user = USERS.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user || user.status !== 'ACTIVE') {
      const ev = auditLog('USER_LOGIN', { actor: null, result: 'DENIED', meta: `email=${email} · unknown or disabled` });
      throw pamErr('AUTH_FAILED', 'Invalid credentials. Event recorded to the audit chain.', ev.id);
    }
    if (password.length < 4) {
      const ev = auditLog('USER_LOGIN', { actor: user, result: 'FAILURE', meta: 'weak/empty password attempt — login throttled 30s' });
      throw pamErr('AUTH_FAILED', 'Password rejected. Repeated failures lock the account for 15 minutes.', ev.id);
    }
    const token = uid('mfa');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    mfaPending.set(token, { userId: user.id, code, ts: now() });
    auditLog('USER_LOGIN', { actor: user, meta: 'password verified · MFA challenge issued' });
    return { mfaToken: token, user, expectedCode: code };
  },

  verifyTotp(mfaToken: string, code: string): SessionUser {
    const pending = mfaPending.get(mfaToken);
    if (!pending) throw pamErr('MFA_EXPIRED', 'MFA challenge expired — start again.');
    const user = USERS.find((u) => u.id === pending.userId)!;
    if (code.trim() !== pending.code) {
      const ev = auditLog('MFA_FAILURE', { actor: user, result: 'FAILURE', meta: 'TOTP mismatch' });
      throw pamErr('MFA_INVALID', 'TOTP code rejected and recorded to the audit log.', ev.id);
    }
    mfaPending.delete(mfaToken);
    auditLog('MFA_SUCCESS', { actor: user });
    session = { ...user, authMethod: 'PASSWORD+TOTP', sessionId: uid('ses'), issuedAt: now() };
    auditLog('SESSION_STARTED', { actor: session, meta: 'HttpOnly · Secure · SameSite=Strict cookie issued' });
    bump();
    return session;
  },

  sso(provider: 'GOOGLE' | 'ENTRA'): SessionUser {
    const user = provider === 'GOOGLE' ? USERS[0] : USERS[1];
    auditLog('USER_LOGIN', { actor: user, meta: `${provider} SSO · OIDC assertion verified · tenant derived from token` });
    auditLog('MFA_SUCCESS', { actor: user, meta: 'step-up satisfied by IdP phishing-resistant MFA' });
    session = { ...user, authMethod: provider === 'GOOGLE' ? 'GOOGLE_SSO' : 'ENTRA_SSO', sessionId: uid('ses'), issuedAt: now() };
    bump();
    return session;
  },

  switchPersona(userId: string): SessionUser {
    const user = USERS.find((u) => u.id === userId);
    if (!user || user.status !== 'ACTIVE') throw pamErr('PERSONA_UNAVAILABLE', 'Persona disabled.');
    auditLog('USER_LOGIN', { actor: user, meta: 'demo persona switch · re-authenticated via passkey' });
    session = { ...user, authMethod: 'WEBAUTHN', sessionId: uid('ses'), issuedAt: now() };
    bump();
    return session;
  },

  logout() {
    if (session) auditLog('SESSION_TERMINATED', { actor: session, meta: 'user logout · refresh token revoked' });
    session = null;
    bump();
  },

  me(): SessionUser | null { return session; },

  /* ---- capability-based launch: NO plaintext ever crosses this boundary ---- */
  createGrant(credentialId: string): GrantMeta {
    const actor = requireSession();
    const cred = CREDENTIALS.find((c) => c.id === credentialId);
    if (!cred || cred.tenantId !== actor.tenantId) {
      const ev = auditLog('ACCESS_DENIED', { result: 'DENIED', resourceId: credentialId, meta: 'credential not found in tenant scope (IDOR attempt)' });
      throw pamErr('IDOR_BLOCKED', 'Tenant isolation: this credential does not exist in your tenant scope.', ev.id);
    }
    if (!credVisible(cred)) {
      const ev = auditLog('ACCESS_DENIED', { result: 'DENIED', resourceId: cred.id, resourceName: cred.name, meta: 'outside collection membership' });
      throw pamErr('NOT_VISIBLE', 'This credential is outside your authorized collections.', ev.id);
    }
    if (!has('credential.use') || !inCollection(cred)) {
      const ev = auditLog('ACCESS_DENIED', { result: 'DENIED', resourceId: cred.id, resourceName: cred.name, meta: 'missing credential.use' });
      throw pamErr('NO_USE_PERM', 'Your role does not hold credential.use for this account.', ev.id);
    }
    if (!jitAllowed(cred)) {
      const ev = auditLog('ACCESS_DENIED', { result: 'DENIED', resourceId: cred.id, resourceName: cred.name, meta: 'JIT window required — no live approval' });
      throw pamErr('JIT_REQUIRED', 'This account requires an approved just-in-time window. Request access first.', ev.id);
    }
    const app = APPS.find((a) => a.credentialId === cred.id)!;
    const t = now();
    const grant: GrantMeta & { userId: string; tenantId: string } = {
      grantId: uid('grt'), tokenTail: rnd(4),
      credentialId: cred.id, credentialName: cred.name, appId: app.id, appName: app.name, domain: app.domain,
      issuedAt: t, expiresAt: t + 30_000, consumed: false,
      userId: actor.id, tenantId: actor.tenantId,
    };
    grants.set(grant.grantId, grant);
    auditLog('GRANT_ISSUED', { resourceId: cred.id, resourceName: cred.name, meta: `single-use · 30s · bound to ${actor.email} @ ${app.domain}` });
    bump();
    const { userId: _u, tenantId: _t, ...view } = grant;
    return view;
  },

  consumeGrant(grantId: string): SessionRec {
    const actor = requireSession();
    const g = grants.get(grantId);
    if (!g) throw pamErr('GRANT_UNKNOWN', 'Launch grant not recognized.');
    if (g.consumed) {
      const ev = auditLog('GRANT_REPLAY_BLOCKED', { result: 'DENIED', resourceId: g.grantId, resourceName: g.credentialName, meta: 'single-use token presented twice — credential not touched' });
      throw pamErr('GRANT_REPLAYED', 'Replay blocked: this grant was already consumed. The credential was not decrypted.', ev.id);
    }
    if (g.expiresAt < now()) {
      const ev = auditLog('ACCESS_DENIED', { result: 'DENIED', resourceId: g.grantId, resourceName: g.credentialName, meta: 'grant expired before consumption' });
      throw pamErr('GRANT_EXPIRED', 'Launch grant expired (30s window). Start a new launch.', ev.id);
    }
    if (g.userId !== actor.id || g.tenantId !== actor.tenantId) {
      const ev = auditLog('ACCESS_DENIED', { result: 'DENIED', resourceId: g.grantId, meta: 'grant bound to different principal' });
      throw pamErr('GRANT_MISBOUND', 'Grant is cryptographically bound to the original user and tenant.', ev.id);
    }
    g.consumed = true;
    g.usedAt = now();
    // Broker decrypts inside the trust boundary and hands the injector an
    // operation handle — only the handle crosses to the browser context.
    const sealed = SECRET_VAULT.get(g.credentialId)!;
    void sealed; // ciphertext metadata only; plaintext never leaves the module
    const app = APPS.find((a) => a.id === g.appId);
    const rec: SessionRec = {
      id: uid('ses'), userId: actor.id, userName: actor.name,
      credentialId: g.credentialId, credentialName: g.credentialName,
      appId: g.appId, appName: g.appName,
      appKind: APPS.find((a) => a.id === g.appId)?.kind ?? 'WEB',
      startedAt: now(), expiresAt: now() + 30 * MIN, status: 'ACTIVE',
      ip: '203.0.113.21', device: 'Chrome 131 · this browser',
      gateway: app?.viaConnector ? 'gw-ap.keyrail.cloud → CONN-01' : 'gw-ap.keyrail.cloud',
      recording: true, injectedBy: 'isolated-world injector v3.2',
    };
    sessions.unshift(rec);
    const cred = CREDENTIALS.find((c) => c.id === g.credentialId)!;
    cred.lastUsedAt = now();
    launchSeries[launchSeries.length - 1] += 1;
    auditLog('APPLICATION_LAUNCHED', { resourceId: cred.id, resourceName: cred.name, meta: `grant ${g.grantId} consumed · domain ${g.domain} verified` });
    auditLog('CREDENTIAL_USED', { resourceId: cred.id, resourceName: cred.name, meta: 'decrypted inside broker enclave · injected via isolated world · memory zeroized' });
    auditLog('SESSION_STARTED', { resourceId: rec.id, resourceName: rec.appName, meta: `proxied via ${rec.gateway} · recording on` });
    bump();
    return rec;
  },

  attemptReplay(grantId: string): never {
    const actor = requireSession();
    const g = grants.get(grantId);
    const ev = auditLog('GRANT_REPLAY_BLOCKED', { actor, result: 'DENIED', resourceId: grantId, resourceName: g?.credentialName ?? 'unknown', meta: 'adversarial replay test — single-use enforcement held' });
    throw pamErr('GRANT_REPLAYED', 'Replay rejected: grant is single-use and already bound to a live session.', ev.id);
  },

  /* ---- reveal: denied for everyone except gated break-glass ---- */
  attemptReveal(credentialId: string): never {
    const actor = requireSession();
    const cred = CREDENTIALS.find((c) => c.id === credentialId);
    const ev = auditLog('CREDENTIAL_REVEAL', { actor, result: 'DENIED', resourceId: credentialId, resourceName: cred?.name, meta: `role=${actor.role} · credential.use ≠ credential.reveal · plaintext never returned` });
    throw pamErr('REVEAL_DENIED', `Denied & audited. ${actor.role} holds launch rights only — the API surface has no plaintext channel (evt ${ev.id.slice(-8)}).`, ev.id);
  },

  breakGlass(credentialId: string, reason: string, coSign: string): RevealWindow {
    const actor = requireSession();
    const cred = CREDENTIALS.find((c) => c.id === credentialId);
    if (!cred) throw pamErr('NOT_FOUND', 'Credential not found.');
    if (!has('credential.reveal')) {
      const ev = auditLog('BREAK_GLASS', { actor, result: 'DENIED', resourceId: credentialId, resourceName: cred.name, meta: 'role lacks credential.reveal' });
      throw pamErr('NO_REVEAL_PERM', 'Break-glass requires credential.reveal (Security Admin only). Attempt recorded.', ev.id);
    }
    if (reason.trim().length < 12) {
      const ev = auditLog('BREAK_GLASS', { actor, result: 'DENIED', resourceId: credentialId, resourceName: cred.name, meta: 'reason too short' });
      throw pamErr('REASON_REQUIRED', 'A detailed justification (min 12 chars) is mandatory for break-glass.', ev.id);
    }
    if (!/^[A-Z]{2,4}-\d{2,6}$/.test(coSign.trim().toUpperCase())) {
      const ev = auditLog('BREAK_GLASS', { actor, result: 'DENIED', resourceId: credentialId, resourceName: cred.name, meta: 'co-sign ticket invalid' });
      throw pamErr('COSIGN_INVALID', 'Co-sign incident ticket must look like INC-1234 (dual authorization).', ev.id);
    }
    const plain = PLAINTEXT.get(credentialId);
    if (!plain) throw pamErr('VAULT_EMPTY', 'Sealed secret missing — vault integrity failure.');
    const win: RevealWindow = {
      credentialId, credentialName: cred.name, value: plain,
      issuedAt: now(), expiresAt: now() + 30_000, watermarkedTo: actor.name,
    };
    revealWindows.set(`${actor.id}:${credentialId}`, win);
    auditLog('BREAK_GLASS', { actor, resourceId: credentialId, resourceName: cred.name, meta: `dual-custody reveal · reason logged · co-sign ${coSign.toUpperCase()} · 30s window · watermark ${actor.name}` });
    auditLog('CREDENTIAL_REVEAL', { actor, resourceId: credentialId, resourceName: cred.name, meta: 'one-time watermarked reveal — SIEM page triggered' });
    bump();
    return win;
  },

  requestAccess(credentialId: string, reason: string, hours: number, ticket: string) {
    const actor = requireSession();
    const cred = CREDENTIALS.find((c) => c.id === credentialId);
    if (!cred) throw pamErr('NOT_FOUND', 'Credential not found.');
    if (reason.trim().length < 8) throw pamErr('REASON_REQUIRED', 'Provide a business justification (min 8 chars).');
    requests.unshift({
      id: uid('req'), userId: actor.id, userName: actor.name,
      credentialId, credentialName: cred.name, reason: reason.trim(),
      ticket: ticket.trim() || 'N/A', hours, status: 'PENDING', createdAt: now(),
    });
    auditLog('ACCESS_REQUESTED', { resourceId: credentialId, resourceName: cred.name, meta: `JIT ${hours}h · ticket ${ticket || 'N/A'}` });
    bump();
  },

  decideRequest(requestId: string, approve: boolean) {
    const actor = requireSession();
    if (!['PAM_ADMIN', 'ORG_ADMIN', 'SUPER_ADMIN', 'SECURITY_ADMIN'].includes(actor.role))
      throw pamErr('NO_APPROVE_PERM', 'Only PAM/Security admins can decide requests.');
    const r = requests.find((x) => x.id === requestId);
    if (!r || r.status !== 'PENDING') throw pamErr('NOT_FOUND', 'Request not pending.');
    r.status = approve ? 'APPROVED' : 'DENIED';
    r.decidedAt = now();
    r.approverName = actor.name;
    if (approve) r.expiresAt = now() + r.hours * 60 * MIN;
    auditLog(approve ? 'ACCESS_APPROVED' : 'ACCESS_DENIED', { resourceId: r.credentialId, resourceName: r.credentialName, meta: `${r.status.toLowerCase()} by ${actor.name} · window ${r.hours}h` });
    bump();
  },

  terminateSession(sessionId: string) {
    const actor = requireSession();
    const s = sessions.find((x) => x.id === sessionId);
    if (!s) return;
    const allowed = s.userId === actor.id || has('session.terminate');
    if (!allowed) throw pamErr('NO_TERMINATE_PERM', 'Not your session and no session.terminate permission.');
    s.status = 'TERMINATED';
    s.endedAt = now();
    auditLog('SESSION_TERMINATED', { resourceId: s.id, resourceName: s.appName, meta: `terminated by ${actor.name} · grant scope revoked · recording sealed` });
    bump();
  },

  rotateNow(credentialId: string) {
    const actor = requireSession();
    if (!has('credential.update') && !has('policy.update'))
      throw pamErr('NO_ROTATE_PERM', 'Rotation requires credential.update.');
    const cred = CREDENTIALS.find((c) => c.id === credentialId);
    if (!cred) throw pamErr('NOT_FOUND', 'Credential not found.');
    sealSecret(credentialId, cred.keyVersion + 1);
    cred.keyVersion += 1;
    cred.rotatedAt = now();
    cred.health = 'VERIFIED';
    cred.versions.unshift({ v: cred.keyVersion, ts: now(), event: 'Manual rotation (verify-before-store)' });
    const job = ROTATION.find((j) => j.credentialId === credentialId);
    if (job) {
      job.lastRun = now();
      job.nextRun = now() + 7 * 24 * 60 * MIN;
      job.status = 'HEALTHY';
      job.history.unshift({ ts: now(), result: 'SUCCESS', keyVersion: cred.keyVersion });
    }
    auditLog('PASSWORD_ROTATED', { resourceId: credentialId, resourceName: cred.name, meta: `new secret verified against target · re-encrypted under DEK v${cred.keyVersion} · old version shredded` });
    bump();
  },

  registerConnector(name: string, site: string): ConnectorMeta {
    requireSession();
    const c: ConnectorMeta = {
      id: uid('conn'), name: name.toUpperCase(), site, status: 'HEALTHY',
      registeredAt: now(), mtls: true, lastHeartbeat: now(), version: '2.4.1',
    };
    connectors.push(c);
    auditLog('CONNECTOR_REGISTERED', { resourceId: c.id, resourceName: c.name, meta: 'outbound-only mTLS tunnel · device identity bound · no inbound ports' });
    bump();
    return c;
  },

  createApiKey(label: string): { id: string; label: string; prefix: string; token: string } {
    const actor = requireSession();
    const token = `kr_live_${rnd(16)}`;
    const k: ApiKeyMeta = { id: uid('key'), label, prefix: token.slice(0, 12), createdAt: now(), scopes: ['audit.read'] };
    apiKeys.unshift(k);
    auditLog('API_KEY_CREATED', { resourceId: k.id, resourceName: label, meta: `scoped audit.read only · no secret-read scope exists · created by ${actor.name}` });
    bump();
    return { ...k, token };
  },

  dismissAlert(id: string) {
    const i = ALERTS.findIndex((a) => a.id === id);
    if (i >= 0) ALERTS.splice(i, 1);
    bump();
  },

  redTeamProbe(attack: string): ProbeResult {
    const actor = requireSession();
    const table: Record<string, { label: string; vector: string; outcome: string; control: string }> = {
      GET_CRED: { label: 'GET /api/credentials/:id', vector: 'Direct API call expecting plaintext JSON', outcome: '404 — no such route exists. Metadata endpoint returns only name, target & policy.', control: 'No plaintext API surface · capability-based launch only' },
      IDOR: { label: 'IDOR — foreign credential id', vector: 'Swap credential id to another tenant’s object', outcome: 'DENIED — tenant id derived from session token, never from the request body.', control: 'Tenant binding from authenticated session · RLS-style scoping' },
      REPLAY: { label: 'Launch grant replay', vector: 'Re-present a consumed grant token', outcome: 'DENIED — grant is single-use; broker refuses second decryption.', control: 'Single-use cryptographic grant · 30s TTL' },
      LOCALSTORAGE: { label: 'localStorage / sessionStorage scan', vector: 'Dump browser storage for secrets', outcome: 'EMPTY — tokens live in HttpOnly cookies; secrets never touch storage.', control: 'HttpOnly · Secure · SameSite=Strict session cookies' },
      DEVTOOLS_DOM: { label: 'DevTools DOM inspection', vector: 'Inspect injected login fields', outcome: 'OPAQUE — injection runs in an isolated world; fields hold masked handles.', control: 'Isolated-world injector · no DOM-readable plaintext' },
      WEBSOCKET: { label: 'WebSocket frame sniffing', vector: 'Capture session gateway frames', outcome: 'TLS 1.3 end-to-broker; frames carry input events, never the secret.', control: 'Gateway proxies operations, not credentials' },
      JWT_FORGE: { label: 'JWT / token forgery', vector: 'Tamper access token claims', outcome: 'REJECTED — asymmetric signature check fails; rotation invalidates old keys.', control: 'Short-lived access tokens · refresh rotation' },
      TENANT_PARAM: { label: 'Tenant parameter tampering', vector: 'Inject ?tenant=other-org', outcome: 'IGNORED — tenant is always derived from the verified session.', control: 'Server-side tenant derivation' },
      XSS_EXFIL: { label: 'Stored XSS exfiltration', vector: 'Script tries to read vault state', outcome: 'BLOCKED — strict CSP, no inline scripts, vault state absent from client.', control: 'CSP · stateless client · secrets server-side' },
      CLIPBOARD: { label: 'Clipboard capture', vector: 'Copy masked secret to clipboard', outcome: 'MASKED ONLY — clipboard receives ••••••; copy of plaintext is impossible.', control: 'Masked display · copy disabled on secret fields' },
      SOURCEMAP: { label: 'Source-map / bundle search', vector: 'Grep JS bundle for secret strings', outcome: 'ABSENT — secrets exist only in the sealed engine module at runtime.', control: 'No secrets in client bundle' },
      DOWNLOAD: { label: 'Export / download attempt', vector: 'Request CSV export of vault', outcome: 'REDACTED — exports contain metadata only; secret columns do not exist.', control: 'Export allow-list · global redaction' },
    };
    const t = table[attack] ?? { label: attack, vector: '—', outcome: 'DENIED', control: 'Defense in depth' };
    const ev = auditLog('RED_TEAM_PROBE', { actor, result: 'DENIED', resourceId: attack, resourceName: t.label, meta: t.vector });
    bump();
    return { attack, ...t, auditId: ev.id };
  },

  snapshot(): Snapshot {
    sessions.forEach((s) => { if (s.status === 'ACTIVE' && s.expiresAt && s.expiresAt < now()) { s.status = 'EXPIRED'; s.endedAt = s.expiresAt; } });
    requests.forEach((r) => { if (r.status === 'APPROVED' && r.expiresAt && r.expiresAt < now()) r.status = 'EXPIRED'; });
    return {
      version, tenant: TENANT, users: USERS, collections: COLLECTIONS,
      credentials: CREDENTIALS.map((c) => ({ ...c })),
      apps: APPS, grants: [...grants.values()].map(({ userId: _u, tenantId: _t, ...g }) => g),
      sessions: [...sessions], requests: [...requests], audit: [...audit],
      connectors: [...connectors], apiKeys: [...apiKeys], rotation: ROTATION.map((r) => ({ ...r })),
      alerts: [...ALERTS], launchSeries: [...launchSeries],
    };
  },
};

export function isPamError(e: unknown): e is PamError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e;
}
