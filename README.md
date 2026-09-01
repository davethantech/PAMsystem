# Keyrail — Cloud-Hosted Privileged Access Management

A multi-tenant SaaS PAM platform where users **use** privileged credentials
without ever being able to **view** them. The plaintext path exists only
inside the broker enclave; every API surface is capability-based.

```
user knows:        "I can open eBay Admin."
user cannot know:  the eBay Admin password — no code path returns it.
```

## Repository

```
src/                 React + TS console
aPI/                 Real HTTP API client
backend/             TypeScript/Fastify control plane (auth, vault, grants, audit)
database/            PostgreSQL migrations — 24 tables, FORCE RLS per tenant
browser-extension/   Manifest V3 connector — domain-allowlisted isolated-world injection
connector/           Go on-prem bridge — outbound-only mTLS, command allowlist
infrastructure/      docker-compose (dev) + k8s.yaml (prod, cloud-agnostic)
docs/                ARCHITECTURE · THREAT-MODEL · API · DEPLOYMENT/DR
tests/               Vitest security suite (engine); backend/tests (API)
```

## Run the console

```bash
npm install
npm run typecheck
npm test
npm run dev
```

The Vite configuration serves the console on port `3000` and proxies `/api`
to the Fastify control plane on port `8080` during local development.

## Run the full stack (local)

```bash
bash infrastructure/dev/gen-certs.sh
export COOKIE_SECRET=$(openssl rand -hex 32)
cd infrastructure && docker compose up --build
```

Then seed the development tenant if required:

```bash
docker compose exec backend npm run seed
```

The controlled browser target is available on port `9000` for acceptance testing.
It provides a real login form and authenticated dashboard so the Playwright
launch path can be tested without depending on a third-party site.

## Test the security model

```bash
npm test
npx vitest run tests/
cd backend && npm install && npm test
```

CI (`.github/workflows/ci.yml`) runs the console security suite, console build,
backend compile/migration/seed/API suite against PostgreSQL and Redis service
containers, connector vet/build, and browser-extension typecheck/bundle.

## Production runtime

The Fastify API and Playwright browser worker require a persistent trusted host.
Do not deploy the browser-session control plane as a Vercel serverless function.
Production uses PostgreSQL, Redis, AWS KMS, TLS termination, and a separately
served Vite frontend. See `DEPLOYMENT.md` and `docs/DEPLOYMENT-DR.md`.

## The one rule

`credential.use` ≠ `credential.reveal`. Launch rights drive a single-use,
30-second grant consumed by an isolated-world injector or session proxy.
Reveal exists only as dual-custody, watermarked, 30-second break-glass for
Security Admins — and every attempt, allowed or denied, is hash-chained into
the tamper-evident audit log.
