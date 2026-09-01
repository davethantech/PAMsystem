# Keyrail Runtime and Deployment

## Production architecture

Keyrail production is a persistent Fastify control plane, not a serverless function. The supported architecture is:

- PostgreSQL as the canonical datastore
- Redis for sessions, grants and ephemeral state
- AWS KMS for tenant data-encryption keys
- Playwright/Chromium on the same trusted execution host or a dedicated persistent browser-worker host
- TLS reverse proxy/load balancer in front of the API
- Vite frontend served separately

The API must not run as a Vercel serverless function because Playwright browser sessions and the janitor require process lifetime.

## Required production environment

```env
NODE_ENV=production
PORT=8080
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/keyrail
REDIS_URL=redis://HOST:6379
COOKIE_SECRET=<random 64+ byte secret>
ISSUER=https://pam.example.com
KMS_PROVIDER=aws
KMS_KEY_ID=<kms-key-id>
PG_SSL=true
PG_SSL_REJECT_UNAUTHORIZED=true
```

Never commit real values.

## Deterministic local live-data testing (recommended)

This is the simplest reliable way to test Keyrail with a real PostgreSQL database, Redis and a visible browser on a Windows development machine.

### 1. Start only PostgreSQL and Redis in Docker

From the repository root:

```powershell
docker compose -f docker-compose.local.yml up -d
```

Wait until both containers report `healthy`:

```powershell
docker compose -f docker-compose.local.yml ps
```

### 2. Configure the backend for real PostgreSQL

Create `backend/.env` (do not commit it):

```env
NODE_ENV=development
PORT=8080
DATABASE_URL=postgres://keyrail:keyrail-local-only@localhost:5432/keyrail
REDIS_URL=redis://localhost:6379
COOKIE_SECRET=<generate-a-random-local-secret>
ISSUER=http://localhost:8080
KMS_PROVIDER=local
SESSION_TTL_MIN=120
IDLE_TIMEOUT_MIN=15
```

This development-only local KMS mode is for test data. Production requires AWS KMS.

### 3. Install backend dependencies and Chromium

```powershell
cd backend
npm ci
npx playwright install chromium
```

### 4. Run migrations against PostgreSQL

```powershell
npm run build
npm run migrate
```

If migration fails, stop here and fix the migration/database error. Do not switch back to pg-mem to hide it.

### 5. Start the API once

```powershell
npm start
```

Expected:

```text
Keyrail API ready
```

Verify in another terminal:

```powershell
curl http://localhost:8080/healthz
```

### 6. Start the frontend once

From the repository root, in a second terminal:

```powershell
npm install
npm run dev
```

Open the Vite URL shown by the terminal (normally `http://localhost:3000`).

Do not simultaneously start another copy of the backend through Vercel, another terminal, or another IDE task.

### 7. First live-data acceptance test

Use the setup screen to create the first tenant/admin.

Then verify, in order:

1. Create a WEB_PASSWORD credential.
2. Confirm it appears in Vault.
3. Refresh the browser.
4. Confirm it still appears.
5. Create a Web Application.
6. Associate the credential.
7. Refresh again.
8. Confirm the application remains.
9. Click Launch.
10. Confirm a visible Chromium window starts from the Keyrail backend process.
11. Confirm the target page opens.
12. Confirm login fields are detected.
13. Confirm the stored credential is used without returning it through the React API.
14. Confirm the configured authenticated-state rule becomes true.
15. Confirm the browser remains open for the user.
16. Confirm an audit event is recorded.

Use the repository's controlled test target before testing a third-party service.

## Production first start

1. Provision PostgreSQL.
2. Provision Redis.
3. Provision an AWS KMS key and grant the API runtime only the required KMS operations.
4. Configure all production environment variables.
5. Install backend dependencies.
6. Install the matching Playwright Chromium runtime on the persistent browser host.
7. Run `npm run build`.
8. Run `npm run migrate` once for the release.
9. Start exactly one API process per configured listener.
10. Put TLS in front of the API.
11. Serve the frontend separately.
12. Verify `/healthz`.
13. Complete initial setup.
14. Run the controlled web-login acceptance test.
15. Only then test approved external applications.

## Production invariants

- PostgreSQL is mandatory in production; pg-mem is never a production fallback.
- `backend/data/db_state.json` is development-only and is not a production datastore.
- A default cookie secret is invalid.
- Production requires AWS KMS.
- Secrets are never returned by normal credential list/read endpoints.
- Browser sessions use isolated Playwright contexts.
- The user's normal Chrome profile is never reused.
- Browser authentication success requires an explicit success condition; leaving a login URL is not sufficient.
- CAPTCHA, MFA, passkeys and other human verification challenges are not bypassed.

## No-loop / no-duplicate-process contract

Only one backend process may own port 8080. Only one frontend dev server should own port 3000.

The API owns one guarded janitor interval. It is cleared on shutdown.

Do not run both `npm run dev` and `npm start` for the backend at the same time.
Do not run a Vercel serverless backend alongside the persistent API.

On SIGTERM/SIGINT the API drains Fastify, closes Redis, closes PostgreSQL and exits once.

## Browser deployment constraint

A headed Playwright browser is visible on the machine where the Playwright process runs. Therefore a cloud API cannot make a headed browser magically appear on the user's local desktop.

For local live testing, run the API and Playwright on the user's machine.
For remote enterprise deployment, use a persistent browser-worker/remote-desktop architecture rather than a serverless function.
