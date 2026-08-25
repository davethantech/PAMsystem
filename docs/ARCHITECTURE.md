# Keyrail — Cloud PAM Architecture

## Principles

1. **Use without view.** A user may *use* a privileged credential; they may
   never *see* it. This is enforced by the absence of any code path that
   returns plaintext — not by policy.
2. **Tenant derived, never trusted.** Tenant identity comes exclusively from
   the verified session token. Client-supplied tenant ids are ignored.
3. **Capabilities, not data.** Credential access is a single-use, 30-second,
   cryptographically bound grant — never a read of a secret object.
4. **Plaintext dwell time → minimum.** Secrets are decrypted only inside the
   broker enclave (`withUnsealedSecret`) and zeroized on scope exit.

## Service map

```
Internet ─TLS 1.3─▶ Edge (LB/WAF/CSP/HSTS)
                     ├─ Web frontend (static, stateless, zero secrets)
                     └─ API gateway ─▶ PAM service (policy, grants, JIT)
                                    ├─▶ Vault service (private subnet; only
                                    │    decryptor; envelope encryption)
                                    ├─▶ Audit service (hash-chained, redacted)
                                    └─▶ Session gateway (SSH/RDP/web proxies)
Vault service ─▶ Cloud KMS/HSM (master keys never leave hardware)
Data tier: PostgreSQL (RLS, PITR, replicated) + Redis — private subnet only
Connector: outbound mTLS from customer LAN; command allowlist; no vault keys
```

## The launch flow (enforced in `backend/src/vault.ts`)

```
POST /credentials/:id/launch            ← user (cookie session)
  ├ identity + fresh MFA check
  ├ RBAC: credential.use ∧ application.launch        (use ≠ reveal)
  ├ collection membership
  ├ JIT window if access=APPROVAL_REQUIRED
  ├ device/geo/concurrency policy
  └ mint grant: sha256(opaque token) stored, 30s TTL,
     bound to tenant+user+credential+app+domain

Connector/gateway: POST /launch/consume  ← single-use token
  ├ SELECT … FOR UPDATE on token_hash
  ├ used?    → GRANT_REPLAY_BLOCKED + DENIED audit   (secret never touched)
  ├ expired? → DENIED
  ├ user mismatch? → DENIED
  └ decrypt in enclave → perform auth operation → zeroize
     → INSERT session (recording on) → CREDENTIAL_USED audit
```

## Encryption

- Field level: **AES-256-GCM** (ct + nonce + tag) per secret.
- Envelope: per-tenant **DEK**, wrapped by cloud **KMS/HSM**; DEK versions
  tracked in `encryption_keys`; `rotateTenantKeys()` re-seals every credential
  under a fresh DEK and retires the old one.
- At rest: encrypted volumes + encrypted PG; in transit: TLS 1.3 everywhere.

## Tenant isolation

Three independent layers:
1. Application: every query runs inside `withTenant()` (pins `app.tenant_id`).
2. Database: **FORCE ROW LEVEL SECURITY** on all 17 tenant tables.
3. Network: vault/data subnets unreachable from the public edge.

## What the client never has

The web frontend and extension hold: metadata, grant tokens (memory-only),
opaque handles. They do not and cannot hold: secrets, DEKs, master keys,
or audit material. `credential.use` and `credential.reveal` are disjoint
permissions; reveal exists only as dual-custody break-glass
(`backend/src/vault.ts → breakGlass`).
