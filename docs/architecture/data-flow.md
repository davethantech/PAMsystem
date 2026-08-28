# Keyrail PAM Cloud - Data Flow Documentation

## Overview

This document describes the data flow patterns in Keyrail PAM Cloud, focusing on how sensitive data (credentials) are handled throughout the system while maintaining the core security invariant: **users can use credentials but cannot view them**.

---

## Core Data Flow Patterns

### 1. Credential Storage Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CREDENTIAL CREATION                                  │
└─────────────────────────────────────────────────────────────────────┘

User Input
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend (Browser)                                                │
│  - Collects credential metadata (name, target, username)              │
│  - Collects plaintext secret via secure input                        │
│  - Sends to backend via HTTPS POST /credentials                      │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Backend (API Layer)                                              │
│  - Validates request (authentication, authorization, input)        │
│  - Extracts tenant_id from authenticated session                    │
│  - Passes to Vault Service                                        │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Vault Service                                                    │
│  - Retrieves tenant DEK (Data Encryption Key) from KMS              │
│  - Generates random nonce for AES-GCM                              │
│  - Encrypts username with AES-256-GCM                              │
│  - Encrypts secret with AES-256-GCM                                 │
│  - Stores ciphertext, nonce, auth tag in database                    │
│  - NEVER stores plaintext in database                              │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Database (PostgreSQL)                                            │
│  credentials table:                                              │
│    - id: uuid                                                  │
│    - tenant_id: uuid                                           │
│    - name: text                                                │
│    - target: text                                               │
│    - kind: text                                                 │
│    - username_encrypted: bytea                                  │
│    - username_nonce: bytea                                      │
│    - secret_ciphertext: bytea                                   │
│    - secret_nonce: bytea                                        │
│    - secret_tag: bytea                                          │
│    - key_version: int                                           │
│    - secret_length: int (for policy only, NOT the secret)        │
└─────────────────────────────────────────────────────────────────────┘
```

**Security Notes:**
- Plaintext secret exists only in backend memory during encryption
- Plaintext is immediately zeroized after encryption
- Database contains only ciphertext, nonce, and auth tag
- Key version tracks which DEK was used for encryption

---

### 2. Credential Retrieval and Launch Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CREDENTIAL LAUNCH                                   │
└─────────────────────────────────────────────────────────────────────┘

User Action
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend (Browser)                                                │
│  - User selects application to launch                              │
│  - Sends POST /credentials/:id/launch                              │
│  - Receives grant token (opaque, single-use)                        │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Backend (Launch Service)                                         │
│  - Validates authentication (session cookie)                      │
│  - Extracts tenant_id from session                                  │
│  - Validates RBAC (credential.use, application.launch)             │
│  - Validates collection membership                                 │
│  - Validates JIT access if required                               │
│  - Validates device/geo/concurrency policy                         │
│  - Creates launch grant with:                                     │
│    * tenant_id binding                                            │
│    * user_id binding                                              │
│    * credential_id binding                                         │
│    * application_id binding                                       │
│    * domain binding                                                │
│    * 30-second TTL                                                 │
│    * Single-use flag                                              │
│  - Stores grant token_hash (sha256 of token) in database            │
│  - Returns grant token to frontend                                │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Browser Extension (Background Worker)                             │
│  - Receives grant token from frontend                              │
│  - Stores in memory only (NEVER in storage)                         │
│  - User navigates to target application                             │
│  - User clicks "Launch" in extension popup                         │
│  - Validates active tab domain against grant domain                 │
│  - Sends POST /launch/consume with token                            │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Backend (Broker Service)                                         │
│  - Validates grant token_hash (SELECT ... FOR UPDATE)               │
│  - Checks grant is not used                                        │
│  - Checks grant is not expired                                     │
│  - Checks grant is bound to current user                            │
│  - Marks grant as used                                             │
│  - Retrieves credential ciphertext from database                   │
│  - Retrieves tenant DEK from KMS                                   │
│  - Decrypts credential in withUnsealedSecret() callback             │
│    * Plaintext exists only in callback scope                       │
│    * Memory is zeroized on callback exit                           │
│  - Performs authentication operation (form submission, etc.)        │
│  - Creates session record                                         │
│  - NEVER returns plaintext to caller                              │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Isolated World Injector (Content Script)                           │
│  - Receives operation from background worker                        │
│  - Operation contains:                                            │
│    * username (plaintext, in isolated scope)                        │
│    * secret (plaintext, in isolated scope)                         │
│    * selectors (CSS selectors for form fields)                     │
│    * domain (for validation)                                       │
│  - Validates current page domain matches grant domain              │
│  - Uses native DOM setters to inject credentials                    │
│    * Page JavaScript cannot observe the values                      │
│  - Zeroizes secret from memory immediately after injection        │
│  - Submits form                                                    │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Target Application                                               │
│  - Receives form submission                                        │
│  - Authenticates user                                              │
│  - User is now logged in                                           │
└─────────────────────────────────────────────────────────────────────┘
```

**Security Notes:**
- Grant token is single-use and time-bound (30 seconds)
- Grant is cryptographically bound to tenant, user, credential, application, domain
- Plaintext credential exists only in broker callback scope
- Plaintext is zeroized immediately after use
- Page JavaScript cannot access isolated world memory
- Extension never stores tokens or secrets in chrome.storage

---

### 3. Password Rotation Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PASSWORD ROTATION                                  │
└─────────────────────────────────────────────────────────────────────┘

Scheduled/Manual Trigger
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Rotation Service                                                │
│  - Retrieves credential from database                              │
│  - Retrieves current DEK from KMS                                  │
│  - Decrypts current password in withUnsealedSecret()                │
│  - Generates new random password                                   │
│  - Calls target application's change password API                   │
│  - VERIFIES new password works before persisting                    │
│    * If verification fails, old password is retained                │
│    * Rollback is automatic                                          │
│  - Encrypts new password with current DEK                          │
│  - Updates database with new ciphertext                             │
│  - Creates credential version record                               │
│  - Updates rotation job status                                    │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Audit Service                                                    │
│  - Records PASSWORD_ROTATED event                                  │
│  - Includes verification result                                    │
│  - Hash-chained with previous events                              │
└─────────────────────────────────────────────────────────────────────┘
```

**Security Notes:**
- Old password is retained until new one is verified
- Verification is mandatory (no blind rotation)
- All operations are audited
- Plaintext passwords exist only during rotation operation

---

### 4. Break-Glass Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    BREAK-GLASS ACCESS                                  │
└─────────────────────────────────────────────────────────────────────┘

Emergency Request
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend (Admin)                                                  │
│  - Security Admin requests break-glass access                      │
│  - Provides:                                                      │
│    * Credential to access                                         │
│    * Detailed reason (min 12 chars)                                │
│    * Co-sign ticket (INC-1234 format)                              │
│    * Second approver user_id                                      │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Backend (Vault Service)                                          │
│  - Validates user has credential.reveal permission                   │
│  - Validates reason length                                         │
│  - Validates co-sign ticket format                                 │
│  - Validates second approver is different user                      │
│  - Retrieves credential from database                               │
│  - Decrypts credential in withUnsealedSecret()                      │
│  - Creates watermarked reveal window:                               │
│    * Plaintext credential                                          │
│    * Watermark with admin name, user_id, timestamp                 │
│    * 30-second TTL                                                 │
│  - Stores in Redis with TTL                                         │
│  - Returns reveal token to frontend                                 │
│  - NEVER returns plaintext directly                                │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend (Admin)                                                  │
│  - Displays watermarked credential for 30 seconds                   │
│  - Watermark includes:                                            │
│    * Admin name                                                   │
│    * Admin user_id                                                │
│    * Timestamp                                                    │
│  - Credential is automatically hidden after 30 seconds               │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Audit Service                                                    │
│  - Records BREAK_GLASS event                                       │
│  - Records CREDENTIAL_REVEAL event                                 │
│  - Both events include watermark information                        │
│  - SIEM is paged immediately                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**Security Notes:**
- Requires credential.reveal permission (Security Admin only)
- Requires detailed justification
- Requires dual-custody (co-sign ticket)
- Watermarked to prevent unauthorized sharing
- Time-bound (30 seconds)
- Fully audited

---

## Audit Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AUDIT DATA FLOW                                   │
└─────────────────────────────────────────────────────────────────────┘

Sensitive Operation
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Service (Any)                                                    │
│  - Calls audit() function with event details                       │
│  - Event includes:                                                │
│    * tenant_id                                                   │
│    * actor_id (user_id)                                          │
│    * actor_name                                                  │
│    * event_type                                                  │
│    * resource_id                                                 │
│    * resource_name                                               │
│    * result (SUCCESS/DENIED/FAILURE)                              │
│    * meta (pre-redacted)                                         │
│    * source_ip                                                   │
│    * device_fp                                                   │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Audit Service                                                   │
│  - Acquires advisory lock for tenant                              │
│  - Retrieves previous event hash from database                    │
│  - Redacts meta field (removes any secret patterns)                 │
│  - Computes current event hash:                                  │
│    hash = sha256(prev_hash | type | actor_id | timestamp | meta)    │
│  - Stores event in audit_events table                              │
│  - Event includes:                                                │
│    * All input fields                                             │
│    * prev_hash (from previous event)                              │
│    * hash (computed)                                              │
│    * at (timestamp)                                               │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Database (PostgreSQL)                                            │
│  audit_events table:                                              │
│    - id: bigserial                                               │
│    - tenant_id: uuid                                             │
│    - actor_id: uuid                                              │
│    - actor_name: text                                            │
│    - event_type: text                                            │
│    - resource_id: text                                            │
│    - resource_name: text                                          │
│    - result: text (SUCCESS/DENIED/FAILURE)                         │
│    - meta: text (redacted)                                        │
│    - source_ip: inet                                              │
│    - device_fp: text                                             │
│    - prev_hash: text                                             │
│    - hash: text                                                  │
│    - at: timestamptz                                             │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Verification                                                    │
│  - Periodic chain verification                                   │
│  - On-demand verification via GET /audit-events/verify             │
│  - Checks each event's hash against computed value                │
│  - Checks each event's prev_hash against previous event's hash     │
│  - Any mismatch indicates tampering                               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Network Data Flow

### Request Flow

```
Client Request
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Edge (Nginx)                                                    │
│  - Terminates TLS 1.3                                             │
│  - Enforces security headers (CSP, HSTS, etc.)                     │
│  - Rate limiting (if configured)                                 │
│  - Routes to appropriate backend service                          │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Backend (Fastify/NestJS)                                        │
│  - Validates request headers                                     │
│  - Parses and validates request body                             │
│  - Extracts session from HttpOnly cookies                         │
│  - Validates session signature                                   │
│  - Extracts tenant_id from session                                │
│  - Sets app.tenant_id for database connection                     │
│  - Routes to appropriate handler                                 │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Service Layer                                                  │
│  - Receives request with authenticated context                    │
│  - Performs business logic                                       │
│  - Uses withTenant() for all database operations                   │
│  - Never trusts client-supplied tenant_id                         │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Data Layer (PostgreSQL/Redis)                                   │
│  - PostgreSQL: All queries run with RLS enforced                   │
│  - Redis: Session storage, caching, queues                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Response Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  Data Layer (PostgreSQL/Redis)                                   │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Service Layer                                                  │
│  - Receives data from database                                   │
│  - Transforms to DTOs (never returns raw database entities)         │
│  - Redacts any sensitive information                              │
│  - Returns sanitized response                                    │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Backend (Fastify/NestJS)                                        │
│  - Receives response from service                                 │
│  - Applies response transformations                               │
│  - Sets security headers                                         │
│  - Returns response to client                                     │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Edge (Nginx)                                                    │
│  - Adds security headers if not present                            │
│  - Compresses response if applicable                               │
│  - Returns to client                                              │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
Client
```

---

## Connector Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CONNECTOR DATA FLOW                                 │
└─────────────────────────────────────────────────────────────────────┘

Customer Network
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Connector (Customer Side)                                        │
│  - Outbound-only connection                                       │
│  - mTLS authentication with PAM Cloud                              │
│  - Device identity certificate                                    │
│  - Tenant binding                                                 │
│  - Heartbeat to gateway                                           │
│  - Command allowlist enforcement                                   │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼ (Outbound TLS)
┌─────────────────────────────────────────────────────────────────────┐
│  Connector Gateway (PAM Cloud)                                    │
│  - Terminates mTLS connection                                      │
│  - Validates device certificate                                    │
│  - Validates tenant binding                                        │
│  - Routes commands to appropriate service                          │
│  - NEVER sends vault master keys to connector                      │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Broker Service                                                   │
│  - Receives command from connector                                 │
│  - Validates command is in allowlist                               │
│  - Validates target is authorized                                  │
│  - Retrieves and decrypts credential in trusted boundary             │
│  - Executes command (SSH, RDP, database query, etc.)                │
│  - Zeroizes plaintext after use                                   │
│  - Returns result (never plaintext credential)                      │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Customer Resource                                               │
│  - SSH server                                                    │
│  - RDP host                                                      │
│  - Database                                                      │
│  - Internal application                                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Security Invariant Enforcement

### Invariant 1: No Plaintext in API Responses

**Enforced by:**
- All API handlers use DTOs (Data Transfer Objects)
- DTOs explicitly define which fields are returned
- Database entities are never serialized directly
- Response validation removes any sensitive fields
- Automated tests scan API responses for secret patterns

**Data Flow:**
```
Database Entity → Service → DTO → API Response
                ↓
          Sensitive fields filtered out
```

### Invariant 2: Use ≠ Reveal

**Enforced by:**
- Separate permissions: `credential.use` and `credential.reveal`
- RBAC matrix explicitly separates these permissions
- Launch flow uses `credential.use` only
- Reveal requires `credential.reveal` + additional controls
- Automated tests verify separation

**Data Flow:**
```
credential.use → Launch Grant → Broker → Injection
                ↓
          No path to plaintext

credential.reveal → Break-Glass → Watermarked Display (30s)
```

### Invariant 3: Tenant Isolation

**Enforced by:**
- Tenant ID derived from authenticated session only
- Client-supplied tenant IDs ignored
- Database RLS (Row Level Security) on all tenant tables
- Application-level tenant context (withTenant)
- All queries include tenant context
- Automated tests verify cross-tenant access prevention

**Data Flow:**
```
Request → Session → Tenant Context → All Database Operations
                    ↓
              Never from client
```

### Invariant 4: Launch Grant Single-Use

**Enforced by:**
- Grant tokens are cryptographically random (24 bytes)
- Grant tokens are hashed (sha256) and stored in database
- SELECT ... FOR UPDATE on grant consumption
- Grant marked as used immediately
- Replay attempts are denied and audited
- Automated tests verify replay prevention

**Data Flow:**
```
Grant Issued → Token Hash Stored → Token Given to Client
                              ↓
                    Consume → SELECT FOR UPDATE → Check used_at → Mark used
```

### Invariant 5: No Secret in Logs

**Enforced by:**
- Global secret redaction function (redact())
- Applied to all log messages
- Applied to audit event meta fields
- Pattern-based redaction (regex)
- Automated tests verify no secrets in logs

**Data Flow:**
```
Log Message → Redaction → Safe to Log
            ↓
      Secrets removed
```

---

## Summary

The Keyrail PAM Cloud data flow is designed with the following principles:

1. **Minimize Plaintext Exposure**: Plaintext secrets exist only in memory, for the shortest possible time, in the most trusted boundaries.

2. **Defense in Depth**: Multiple layers of controls (encryption, RLS, RBAC, audit) protect sensitive data.

3. **Zero Trust**: Never trust client-supplied data; always verify through authenticated context.

4. **Complete Audit Trail**: All sensitive operations are recorded in a tamper-evident log.

5. **Fail Secure**: The system is designed to fail in a secure state by default.

All data flows are designed to maintain these principles while providing the functionality needed for privileged access management.
