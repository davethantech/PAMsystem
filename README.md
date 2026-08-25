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
cd infrastructure && export COOKIE_SECRET=$(openssl rand -hex 32) && docker compose up --build
```

## Test the security model

```bash
npx vitest run                    # engine: replay/IDOR/reveal/tenant/chain tests
cd backend && npm i && npm test   # API: inject()-based security suite
```

## The one rule

`credential.use` ≠ `credential.reveal`. Launch rights drive a single-use,
30-second grant consumed by an isolated-world injector or session proxy.
Reveal exists only as dual-custody, watermarked, 30-second break-glass for
Security Admins — and every attempt, allowed or denied, is hash-chained into
the tamper-evident audit log.
