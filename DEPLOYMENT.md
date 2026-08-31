# Keyrail Runtime and Deployment

## Supported production architecture

Keyrail production runs as a persistent Fastify process with:

- PostgreSQL as the canonical datastore
- Redis as the session/cache backend
- AWS KMS for tenant data-encryption keys (`KMS_PROVIDER=aws`)
- Playwright/Chromium on the same trusted execution host or a dedicated browser-worker host
- a TLS-terminating reverse proxy / load balancer in front of the API
- the Vite frontend served separately from the API

The API must not run as a Vercel serverless function because browser sessions and the janitor require process lifetime.

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

Never commit these values.

## First production start

1. Provision PostgreSQL.
2. Create the Keyrail database and application role.
3. Run migrations with `npm run migrate` from `backend` using production environment variables.
4. Start Redis.
5. Start the API with `npm start` from `backend`.
6. Serve the frontend with the production build.
7. Verify `GET /healthz`.
8. Complete initial setup through the application.

## Production invariants

- If PostgreSQL is unavailable, the API must fail rather than switching to pg-mem.
- JSON disk state is development-only.
- A default cookie secret is invalid in production.
- Production requires AWS KMS.
- Secrets are never returned by credential list/read endpoints.
- Browser launch sessions run in isolated headed Chromium contexts.

## Local development

Local development may use the explicit pg-mem fallback when PostgreSQL is unavailable. The fallback is persisted to `backend/data/db_state.json` only for developer convenience.

For realistic live-data testing, use PostgreSQL and Redis locally instead of the pg-mem fallback.

Example:

```env
NODE_ENV=development
DATABASE_URL=postgres://keyrail:keyrail@localhost:5432/keyrail
REDIS_URL=redis://localhost:6379
COOKIE_SECRET=<random local secret>
ISSUER=http://localhost:8080
KMS_PROVIDER=local
```

Then:

```bash
cd backend
npm install
npm run build
npm run migrate
npm start
```

Serve the frontend with the Vite dev server or production build and point `VITE_API_URL` at the API base path.

## No-loop startup contract

Only one API process should own the configured port. The API has one janitor interval guarded against overlapping executions. Do not start a second backend through both Vercel and a local listener.

On shutdown, the server drains Fastify, closes Redis, closes PostgreSQL, and exits once.

## Live browser testing

Browser automation requires the API process and Playwright-capable Chromium on the same trusted host/worker. Do not place the browser session manager inside a stateless serverless function.

Use a controlled test application on `http://localhost:9000` before any third-party site. Only after that test passes should live external targets be exercised.
