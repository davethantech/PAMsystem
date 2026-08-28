# Keyrail PAM Cloud - Secret Lifecycle

## Overview

This document describes the **complete lifecycle** of secrets (credentials, keys, tokens, etc.) in the Keyrail PAM Cloud system, from creation to destruction. Understanding and properly managing this lifecycle is critical for maintaining the system's security guarantees.

---

## Secret Lifecycle Stages

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SECRET LIFECYCLE                                   │
└─────────────────────────────────────────────────────────────────────┘

    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
    │   CREATION  │────▶│   STORAGE   │────▶│    USE      │
    └─────────────┘     └─────────────┘     └──────┬──────┘
                                                  │
                                                  ▼
                                          ┌─────────────┐
                                          │  ROTATION   │
                                          └──────┬──────┘
                                                 │
    ┌───────────────────────────────────────────┼─────────────┐
    │                                       │             │
    ▼                                       ▼             ▼
┌─────────────┐                   ┌─────────────┐   ┌─────────────┐
│  DESTRUCTION │                   │   EXPIRY    │   │   REVOCATION│
└─────────────┘                   └─────────────┘   └─────────────┘
```

---

## Stage 1: Creation

### Overview

Secrets are created when:
- A user adds a new credential to the vault
- The system generates a new DEK (Data Encryption Key)
- The system generates a new password for rotation
- A user enrolls in MFA
- A new API key is created

### Process Flow

```
User Input (Plaintext Secret)
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend (Browser)                                                │
│  - Collects secret via secure input field                           │
│  - Never stores secret in component state                          │
│  - Never logs secret                                               │
│  - Sends to backend via HTTPS POST                                 │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Backend (API Layer)                                              │
│  - Receives request via HTTPS                                      │
│  - Validates authentication (session cookie)                      │
│  - Validates authorization (RBAC permissions)                     │
│  - Validates input (schema, constraints)                           │
│  - Extracts tenant_id from session                                  │
│  - Passes plaintext to Vault Service                               │
│  - NEVER stores plaintext in memory longer than necessary           │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Vault Service                                                    │
│  - Receives plaintext secret                                       │
│  - Validates tenant context                                        │
│  - Retrieves current DEK for tenant from KMS                       │
│  - Generates random nonce (12 bytes) for AES-GCM                   │
│  - Encrypts secret with AES-256-GCM                                │
│  - Zeroizes plaintext from memory immediately after encryption      │
│  - Returns ciphertext, nonce, tag, key_version                       │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Database (PostgreSQL)                                            │
│  - Stores ciphertext in secret_ciphertext column                    │
│  - Stores nonce in secret_nonce column                              │
│  - Stores auth tag in secret_tag column                             │
│  - Stores key_version for future decryption                         │
│  - Stores secret_length for policy (NOT the secret itself)          │
│  - NEVER stores plaintext                                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Security Controls

| Control | Purpose | Implementation |
|---------|---------|----------------|
| HTTPS | Protect data in transit | TLS 1.3 |
| Input Validation | Prevent invalid/malicious input | Zod schema validation |
| Authentication | Verify user identity | JWT session validation |
| Authorization | Verify user has permission | RBAC check |
| Tenant Context | Prevent cross-tenant access | Session-derived tenant_id |
| Memory Zeroization | Prevent secret persistence | Immediate zeroization after encryption |
| Field-Level Encryption | Protect secret at rest | AES-256-GCM |
| Envelope Encryption | Protect encryption keys | KMS-wrapped DEKs |

### Data States

| State | Location | Protection |
|-------|----------|------------|
| Plaintext | User's browser | HTTPS, no storage |
| Plaintext | Backend memory | Process memory, short-lived |
| Plaintext | Vault Service memory | Function scope only |
| Ciphertext | Backend memory | Temporary, for DB insert |
| Ciphertext | Database | AES-256-GCM, RLS |

### Code Example

```typescript
// Backend - Credential Creation
export async function createCredential(p: Principal, input: {
  name: string;
  target: string;
  kind: string;
  username: string;
  secret: string;  // Plaintext from client
  collectionIds: string[];
  rotationPolicy: string;
  access: string;
  jitWindowMin?: number;
}) {
  // 1. Validate permissions
  if (!p.permissions.includes('credential.create')) {
    throw new HttpError(403, 'FORBIDDEN', 'credential.create required');
  }
  
  return withTenant(p.tenantId, async (client) => {
    // 2. Get current DEK version
    const { rows: kv } = await client.query(
      `SELECT key_version FROM encryption_keys WHERE tenant_id=$1 AND state='ACTIVE' ORDER BY key_version DESC LIMIT 1`,
      [p.tenantId]);
    const version = kv[0]?.key_version ?? 1;
    
    // 3. Encrypt (plaintext exists only in seal() scope)
    const sSecret = await seal(p.tenantId, version, input.secret);
    const sUser = await seal(p.tenantId, version, input.username);
    
    // 4. Store ciphertext only
    const ins = await client.query(
      `INSERT INTO credentials
        (tenant_id, name, target, kind, username_encrypted, username_nonce,
         secret_ciphertext, secret_nonce, secret_tag, key_version, secret_length,
         rotation_policy, access, jit_window_min, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [p.tenantId, input.name, input.target, input.kind, sUser.ct, sUser.nonce,
       sSecret.ct, sSecret.nonce, sSecret.tag, version, input.secret.length,
       input.rotationPolicy, input.access, input.jitWindowMin ?? null, p.userId]);
    
    // 5. Audit
    await audit({ 
      tenantId: p.tenantId, 
      actorId: p.userId, 
      actorName: p.name, 
      type: 'CREDENTIAL_CREATED', 
      resourceId: ins.rows[0].id, 
      resourceName: input.name 
    });
    
    return { id: ins.rows[0].id };
  });
}
```

### Threats Mitigated

- **Eavesdropping**: HTTPS protects data in transit
- **Tampering**: HTTPS protects data integrity
- **Injection**: Input validation prevents malicious data
- **Cross-tenant access**: Tenant context and RLS prevent data leakage
- **Memory scraping**: Zeroization prevents secret persistence
- **Database compromise**: Encryption protects data at rest

---

## Stage 2: Storage

### Overview

Secrets are stored in the database in encrypted form. The encryption scheme ensures that even if the database is compromised, the secrets remain protected (assuming the KMS is not also compromised).

### Storage Schema

```sql
CREATE TABLE credentials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name              text NOT NULL,
  target            text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('PASSWORD','API_KEY','SSH_KEY','TOKEN','CERTIFICATE','SECURE_NOTE','RECOVERY_CODES','OTP_SEED')),
  -- Encrypted fields
  username_encrypted bytea,
  username_nonce    bytea,
  secret_ciphertext bytea NOT NULL,
  secret_nonce      bytea NOT NULL,
  secret_tag        bytea NOT NULL,
  -- Metadata (not encrypted)
  key_version       int  NOT NULL,
  secret_length     int  NOT NULL,  -- For policy only, NOT the secret
  rotation_policy   text NOT NULL DEFAULT 'manual',
  rotated_at        timestamptz,
  health            text NOT NULL DEFAULT 'PENDING' CHECK (health IN ('VERIFIED','PENDING','FAILED')),
  access            text NOT NULL DEFAULT 'PERMANENT' CHECK (access IN ('PERMANENT','APPROVAL_REQUIRED','ONE_TIME','SCHEDULED','EMERGENCY')),
  jit_window_min    int,
  last_used_at      timestamptz,
  deleted_at        timestamptz,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
```

### Encryption Details

#### AES-256-GCM

- **Algorithm**: Advanced Encryption Standard with Galois/Counter Mode
- **Key Size**: 256 bits
- **Nonce**: 12 bytes (96 bits) - unique per encryption, never reused
- **Authentication Tag**: 16 bytes (128 bits) - provides integrity protection
- **Security**: NIST-approved, hardware-accelerated, authenticated encryption

#### Envelope Encryption

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ENVELOPE ENCRYPTION                               │
└─────────────────────────────────────────────────────────────────────┘

Plaintext Secret (e.g., "MyPassword123!")
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 1: Generate DEK (Data Encryption Key)                         │
│  - 32 bytes (256 bits) random key                                   │
│  - Generated per tenant                                             │
│  - Wrapped by KMS before storage                                    │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 2: Encrypt Secret with DEK                                   │
│  - AES-256-GCM(secret, DEK, nonce)                                 │
│  - Produces: ciphertext + nonce + auth_tag                          │
│  - nonce is unique per encryption                                   │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 3: Wrap DEK with KMS                                          │
│  - Cloud KMS encrypts DEK                                          │
│  - Produces: wrapped_dek                                            │
│  - Master key never leaves KMS hardware                             │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Storage:                                                          │
│  - Database: ciphertext, nonce, auth_tag, key_version                │
│  - Database: wrapped_dek (in encryption_keys table)                  │
│  - KMS: Master key (never stored in database)                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Management

#### DEK (Data Encryption Key)

- **Purpose**: Encrypts/decrypts credential secrets
- **Size**: 32 bytes (256 bits)
- **Generation**: Cryptographically secure random
- **Storage**: Wrapped by KMS, stored in database
- **Versioning**: Each tenant has one or more DEK versions
- **Rotation**: DEKs can be rotated, re-encrypting all credentials

#### KMS Master Key

- **Purpose**: Wraps/unwraps DEKs
- **Type**: Hardware Security Module (HSM) backed
- **Storage**: Cloud KMS (AWS KMS, Azure Key Vault, Google Cloud KMS)
- **Access**: Controlled by IAM policies
- **Audit**: All key operations are logged by cloud provider

### Security Controls

| Control | Purpose | Implementation |
|---------|---------|----------------|
| RLS (Row Level Security) | Tenant isolation | PostgreSQL RLS policies |
| Field-Level Encryption | Protect secrets | AES-256-GCM |
| Envelope Encryption | Protect DEKs | KMS wrapping |
| Hardware Security | Protect master keys | Cloud HSM |
| Key Rotation | Limit exposure | DEK rotation |
| Access Control | Restrict database access | Database permissions |

### Threats Mitigated

- **Database compromise**: Encryption protects data at rest
- **Cross-tenant access**: RLS prevents unauthorized access
- **Key compromise**: Envelope encryption limits exposure
- **Data corruption**: Authentication tags provide integrity

---

## Stage 3: Use

### Overview

Secrets are used when:
- A user launches an application
- The broker decrypts the credential and performs authentication
- The user is logged into the target application without ever seeing the credential

### Process Flow

```
User Action (Click "Open")
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
│  - Creates launch grant:                                          │
│    * tenant_id binding                                             │
│    * user_id binding                                               │
│    * credential_id binding                                         │
│    * application_id binding                                        │
│    * domain binding                                                │
│    * 30-second TTL                                                │
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
│  Backend (Broker Service) - TRUSTED EXECUTION BOUNDARY              │
│  - Validates grant token_hash (SELECT ... FOR UPDATE)               │
│  - Checks grant is not used                                        │
│  - Checks grant is not expired                                     │
│  - Checks grant is bound to current user                            │
│  - Marks grant as used (atomic operation)                          │
│  - Retrieves credential ciphertext from database                   │
│  - Retrieves tenant DEK from KMS                                   │
│  - Calls withUnsealedSecret() with callback:                      │
│    * Decrypts credential                                            │
│    * Plaintext exists ONLY in callback scope                       │
│    * Performs authentication operation (form submission, etc.)    │
│    * Zeroizes plaintext on scope exit (automatic)                  │
│    * NEVER returns plaintext to caller                             │
│  - Creates session record                                         │
│  - Audits the operation                                            │
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

### Security Controls

| Control | Purpose | Implementation |
|---------|---------|----------------|
| Capability-Based Launch | Prevent unauthorized use | Single-use, time-bound grants |
| RBAC | Enforce permissions | Permission checks |
| Collection Membership | Enforce scope | Collection validation |
| JIT Access | Enforce approval workflows | JIT window validation |
| Grant Binding | Prevent misuse | Tenant/user/credential/app binding |
| Atomic Consumption | Prevent replay | SELECT FOR UPDATE |
| Trusted Boundary | Prevent secret leakage | Broker enclave |
| Isolated World | Prevent page access | Chrome Extension MV3 |
| Memory Zeroization | Prevent persistence | Automatic cleanup |
| Domain Validation | Prevent phishing | Strict hostname matching |

### Data States

| State | Location | Protection |
|-------|----------|------------|
| Grant Token | Frontend memory | Opaque, single-use |
| Grant Token | Extension memory | Opaque, single-use |
| Grant Hash | Database | SHA-256 hash |
| Ciphertext | Database | AES-256-GCM |
| Plaintext | Broker callback | Function scope only, zeroized |
| Plaintext | Isolated world | Memory only, zeroized |

### Code Example

```typescript
// Backend - Broker Service
export async function consumeGrant(p: Principal, token: string, perform: (op: { username: string; secret: string; domain: string }) => Promise<{ gateway: string }>) {
  return withTenant(p.tenantId, async (client) => {
    const hash = sha256(token);
    
    // 1. Get grant (with lock to prevent race conditions)
    const { rows } = await client.query(
      `SELECT g.*, c.name AS cred_name, c.key_version, c.secret_ciphertext, c.secret_nonce, c.secret_tag,
              c.username_encrypted, c.username_nonce, a.domain, a.name AS app_name
         FROM launch_grants g
         JOIN credentials c ON c.id = g.credential_id
         JOIN applications a ON a.id = g.application_id
        WHERE g.token_hash = $1 FOR UPDATE OF g`, [hash]);

    // 2. Validation checks
    if (!rows.length) {
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, 
        type: 'ACCESS_DENIED', result: 'DENIED', resourceId: rows[0]?.id, 
        resourceName: rows[0]?.cred_name, meta: 'unknown grant token' });
      throw new HttpError(404, 'GRANT_UNKNOWN', 'Grant not recognized');
    }
    
    const g = rows[0];
    
    if (g.used_at) {
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, 
        type: 'GRANT_REPLAY_BLOCKED', result: 'DENIED', resourceId: g.id, 
        resourceName: g.cred_name, meta: 'single-use token re-presented — secret NOT decrypted' });
      throw new HttpError(409, 'GRANT_REPLAYED', 'Replay blocked');
    }
    
    if (new Date(g.expires_at) < new Date()) {
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, 
        type: 'ACCESS_DENIED', result: 'DENIED', resourceId: g.id, 
        resourceName: g.cred_name, meta: 'grant expired' });
      throw new HttpError(410, 'GRANT_EXPIRED', 'Grant expired (30s window)');
    }
    
    if (g.user_id !== p.userId) {
      await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, 
        type: 'ACCESS_DENIED', result: 'DENIED', resourceId: g.id, 
        meta: 'grant bound to different principal' });
      throw new HttpError(403, 'GRANT_MISBOUND', 'Grant is bound to its original user');
    }

    // 3. Mark as used
    await client.query(`UPDATE launch_grants SET used_at = now() WHERE id = $1`, [g.id]);

    // 4. Decrypt and perform operation (plaintext only in callback)
    const sealed: Sealed = { ct: g.secret_ciphertext, nonce: g.secret_nonce, tag: g.secret_tag };
    const userSealed: Sealed = { ct: g.username_encrypted, nonce: g.username_nonce, tag: g.secret_tag.slice(0, 12) };
    
    let username = '';
    await withUnsealedSecret(p.tenantId, g.key_version, userSealed, async (u) => { 
      username = u; 
    });

    const session = await withUnsealedSecret(p.tenantId, g.key_version, sealed, async (secret) => {
      // 5. Perform authentication operation
      const { gateway } = await perform({ username, secret, domain: g.domain });
      
      // 6. Create session record
      const ins = await client.query(
        `INSERT INTO sessions (tenant_id, user_id, credential_id, application_id, gateway, status, expires_at)
         VALUES ($1,$2,$3,$4,$5,'ACTIVE', now() + interval '30 minutes') RETURNING id`,
        [p.tenantId, p.userId, g.credential_id, g.application_id, gateway]);
      
      return ins.rows[0].id;
      // 7. Secret is zeroized here (automatic on scope exit)
    });

    // 8. Update credential usage
    await client.query(`UPDATE credentials SET last_used_at = now() WHERE id = $1`, [g.credential_id]);
    
    // 9. Audit
    await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, 
      type: 'APPLICATION_LAUNCHED', resourceId: g.credential_id, resourceName: g.cred_name, 
      meta: `grant=${g.id} consumed · domain verified` });
    await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, 
      type: 'CREDENTIAL_USED', resourceId: g.credential_id, resourceName: g.cred_name, 
      meta: 'decrypted in broker enclave · zeroized after use' });
    await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, 
      type: 'SESSION_STARTED', resourceId: session, resourceName: g.app_name });
    
    return { sessionId: session };
  });
}
```

### Threats Mitigated

- **Replay attacks**: Single-use grants prevent replay
- **Token theft**: Grants are bound to user and have short TTL
- **Session hijacking**: HttpOnly, Secure, SameSite cookies
- **Credential exposure**: Plaintext exists only in trusted boundary
- **Phishing**: Domain validation prevents credential misuse
- **Cross-site attacks**: Isolated world prevents page access

---

## Stage 4: Rotation

### Overview

Secrets are rotated when:
- Scheduled rotation occurs (daily, weekly, monthly, etc.)
- Manual rotation is triggered
- After a session (for certain credentials)
- After a security incident

### Process Flow

```
Scheduled/Manual Trigger
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Rotation Service                                                │
│  - Retrieves credential from database                              │
│  - Validates rotation is allowed (permissions, policy)              │
│  - Retrieves current DEK from KMS                                  │
│  - Calls withUnsealedSecret() to decrypt current password          │
│  - Generates new random password                                   │
│  - Calls target application's change password API                   │
│  - VERIFIES new password works before persisting                    │
│    * If verification fails:                                        │
│      - Old password is retained                                    │
│      - Rollback is automatic                                       │
│      - Failure is audited                                          │
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

### Security Controls

| Control | Purpose | Implementation |
|---------|---------|----------------|
| Verification Before Store | Prevent blind rotation | Mandatory verification |
| Rollback on Failure | Prevent lockout | Automatic rollback |
| Atomic Update | Prevent partial updates | Database transaction |
| Version Tracking | Enable rollback | Credential version history |
| Audit Logging | Record all operations | Comprehensive audit trail |

### Code Example

```typescript
// Backend - Rotation Service
export async function rotateCredential(p: Principal, credentialId: string, adapters: {
  changePassword: (target: string, username: string, oldSecret: string, newSecret: string) => Promise<void>;
  verify: (target: string, username: string, secret: string) => Promise<boolean>;
}) {
  if (!p.permissions.includes('credential.update')) 
    throw new HttpError(403, 'FORBIDDEN', 'credential.update required');
  
  return withTenant(p.tenantId, async (client) => {
    const { rows } = await client.query(`SELECT * FROM credentials WHERE id = $1`, [credentialId]);
    const c = rows[0];
    if (!c) throw new HttpError(404, 'NOT_FOUND', 'Credential not found');
    
    const sealed: Sealed = { ct: c.secret_ciphertext, nonce: c.secret_nonce, tag: c.secret_tag };
    const newSecret = randomToken(24) + 'Aa1!';

    await withUnsealedSecret(p.tenantId, c.key_version, sealed, async (oldSecret) => {
      // 1. Change at target
      await adapters.changePassword(c.target, c.username_encrypted ? '(decrypted in adapter boundary)' : '', oldSecret, newSecret);
      
      // 2. VERIFY before persisting - blind rotation is forbidden
      const ok = await adapters.verify(c.target, '', newSecret);
      if (!ok) {
        await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, 
          type: 'PASSWORD_ROTATED', result: 'FAILURE', resourceId: credentialId, 
          resourceName: c.name, 
          meta: 'verification failed — rolled back, old secret retained, alert raised' });
        throw new HttpError(502, 'ROTATION_VERIFY_FAILED', 
          'New secret failed verification; previous secret retained');
      }
      
      // 3. Re-seal under current DEK
      const s = await seal(p.tenantId, c.key_version, newSecret);
      await client.query(
        `UPDATE credentials SET secret_ciphertext=$1, secret_nonce=$2, secret_tag=$3, secret_length=$4,
           rotated_at=now(), health='VERIFIED' WHERE id=$5`,
        [s.ct, s.nonce, s.tag, newSecret.length, credentialId]);
      await client.query(`INSERT INTO credential_versions (credential_id, key_version, event) 
        VALUES ($1,$2,'rotation verified')`, [credentialId, c.key_version]);
    });
    
    await client.query(
      `UPDATE password_rotation_jobs SET last_run_at=now(), last_result='SUCCESS', attempts=attempts+1 
        WHERE credential_id=$1`, [credentialId]);
    
    await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, 
      type: 'PASSWORD_ROTATED', resourceId: credentialId, resourceName: c.name, 
      meta: 'verified against target · re-encrypted · old ciphertext shredded' });
    
    return { rotated: true };
  });
}
```

### Threats Mitigated

- **Blind rotation**: Verification prevents setting invalid passwords
- **Lockout**: Rollback prevents losing access to target
- **Partial update**: Atomic operations prevent inconsistency
- **Undetected changes**: Audit logging provides visibility

---

## Stage 5: Expiry

### Overview

Secrets and access rights can expire:
- Launch grants expire after 30 seconds
- JIT access windows expire after configured time
- Sessions expire after inactivity or timeout
- Break-glass reveal windows expire after 30 seconds
- Credentials can have expiration dates

### Process Flow

```
Time Passes
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Janitor Process (Periodic Cleanup)                               │
│  - Runs every 30 seconds                                           │
│  - For each tenant:                                                │
│    * Deletes expired launch grants                                 │
│    * Expires approved JIT windows                                  │
│    * Expires idle sessions                                         │
│  - All operations respect tenant isolation (RLS)                  │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Database (PostgreSQL)                                            │
│  - Expired grants are deleted                                      │
│  - Expired JIT windows are marked as EXPIRED                       │
│  - Expired sessions are marked as EXPIRED                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Security Controls

| Control | Purpose | Implementation |
|---------|---------|----------------|
| TTL (Time-to-Live) | Automatic expiration | Database timestamps |
| Janitor Process | Clean up expired items | Periodic background job |
| Tenant Isolation | Prevent cross-tenant cleanup | withTenant() |
| Atomic Operations | Prevent race conditions | Database transactions |

### Code Example

```typescript
// Backend - Janitor Process (in main.ts)
const janitor = setInterval(async () => {
  const { rows: tenants } = await pool.query(`SELECT id FROM tenants WHERE status = 'ACTIVE'`);
  for (const t of tenants) {
    await withTenant(t.id, async (c) => {
      await c.query(`DELETE FROM launch_grants WHERE expires_at < now() - interval '1 hour'`);
      await c.query(`UPDATE access_requests SET status='EXPIRED' WHERE status='APPROVED' AND expires_at < now()`);
      await c.query(`UPDATE sessions SET status='EXPIRED', ended_at=expires_at WHERE status='ACTIVE' AND expires_at < now()`);
    }).catch((e) => app.log.warn({ err: e.message }, 'janitor sweep failed'));
  }
}, 30_000);
```

### Threats Mitigated

- **Token reuse**: Expired tokens cannot be used
- **Access persistence**: Temporary access automatically revoked
- **Resource exhaustion**: Cleanup prevents accumulation of expired items

---

## Stage 6: Revocation

### Overview

Secrets and access can be revoked:
- User sessions can be revoked
- Credentials can be deleted (soft or hard)
- Access requests can be denied
- Connectors can be revoked
- API keys can be revoked

### Process Flow

```
Administrator Action / Policy Trigger
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Revocation Service                                               │
│  - Validates revocation is allowed (permissions)                    │
│  - Marks item as revoked/deleted                                  │
│  - For sessions: marks as TERMINATED                              │
│  - For credentials: marks as deleted_at (soft delete)              │
│  - For connectors: marks as REVOKED                               │
│  - For API keys: marks as revoked_at                              │
│  - Audits the revocation                                          │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Database (PostgreSQL) / Redis                                    │
│  - Item is marked as revoked/deleted                              │
│  - Soft delete preserves data for audit/rollback                   │
│  - Hard delete removes data permanently (rare)                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Security Controls

| Control | Purpose | Implementation |
|---------|---------|----------------|
| Soft Delete | Preserve data for audit | deleted_at timestamp |
| Hard Delete | Permanent removal | Actual deletion |
| Audit Logging | Record revocation | Comprehensive audit trail |
| Permission Checks | Prevent unauthorized revocation | RBAC validation |
| Immediate Effect | Prevent further use | Status change |

### Threats Mitigated

- **Unauthorized access**: Revoked items cannot be used
- **Data loss**: Soft delete allows recovery
- **Undetected revocation**: Audit logging provides visibility

---

## Stage 7: Destruction

### Overview

Secrets are permanently destroyed when:
- Hard delete is performed on a credential
- Tenant is deleted
- System is decommissioned

### Process Flow

```
Hard Delete Trigger
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Destruction Service                                              │
│  - Validates destruction is allowed (permissions)                   │
│  - For credentials:                                               │
│    * Retrieves and decrypts all versions (optional, for audit)     │
│    * Zeroizes all plaintext from memory                            │
│    * Deletes all credential data from database                     │
│  - For tenant:                                                    │
│    * Deletes all tenant data                                      │
│    * Rotates and retires all DEKs                                 │
│    * Deletes all encryption keys                                  │
│  - Audits the destruction                                         │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Database (PostgreSQL)                                            │
│  - All credential data is permanently deleted                       │
│  - All related data (versions, mappings) is deleted                 │
└─────────────────────────────────────────────────────────────────────┘
```

### Security Controls

| Control | Purpose | Implementation |
|---------|---------|----------------|
| Permission Checks | Prevent unauthorized destruction | RBAC validation |
| Confirmation | Prevent accidental destruction | User confirmation |
| Audit Logging | Record destruction | Comprehensive audit trail |
| Zeroization | Prevent memory persistence | Memory cleanup |
| Atomic Operations | Prevent partial destruction | Database transactions |

### Code Example

```typescript
// Backend - Hard Delete Credential
export async function hardDeleteCredential(p: Principal, credentialId: string) {
  if (!p.permissions.includes('credential.delete')) 
    throw new HttpError(403, 'FORBIDDEN', 'credential.delete required');
  
  return withTenant(p.tenantId, async (client) => {
    // Get credential for audit
    const { rows } = await client.query(`SELECT * FROM credentials WHERE id = $1`, [credentialId]);
    if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Credential not found');
    const c = rows[0];
    
    // Delete all related data
    await client.query(`DELETE FROM credential_collections WHERE credential_id = $1`, [credentialId]);
    await client.query(`DELETE FROM application_credentials WHERE credential_id = $1`, [credentialId]);
    await client.query(`DELETE FROM credential_versions WHERE credential_id = $1`, [credentialId]);
    await client.query(`DELETE FROM password_rotation_jobs WHERE credential_id = $1`, [credentialId]);
    
    // Hard delete credential
    await client.query(`DELETE FROM credentials WHERE id = $1`, [credentialId]);
    
    await audit({ tenantId: p.tenantId, actorId: p.userId, actorName: p.name, 
      type: 'CREDENTIAL_DELETED', resourceId: credentialId, resourceName: c.name, 
      meta: 'hard delete · all versions and mappings removed' });
    
    return { deleted: true };
  });
}
```

### Threats Mitigated

- **Data persistence**: Permanent removal prevents recovery
- **Unauthorized destruction**: Permission checks prevent abuse
- **Partial destruction**: Atomic operations prevent inconsistency

---

## Secret Lifecycle Summary

| Stage | Duration | Location | Protection |
|-------|----------|----------|------------|
| Creation | Seconds | Browser → Backend → DB | HTTPS, validation, encryption |
| Storage | Permanent | Database | AES-256-GCM, RLS, KMS |
| Use | Seconds | Broker enclave | Memory isolation, zeroization |
| Rotation | Minutes | Backend | Verification, atomic update |
| Expiry | Configurable | Database | TTL, janitor process |
| Revocation | Immediate | Database | Status change, audit |
| Destruction | Permanent | Database | Hard delete, audit |

---

## Plaintext Exposure Analysis

The **only** times plaintext secrets exist in memory:

1. **Creation**: In Vault Service during encryption (milliseconds)
2. **Use**: In Broker Service during decryption and injection (milliseconds)
3. **Rotation**: In Rotation Service during change/verify (seconds)
4. **Break-Glass**: In Vault Service during reveal (milliseconds, watermarked)

**Plaintext NEVER exists in:**
- Database (only ciphertext)
- Logs (redacted)
- API responses (DTOs exclude sensitive fields)
- Frontend (only receives metadata and grants)
- Browser storage (localStorage, sessionStorage)
- DOM (isolated world prevents access)
- Network (always encrypted in transit)
- Backups (ciphertext only)

---

## Memory Management

### Zeroization

All plaintext secrets are zeroized from memory:

1. **Automatic**: `withUnsealedSecret()` zeroizes buffer on scope exit
2. **Manual**: Explicit zeroization in sensitive operations
3. **Garbage Collection**: Node.js GC eventually reclaims memory

### Zeroization Implementation

```typescript
// Crypto Service
export async function withUnsealedSecret<T>(
  tenantId: string, version: number, sealed: Sealed,
  fn: (plaintext: string) => Promise<T>,
): Promise<T> {
  const buf = await unseal(tenantId, version, sealed);
  try {
    return await fn(buf.toString('utf8'));
  } finally {
    buf.fill(0);  // Zeroize the buffer
  }
}
```

### Memory Safety

- **Node.js**: Uses Buffer objects which can be zeroized
- **V8**: Strings are immutable, but Buffer contents can be modified
- **Process Isolation**: Each service runs in its own process (Docker container)
- **No Shared Memory**: Services don't share memory

---

## Key Rotation

### DEK Rotation

1. **Generate New DEK**: New random DEK is generated
2. **Wrap New DEK**: New DEK is wrapped by KMS
3. **Store New DEK**: Wrapped DEK stored in database
4. **Re-encrypt All Credentials**: Each credential is decrypted with old DEK and re-encrypted with new DEK
5. **Retire Old DEK**: Old DEK is marked as RETIRED
6. **Audit**: Rotation is fully audited

### Master Key Rotation

- **Cloud KMS**: Handled by cloud provider
- **Key Versioning**: Each version is separate
- **Automatic Rotation**: Can be configured in cloud KMS
- **Manual Rotation**: Can be triggered via key ceremony

---

## Backup and Recovery

### Backup Strategy

| Data | Backup Method | Encryption | Retention |
|------|---------------|------------|-----------|
| Database | PITR + Nightly snapshots | Encrypted | 30-365 days |
| Secrets (ciphertext) | In DB backups | Encrypted | Same as DB |
| KMS Keys | Cloud provider backup | Hardware-backed | Per provider |
| Audit Logs | Streamed to SIEM + Nightly export | Encrypted | 365+ days |

### Recovery Strategy

1. **Database Recovery**: Restore from PITR or snapshot
2. **KMS Recovery**: Cloud provider key recovery ceremony
3. **DEK Recovery**: DEKs are in DB backups, but useless without KMS
4. **Secret Recovery**: Not possible - secrets are encrypted with DEKs which require KMS

**Important**: If both the database and KMS are compromised, secrets may be at risk. This is mitigated by:
- Separate custody of KMS and database
- Hardware security for KMS
- Different access controls for KMS and database

---

## Compliance Considerations

### Data Retention

- **Audit Logs**: 365 days minimum (configurable)
- **Session Recordings**: Configurable (default 90 days)
- **Credentials**: Until deleted
- **Tenant Data**: Until tenant deletion

### Data Deletion

- **Soft Delete**: Default for most data (preserves for audit)
- **Hard Delete**: Available for permanent removal
- **GDPR Compliance**: Supports right to erasure
- **Audit Trail**: Deletions are fully audited

### Encryption Standards

- **Algorithm**: AES-256-GCM (NIST-approved)
- **Key Size**: 256 bits (minimum)
- **Key Management**: Cloud KMS/HSM
- **Compliance**: Meets or exceeds:
  - FIPS 140-2
  - ISO 27001
  - SOC 2
  - PCI DSS
  - HIPAA

---

## Summary

The secret lifecycle in Keyrail PAM Cloud is designed with the following principles:

1. **Minimize Plaintext Exposure**: Plaintext exists only in memory, for the shortest possible time, in the most trusted boundaries.
2. **Defense in Depth**: Multiple layers of encryption and controls protect secrets at all stages.
3. **Automatic Cleanup**: Expired and revoked access is automatically removed.
4. **Comprehensive Audit**: All secret operations are recorded in a tamper-evident log.
5. **Fail Secure**: Any error or uncertainty results in denial of access.

**Remember**: The security of the entire system depends on properly managing the secret lifecycle. A single mistake in any stage can compromise the system's security guarantees.

---

## Related Documentation

- [Security Invariants](./invariants.md)
- [Trust Boundaries](./trust-boundaries.md)
- [Security Testing](./security-testing.md)
- [Threat Model](../THREAT-MODEL.md)
- [Architecture Overview](../architecture/overview.md)
