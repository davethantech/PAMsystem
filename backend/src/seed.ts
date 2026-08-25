/**
 * Dev seed — idempotent. Provisions the Meridian demo tenant end-to-end:
 * role→permission matrix, users (argon2 + TOTP enrolled), collections,
 * vault entries SEALED under a fresh DEK, applications, and rotation jobs.
 *
 *   npm run seed:dev          (tsx)
 *   npm run seed              (compiled dist)
 *
 * Dev credentials (printed below) are for local/docker runs ONLY.
 */
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { pool, withTenant } from './db.js';
import { generateDek, seal } from './crypto.js';

export const DEV_PASSWORD = 'Dev-Password-2024!';
export const DEV_TOTP_SEED = 'KEYRAILDEVSEED234567ABCDEFGHIJKLMN'; // base32, dev only

const ROLE_PERMS: Record<string, string[]> = {
  SUPER_ADMIN: ['*'],
  ORG_ADMIN: ['credential.view_metadata', 'credential.use', 'credential.create', 'credential.update', 'application.launch', 'session.start', 'session.terminate', 'user.create', 'user.disable', 'policy.create', 'policy.update', 'audit.view'],
  PAM_ADMIN: ['credential.view_metadata', 'credential.use', 'credential.create', 'credential.update', 'application.launch', 'session.start', 'session.terminate', 'user.create', 'policy.create', 'policy.update', 'audit.view'],
  SECURITY_ADMIN: ['credential.view_metadata', 'credential.use', 'credential.reveal', 'application.launch', 'session.start', 'session.terminate', 'session.record.view', 'policy.create', 'policy.update', 'audit.view'],
  AUDITOR: ['credential.view_metadata', 'session.record.view', 'audit.view'],
  USER: ['credential.view_metadata', 'credential.use', 'application.launch', 'session.start'],
  READ_ONLY: ['credential.view_metadata'],
};

const USERS = [
  { email: 'priya@meridian.dev', name: 'Priya Sharma', role: 'PAM_ADMIN', cols: ['col_cloud', 'col_webops', 'col_infra', 'col_critical', 'col_finance'] },
  { email: 'marcus@meridian.dev', name: 'Marcus Webb', role: 'SECURITY_ADMIN', cols: ['col_cloud', 'col_webops', 'col_infra', 'col_critical', 'col_finance'] },
  { email: 'chetan@meridian.dev', name: 'Chetan Nair', role: 'USER', cols: ['col_cloud', 'col_webops'] },
  { email: 'elena@meridian.dev', name: 'Elena Petrova', role: 'AUDITOR', cols: [] },
  { email: 'john@meridian.dev', name: 'John Kowalski', role: 'USER', cols: ['col_cloud'] },
];

const COLLECTIONS = [
  { key: 'col_cloud', name: 'Cloud Platform', description: 'Marketplace and SaaS admin consoles' },
  { key: 'col_webops', name: 'Web Ops', description: 'Hosting panels and inventory systems' },
  { key: 'col_infra', name: 'Infrastructure', description: 'Databases, bastions, network devices' },
  { key: 'col_critical', name: 'Critical Accounts', description: 'Break-glass and domain admin' },
  { key: 'col_finance', name: 'Finance', description: 'Payment and banking portals' },
];

const CREDS = [
  { name: 'eBay AU — Seller Admin', target: 'ebay.com.au', kind: 'PASSWORD', username: 'meridian-ops-admin', cols: ['col_cloud'], access: 'PERMANENT', app: { name: 'eBay Seller Hub', kind: 'WEB', domain: 'ebay.com.au', url: 'https://www.ebay.com.au/sh/ovw', selectors: { username: '#userid', password: '#pass', submit: '#sgnBt' } } },
  { name: 'Cloudflare — Company Admin', target: 'dash.cloudflare.com', kind: 'PASSWORD', username: 'admin@meridian.dev', cols: ['col_cloud'], access: 'PERMANENT', app: { name: 'Cloudflare', kind: 'WEB', domain: 'dash.cloudflare.com', url: 'https://dash.cloudflare.com', selectors: { username: '#login-form-username', password: '#login-form-password', submit: 'button[type=submit]' } } },
  { name: 'cPanel — Hosting Master', target: 'cpanel.meridian.shop:2083', kind: 'PASSWORD', username: 'meridian_host', cols: ['col_webops'], access: 'PERMANENT', app: { name: 'cPanel', kind: 'WEB', domain: 'cpanel.meridian.shop', url: 'https://cpanel.meridian.shop:2083', selectors: { username: '#user', password: '#pass', submit: '#login-submit' } } },
  { name: 'Unleashed — Inventory Owner', target: 'app.unleashedsoftware.com', kind: 'PASSWORD', username: 'ops@meridian.dev', cols: ['col_webops'], access: 'PERMANENT', app: { name: 'Unleashed', kind: 'WEB', domain: 'app.unleashedsoftware.com', url: 'https://app.unleashedsoftware.com', selectors: { username: '#UserName', password: '#Password', submit: '#LoginButton' } } },
  { name: 'Prod PostgreSQL — app_svc', target: 'db-int.meridian.local:5432', kind: 'PASSWORD', username: 'app_svc', cols: ['col_infra'], access: 'APPROVAL_REQUIRED', app: { name: 'Prod PostgreSQL', kind: 'DB', domain: 'db-int.meridian.local', url: 'psql://db-int.meridian.local:5432/orders', selectors: null } } },
  { name: 'Core Switch — netadmin (SSH)', target: 'sw-core-01.meridian.local', kind: 'SSH_KEY', username: 'netadmin', cols: ['col_infra'], access: 'APPROVAL_REQUIRED', app: { name: 'Core Switch SSH', kind: 'SSH', domain: 'sw-core-01.meridian.local', url: 'ssh://sw-core-01.meridian.local', selectors: null } } },
];

async function main() {
  // 1. tenant
  await pool.query(`INSERT INTO tenants (name, slug) VALUES ('Meridian Retail Group','meridian') ON CONFLICT (slug) DO NOTHING`);
  const { rows: [tenant] } = await pool.query(`SELECT id FROM tenants WHERE slug = 'meridian'`);
  const tid = tenant.id;

  await withTenant(tid, async (c) => {
    // 2. permission matrix (incl. the '*' super-permission)
    await c.query(`INSERT INTO permissions (name) VALUES ('*') ON CONFLICT (name) DO NOTHING`);
    const { rows: roles } = await c.query(`SELECT id, name FROM roles WHERE is_system = true`);
    const { rows: perms } = await c.query(`SELECT id, name FROM permissions`);
    const permId = Object.fromEntries(perms.map((p) => [p.name, p.id]));
    for (const r of roles) {
      for (const perm of ROLE_PERMS[r.name] ?? []) {
        await c.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [r.id, permId[perm]]);
      }
    }

    // 3. users + argon2 + TOTP enrollment + role binding
    const hash = await argon2.hash(DEV_PASSWORD);
    const roleId = Object.fromEntries(roles.map((r) => [r.name, r.id]));
    const userIds: Record<string, string> = {};
    for (const u of USERS) {
      const ins = await c.query(
        `INSERT INTO users (tenant_id, email, name, password_hash, mfa_required)
         VALUES ($1,$2,$3,$4,true)
         ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'ACTIVE'
         RETURNING id`, [tid, u.email, u.name, hash]);
      userIds[u.email] = ins.rows[0].id;
      await c.query(`DELETE FROM mfa_methods WHERE user_id = $1 AND kind = 'TOTP'`, [userIds[u.email]]);
      await c.query(
        `INSERT INTO mfa_methods (user_id, kind, secret_enc, metadata) VALUES ($1,'TOTP',$2,$3)`,
        [userIds[u.email], Buffer.from(DEV_TOTP_SEED, 'utf8'), { label: 'dev-seed' }]);
      await c.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [userIds[u.email], roleId[u.role]]);
    }

    // 4. DEK + collections + membership
    const { rows: kv } = await c.query(`SELECT key_version FROM encryption_keys WHERE state='ACTIVE' ORDER BY key_version DESC LIMIT 1`);
    let keyVersion = kv[0]?.key_version;
    if (!keyVersion) keyVersion = (await generateDek(tid)).version;

    const colIds: Record<string, string> = {};
    for (const col of COLLECTIONS) {
      const ins = await c.query(
        `INSERT INTO collections (tenant_id, name, description) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, name) DO UPDATE SET description = EXCLUDED.description RETURNING id`,
        [tid, col.name, col.description]);
      colIds[col.key] = ins.rows[0].id;
    }
    for (const u of USERS) {
      for (const colKey of u.cols) {
        const ins = await c.query(
          `INSERT INTO collection_members (collection_id, user_id) VALUES ($1,$2)
           ON CONFLICT DO NOTHING RETURNING id`, [colIds[colKey], userIds[u.email]]);
        void ins;
      }
    }

    // 5. credentials (sealed), applications, mappings, rotation jobs
    for (const cr of CREDS) {
      const existing = await c.query(`SELECT id FROM credentials WHERE tenant_id=$1 AND name=$2`, [tid, cr.name]);
      let credId = existing.rows[0]?.id;
      if (!credId) {
        const secret = crypto.randomBytes(18).toString('base64url');
        const sSecret = await seal(tid, keyVersion, secret);
        const sUser = await seal(tid, keyVersion, cr.username);
        const ins = await c.query(
          `INSERT INTO credentials
             (tenant_id, name, target, kind, username_encrypted, username_nonce,
              secret_ciphertext, secret_nonce, secret_tag, key_version, secret_length,
              rotation_policy, access, jit_window_min, health, rotated_at, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'every-30d',$12,30,'VERIFIED',now(),$13)
           RETURNING id`,
          [tid, cr.name, cr.target, cr.kind, sUser.ct, sUser.nonce,
           sSecret.ct, sSecret.nonce, sSecret.tag, keyVersion, secret.length,
           cr.access, userIds['priya@meridian.dev']]);
        credId = ins.rows[0].id;
        await c.query(`INSERT INTO credential_versions (credential_id, key_version, event) VALUES ($1,$2,'seeded')`, [credId, keyVersion]);
        await c.query(
          `INSERT INTO password_rotation_jobs (tenant_id, credential_id, policy, next_run_at)
           VALUES ($1,$2,'every-30d', now() + interval '30 days')`, [tid, credId]);
      }
      for (const colKey of cr.cols)
        await c.query(`INSERT INTO credential_collections (credential_id, collection_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [credId, colIds[colKey]]);

      const appIns = await c.query(
        `INSERT INTO applications (tenant_id, name, kind, domain, url, login_selectors, auth_flow)
         VALUES ($1,$2,$3,$4,$5,$6,'password')
         ON CONFLICT (tenant_id, name) DO UPDATE SET domain = EXCLUDED.domain RETURNING id`,
        [tid, cr.app.name, cr.app.kind, cr.app.domain, cr.app.url, cr.app.selectors ? JSON.stringify(cr.app.selectors) : null]);
      await c.query(`INSERT INTO application_credentials (application_id, credential_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [appIns.rows[0].id, credId]);
    }

    // 6. baseline launch policy
    const pol = await c.query(`SELECT id FROM access_policies WHERE tenant_id=$1 AND name='default-launch-policy'`, [tid]);
    if (!pol.rowCount) {
      await c.query(
        `INSERT INTO access_policies (tenant_id, name, rule, created_by) VALUES ($1,'default-launch-policy',$2,$3)`,
        [tid, JSON.stringify({ mfa_step_up: true, geo_allow: ['AU', 'NZ'], max_concurrent_sessions: 2, idle_timeout_min: 15, record_sessions: true }), userIds['priya@meridian.dev']]);
    }
  });

  console.log(`
┌─ KEYRAIL DEV SEED COMPLETE ──────────────────────────────┐
  tenant   meridian
  password ${DEV_PASSWORD}   (all users)
  TOTP seed  ${DEV_TOTP_SEED}
  users    ${USERS.map((u) => `${u.email} [${u.role}]`).join('\n           ')}
  NOTE: dev TOTP seeds are stored UNENCRYPTED in mfa_methods.
        Production enrollment must seal seeds under the tenant DEK.
└──────────────────────────────────────────────────────────┘`);
  await pool.end();
}

main().catch((e) => { console.error('seed failed:', e.message); process.exit(1); });
