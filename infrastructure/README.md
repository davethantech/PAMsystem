# Infrastructure

## Local development

```bash
export COOKIE_SECRET=$(openssl rand -hex 32)
docker compose up --build
```

Topology mirrors production: `edge` (nginx, only public ports) → `api` (private)
→ `vault` network (postgres/redis, `internal: true` — no public route) →
`internal` network (customer-LAN simulation where the connector lives).
Migrations run automatically from `../database/migrations`.

## Cloud deployment (AWS / Azure / GCP)

`k8s.yaml` is cloud-agnostic. Per-cloud additions:

| Concern        | AWS                              | Azure                      | GCP                     |
| -------------- | -------------------------------- | -------------------------- | ----------------------- |
| KMS master key | KMS CMK (HSM-backed, per tenant) | Key Vault Managed HSM      | Cloud KMS (HSM level)   |
| Database       | RDS/Aurora PG 16 multi-AZ + PITR | Flexible Server + Geo HA   | Cloud SQL HA + PITR     |
| Secrets        | Secrets Manager + ESO            | Key Vault + ESO            | Secret Manager + ESO    |
| Ingress        | ALB + cert-manager               | App Gateway + cert-manager | GKE Ingress + managed certs |
| Monitoring     | CloudWatch + Grafana             | Monitor + Grafana          | Cloud Monitoring + Grafana |

### Deploy

```bash
kubectl apply -f k8s.yaml
kubectl -n keyrail apply -f <(eso api-secret)   # from your secret manager
kubectl -n keyrail rollout status deploy/api
```

### Operational guarantees

- **HA**: 3× API, 2× PAM, 2× gateway; synchronous PG replica; PDB minAvailable=2
- **Backups**: PITR (5-min RPO) + nightly encrypted snapshots, cross-region copy
- **Rolling deploys**: maxUnavailable=1 with readiness gates; zero-downtime
- **Auto-scaling**: HPA on CPU 65%, 3→12 replicas
- **Isolation**: NetworkPolicy default-deny; postgres/redis unreachable from edge

See `docs/DEPLOYMENT.md` for the DR runbook and key ceremony.
