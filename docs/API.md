# Keyrail REST API

Base: `https://pam.<tenant-domain>/api` · Auth: HttpOnly session cookies
(`kr_access` 5-min JWT + rotating `kr_refresh`). All responses are JSON.
Every mutation writes a hash-chained audit event.

## What does NOT exist

> `GET /credentials/:id/secret` — **no such route**. Requests to it return
> `404 NO_SUCH_ROUTE` and write a `RED_TEAM_PROBE` (DENIED) audit event.
> `POST /credentials/:id/reveal` — exists only to deny and audit. Plaintext
> leaves the vault exclusively via (a) the broker enclave performing an auth
> operation, or (b) dual-custody break-glass.

## Authentication

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{tenant, email, password}` → MFA challenge. 5 fails ⇒ 15-min lock |
| POST | `/auth/mfa` | `{mfaToken, code}` TOTP (RFC 6238, ±30s drift) |
| GET  | `/auth/google/callback`, `/auth/entra/callback` | OIDC; tenant derived from assertion |
| POST | `/auth/refresh` | rotates refresh token; reuse ⇒ family revoked |
| POST | `/auth/logout` | revokes session |
| GET  | `/me` | principal + effective permissions |

## Vault (metadata only)

| Method | Path | Permission |
|---|---|---|
| GET  | `/credentials` | `credential.view_metadata` — returns metadata; ciphertext columns never selected |
| POST | `/credentials` | `credential.create` — sealed under active tenant DEK |
| PATCH| `/credentials/:id` | `credential.update` |
| POST | `/credentials/:id/launch` | `credential.use` → `{grantId, token(30s), domain}` |
| POST | `/launch/consume` | connector/gateway only; single-use token → `{sessionId}` |
| POST | `/credentials/:id/request-access` | JIT request `{reason≥8, ticket, hours}` |
| POST | `/access-requests/:id/approve|deny` | `policy.update` |
| POST | `/credentials/:id/rotate` | `credential.update`; verify-before-store, rollback on failure |
| POST | `/keys/rotate` | `policy.update`; tenant DEK ceremony |
| POST | `/break-glass` | `credential.reveal` + reason≥12 + co-sign ticket + second approver |

## Operations

| Method | Path | Permission |
|---|---|---|
| GET  | `/sessions` | own sessions, or all with `session.terminate` |
| POST | `/sessions/:id/terminate` | owner or `session.terminate` |
| GET  | `/audit-events?type=&limit≤500` | `audit.view` — metadata + chain hashes |
| GET  | `/audit-events/verify` | `audit.view` — full chain integrity check |
| POST | `/connectors/register` / GET `/connectors` / POST `/connectors/:id/revoke` | `policy.create`/`policy.update` |

## Error contract

```json
{ "error": "GRANT_REPLAYED", "message": "Replay blocked", "auditId": "4821" }
```

Codes: `401 UNAUTHENTICATED|TOKEN_INVALID|REFRESH_INVALID` ·
`403 NO_USE_PERM|NOT_VISIBLE|JIT_REQUIRED|REVEAL_DENIED|IDOR_BLOCKED` ·
`404 NO_SUCH_ROUTE` · `409 GRANT_REPLAYED` · `410 GRANT_EXPIRED` ·
`429 SESSION_LIMIT` — every 4xx/5xx on a sensitive path is audited.
