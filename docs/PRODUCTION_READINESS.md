# Production Readiness — Forensic Audit (initial)

This document is the Phase 0 repository forensic audit required by the full production readiness plan. It lists components, current status, evidence found in the repository, and the required fixes to reach production readiness.

Legend — statuses
- IMPLEMENTED — complete backend workflow present, tested, and ready for production (rare).
- PARTIAL — core exists but missing production elements, tests, or hardening.
- MOCKED — dev-only stub or mock present; NOT production-ready.
- MISSING — not implemented.
- INSECURE — implemented but with insecure defaults or dangerous behaviors.
- BROKEN — fails to run or logically incorrect.
- UNTESTED — functionality exists but no tests or verification.

Audit summary
- Inspected files: backend/src/{main.ts,routes.ts,db.ts,crypto.ts,vault.ts,auth.ts,seed.ts,audit.ts}, backend/.env.example, backend/package.json, root package.json, repo layout (backend, browser-extension, connector, database, infrastructure).
- Key findings:
  - Backend contains a substantial, security-aware design (RLS approach, no plaintext endpoints, capability flow).
  - Crypto module implements envelope encryption with a KMS abstraction; local dev stub uses an ephemeral in-memory key (mock).
  - Many security-critical components are present conceptually (vault, launch grants, access requests, audit chain), but production hardening, KMS integration, RLS verification, health checks, docker/compose, and deployment docs are incomplete or default to insecure values.
  - There are several high-risk defaults and missing production artifacts that must be fixed before any production claim.

Component | Status | Evidence | Required Fix
--- | ---: | --- | ---
Frontend (Next.js / Vite) | PARTIAL | root package.json is a Vite React app (vite, react) — no build/deploy scripts for production app (root scripts are minimal) | Ensure frontend uses Next.js (user requirement) or clearly document if Vite SPA is intentional. Add production build scripts, CSP review, secure cookie handling integration with backend.
Backend (Fastify API) | PARTIAL | backend/src/routes.ts implements routes and security-conscious patterns (no plaintext endpoints, principal resolution, withTenant) | Add production configuration: strict validation of cfg, add full health endpoint checks, robust error/metrics integration, logging redaction review, and production build & CI pipeline.
Database (PostgreSQL) | PARTIAL | db.ts uses pg Pool and migrate() reads ../database/migrations — migrations directory present but not yet validated | Run and verify all migrations in database/migrations; ensure tables listed in spec exist with correct constraints, UUID PKs and tenant_id; enforce RLS policies SQL; database role must not be superuser.
Database migrations | UNTESTED | db.ts references ../database/migrations; files exist (directory present) but not yet executed or validated | Execute migrations from clean DB, review for missing tables/constraints/indexes; add missing tables required by spec (see PHASE 3 list).
Redis (cache/session) | PARTIAL | backend/.env.example defines REDIS_URL; db.ts creates ioredis client | Add Redis healthcheck in /health; ensure Redis is bound to private network in deployment; add sentinel/replication considerations and connection/security (AUTH/TLS) for prod.
KMS / Encryption | MOCKED / PARTIAL | crypto.ts includes KMS abstraction; LOCAL_MASTER is randomBytes(32) (dev-only) and KMS_PROVIDER default in .env.example is local | Integrate real cloud or hardware KMS for production (AWS KMS or a supported HSM). Remove/local stub from production configs. Implement secure storage of KMS credentials and machine identities; do not store master key as env var in plaintext.
Vault (envelope encryption, key versioning) | PARTIAL | crypto.ts implements DEK generation, wrapping, getDek and seal/unseal; vault.ts exists (not fully inspected in this pass) | Verify vault code for proper use of withUnsealedSecret, zeroization, rotateTenantDek path, and correct storage of wrapped_dek. Add tests for key rotation, decryption, and ciphertext integrity.
Zero-plaintext retrieval guarantee | PARTIAL | routes.ts intentionally avoids GET /credentials/:id/secret and uses capability/launch flow | Verify vault.createCredential/issueLaunchGrant/consumeGrant never return plaintext. Implement and test capability binding (tenant, user, application, audience), single-use tokens, expiry and revocation.
Credential Broker (brokered decryption) | PARTIAL | routes call createCredential/issueLaunchGrant/consumeGrant in vault.ts | Inspect and test vault.ts to ensure the broker decrypts and hands secrets only to authorized, audited brokers/gateways. Add integration tests simulating browser extension & connector flows.
Authentication (email/password) | PARTIAL | routes implement /auth/login, /auth/mfa, refresh, logout; auth.ts exists | Add hardened password policy, account lockout/brute force protection (beyond rate-limit), refresh token rotation, session idle/absolute timeouts tests, secure cookie flags verified at runtime. Ensure cookie secret is required and validated (cfg.cookieSecret currently has unsafe default).
OIDC / SSO (Google / Entra) | PARTIAL | routes.ts references oidcCallback and env entries in .env.example | Implement/verify provider setup, keys, discovery URLs, and callback security. Add CI/test flows for SSO login, and document required production env values.
MFA (TOTP, WebAuthn) | PARTIAL | routes use TOTP flow and imports @simplewebauthn/server | Verify TOTP secret storage is encrypted (I saw mfa_methods secret column read convert_from(secret_enc, 'utf8') — may store plaintext) and that WebAuthn is fully implemented and tested. Ensure secrets are stored encrypted.
Session management | PARTIAL | routes use cookies kr_access/kr_refresh, rotateRefresh referenced in auth module | Verify refresh rotation, session revocation (redis, session store), session TTL/idle enforcement, and audit logging. Add tests for session revocation and token reuse detection.
RBAC / Permissions | PARTIAL | withTenant and role/permission queries present in principal() and require() | Add unit and integration tests for horizontal/vertical escalation, IDOR checks, enforcement of permission boundaries. Ensure permission set includes required granular actions and that credential.use != credential.reveal.
Audit (tamper-evident chain) | PARTIAL | audit.ts exists and routes expose /audit-events and /audit-events/verify | Validate chainHash/verifyChain implementations, ensure audit events never include secrets, and add tests for tamper detection and chain verification. Document the integrity model and checkpointing.
Browser extension (Manifest v3) | PARTIAL | browser-extension package exists and build script is present | Validate extension build, domain boundary checking, secure authentication flows, and that extension never receives plaintext secrets. Add domain boundary tests (suffix/prefix attacks).
Connector (customer-side outbound connector) | PARTIAL | connector folder exists, routes implement connectors register/revoke | Review connector implementation for mTLS, device identity, enroll flow, allowlists and revocation semantics. Ensure connector cannot receive master keys and has explicit command allowlist.
Launch grants / capability model | PARTIAL | routes implement /credentials/:id/launch and /launch/consume with token checks and constraints in code comments | Implement exhaustive tests for binding checks: wrong tenant, wrong user, wrong application, wrong credential, expired token, replay attempts and audience. Ensure tokens are cryptographically random and single-use.
Password rotation architecture | MISSING / PARTIAL | rotateCredential endpoint present but uses placeholders (changePassword: async () => { /* target adapter */ }, verify: async () => true) | Implement rotation adapters for targets or mark integrations blocked. Do not replace stored secret before verification. Add tests and rollback mechanisms.
Health checks | INSECURE / MISSING | routes.ts only exposes app.get('/healthz', async () => ({ ok: true, ts: Date.now() })); db.ts and redis are used but not reported | Implement /health that performs real checks for API readiness, PostgreSQL connectivity and migrations, Redis connectivity and optionally KMS connectivity. Health must fail if dependencies unavailable.
Secrets / configuration | INSECURE | backend/.env.example contains COOKIE_SECRET=change-me and KMS_PROVIDER=local by default | Create and require a validated .env.example and .env.production.example with no credentials. Refuse startup if critical configuration missing. Implement secret scanning in CI and remove unsafe defaults.
Docker / Development Compose | MISSING / PARTIAL | infrastructure directory exists, but a top-level docker-compose.yml or docker-compose.prod.yml is not present in root (not yet validated) | Add docker-compose.yml for development that brings up backend, frontend, PostgreSQL, Redis. Add docker-compose.prod.yml for production with private/public networks, nginx reverse proxy, TLS hints, healthchecks, and no public DB/Redis exposure.
CI / CD | PARTIAL | .github exists but not inspected fully in this pass | Create GitHub Actions: PR checks: npm ci, lint, typecheck, unit tests, build. main: repeat + Docker image build + vulnerability scan. Fail PRs on secrets detection.
Tests & coverage | UNTESTED | backend/package.json has "test": "vitest run" but tests are not yet validated | Run existing tests, add missing unit/integration tests for auth, RBAC, vault, launch grants, KMS integration, and adversarial tests outlined in plan.
VPS deployment docs | MISSING / PARTIAL | docs/ directory exists but VPS deployment docs required by Phase 24 not yet present | Create docs/VPS_DEPLOYMENT.md and docker-compose.prod.yml, nginx config, health checks, backup & restore scripts.
Backup / restore | MISSING | no scripts found (not yet inspected fully) | Implement encrypted pg_dump rotation, retention, test restore workflow and provide scripts (scripts/backup.sh, scripts/restore.sh).
Dependency security | UNTESTED | package-lock.json present; no automated audit artifacts found | Run `npm audit` / Snyk / other scans and address critical/high vulnerabilities. Add Dependabot or equivalent.
Secret history scan | UNTESTED | no automated secret scan found | Scan Git history for committed secrets and remediate if found. Add secret scanning to CI.
CSP / HSTS / secure headers | PARTIAL | routes.ts adds many security headers in onSend hook | Review header values for production correctness, ensure CSP fits the frontend architecture, and verify there are no unsafe inline script allowances.
Documentation (USER_TESTING / FINAL) | MISSING / PARTIAL | docs/ exists but not the full set required | Add docs/PRODUCTION_READINESS.md (this file), docs/FINAL_PRODUCTION_READINESS.md (post-work), docs/USER_TESTING.md and docs/VPS_DEPLOYMENT.md.

Immediate high-risk blockers (must fix before any production claim)
1. KMS: Production must not use LOCAL_MASTER. Default KMS_PROVIDER in .env.example is "local" — change to require explicit production KMS config. Integrate real KMS or an HSM abstraction and ensure keys never stored in plaintext.
2. Health checks: /healthz currently returns static ok; this will cause orchestrators to believe service healthy when DB/Redis is down. Implement real readiness/liveness checks that fail when dependencies unavailable.
3. Secrets defaults: COOKIE_SECRET and other values in .env.example are insecure. Startup should refuse to run with default cookie secret or missing KMS config in production-mode.
4. rotateCredential placeholders: Rotation endpoints contain placeholder adapters that claim success — REMOVE mock behavior and clearly mark rotation adapters as NOT_IMPLEMENTED; do not enable rotation in production until adapters exist and verified.
5. Audit chain verification: Verify verifyChain implementation and ensure audit entries do not contain secrets. Add tests.
6. Ensure migrations create RLS policies and tenant-forcing mechanisms — RLS must be enforced; verify with tests that cross-tenant reads are impossible even with unexpected query shapes.

Priority action plan (next steps)
- P0 (security-critical, immediate)
  1. Require a production KMS and prevent startup with KMS_PROVIDER=local in production (or explicitly make dev-mode only).
  2. Implement /healthz to check PostgreSQL (simple SELECT 1), Redis (PING) and KMS health; fail startup if critical config missing.
  3. Enforce and validate cookie secret and session config at startup; refuse to start with weak defaults.
  4. Run migrations against a fresh Postgres instance, verify required tables exist, add missing ones.
  5. Add automated tests (unit + integration) that confirm: GET /credentials/:id/secret is unreachable and logs a RED_TEAM_PROBE; launch grant issuance + single-use consumption; basic RLS tenant isolation via withTenant.
- P1 (needed before demo)
  1. Harden authentication flows: refresh rotation, cookie flags, brute-force protection per-account.
  2. Review and encrypt storage of MFA secrets; ensure they are never stored plaintext in DB.
  3. Verify vault broker never returns plaintext to API callers; add integration tests with browser-extension emulation.
  4. Replace placeholder rotation adapters with either documented NOT_IMPLEMENTED responses or real adapters for the demo target.
- P2 (infrastructure & QA)
  1. Add docker-compose.yml for dev and docker-compose.prod.yml for production with separate networks and nginx config.
  2. Implement backup/restore scripts and test restores.
  3. Create CI pipelines (PR checks + main).
  4. Add secret scanning to CI and Dependabot.
- P3 (features & polishing)
  1. Implement and test WebAuthn/passkeys flow.
  2. Implement SAML (architectural plan) if required.
  3. Add RBAC coverage, JIT access workflows, password rotation adapters for supported integrations.
  4. Complete browser-extension security tests and domain boundary tests.

Suggested immediate development tasks (concrete)
- Add a failing-safe check in backend startup to require cfg.cookieSecret length >= 64 and KMS_PROVIDER != 'local' when an environment variable PRODUCTION=true is set.
- Implement /healthz to check Postgres and Redis (and optionally KMS): return { ok: true, api: true, postgres: true, redis: true, ts } or a 503 if any dependency fails.
- Review crypto.ts: localWrap/localUnwrap must be clearly marked dev-only and not allowed in production. Replace cfg.kmsKeyId default with empty and require explicit configuration.
- Create a development docker-compose.yml that spins up: postgres (non-root role), redis, backend (mounted code for dev), and frontend. Document dev steps in README.md.
- Run npm ci and vitest in CI and locally; collect failing tests and add tests for the vault/launch flows before making other changes.

Testing & verification
- Tests required before any production claim:
  - unit tests for crypto.seal/unseal and withUnsealedSecret zeroization
  - integration tests for auth login -> mfa -> session establishment -> refresh rotation
  - adversarial tests (IDOR, horizontal/vertical escalation, grant replay)
  - migration test: start clean DB, run migrations, run seed, run app, run API tests
  - browser-extension domain validation tests
- I recommend creating a `tests/e2e/demo-target` scenario that exercises the full login → application → launch → browser injection flow with a demo target as Phase 10 describes.

Risk summary and blockers
- The main production blockers are KMS not integrated, health checks missing, insecure default secrets, incomplete rotation adapters, and unverified migrations / RLS policies.
- Until KMS, health, and secret defaults are fixed and verified by tests and CI, do NOT deploy to production or claim production readiness.

Appendix — specific lines / code references used as evidence
- backend/.env.example shows KMS_PROVIDER=local and COOKIE_SECRET=change-me (insecure defaults).
- backend/src/crypto.ts:
  - Local dev KMS stub: LOCAL_MASTER = crypto.randomBytes(32) (line ~20 onwards).
  - KMS abstraction present but production usage conditional on cfg.kmsProvider (line ~17-76).
- backend/src/routes.ts:
  - Principal resolution, RLS-forced comments, and anti-endpoint policy (no plaintext endpoint) exist (top of file).
  - /healthz currently returns static { ok: true } (line ~82).
  - Launch/capability flow implemented endpoints: POST /credentials/:id/launch and /launch/consume (lines ~213–231).
- backend/src/db.ts:
  - withTenant pins transaction with set_config('app.tenant_id', …) (lines ~36–52).
  - migrate() reads ../database/migrations (lines ~60–69).
- backend/package.json:
  - build/migrate/seed scripts available, tests use vitest (evidence of test harness), but tests not yet run.

Acceptance (next milestone)
- I will prepare PR(s) implementing the P0 fixes (health checks, startup validation for secrets and KMS, and a development docker-compose) and a first set of tests verifying: migrations run, health checks fail on missing dependencies, and that GET /credentials/:id/secret is unreachable and logs RED_TEAM_PROBE. I will also add docs/PRODUCTION_READINESS.md (this draft) into the repository.

If you want, I will:
- Commit docs/PRODUCTION_READINESS.md into the repo now and open a PR with the initial P0 fixes (health checks & startup validations), then run the test suite and report results.
- Or, if you prefer, I can begin by running the test suite (locally or in CI) and report failing tests first.

Which do you want me to do next?
