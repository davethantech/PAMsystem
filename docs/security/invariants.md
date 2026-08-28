# Keyrail PAM Cloud - Security Invariants

## Overview

Security invariants are properties that **must always hold** in the Keyrail PAM Cloud system. They represent the non-negotiable security guarantees that the system provides. Violating any of these invariants constitutes a critical security vulnerability.

This document defines the security invariants, explains how they are enforced, and provides guidance for testing and maintaining them.

---

## Invariant Definition

A security invariant is a property that:
1. **Must always be true** during normal system operation
2. **Cannot be bypassed** through any legitimate user action
3. **Is enforced** through multiple layers of controls
4. **Is tested** automatically to prevent regressions

---

## Security Invariants

### Invariant 1: Normal Users Cannot Retrieve Plaintext Credentials

**Statement**: No user without the `credential.reveal` permission can retrieve the plaintext value of any credential through any means.

**Enforcement Layers**:

1. **API Layer**
   - No API endpoints return plaintext credentials
   - All credential endpoints return only metadata (id, name, target, kind, etc.)
   - The `/credentials/:id/secret` endpoint does not exist (404 with audit)
   - The `/credentials/:id/reveal` endpoint denies all requests (403 with audit)

2. **Service Layer**
   - Credential Service never returns plaintext
   - Vault Service's decrypt operations are only accessible to Broker Service
   - `withUnsealedSecret()` is the only decryption boundary

3. **Database Layer**
   - Database stores only ciphertext, nonce, and auth tag
   - Plaintext never touches the database

4. **Frontend Layer**
   - Frontend never receives plaintext credentials
   - Frontend displays only metadata
   - No DOM elements contain plaintext secrets

5. **Browser Extension Layer**
   - Extension never receives plaintext credentials
   - Extension receives only operation handles
   - Injection happens in isolated world

6. **Broker Layer**
   - Broker is the ONLY place plaintext is decrypted
   - Plaintext exists only in broker callback scope
   - Memory is zeroized after use

**Testing**:
```typescript
// Test that no API returns plaintext
it('should never return plaintext credentials in API responses', async () => {
  const response = await app.inject({ method: 'GET', url: '/credentials' });
  const body = response.json();
  
  // Check no credential has secret field
  expect(body).not.toContainKey('secret');
  expect(body).not.toContainKey('password');
  expect(body).not.toContainKey('value');
  
  // Check no plaintext patterns
  const json = JSON.stringify(body);
  expect(json).not.toMatch(/password\s*[:=]/i);
  expect(json).not.toMatch(/secret\s*[:=]/i);
});

// Test that reveal endpoint denies
it('should deny credential reveal attempts', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/credentials/123/reveal',
    cookies: { kr_access: userCookie }
  });
  
  expect(response.statusCode).toBe(403);
  expect(response.json().error).toBe('REVEAL_DENIED');
});
```

**Mutation Testing**:
- If the check `grant.audience !== expectedAudience` is removed, tests must fail
- If any code path returns plaintext, tests must fail
- If redaction is disabled, tests must fail

---

### Invariant 2: `credential.use` Does Not Imply `credential.reveal`

**Statement**: Holding the `credential.use` permission does NOT grant the ability to reveal (view) the plaintext credential. These are disjoint permissions.

**Enforcement Layers**:

1. **RBAC Matrix**
   - Built-in roles have separate permissions:
     - USER: `credential.use` but NOT `credential.reveal`
     - PAM_ADMIN: `credential.use` but NOT `credential.reveal`
     - SECURITY_ADMIN: Both `credential.use` AND `credential.reveal`

2. **Permission Checks**
   - Launch flow checks for `credential.use` and `application.launch`
   - Reveal flow checks for `credential.reveal`
   - These checks are independent

3. **API Endpoints**
   - Launch endpoints require `credential.use`
   - Reveal endpoints require `credential.reveal`
   - No endpoint grants both

4. **Break-Glass**
   - Even break-glass requires explicit `credential.reveal` permission
   - Break-glass has additional controls (reason, co-sign, etc.)

**Testing**:
```typescript
// Test that USER role can launch but not reveal
it('should allow USER to launch but not reveal', async () => {
  // Login as USER
  const user = await loginAs('user@test.com');
  
  // Should be able to launch
  const launchResponse = await app.inject({
    method: 'POST',
    url: '/credentials/123/launch',
    cookies: { kr_access: user.cookies },
    payload: { applicationId: '456' }
  });
  expect(launchResponse.statusCode).not.toBe(403);
  
  // Should NOT be able to reveal
  const revealResponse = await app.inject({
    method: 'POST',
    url: '/credentials/123/reveal',
    cookies: { kr_access: user.cookies }
  });
  expect(revealResponse.statusCode).toBe(403);
});

// Test that PAM_ADMIN can launch but not reveal
it('should allow PAM_ADMIN to launch but not reveal', async () => {
  // Similar test for PAM_ADMIN role
});

// Test that SECURITY_ADMIN can both launch and reveal
it('should allow SECURITY_ADMIN to both launch and reveal', async () => {
  // Login as SECURITY_ADMIN
  const admin = await loginAs('security-admin@test.com');
  
  // Should be able to launch
  const launchResponse = await app.inject({
    method: 'POST',
    url: '/credentials/123/launch',
    cookies: { kr_access: admin.cookies },
    payload: { applicationId: '456' }
  });
  expect(launchResponse.statusCode).not.toBe(403);
  
  // Should be able to reveal (with additional break-glass controls)
  // Note: This would still require break-glass procedure
});
```

**Mutation Testing**:
- If `credential.use` is added to a role that shouldn't have it, tests must fail
- If `credential.reveal` is added to USER role, tests must fail
- If permission check is removed from launch flow, tests must fail

---

### Invariant 3: Tenant Boundaries Cannot Be Crossed

**Statement**: A user in Tenant A cannot access any data, credentials, or resources belonging to Tenant B, even if they know the resource IDs.

**Enforcement Layers**:

1. **Authentication Layer**
   - Session tokens contain tenant_id
   - Tenant_id is derived from verified session, never from client

2. **Application Layer**
   - All requests use `withTenant()` context
   - Tenant_id is pinned for the entire request/transaction
   - Client-supplied tenant_id parameters are ignored

3. **Database Layer**
   - FORCE ROW LEVEL SECURITY on all tenant-scoped tables
   - RLS policy: `tenant_id = current_setting('app.tenant_id')`
   - All queries run with tenant context set

4. **API Layer**
   - No endpoints accept tenant_id from client
   - Tenant_id always comes from session

5. **Service Layer**
   - All service operations include tenant context
   - Cross-tenant operations are explicitly prevented

**Testing**:
```typescript
// Test tenant isolation with IDOR attempt
it('should prevent cross-tenant access via IDOR', async () => {
  // Login as user in Tenant A
  const userA = await loginAs('user-a@tenant-a.com');
  
  // Try to access credential from Tenant B using known ID
  const response = await app.inject({
    method: 'GET',
    url: '/credentials/tenant-b-credential-id',
    cookies: { kr_access: userA.cookies }
  });
  
  // Should be denied (403 or 404)
  expect([403, 404]).toContain(response.statusCode);
  
  // Check audit log for IDOR attempt
  const audit = await app.inject({
    method: 'GET',
    url: '/audit-events?type=ACCESS_DENIED',
    cookies: { kr_access: userA.cookies }
  });
  expect(audit.json()).toContainEqual(expect.objectContaining({
    type: 'ACCESS_DENIED',
    meta: expect.stringContaining('IDOR')
  }));
});

// Test tenant isolation with query parameter
it('should ignore client-supplied tenant parameter', async () => {
  const userA = await loginAs('user-a@tenant-a.com');
  
  // Try to access with ?tenant=tenant-b
  const response1 = await app.inject({
    method: 'GET',
    url: '/credentials?tenant=tenant-b',
    cookies: { kr_access: userA.cookies }
  });
  
  // Should return only Tenant A credentials
  const response2 = await app.inject({
    method: 'GET',
    url: '/credentials',
    cookies: { kr_access: userA.cookies }
  });
  
  // Both responses should be identical
  expect(response1.json()).toEqual(response2.json());
});
```

**Mutation Testing**:
- If RLS is disabled on a table, tests must fail
- If tenant context is not set, tests must fail
- If client-supplied tenant_id is used, tests must fail

---

### Invariant 4: Launch Grants Cannot Be Replayed

**Statement**: A launch grant token can be consumed only once. Any attempt to reuse a grant token is denied.

**Enforcement Layers**:

1. **Token Generation**
   - Grant tokens are cryptographically random (24 bytes)
   - Tokens are single-use by design

2. **Database Layer**
   - Grant tokens are stored as hash (sha256) in database
   - `used_at` column tracks consumption time
   - SELECT ... FOR UPDATE on consumption prevents race conditions

3. **Consumption Flow**
   - Atomic check-and-mark operation
   - If already used, deny immediately
   - If expired, deny immediately
   - If user mismatch, deny immediately

4. **Audit Layer**
   - All consumption attempts are audited
   - Replay attempts trigger GRANT_REPLAY_BLOCKED event

**Testing**:
```typescript
// Test grant replay prevention
it('should prevent grant replay', async () => {
  const user = await loginAs('user@test.com');
  
  // Create a grant
  const createResponse = await app.inject({
    method: 'POST',
    url: '/credentials/123/launch',
    cookies: { kr_access: user.cookies },
    payload: { applicationId: '456' }
  });
  const { token } = createResponse.json();
  
  // Consume the grant
  const consumeResponse1 = await app.inject({
    method: 'POST',
    url: '/launch/consume',
    cookies: { kr_access: user.cookies },
    payload: { token, kind: 'web-inject' }
  });
  expect(consumeResponse1.statusCode).toBe(200);
  
  // Try to consume again
  const consumeResponse2 = await app.inject({
    method: 'POST',
    url: '/launch/consume',
    cookies: { kr_access: user.cookies },
    payload: { token, kind: 'web-inject' }
  });
  expect(consumeResponse2.statusCode).toBe(409); // Conflict
  expect(consumeResponse2.json().error).toBe('GRANT_REPLAYED');
  
  // Check audit log
  const audit = await app.inject({
    method: 'GET',
    url: '/audit-events?type=GRANT_REPLAY_BLOCKED',
    cookies: { kr_access: user.cookies }
  });
  expect(audit.json().length).toBeGreaterThan(0);
});
```

**Mutation Testing**:
- If SELECT ... FOR UPDATE is removed, tests must fail (race condition)
- If used_at check is removed, tests must fail
- If hash comparison is removed, tests must fail

---

### Invariant 5: Launch Grants Cannot Be Transferred Between Users

**Statement**: A launch grant token issued to User A cannot be consumed by User B, even if User B has the necessary permissions.

**Enforcement Layers**:

1. **Grant Binding**
   - Grant tokens are bound to specific user_id at creation
   - Binding is stored in database

2. **Consumption Check**
   - Consumption validates that current user matches grant user
   - Check happens before any decryption

3. **Session Validation**
   - User identity comes from verified session
   - Session cannot be transferred

**Testing**:
```typescript
// Test grant user binding
it('should prevent grant consumption by different user', async () => {
  // Login as User A
  const userA = await loginAs('user-a@test.com');
  
  // Create a grant as User A
  const createResponse = await app.inject({
    method: 'POST',
    url: '/credentials/123/launch',
    cookies: { kr_access: userA.cookies },
    payload: { applicationId: '456' }
  });
  const { token } = createResponse.json();
  
  // Login as User B
  const userB = await loginAs('user-b@test.com');
  
  // Try to consume User A's grant
  const consumeResponse = await app.inject({
    method: 'POST',
    url: '/launch/consume',
    cookies: { kr_access: userB.cookies },
    payload: { token, kind: 'web-inject' }
  });
  
  expect(consumeResponse.statusCode).toBe(403);
  expect(consumeResponse.json().error).toBe('GRANT_MISBOUND');
  
  // Check audit log
  const audit = await app.inject({
    method: 'GET',
    url: '/audit-events?type=ACCESS_DENIED',
    cookies: { kr_access: userB.cookies }
  });
  expect(audit.json()).toContainEqual(expect.objectContaining({
    type: 'ACCESS_DENIED',
    meta: expect.stringContaining('bound to different principal')
  }));
});
```

**Mutation Testing**:
- If user_id binding check is removed, tests must fail
- If session user extraction is bypassed, tests must fail

---

### Invariant 6: Launch Grants Cannot Be Transferred Between Applications

**Statement**: A launch grant token issued for Application A cannot be used to access Application B, even if both applications use the same credential.

**Enforcement Layers**:

1. **Grant Binding**
   - Grant tokens are bound to specific application_id at creation
   - Binding is stored in database

2. **Consumption Check**
   - Consumption validates that grant application matches request
   - Check happens before any decryption

3. **Broker Validation**
   - Broker validates application context
   - Domain validation ensures correct target

**Testing**:
```typescript
// Test grant application binding
it('should prevent grant use with different application', async () => {
  const user = await loginAs('user@test.com');
  
  // Create a grant for Application A
  const createResponse = await app.inject({
    method: 'POST',
    url: '/credentials/123/launch',
    cookies: { kr_access: user.cookies },
    payload: { applicationId: 'app-a' }
  });
  const { token } = createResponse.json();
  
  // Try to consume with Application B
  const consumeResponse = await app.inject({
    method: 'POST',
    url: '/launch/consume',
    cookies: { kr_access: user.cookies },
    payload: { token, kind: 'web-inject', applicationId: 'app-b' }
  });
  
  // Should be denied
  expect([403, 404]).toContain(consumeResponse.statusCode);
});
```

---

### Invariant 7: Credentials Cannot Be Used Against Unauthorized Domains

**Statement**: A credential can only be used against explicitly authorized domains. The system prevents credential use against any domain not in the allowlist.

**Enforcement Layers**:

1. **Application Configuration**
   - Each application has explicit domain configuration
   - Domains are validated on application creation

2. **Grant Creation**
   - Grant is bound to application's domain
   - Domain is stored in grant record

3. **Extension Validation**
   - Extension validates current tab domain against grant domain
   - Strict hostname matching (not string endsWith)

4. **Broker Validation**
   - Broker validates domain before credential use
   - Domain must exactly match or be subdomain of configured domain

**Testing**:
```typescript
// Test domain validation in extension
it('should prevent injection on unauthorized domain', async () => {
  // Setup: Grant for ebay.com.au
  const grant = { domain: 'ebay.com.au', token: 'test-token' };
  
  // Simulate extension receiving grant
  pendingGrant = grant;
  
  // Try to inject on notebay.com.au (should fail)
  const result1 = await simulateLaunchClick('https://notebay.com.au');
  expect(result1.ok).toBe(false);
  expect(result1.error).toContain('Blocked');
  
  // Try to inject on evil-ebay.com.au (should fail)
  const result2 = await simulateLaunchClick('https://evil-ebay.com.au');
  expect(result2.ok).toBe(false);
  
  // Try to inject on ebay.com.au.attacker.com (should fail)
  const result3 = await simulateLaunchClick('https://ebay.com.au.attacker.com');
  expect(result3.ok).toBe(false);
  
  // Should succeed on ebay.com.au
  const result4 = await simulateLaunchClick('https://www.ebay.com.au');
  expect(result4.ok).toBe(true);
});

// Test domain validation in backend
it('should validate domain in broker', async () => {
  const user = await loginAs('user@test.com');
  
  // Create grant for ebay.com.au
  const createResponse = await app.inject({
    method: 'POST',
    url: '/credentials/123/launch',
    cookies: { kr_access: user.cookies },
    payload: { applicationId: 'ebay-app' } // domain: ebay.com.au
  });
  const { token } = createResponse.json();
  
  // Try to consume with wrong domain
  const consumeResponse = await app.inject({
    method: 'POST',
    url: '/launch/consume',
    cookies: { kr_access: user.cookies },
    payload: { token, kind: 'web-inject', observedDomain: 'evil.com' }
  });
  
  expect([403, 404]).toContain(consumeResponse.statusCode);
});
```

---

### Invariant 8: Expired Access Automatically Expires

**Statement**: When a JIT access window, launch grant, or session expires, the associated access is automatically revoked and cannot be used.

**Enforcement Layers**:

1. **JIT Windows**
   - Access requests have expires_at timestamp
   - Launch checks for active JIT window
   - Janitor process cleans up expired requests

2. **Launch Grants**
   - Grants have 30-second TTL
   - Consumption checks expiration time
   - Janitor process cleans up expired grants

3. **Sessions**
   - Sessions have configurable TTL
   - Session check on each use
   - Janitor process cleans up expired sessions

4. **Break-Glass**
   - Reveal windows have 30-second TTL
   - Token stored in Redis with TTL
   - Automatic expiration

**Testing**:
```typescript
// Test JIT window expiration
it('should prevent launch after JIT window expires', async () => {
  const user = await loginAs('user@test.com');
  
  // Request JIT access with 1 hour window
  await app.inject({
    method: 'POST',
    url: '/credentials/123/request-access',
    cookies: { kr_access: user.cookies },
    payload: { reason: 'Test access', hours: 1, ticket: 'TEST-123' }
  });
  
  // Admin approves
  const admin = await loginAs('admin@test.com');
  await app.inject({
    method: 'POST',
    url: '/access-requests/1/approve',
    cookies: { kr_access: admin.cookies }
  });
  
  // User can launch
  const launchResponse1 = await app.inject({
    method: 'POST',
    url: '/credentials/123/launch',
    cookies: { kr_access: user.cookies },
    payload: { applicationId: '456' }
  });
  expect(launchResponse1.statusCode).toBe(200);
  
  // Wait for expiration (simulate)
  await fastForwardTime(61 * 60 * 1000); // 61 minutes
  
  // User cannot launch
  const launchResponse2 = await app.inject({
    method: 'POST',
    url: '/credentials/123/launch',
    cookies: { kr_access: user.cookies },
    payload: { applicationId: '456' }
  });
  expect(launchResponse2.statusCode).toBe(403);
  expect(launchResponse2.json().error).toContain('JIT');
});

// Test grant expiration
it('should prevent grant consumption after expiration', async () => {
  const user = await loginAs('user@test.com');
  
  // Create a grant
  const createResponse = await app.inject({
    method: 'POST',
    url: '/credentials/123/launch',
    cookies: { kr_access: user.cookies },
    payload: { applicationId: '456' }
  });
  const { token } = createResponse.json();
  
  // Wait for expiration (31 seconds)
  await fastForwardTime(31 * 1000);
  
  // Try to consume
  const consumeResponse = await app.inject({
    method: 'POST',
    url: '/launch/consume',
    cookies: { kr_access: user.cookies },
    payload: { token, kind: 'web-inject' }
  });
  
  expect(consumeResponse.statusCode).toBe(410); // Gone
  expect(consumeResponse.json().error).toBe('GRANT_EXPIRED');
});
```

---

### Invariant 9: Secrets Never Appear in Logs

**Statement**: No secret (password, API key, token, etc.) ever appears in any log file, audit trail, or telemetry, even by accident.

**Enforcement Layers**:

1. **Global Redaction**
   - All log messages pass through redaction function
   - Pattern-based secret detection and removal

2. **Audit Meta Redaction**
   - Audit event meta fields are redacted before storage
   - Redaction happens in audit() function

3. **Structured Logging**
   - Sensitive fields are excluded from log output
   - Never log raw request/response bodies

4. **Error Handling**
   - Error messages are sanitized
   - Stack traces are sanitized in production

**Testing**:
```typescript
// Test log redaction
it('should redact secrets from log messages', () => {
  const message = 'User login with password=SuperSecret123! and token=abc123';
  const redacted = redact(message);
  
  expect(redacted).not.toContain('SuperSecret123!');
  expect(redacted).not.toContain('abc123');
  expect(redacted).toContain('password=[REDACTED]');
  expect(redacted).toContain('token=[REDACTED]');
});

// Test audit meta redaction
it('should redact secrets from audit meta', async () => {
  const user = await loginAs('user@test.com');
  
  // Perform operation with secret in meta (should be redacted)
  await app.inject({
    method: 'POST',
    url: '/credentials/123/launch',
    cookies: { kr_access: user.cookies },
    payload: { applicationId: '456', note: 'password=secret123' }
  });
  
  // Check audit log
  const audit = await app.inject({
    method: 'GET',
    url: '/audit-events',
    cookies: { kr_access: user.cookies }
  });
  
  const events = audit.json();
  for (const event of events) {
    expect(event.meta).not.toContain('secret123');
    expect(event.meta).not.toMatch(/password=[^REDACTED]/);
  }
});
```

**Mutation Testing**:
- If redaction is disabled, tests must fail
- If new secret pattern is added without redaction, tests must fail
- If audit meta bypasses redaction, tests must fail

---

### Invariant 10: Secrets Never Appear in Normal API Responses

**Statement**: No API endpoint returns plaintext secrets in its response, under any circumstances, for any user role.

**Enforcement Layers**:

1. **DTO Usage**
   - All responses use DTOs (Data Transfer Objects)
   - DTOs explicitly define returned fields
   - Sensitive fields are excluded from DTOs

2. **No Direct Serialization**
   - Database entities are never serialized directly
   - Always transform to DTO before returning

3. **Response Validation**
   - Automated tests scan all API responses for secret patterns
   - CI pipeline includes response validation

4. **Field Selection**
   - Database queries explicitly select non-sensitive fields
   - Ciphertext fields are never selected for normal responses

**Testing**:
```typescript
// Test credential list response
it('should not include secrets in credential list', async () => {
  const user = await loginAs('user@test.com');
  
  const response = await app.inject({
    method: 'GET',
    url: '/credentials',
    cookies: { kr_access: user.cookies }
  });
  
  const credentials = response.json();
  
  // Check no credential has secret fields
  for (const cred of credentials) {
    expect(cred).not.toHaveProperty('secret');
    expect(cred).not.toHaveProperty('password');
    expect(cred).not.toHaveProperty('secret_ciphertext');
    expect(cred).not.toHaveProperty('username_encrypted');
    
    // Check no plaintext patterns
    const json = JSON.stringify(cred);
    expect(json).not.toMatch(/password\s*[:=]/i);
    expect(json).not.toMatch(/secret\s*[:=]/i);
  }
});

// Test credential detail response
it('should not include secrets in credential detail', async () => {
  const user = await loginAs('user@test.com');
  
  const response = await app.inject({
    method: 'GET',
    url: '/credentials/123',
    cookies: { kr_access: user.cookies }
  });
  
  const cred = response.json();
  
  expect(cred).not.toHaveProperty('secret');
  expect(cred).not.toHaveProperty('password');
  expect(cred).not.toHaveProperty('secret_ciphertext');
});

// Automated response scanner
function scanResponseForSecrets(response: any): string[] {
  const issues: string[] = [];
  const json = JSON.stringify(response);
  
  const secretPatterns = [
    /password\s*[:=]\s*["']?[^"'\s,}{]+/i,
    /secret\s*[:=]\s*["']?[^"'\s,}{]+/i,
    /token\s*[:=]\s*["']?[A-Za-z0-9\-_]+/i,
    /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9\-_]+/i,
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  ];
  
  for (const pattern of secretPatterns) {
    if (pattern.test(json)) {
      issues.push(`Pattern matched: ${pattern.source}`);
    }
  }
  
  return issues;
}

// Run against all endpoints
it('should scan all API endpoints for secrets', async () => {
  const endpoints = [
    '/credentials',
    '/credentials/123',
    '/applications',
    '/applications/123',
    '/sessions',
    '/sessions/123',
    '/audit-events',
    '/me',
  ];
  
  const user = await loginAs('user@test.com');
  
  for (const endpoint of endpoints) {
    const response = await app.inject({
      method: 'GET',
      url: endpoint,
      cookies: { kr_access: user.cookies }
    });
    
    const issues = scanResponseForSecrets(response.json());
    expect(issues).toHaveLength(0);
  }
});
```

---

## Invariant Testing Strategy

### Test Categories

1. **Unit Tests**: Test individual functions that enforce invariants
2. **Integration Tests**: Test invariant enforcement across service boundaries
3. **API Tests**: Test invariant enforcement at API layer
4. **End-to-End Tests**: Test invariant enforcement in complete workflows
5. **Adversarial Tests**: Test invariant enforcement against malicious inputs
6. **Mutation Tests**: Test that removing invariant checks causes test failures

### Test Automation

- All invariant tests run in CI pipeline
- Tests run against live database (with test data)
- Tests run against live services (where applicable)
- Mutation tests run as part of code review

### Test Coverage

| Invariant | Unit Tests | Integration Tests | API Tests | E2E Tests | Adversarial Tests |
|-----------|------------|-------------------|-----------|-----------|-------------------|
| 1. No plaintext retrieval | ✓ | ✓ | ✓ | ✓ | ✓ |
| 2. Use ≠ Reveal | ✓ | ✓ | ✓ | ✓ | ✓ |
| 3. Tenant isolation | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4. No grant replay | ✓ | ✓ | ✓ | ✓ | ✓ |
| 5. No grant transfer (user) | ✓ | ✓ | ✓ | ✓ | ✓ |
| 6. No grant transfer (app) | ✓ | ✓ | ✓ | ✓ | ✓ |
| 7. Domain validation | ✓ | ✓ | ✓ | ✓ | ✓ |
| 8. Expiration | ✓ | ✓ | ✓ | ✓ | ✓ |
| 9. No secrets in logs | ✓ | ✓ | ✓ | - | ✓ |
| 10. No secrets in API | ✓ | ✓ | ✓ | - | ✓ |

---

## Invariant Maintenance

### Adding New Invariants

When adding a new security invariant:

1. **Define**: Clearly state the invariant
2. **Enforce**: Implement enforcement in multiple layers
3. **Test**: Create comprehensive tests
4. **Document**: Add to this document
5. **Review**: Security team review
6. **Monitor**: Set up monitoring/alerting

### Modifying Invariants

Modifying an existing invariant requires:

1. **Justification**: Clear business justification
2. **Impact Analysis**: Analysis of security impact
3. **Alternatives**: Consideration of alternatives
4. **Approval**: Security team approval
5. **Documentation**: Update this document
6. **Communication**: Notify all stakeholders

### Invariant Violations

If an invariant violation is discovered:

1. **Immediate Action**: Fix the violation
2. **Investigation**: Determine root cause
3. **Impact Assessment**: Assess potential impact
4. **Remediation**: Implement additional controls
5. **Disclosure**: Disclose to affected parties if necessary
6. **Post-Mortem**: Conduct post-mortem analysis

---

## Summary

The security invariants defined in this document are the foundation of Keyrail PAM Cloud's security. They represent the non-negotiable properties that must always hold. Each invariant is enforced through multiple layers of controls and is thoroughly tested to prevent regressions.

**Remember**: If any of these invariants can be violated, the system is not secure, regardless of other features or controls.

---

## Related Documentation

- [Trust Boundaries](./trust-boundaries.md)
- [Secret Lifecycle](./secret-lifecycle.md)
- [Security Testing](./security-testing.md)
- [Threat Model](../THREAT-MODEL.md)
- [Architecture Overview](../architecture/overview.md)
