# Keyrail Threat Model

Scope: an adversary who is (a) an external attacker, or (b) an **authorized
user deliberately attempting to exfiltrate a privileged secret**.

| # | Threat | Impact | Attack path | Preventive control | Detection | Response |
|---|--------|--------|-------------|--------------------|-----------|----------|
| 1 | Compromised user account | Secret use via portal | Stolen password → login | Argon2id + mandatory MFA + device binding; 5-fail lockout | Impossible-travel, MFA_FAILURE events | Revoke session family; force re-enroll |
| 2 | Malicious employee | Secret hoarding | Screenshot/copy shared passwords | No plaintext surface; use-only launch; masked UI | Launch cadence analytics; CREDENTIAL_REVEAL DENIED stream | Collection review; role downgrade |
| 3 | Compromised browser | Read secrets from tab | Malware reading DOM/storage | Isolated-world injection; HttpOnly cookies; no DOM plaintext; CSP | CSP violation reports; extension integrity | Kill sessions; rotate affected creds |
| 4 | Malicious extension | Phish injection | Rogue MV3 requests inject | Strict per-grant domain allowlist in background worker; user-confirmed launch | Grant/domain mismatch denials | Revoke connector enrollment |
| 5 | Compromised PAM server | Grant abuse | RCE on control plane | Vault in separate subnet; grants 30s single-use; HSM keys | Enclave attestation drift; GRANT anomalies | Rotate tenant DEK; freeze launches |
| 6 | Database compromise | Mass secret theft | Dump `credentials` | AES-256-GCM ciphertext only; DEKs KMS-wrapped | KMS Decrypt spike; canary rows | Rotate all DEKs via KMS; restore from PITR |
| 7 | Cloud account compromise | Infra takeover | Console access | SCPs, private subnets, MFA on root, break-glass alarms | CloudTrail/Activity-log alerts | DR failover; key rotation ceremony |
| 8 | API abuse | Enumeration/IDOR | Scripted probing | Tenant-from-token; RLS; rate limit 300/min; zod validation | 429 storms; ACCESS_DENIED clusters | IP quarantine; WAF rule |
| 9 | Credential replay | Session hijack | Re-use captured grant | Single-use + 30s TTL + user binding (FOR UPDATE) | `GRANT_REPLAY_BLOCKED` events | Auto — secret never decrypted |
| 10 | Session hijacking | Account takeover | Cookie theft/fixation | Secure+SameSite=Strict; refresh rotation w/ reuse detection; IP+device pin | Refresh reuse ⇒ family revocation | Force re-auth; notify user |
| 11 | Tenant escape | Cross-tenant read | IDOR/param tampering | Tenant derived from token; FORCE RLS; ignored `?tenant=` | Cross-tenant DENIED probes | Quarantine source; audit review |
| 12 | Insider administrator | Rogue reveal | Admin dumps vault | use/reveal separation; dual-custody break-glass; all admin acts chained | BREAK_GLASS events page SIEM instantly | Second-admin veto; key ceremony |
| 13 | Connector compromise | LAN pivot | Tunnel abuse | mTLS device identity; command+target allowlists; tenant binding; no keys on device | Heartbeat loss; COMMAND_DENIED stream | Instant revocation endpoint |
| 14 | Supply-chain attack | Backdoored build | Poisoned dependency | Pinned versions; SBOM; secret scanning; signed images | Dependency drift alerts | Rebuild from pinned manifest |
| 15 | Backup compromise | Historic secrets | Steal backups | KMS-wrapped backup keys, separate custody; ciphertext-only dumps | Key-access auditing | Re-key tenants; verify chain |

## Verification

- `tests/engine.security.test.ts` — replays threats 2, 3, 6, 9, 11, 12
  against the live engine (denials + audit trail + chain integrity).
- `backend/tests/api.security.test.ts` — replays 8, 9, 10, 11 against the
  API via `app.inject()` (no network required).
- Quarterly red-team exercise script: `docs/DEPLOYMENT.md § Security gates`.
