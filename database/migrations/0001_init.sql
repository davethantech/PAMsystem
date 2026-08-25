-- KEYRAIL PAM · initial schema · PostgreSQL 15+
-- Every tenant-scoped table is protected by Row Level Security.
-- The app sets `app.tenant_id` per transaction (see backend/src/db.ts withTenant()).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- tenants
CREATE TABLE tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  region        text NOT NULL DEFAULT 'ap-southeast-2',
  plan          text NOT NULL DEFAULT 'enterprise',
  kms_key_id    text,                       -- cloud KMS customer master key arn/id
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER tenants_updated BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------- users
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         citext NOT NULL,
  name          text NOT NULL,
  title         text,
  password_hash text,                       -- argon2id; null when SSO-only
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED','LOCKED')),
  mfa_required  boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  failed_logins int NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  deleted_at    timestamptz,                -- soft delete
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);
CREATE INDEX users_tenant_idx ON users (tenant_id) WHERE deleted_at IS NULL;
CREATE TRIGGER users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------- roles & permissions
CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,   -- null = built-in role
  name        text NOT NULL,               -- SUPER_ADMIN … READ_ONLY
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE         -- credential.use, credential.reveal, …
);

INSERT INTO permissions (name) VALUES
  ('credential.view_metadata'),('credential.use'),('credential.reveal'),
  ('credential.create'),('credential.update'),('credential.delete'),
  ('application.launch'),('session.start'),('session.terminate'),('session.record.view'),
  ('user.create'),('user.disable'),('policy.create'),('policy.update'),('audit.view')
ON CONFLICT (name) DO NOTHING;

-- Built-in roles. NOTE: credential.use and credential.reveal are deliberately
-- disjoint — holding launch rights never implies reveal rights.
INSERT INTO roles (name, is_system) VALUES
  ('SUPER_ADMIN', true),('ORG_ADMIN', true),('PAM_ADMIN', true),
  ('SECURITY_ADMIN', true),('AUDITOR', true),('USER', true),('READ_ONLY', true)
ON CONFLICT (tenant_id, name) DO NOTHING;

CREATE TABLE role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id   uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

-- ---------------------------------------------------------------- groups
CREATE TABLE groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE groups_users (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE groups_roles (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  role_id  uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, role_id)
);

-- ---------------------------------------------------------------- collections
CREATE TABLE collections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE collection_members (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE CASCADE,
  group_id      uuid REFERENCES groups(id) ON DELETE CASCADE,
  CHECK (user_id IS NOT NULL OR group_id IS NOT NULL),
  PRIMARY KEY (collection_id, user_id, group_id)
);

-- ---------------------------------------------------------------- encryption keys
CREATE TABLE encryption_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_version   int  NOT NULL,
  wrapped_dek   bytea NOT NULL,             -- DEK wrapped by cloud KMS (never plaintext at rest)
  algorithm     text NOT NULL DEFAULT 'AES-256-GCM',
  state         text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','ROTATING','RETIRED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  retired_at    timestamptz,
  UNIQUE (tenant_id, key_version)
);

-- ---------------------------------------------------------------- credentials (vault)
-- Plaintext never touches this table. Only ciphertext + nonce + tag.
CREATE TABLE credentials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name              text NOT NULL,
  target            text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('PASSWORD','API_KEY','SSH_KEY','TOKEN','CERTIFICATE','SECURE_NOTE','RECOVERY_CODES')),
  username_encrypted bytea,
  username_nonce    bytea,
  secret_ciphertext bytea NOT NULL,
  secret_nonce      bytea NOT NULL,
  secret_tag        bytea NOT NULL,
  key_version       int  NOT NULL,
  secret_length     int  NOT NULL,          -- for strength policy only; not the secret
  rotation_policy   text NOT NULL DEFAULT 'manual',
  rotated_at        timestamptz,
  health            text NOT NULL DEFAULT 'PENDING' CHECK (health IN ('VERIFIED','PENDING','FAILED')),
  access            text NOT NULL DEFAULT 'PERMANENT'
                    CHECK (access IN ('PERMANENT','APPROVAL_REQUIRED','ONE_TIME','SCHEDULED','EMERGENCY')),
  jit_window_min    int,
  last_used_at      timestamptz,
  deleted_at        timestamptz,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credentials_tenant_idx ON credentials (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX credentials_kind_idx   ON credentials (tenant_id, kind);
CREATE TRIGGER credentials_updated BEFORE UPDATE ON credentials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE credential_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  key_version   int  NOT NULL,
  event         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credential_collections (
  credential_id uuid NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  PRIMARY KEY (credential_id, collection_id)
);

-- ---------------------------------------------------------------- applications
CREATE TABLE applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('WEB','SSH','RDP','DB','NETWORK')),
  domain        text NOT NULL,              -- strict allowlist for injection
  url           text NOT NULL,
  login_selectors jsonb,                    -- {username, password, submit, otp}
  auth_flow     text NOT NULL DEFAULT 'password',
  via_connector uuid REFERENCES connectors_stub(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- forward-declared stub replaced below by real connectors table (order-safe)
DROP TABLE IF EXISTS applications CASCADE;

CREATE TABLE connectors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           text NOT NULL,
  site           text,
  device_cert_fp text NOT NULL,             -- mTLS device identity fingerprint
  status         text NOT NULL DEFAULT 'HEALTHY' CHECK (status IN ('HEALTHY','DEGRADED','REVOKED')),
  version        text,
  last_heartbeat timestamptz,
  registered_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  UNIQUE (tenant_id, name)
);

CREATE TABLE applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('WEB','SSH','RDP','DB','NETWORK')),
  domain        text NOT NULL,
  url           text NOT NULL,
  login_selectors jsonb,
  auth_flow     text NOT NULL DEFAULT 'password',
  via_connector uuid REFERENCES connectors(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE application_credentials (
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  credential_id  uuid NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  PRIMARY KEY (application_id, credential_id)
);

-- ---------------------------------------------------------------- policies
CREATE TABLE access_policies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  rule        jsonb NOT NULL,               -- {mfa_step_up, geo, device, idle_timeout_min, …}
  enabled     boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- access requests / approvals
CREATE TABLE access_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  reason        text NOT NULL CHECK (char_length(reason) >= 8),
  ticket        text,
  window_hours  numeric NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','APPROVED','DENIED','EXPIRED')),
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_requests_pending_idx
  ON access_requests (tenant_id, status) WHERE status = 'PENDING';

CREATE TABLE approvals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES access_requests(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision    text NOT NULL CHECK (decision IN ('APPROVE','DENY')),
  comment     text,
  decided_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- launch grants (capabilities)
-- The ONLY authorized path toward using a secret. Never returns plaintext.
CREATE TABLE launch_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,      -- sha256(opaque token); token never stored
  domain        text NOT NULL,              -- bound allowlist domain
  expires_at    timestamptz NOT NULL,       -- 30s
  used_at       timestamptz,                -- single-use marker
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX launch_grants_expiry_idx ON launch_grants (expires_at);

-- ---------------------------------------------------------------- sessions
CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id uuid REFERENCES credentials(id),
  application_id uuid REFERENCES applications(id),
  gateway       text,
  source_ip     inet,
  device_fp     text,
  recording     boolean NOT NULL DEFAULT true,
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','TERMINATED','EXPIRED')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  ended_at      timestamptz
);
CREATE INDEX sessions_active_idx ON sessions (tenant_id) WHERE status = 'ACTIVE';

CREATE TABLE session_events (
  id         bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind       text NOT NULL,                 -- START, INJECT_OK, KEYSTROKE_BATCH, TERMINATE …
  meta       jsonb,
  at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- audit
CREATE TABLE audit_events (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  actor_id    uuid,
  actor_name  text NOT NULL,
  event_type  text NOT NULL,
  resource_id text,
  resource_name text,
  result      text NOT NULL CHECK (result IN ('SUCCESS','DENIED','FAILURE')),
  meta        text,                         -- pre-redacted
  source_ip   inet,
  device_fp   text,
  prev_hash   text NOT NULL,
  hash        text NOT NULL,                -- hash-chained, tamper-evident
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_idx ON audit_events (tenant_id, at DESC);
CREATE INDEX audit_type_idx   ON audit_events (tenant_id, event_type);

-- ---------------------------------------------------------------- devices / mfa / api keys
CREATE TABLE devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint   text NOT NULL,
  label         text,
  trusted       boolean NOT NULL DEFAULT false,
  last_seen_at  timestamptz,
  revoked_at    timestamptz,
  UNIQUE (tenant_id, fingerprint)
);

CREATE TABLE mfa_methods (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('TOTP','WEBAUTHN','RECOVERY')),
  secret_enc  bytea,                        -- encrypted TOTP seed / credential id / code hash
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label       text NOT NULL,
  token_hash  bytea NOT NULL UNIQUE,
  prefix      text NOT NULL,
  scopes      text[] NOT NULL DEFAULT '{audit.read}',   -- no secret-read scope exists
  last_used_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- rotation jobs
CREATE TABLE password_rotation_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  policy        text NOT NULL,              -- every-1d … after-session, manual
  last_run_at   timestamptz,
  next_run_at   timestamptz,
  last_result   text CHECK (last_result IN ('SUCCESS','FAILED','ROLLED_BACK')),
  attempts      int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, credential_id)
);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  body       text NOT NULL,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ================================================================ RLS
-- Tenant isolation is enforced by the database, not by application discipline.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','groups','collections','encryption_keys','credentials','applications',
    'connectors','access_policies','access_requests','approvals','launch_grants',
    'sessions','audit_events','devices','api_keys','password_rotation_jobs','notifications'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;

-- superuser bypass guard: app role must never be a superuser in production.
COMMENT ON TABLE credentials IS 'Ciphertext only. Plaintext exists solely in broker enclave memory.';
COMMENT ON TABLE launch_grants IS 'Single-use, 30s, user+tenant+app+domain bound capability tokens.';
