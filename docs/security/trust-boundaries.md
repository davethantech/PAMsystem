# Keyrail PAM Cloud - Trust Boundaries

## Overview

This document explicitly identifies and describes the **trust boundaries** in the Keyrail PAM Cloud system. A trust boundary is a line between components where the level of trust changes - data crossing this boundary must be validated, sanitized, or protected.

Understanding trust boundaries is critical for:
- Security architecture design
- Threat modeling
- Code review
- Incident response
- Compliance auditing

---

## Trust Boundary Definition

A **trust boundary** is a separation between:
- Components with different levels of privilege
- Components with different levels of access to sensitive data
- Components under different control or ownership

When data crosses a trust boundary:
1. It must be **validated** (is it what we expect?)
2. It must be **sanitized** (is it safe to use?)
3. It must be **authorized** (is the sender allowed to send this?)
4. It may need to be **transformed** (to a safe representation)

---

## Trust Boundary Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TRUST BOUNDARY MAP                               │
└─────────────────────────────────────────────────────────────────────┘

LEGEND:
  ━━━━━  Trust Boundary (data crossing requires validation)
  ─────  Data Flow
  [  ]  Component
  (  )  External Entity


          ┌─────────────────────────────────────────────────────────┐
          │                    EXTERNAL / UNTRUSTED                   │
          │                                                         │
          │  (User Browser)     (Attacker)     (Malicious Extension)  │
          │       │                  │                  │             │
          └────────────┼──────────┼──────────────────┼─────────────┘
                       │                  │                  │
                       ▼                  ▼                  ▼
          ┌─────────────────────────────────────────────────────────┐
          │              TRUST BOUNDARY 1: NETWORK EDGE                │
          │              (TLS Termination, WAF, Rate Limiting)          │
          │                                                         │
          │  [Nginx Edge]  [WAF]  [DDoS Protection]  [Load Balancer]  │
          │       │              │              │              │      │
          └────────────┼──────────┼──────────────────┼─────────────┘
                       │              │              │              │
                       ▼              ▼              ▼              ▼
          ┌─────────────────────────────────────────────────────────┐
          │              TRUST BOUNDARY 2: APPLICATION EDGE            │
          │              (Request Validation, Auth, Rate Limiting)     │
          │                                                         │
          │  [Frontend - Static Files]  [Backend API Gateway]         │
          │       │                              │                     │
          └──────────────────────────┼──────────────────┼─────────────┘
                                       │                  │
                                       ▼                  ▼
          ┌─────────────────────────────────────────────────────────┐
          │              TRUST BOUNDARY 3: SERVICE LAYER                 │
          │              (Authentication, Authorization, Validation)   │
          │                                                         │
          │  [Auth Service]  [Tenant Service]  [Other Services]       │
          │       │              │                     │              │
          └──────────────────────────┼──────────────────┼─────────────┘
                                       │                  │
                                       ▼                  ▼
          ┌─────────────────────────────────────────────────────────┐
          │              TRUST BOUNDARY 4: DATA ACCESS                  │
          │              (RLS, Query Validation, Tenant Context)        │
          │                                                         │
          │  [Database - PostgreSQL]  [Cache - Redis]                 │
          │       │                       │                              │
          └──────────────────────────┘               └──────────────────┘

          ┌─────────────────────────────────────────────────────────┐
          │              TRUST BOUNDARY 5: KMS                          │
          │              (Hardware Security Module)                    │
          │                                                         │
          │  [Cloud KMS / HSM]                                        │
          │                                                         │
          └─────────────────────────────────────────────────────────┘

          ┌─────────────────────────────────────────────────────────┐
          │              TRUST BOUNDARY 6: BROWSER                      │
          │              (Isolated World, Extension Context)            │
          │                                                         │
          │  [Browser Extension]  [Isolated World Injector]           │
          │       │                       │                              │
          └──────────────────────────┼───────────────────────────────┘
                                       │
                                       ▼
          ┌─────────────────────────────────────────────────────────┐
          │              TRUST BOUNDARY 7: TARGET APPLICATION           │
          │              (External Systems)                             │
          │                                                         │
          │  (eBay)  (Cloudflare)  (cPanel)  (Internal Systems)         │
          │                                                         │
          └─────────────────────────────────────────────────────────┘

          ┌─────────────────────────────────────────────────────────┐
          │              TRUST BOUNDARY 8: CONNECTOR                    │
          │              (Customer Network Bridge)                      │
          │                                                         │
          │  [Connector]  [Connector Gateway]                         │
          │       │                  │                                  │
          └──────────────────────────┼──────────────────────────────┘
                                       │
                                       ▼
          ┌─────────────────────────────────────────────────────────┐
          │              TRUST BOUNDARY 9: CUSTOMER RESOURCES            │
          │              (Private Networks)                             │
          │                                                         │
          │  (SSH Servers)  (RDP Hosts)  (Databases)  (APIs)           │
          │                                                         │
          └─────────────────────────────────────────────────────────┘
```

---

## Detailed Trust Boundaries

### Boundary 1: Network Edge

**Components:**
- Internet (Untrusted)
- Cloud Load Balancer
- Nginx Edge
- WAF (Web Application Firewall)
- DDoS Protection

**Trust Level:** Low (external, potentially malicious)

**Data Flow:**
- Inbound: HTTP/HTTPS requests from users, attackers, bots
- Outbound: HTTP responses to users

**Security Controls:**

| Control | Purpose | Implementation |
|---------|---------|----------------|
| TLS 1.3 | Encrypt all traffic | Nginx SSL configuration |
| WAF | Block malicious requests | Cloud provider WAF or ModSecurity |
| Rate Limiting | Prevent brute force/DDoS | Nginx rate limiting |
| Request Size Limits | Prevent large payload attacks | Nginx client_max_body_size |
| Security Headers | Protect against XSS, clickjacking, etc. | Nginx headers |
| IP Filtering | Block known bad IPs | Firewall rules |
| Bot Detection | Detect and block bots | WAF rules |

**Data Validation:**
- Validate HTTP method
- Validate request size
- Validate headers
- Validate TLS version and cipher

**Threats Mitigated:**
- Man-in-the-middle attacks (TLS)
- DDoS attacks (rate limiting, WAF)
- SQL injection (WAF)
- XSS (headers)
- Clickjacking (headers)
- Protocol attacks (TLS 1.3)

---

### Boundary 2: Application Edge

**Components:**
- Nginx Edge (Trusted)
- Frontend - Static Files (Trusted)
- Backend API Gateway (Trusted)

**Trust Level:** Medium (internal, but exposed to network)

**Data Flow:**
- Inbound: HTTP requests from edge
- Outbound: HTTP responses to edge

**Security Controls:**

| Control | Purpose | Implementation |
|---------|---------|----------------|
| Request Validation | Validate all inputs | Fastify/NestJS validation |
| Authentication | Verify user identity | JWT validation |
| Session Validation | Verify active session | Session lookup |
| CSRF Protection | Prevent cross-site request forgery | SameSite cookies, CSRF tokens |
| CORS | Restrict cross-origin requests | CORS middleware |
| Rate Limiting | Prevent API abuse | Fastify rate limiting |
| Input Sanitization | Prevent injection attacks | Zod validation |

**Data Validation:**
- Validate all request parameters
- Validate request body against schema
- Validate query parameters
- Validate headers
- Validate cookies

**Threats Mitigated:**
- Injection attacks (validation)
- Authentication bypass (session validation)
- CSRF (SameSite cookies)
- API abuse (rate limiting)
- Data corruption (validation)

---

### Boundary 3: Service Layer

**Components:**
- API Gateway (Trusted)
- Auth Service (Trusted)
- Tenant Service (Trusted)
- All other services (Trusted)

**Trust Level:** High (internal services, same process or internal network)

**Data Flow:**
- Inbound: Requests from API Gateway
- Outbound: Responses to API Gateway
- Internal: Service-to-service communication

**Security Controls:**

| Control | Purpose | Implementation |
|---------|---------|----------------|
| Authentication | Verify service identity | Internal (same process) or mTLS |
| Authorization | Verify permissions | RBAC checks |
| Tenant Context | Enforce tenant isolation | withTenant() |
| Input Validation | Validate service inputs | Zod validation |
| Audit Logging | Record sensitive operations | audit() function |
| Secret Redaction | Prevent secret leakage | redact() function |

**Data Validation:**
- Validate all service inputs
- Validate tenant context
- Validate permissions
- Validate resource existence and access

**Threats Mitigated:**
- Privilege escalation (authorization)
- Tenant escape (tenant context)
- Information disclosure (redaction)
- Unauthorized access (RBAC)

**Special Note:** This boundary is **internal** to the application. Data crossing between services within the same process does not cross a network boundary, but still crosses a **logical** trust boundary (different services may have different privileges).

---

### Boundary 4: Data Access

**Components:**
- Services (Trusted)
- Database - PostgreSQL (Trusted, but separate process)
- Cache - Redis (Trusted, but separate process)

**Trust Level:** High (trusted infrastructure, but separate processes)

**Data Flow:**
- Inbound: Queries from services
- Outbound: Results to services

**Security Controls:**

| Control | Purpose | Implementation |
|---------|---------|----------------|
| Connection Security | Encrypt data in transit | TLS for cloud DB, local socket for Docker |
| RLS (Row Level Security) | Enforce tenant isolation | PostgreSQL RLS policies |
| Parameterized Queries | Prevent SQL injection | pg library |
| Query Validation | Validate query parameters | Service layer |
| Tenant Context | Bind queries to tenant | withTenant() |
| Field Encryption | Protect sensitive data | AES-256-GCM |

**Data Validation:**
- Validate all query parameters
- Validate tenant context is set
- Validate query results
- Sanitize output (remove sensitive fields)

**Threats Mitigated:**
- SQL injection (parameterized queries)
- Data leakage (RLS, field encryption)
- Tenant escape (RLS, tenant context)
- Unauthorized data access (RLS)

**Special Note:** Even though the database is trusted, it represents a **critical trust boundary** because:
1. It contains all application data
2. A database compromise could expose encrypted data
3. RLS must be properly configured to prevent tenant escape

---

### Boundary 5: KMS (Key Management Service)

**Components:**
- Services (Trusted)
- Cloud KMS / HSM (Highly Trusted)

**Trust Level:** Very High (hardware-backed security)

**Data Flow:**
- Inbound: Key requests from services
- Outbound: Key material (wrapped) to services

**Security Controls:**

| Control | Purpose | Implementation |
|---------|---------|----------------|
| Hardware Security | Protect master keys | Cloud HSM |
| Key Wrapping | Protect DEKs | KMS wrap/unwrap |
| Access Control | Restrict key access | IAM policies |
| Audit Logging | Record key operations | Cloud KMS logging |
| Key Rotation | Limit exposure of compromised keys | KMS key rotation |

**Data Validation:**
- Validate key IDs
- Validate key usage
- Validate access permissions

**Threats Mitigated:**
- Key compromise (HSM)
- Unauthorized key access (IAM)
- Key leakage (wrapping)

**Special Note:** This is the **highest trust boundary** in the system. The KMS/HSM contains the master keys that protect all other data. Compromise of this boundary could lead to complete system compromise.

---

### Boundary 6: Browser

**Components:**
- Backend (Trusted)
- Browser Extension (Semi-Trusted)
- Isolated World Injector (Trusted Context)
- Page Context (Untrusted)

**Trust Level:** Mixed (extension is semi-trusted, page is untrusted)

**Data Flow:**
- Inbound: Grant tokens from backend
- Outbound: Consumption requests to backend
- Injection: Credentials to page (via isolated world)

**Security Controls:**

| Control | Purpose | Implementation |
|---------|---------|----------------|
| Token Storage | Prevent token theft | Memory only, never storage |
| Domain Validation | Prevent phishing | Strict hostname matching |
| Isolated World | Prevent page access to secrets | Chrome Extension MV3 |
| Native DOM Access | Prevent observation | Native property descriptors |
| Memory Zeroization | Prevent secret persistence | Immediate zeroization |
| Single-Use Tokens | Prevent replay | Grant tokens |
| HttpOnly Cookies | Prevent XSS token theft | Cookie settings |

**Data Validation:**
- Validate grant tokens
- Validate domain matching
- Validate session
- Validate origin

**Threats Mitigated:**
- Credential theft (isolated world)
- Token theft (memory storage, HttpOnly)
- Phishing (domain validation)
- Replay attacks (single-use tokens)
- XSS (isolated world, HttpOnly cookies)

**Special Note:** The browser extension operates in a **semi-trusted** environment. While the extension code is trusted, the browser and page context are not. This boundary is critical for preventing credential exposure.

---

### Boundary 7: Target Application

**Components:**
- Broker Service (Trusted)
- Target Applications (Untrusted)

**Trust Level:** Low (external systems, potentially malicious)

**Data Flow:**
- Outbound: Authentication requests to target
- Inbound: Responses from target

**Security Controls:**

| Control | Purpose | Implementation |
|---------|---------|----------------|
| Credential Injection | Authenticate to target | Isolated world injection |
| Session Isolation | Prevent session mixing | Separate browser sessions |
| Domain Validation | Prevent credential misuse | Strict domain matching |
| SSRF Protection | Prevent internal network access | URL validation |
| Request Validation | Validate target responses | Response parsing |

**Data Validation:**
- Validate target URLs
- Validate target domains
- Validate target responses
- Validate authentication success

**Threats Mitigated:**
- Credential misuse (domain validation)
- Session hijacking (session isolation)
- SSRF (URL validation)
- Phishing (domain validation)

**Special Note:** Target applications are **external** to our system and are considered untrusted. We must be careful not to trust any data returned from them.

---

### Boundary 8: Connector

**Components:**
- Connector Gateway (Trusted)
- Connector (Semi-Trusted - Customer-controlled)
- Customer Resources (Untrusted)

**Trust Level:** Mixed (gateway is trusted, connector is semi-trusted)

**Data Flow:**
- Inbound: mTLS connections from connectors
- Outbound: Commands to customer resources
- Internal: Communication between gateway and services

**Security Controls:**

| Control | Purpose | Implementation |
|---------|---------|----------------|
| mTLS Authentication | Verify connector identity | Mutual TLS |
| Device Certificates | Identify connectors | X.509 certificates |
| Tenant Binding | Prevent cross-tenant access | Tenant context |
| Command Allowlist | Restrict connector actions | Allowlist validation |
| Heartbeat | Detect compromised connectors | Regular pings |
| Rate Limiting | Prevent connector abuse | Per-connector limits |
| No Vault Keys | Prevent key leakage | Never send DEKs |

**Data Validation:**
- Validate device certificates
- Validate tenant binding
- Validate command type
- Validate target resources
- Validate command parameters

**Threats Mitigated:**
- Connector impersonation (mTLS)
- Cross-tenant access (tenant binding)
- Command injection (allowlist)
- Connector compromise (heartbeat, revocation)
- Key leakage (no vault keys)

**Special Note:** Connectors run on **customer infrastructure** and are therefore semi-trusted. They have access to customer resources but should not have access to PAM internals.

---

### Boundary 9: Customer Resources

**Components:**
- Connector (Semi-Trusted)
- Customer Resources (Untrusted)

**Trust Level:** Low (customer-controlled, potentially misconfigured)

**Data Flow:**
- Outbound: Commands from connector
- Inbound: Responses from resources

**Security Controls:**

| Control | Purpose | Implementation |
|---------|---------|----------------|
| Outbound-Only | Prevent inbound access | Connector initiates all connections |
| Command Validation | Prevent unauthorized actions | Allowlist |
| Response Validation | Prevent data leakage | Response parsing |
| Session Recording | Audit connector actions | Session recording |

**Data Validation:**
- Validate command parameters
- Validate resource responses
- Sanitize any data returned

**Threats Mitigated:**
- Unauthorized access (command validation)
- Data leakage (response validation)
- Lateral movement (outbound-only)

---

## Trust Boundary Matrix

| Boundary | From | To | Trust Level Change | Key Controls |
|----------|------|---|---------------------|--------------|
| 1 | Internet | Edge | Low → Medium | TLS, WAF, Rate Limiting |
| 2 | Edge | Application | Medium → High | Auth, Validation, Rate Limiting |
| 3 | Application | Services | High → High | RBAC, Tenant Context |
| 4 | Services | Database | High → High | RLS, Parameterized Queries |
| 5 | Services | KMS | High → Very High | Hardware Security, Wrapping |
| 6 | Backend | Browser Extension | High → Medium | Token Security, Domain Validation |
| 7 | Extension | Page | Medium → Low | Isolated World, Native DOM |
| 8 | Broker | Target App | High → Low | Domain Validation, SSRF Protection |
| 9 | Gateway | Connector | High → Medium | mTLS, Tenant Binding |
| 10 | Connector | Customer Resources | Medium → Low | Command Validation, Outbound-Only |

---

## Data Classification by Trust Boundary

### Data Classes

| Class | Description | Examples | Storage | Transmission |
|-------|-------------|----------|---------|--------------|
| Public | Non-sensitive data | User names, application names | Anywhere | Any channel |
| Internal | Sensitive but not secret | Tenant IDs, user IDs, timestamps | Database, Logs | Encrypted |
| Confidential | Sensitive business data | Credential metadata, collection names | Database (encrypted at rest) | TLS |
| Secret | Authentication credentials | Passwords, API keys, tokens | Database (encrypted), KMS | Never transmitted |
| Critical | Master keys, system secrets | DEKs, KMS keys | KMS only | Never transmitted |

### Data Flow Rules

| From \ To | Public | Internal | Confidential | Secret | Critical |
|-----------|--------|----------|-------------|--------|----------|
| Public | ✓ | ✓ | ✗ | ✗ | ✗ |
| Internal | ✓ | ✓ | ✓ | ✗ | ✗ |
| Confidential | ✓ | ✓ | ✓ | ✗ | ✗ |
| Secret | ✗ | ✗ | ✗ | ✓ (in broker) | ✗ |
| Critical | ✗ | ✗ | ✗ | ✗ | ✓ (in KMS) |

**Rules:**
- ✓ = Allowed
- ✗ = Not allowed
- Data can only flow **down** in sensitivity (Public → Internal → Confidential → Secret → Critical)
- Data **cannot** flow up in sensitivity without proper protection
- Secret data can only exist in the **Broker** trust boundary
- Critical data can only exist in the **KMS** trust boundary

---

## Trust Boundary Crossing Rules

When data crosses a trust boundary from **higher trust to lower trust** (or vice versa), the following rules apply:

### 1. Higher Trust → Lower Trust

**Requirements:**
- **Validate**: Ensure data is what we expect
- **Sanitize**: Remove or escape dangerous content
- **Authorize**: Ensure sender is allowed to send this data
- **Transform**: Convert to safe representation if needed
- **Log**: Record the data flow (if sensitive)

**Example:** Database → API Response
- Validate: Check data types and constraints
- Sanitize: Remove sensitive fields, redact secrets
- Authorize: Check user has permission to view
- Transform: Convert to DTO
- Log: Audit the access

### 2. Lower Trust → Higher Trust

**Requirements:**
- **Validate**: Ensure data is what we expect (more strictly)
- **Sanitize**: Remove or escape all potentially dangerous content
- **Authorize**: Ensure sender is authenticated and authorized
- **Transform**: Convert to safe internal representation
- **Log**: Record the data flow

**Example:** HTTP Request → Service
- Validate: Schema validation, type checking
- Sanitize: Input sanitization, XSS prevention
- Authorize: Authentication, RBAC checks
- Transform: Parse and normalize
- Log: Audit the request

---

## Common Trust Boundary Violations

### 1. Trusting Client-Supplied Data

**Violation:** Using client-supplied tenant_id, user_id, or other identifiers without validation.

**Example (BAD):**
```typescript
// ❌ BAD: Trusting client-supplied tenant_id
app.get('/credentials', async (req) => {
  const tenantId = req.query.tenant; // Client-supplied!
  const creds = await getCredentials(tenantId);
  return creds;
});
```

**Example (GOOD):**
```typescript
// ✓ GOOD: Using tenant_id from authenticated session
app.get('/credentials', async (req) => {
  const principal = await getPrincipal(req); // From session
  const creds = await getCredentials(principal.tenantId);
  return creds;
});
```

**Mitigation:** Always derive trust-sensitive identifiers from authenticated context, never from client input.

---

### 2. Returning Sensitive Data

**Violation:** Returning database entities directly without DTO transformation.

**Example (BAD):**
```typescript
// ❌ BAD: Returning raw database entity
app.get('/credentials/:id', async (req) => {
  const cred = await db.credentials.findOne(req.params.id);
  return cred; // Includes secret_ciphertext, etc.
});
```

**Example (GOOD):**
```typescript
// ✓ GOOD: Using DTO to control returned fields
app.get('/credentials/:id', async (req) => {
  const cred = await db.credentials.findOne(req.params.id);
  return {
    id: cred.id,
    name: cred.name,
    target: cred.target,
    kind: cred.kind,
    // No sensitive fields
  };
});
```

**Mitigation:** Always use DTOs to explicitly define returned fields. Never return database entities directly.

---

### 3. Logging Sensitive Data

**Violation:** Logging data without redaction.

**Example (BAD):**
```typescript
// ❌ BAD: Logging raw request body
app.post('/launch', async (req) => {
  console.log('Launch request:', req.body); // Might contain secrets
  // ...
});
```

**Example (GOOD):**
```typescript
// ✓ GOOD: Using redaction
app.post('/launch', async (req) => {
  console.log('Launch request:', redact(JSON.stringify(req.body)));
  // ...
});
```

**Mitigation:** Always use the `redact()` function for any data that might contain secrets before logging.

---

### 4. Storing Secrets in Untrusted Locations

**Violation:** Storing grant tokens or secrets in browser storage.

**Example (BAD):**
```javascript
// ❌ BAD: Storing token in localStorage
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'GRANT_ISSUED') {
    localStorage.setItem('grantToken', msg.token); // Unsafe!
  }
});
```

**Example (GOOD):**
```javascript
// ✓ GOOD: Storing in memory only
let pendingGrant = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'GRANT_ISSUED') {
    pendingGrant = msg.grant; // Memory only
  }
});
```

**Mitigation:** Never store secrets or tokens in localStorage, sessionStorage, or any persistent browser storage. Use memory only.

---

### 5. Bypassing Tenant Isolation

**Violation:** Querying database without tenant context.

**Example (BAD):**
```typescript
// ❌ BAD: Query without tenant context
async function getCredential(id: string) {
  return db.query('SELECT * FROM credentials WHERE id = $1', [id]);
}
```

**Example (GOOD):**
```typescript
// ✓ GOOD: Query with tenant context
async function getCredential(tenantId: string, id: string) {
  return withTenant(tenantId, (client) => {
    return client.query('SELECT * FROM credentials WHERE id = $1', [id]);
  });
}
```

**Mitigation:** Always use `withTenant()` for database operations. Never query without tenant context.

---

### 6. Plaintext in Memory

**Violation:** Keeping plaintext secrets in memory longer than necessary.

**Example (BAD):**
```typescript
// ❌ BAD: Keeping plaintext in memory
async function useCredential() {
  const plaintext = await decrypt(credential); // Plaintext in memory
  // ... do something ...
  // Plaintext stays in memory!
  return result;
}
```

**Example (GOOD):**
```typescript
// ✓ GOOD: Using withUnsealedSecret for automatic cleanup
async function useCredential() {
  return withUnsealedSecret(tenantId, version, sealed, async (plaintext) => {
    // Plaintext only exists in this scope
    const result = await doSomething(plaintext);
    return result;
    // Plaintext is zeroized when scope exits
  });
}
```

**Mitigation:** Always use `withUnsealedSecret()` for credential decryption. Never handle plaintext directly.

---

## Trust Boundary Testing

Each trust boundary should have automated tests that verify:

1. **Data Validation**: Invalid data is rejected
2. **Sanitization**: Dangerous content is removed/escaped
3. **Authorization**: Unauthorized access is denied
4. **Transformation**: Data is converted to safe representation
5. **No Leakage**: Secrets don't cross boundaries unexpectedly

### Test Examples

```typescript
// Test Boundary 1: Network Edge
describe('Network Edge Trust Boundary', () => {
  it('should reject HTTP requests (not HTTPS)', async () => {
    const response = await fetch('http://pam.example.com');
    expect(response.status).toBe(301); // Redirect to HTTPS
  });
  
  it('should block requests with invalid TLS', async () => {
    // This would fail in a real test with weak TLS
    const response = await fetch('https://pam.example.com', {
      // Simulate weak TLS
    });
    expect(response.ok).toBe(false);
  });
});

// Test Boundary 2: Application Edge
describe('Application Edge Trust Boundary', () => {
  it('should reject unauthenticated requests', async () => {
    const response = await app.inject({ method: 'GET', url: '/credentials' });
    expect(response.statusCode).toBe(401);
  });
  
  it('should reject requests with invalid session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/credentials',
      cookies: { kr_access: 'invalid-token' }
    });
    expect(response.statusCode).toBe(401);
  });
});

// Test Boundary 4: Data Access
describe('Data Access Trust Boundary', () => {
  it('should enforce RLS on all tenant tables', async () => {
    // Login as Tenant A
    const userA = await loginAs('user-a@tenant-a.com');
    
    // Try to access Tenant B's data
    const response = await app.inject({
      method: 'GET',
      url: '/credentials/tenant-b-credential',
      cookies: { kr_access: userA.cookies }
    });
    
    expect([403, 404]).toContain(response.statusCode);
  });
  
  it('should never return plaintext in database queries', async () => {
    const result = await db.query('SELECT * FROM credentials WHERE id = $1', [123]);
    expect(result.rows[0]).not.toHaveProperty('secret');
    expect(result.rows[0]).toHaveProperty('secret_ciphertext');
  });
});

// Test Boundary 6: Browser
describe('Browser Trust Boundary', () => {
  it('should not store grant tokens in storage', async () => {
    // Simulate extension receiving grant
    const grant = { token: 'test-token', domain: 'example.com' };
    
    // Check storage
    expect(localStorage.getItem('grantToken')).toBeNull();
    expect(sessionStorage.getItem('grantToken')).toBeNull();
  });
  
  it('should validate domain before injection', async () => {
    pendingGrant = { domain: 'ebay.com' };
    
    const result1 = await simulateInjection('https://ebay.com');
    expect(result1.ok).toBe(true);
    
    const result2 = await simulateInjection('https://evil-ebay.com');
    expect(result2.ok).toBe(false);
  });
});
```

---

## Trust Boundary Monitoring

Each trust boundary should be monitored for:

1. **Anomalous Data Flow**: Unexpected data crossing boundaries
2. **Validation Failures**: Increased rate of rejected data
3. **Authorization Failures**: Increased rate of access denials
4. **Performance Issues**: Slow data processing at boundaries
5. **Error Rates**: Increased errors at boundary crossings

### Monitoring Examples

```yaml
# Example Prometheus metrics
- name: trust_boundary_validation_failures
  description: Number of validation failures at trust boundaries
  labels: [boundary, reason]
  type: counter

- name: trust_boundary_authorization_failures
  description: Number of authorization failures at trust boundaries
  labels: [boundary, reason]
  type: counter

- name: trust_boundary_data_volume
  description: Volume of data crossing trust boundaries
  labels: [boundary, direction]
  type: counter

- name: trust_boundary_processing_time
  description: Time to process data at trust boundaries
  labels: [boundary]
  type: histogram
```

---

## Summary

Trust boundaries are the **critical security lines** in the Keyrail PAM Cloud system. Understanding and properly enforcing these boundaries is essential for maintaining the system's security guarantees.

**Key Principles:**
1. **Never trust, always verify** - Data crossing boundaries must be validated
2. **Defense in depth** - Multiple controls at each boundary
3. **Least privilege** - Minimum necessary access across boundaries
4. **Fail secure** - Deny by default, allow only explicitly
5. **Audit everything** - Record all boundary crossings for sensitive data

**Remember:** The security of the entire system depends on the proper enforcement of these trust boundaries. A single boundary failure can compromise the entire system.

---

## Related Documentation

- [Security Invariants](./invariants.md)
- [Secret Lifecycle](./secret-lifecycle.md)
- [Security Testing](./security-testing.md)
- [Threat Model](../THREAT-MODEL.md)
- [Architecture Overview](../architecture/overview.md)
