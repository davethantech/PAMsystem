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
src/                 React + TS console (this demo runs the real engine in-browser)
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
npm install && npm run dev        # interactive product demo (simulated cloud)
npm run build                     # static production bundle
```

## Run the full stack (local)

```bash
bash infrastructure/dev/gen-certs.sh                       # self-signed PKI (dev only)
export COOKIE_SECRET=$(openssl rand -hex 32)
cd infrastructure && docker compose up --build             # migrations run at boot
docker compose exec backend npm run seed                   # demo tenant + sealed vault
node infrastructure/smoke.mjs                              # 14-step end-to-end gate
```

## Test the security model

```bash
npx vitest run tests/             # engine: replay/IDOR/reveal/tenant/chain tests
cd backend && npm i && npm test   # API suite (needs Postgres+Redis, e.g. via compose)
```

CI (`.github/workflows/ci.yml`) runs all of the above plus backend compile,
migrate + seed against service containers, `go vet` + connector build, and the
extension typecheck/bundle.

## The one rule

`credential.use` ≠ `credential.reveal`. Launch rights drive a single-use,
30-second grant consumed by an isolated-world injector or session proxy.
Reveal exists only as dual-custody, watermarked, 30-second break-glass for
Security Admins — and every attempt, allowed or denied, is hash-chained into
the tamper-evident audit log.
