# Deployment & Disaster Recovery

## Go-live checklist (production gate)

1. **Provision cloud tenancy**: VPC with edge/api/vault/data subnets;
   KMS CMK (HSM-backed) per environment; RDS multi-AZ + PITR; Redis HA.
2. **Secrets**: issue via secret manager → External Secrets Operator.
   `COOKIE_SECRET` (64B), DB creds, OIDC client secrets. Never in manifests.
3. **Deploy**: `kubectl apply -f infrastructure/k8s.yaml`; verify
   `/healthz` on api/pam/gateway; run `npm run migrate` (or CI job).
4. **Key ceremony**: generate tenant DEKs via `/keys/rotate`; escrow KMS key
   material per policy; document custodians.
5. **Verify isolation**: from a pod in `edge`, confirm `postgres:5432` and
   `redis:6379` are unreachable (NetworkPolicy default-deny works).
6. **Security tests**: `npx vitest run` in repo root (engine suite) and
   `npm test` in `/backend` (API suite). Both must be green.
7. **Red-team script** (quarterly): replay every vector in
   `docs/THREAT-MODEL.md § Verification`; expect 100% denial + audit trail.

## Backups & DR

| Asset | Mechanism | RPO | RTO |
|---|---|---|---|
| PostgreSQL | PITR (WAL archiving) + nightly encrypted snapshots, cross-region | 5 min | 30 min |
| Secrets (ciphertext) | In DB backups; useless without KMS | — | — |
| KMS keys | HSM-replicated; key material escrow ceremony | 0 | 4 h (ceremony) |
| Redis | Rebuilt from sessions re-auth; AOF on | 15 min | 5 min |
| Audit chain | Streamed to SIEM + nightly export to immutable storage | 1 min | 15 min |

### Failover runbook

1. Detect (healthchecks + synthetic launch probe every 60s).
2. Promote PG replica; point api at standby; DNS TTL 60s.
3. Verify audit chain (`GET /audit-events/verify`) — chain must be intact
   before accepting traffic (tamper check post-incident).
4. Page Security Admin; snapshot KMS access logs for the incident window.

## Connector rollout (customer side)

```bash
# on any host inside the customer network — no inbound ports needed
curl -fsSL https://get.keyrail.cloud/conn | sh
keyrail-connector enroll --tenant <id>   # mTLS device cert issued by cloud
```

Revocation is immediate via `POST /connectors/:id/revoke`.

## Environment configuration (examples)

```
COOKIE_SECRET=<openssl rand -hex 32>
KMS_PROVIDER=aws            # or local for dev
KMS_KEY_ID=arn:aws:kms:...:key/...
DATABASE_URL=postgres://... (private subnet only)
REDIS_URL=redis://...
ISSUER=https://pam.example.com
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
ENTRA_TENANT_ID / ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET
```
