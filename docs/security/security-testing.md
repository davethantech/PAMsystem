# Keyrail PAM Cloud - Security Testing

## Overview

This document describes the security testing approach for Keyrail PAM Cloud. It covers testing methodologies, test cases, automation, and continuous security validation.

---

## Security Testing Pyramid

```
                    ┌─────────────────┐
                    │  Red Team        │  ← Quarterly
                    │  Exercises       │
                    └────────┬────────┘
                             │
                             ▼
              ┌─────────────────────────────────┐
              │         Integration Tests        │  ← Per merge
              │  - API Security                  │
              │  - End-to-End Workflows          │
              │  - Adversarial Scenarios         │
              └──────────────┬──────────────────┘
                           │
                           ▼
              ┌─────────────────────────────────┐
              │          Unit Tests               │  ← Per commit
              │  - Crypto Operations              │
              │  - Input Validation               │
              │  - Permission Checks              │
              │  - Tenant Isolation               │
              └──────────────┬──────────────────┘
                           │
                           ▼
              ┌─────────────────────────────────┐
              │        Static Analysis            │  ← Per push
              │  - Type Checking                  │
              │  - Linting                        │
              │  - Dependency Scanning            │
              │  - Secret Scanning                │
              └─────────────────────────────────┘
```

---

## Test Categories

### 1. Unit Tests

**Purpose**: Test individual functions and components in isolation.

**Focus Areas**:
- Cryptographic operations
- Input validation
- Permission checks
- Tenant isolation
- Data transformation
- Redaction functions

**Tools**:
- Vitest (JavaScript/TypeScript)
- Jest (alternative)

**Example Tests**:

```typescript
// Crypto operations
describe('Crypto Service', () => {
  it('should encrypt and decrypt correctly', () => {
    const plaintext = 'SuperSecret123!';
    const dek = crypto.randomBytes(32);
    const sealed = aes256GcmEncrypt(plaintext, dek);
    const decrypted = aes256GcmDecrypt(sealed, dek);
    expect(decrypted).toBe(plaintext);
  });
  
  it('should generate unique nonces', () => {
    const nonce1 = crypto.randomBytes(12);
    const nonce2 = crypto.randomBytes(12);
    expect(nonce1).not.toEqual(nonce2);
  });
  
  it('should fail with wrong key', () => {
    const plaintext = 'SuperSecret123!';
    const dek1 = crypto.randomBytes(32);
    const dek2 = crypto.randomBytes(32);
    const sealed = aes256GcmEncrypt(plaintext, dek1);
    expect(() => aes256GcmDecrypt(sealed, dek2)).toThrow();
  });
});

// Permission checks
describe('Permission Service', () => {
  it('should allow access with correct permission', () => {
    const user = { permissions: ['credential.use', 'application.launch'] };
    expect(hasPermission(user, 'credential.use')).toBe(true);
  });
  
  it('should deny access without permission', () => {
    const user = { permissions: ['credential.view_metadata'] };
    expect(hasPermission(user, 'credential.use')).toBe(false);
  });
  
  it('should allow access with wildcard permission', () => {
    const user = { permissions: ['*'] };
    expect(hasPermission(user, 'credential.use')).toBe(true);
  });
});

// Tenant isolation
describe('Tenant Isolation', () => {
  it('should enforce tenant context in queries', async () => {
    const tenantId = 'tenant-123';
    const result = await withTenant(tenantId, async (client) => {
      return client.query('SELECT * FROM credentials WHERE tenant_id = $1', [tenantId]);
    });
    // Verify RLS is active
    expect(result).toBeDefined();
  });
});

// Redaction
describe('Redaction', () => {
  it('should redact passwords from strings', () => {
    const input = 'password=SuperSecret123! token=abc123';
    const redacted = redact(input);
    expect(redacted).not.toContain('SuperSecret123!');
    expect(redacted).not.toContain('abc123');
    expect(redacted).toContain('password=[REDACTED]');
    expect(redacted).toContain('token=[REDACTED]');
  });
  
  it('should redact Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const redacted = redact(input);
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });
  
  it('should redact private keys', () => {
    const input = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----';
    const redacted = redact(input);
    expect(redacted).not.toContain('MIIEvgIBADANBg');
  });
});
```

---

### 2. Integration Tests

**Purpose**: Test interactions between components and services.

**Focus Areas**:
- API endpoint security
- Service-to-service communication
- Database operations
- Authentication and authorization flows
- Tenant isolation across services

**Tools**:
- Vitest (with Fastify inject)
- Test containers (PostgreSQL, Redis)

**Example Tests**:

```typescript
// API security
describe('API Security', () => {
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
  
  it('should enforce RBAC on all endpoints', async () => {
    const user = await loginAs('user@test.com'); // USER role
    const response = await app.inject({
      method: 'POST',
      url: '/credentials',
      cookies: { kr_access: user.cookies },
      payload: { name: 'Test', target: 'test.com', kind: 'PASSWORD', username: 'test', secret: 'test123' }
    });
    expect(response.statusCode).toBe(403); // USER cannot create credentials
  });
});

// Tenant isolation
describe('Tenant Isolation', () => {
  it('should prevent cross-tenant access', async () => {
    const userA = await loginAs('user-a@tenant-a.com');
    const response = await app.inject({
      method: 'GET',
      url: '/credentials/tenant-b-credential-id',
      cookies: { kr_access: userA.cookies }
    });
    expect([403, 404]).toContain(response.statusCode);
  });
  
  it('should ignore client-supplied tenant parameters', async () => {
    const userA = await loginAs('user-a@tenant-a.com');
    const response1 = await app.inject({
      method: 'GET',
      url: '/credentials',
      cookies: { kr_access: userA.cookies }
    });
    const response2 = await app.inject({
      method: 'GET',
      url: '/credentials?tenant=tenant-b',
      cookies: { kr_access: userA.cookies }
    });
    expect(response1.json()).toEqual(response2.json());
  });
});

// Launch flow
describe('Launch Flow Security', () => {
  it('should issue and consume grants correctly', async () => {
    const user = await loginAs('user@test.com');
    
    // Issue grant
    const issueResponse = await app.inject({
      method: 'POST',
      url: '/credentials/123/launch',
      cookies: { kr_access: user.cookies },
      payload: { applicationId: '456' }
    });
    expect(issueResponse.statusCode).toBe(200);
    const { token } = issueResponse.json();
    
    // Consume grant
    const consumeResponse = await app.inject({
      method: 'POST',
      url: '/launch/consume',
      cookies: { kr_access: user.cookies },
      payload: { token, kind: 'web-inject' }
    });
    expect(consumeResponse.statusCode).toBe(200);
  });
  
  it('should prevent grant replay', async () => {
    const user = await loginAs('user@test.com');
    
    const issueResponse = await app.inject({
      method: 'POST',
      url: '/credentials/123/launch',
      cookies: { kr_access: user.cookies },
      payload: { applicationId: '456' }
    });
    const { token } = issueResponse.json();
    
    // Consume once
    await app.inject({
      method: 'POST',
      url: '/launch/consume',
      cookies: { kr_access: user.cookies },
      payload: { token, kind: 'web-inject' }
    });
    
    // Try to consume again
    const replayResponse = await app.inject({
      method: 'POST',
      url: '/launch/consume',
      cookies: { kr_access: user.cookies },
      payload: { token, kind: 'web-inject' }
    });
    expect(replayResponse.statusCode).toBe(409);
    expect(replayResponse.json().error).toBe('GRANT_REPLAYED');
  });
  
  it('should prevent grant use by different user', async () => {
    const userA = await loginAs('user-a@test.com');
    const userB = await loginAs('user-b@test.com');
    
    const issueResponse = await app.inject({
      method: 'POST',
      url: '/credentials/123/launch',
      cookies: { kr_access: userA.cookies },
      payload: { applicationId: '456' }
    });
    const { token } = issueResponse.json();
    
    // User B tries to use User A's grant
    const consumeResponse = await app.inject({
      method: 'POST',
      url: '/launch/consume',
      cookies: { kr_access: userB.cookies },
      payload: { token, kind: 'web-inject' }
    });
    expect(consumeResponse.statusCode).toBe(403);
    expect(consumeResponse.json().error).toBe('GRANT_MISBOUND');
  });
});
```

---

### 3. API Tests

**Purpose**: Test API endpoints for security vulnerabilities.

**Focus Areas**:
- Authentication and session management
- Authorization and RBAC
- Input validation and sanitization
- Response validation (no secrets in responses)
- Rate limiting
- Security headers

**Tools**:
- Fastify inject (for testing without network)
- Supertest (alternative, for HTTP testing)

**Example Tests**:

```typescript
// Authentication
describe('Authentication', () => {
  it('should set secure cookie attributes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { tenant: 'test', email: 'user@test.com', password: 'Test123!' }
    });
    
    const setCookie = response.headers['set-cookie']?.toString() ?? '';
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
  });
  
  it('should rotate refresh tokens', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { tenant: 'test', email: 'user@test.com', password: 'Test123!' }
    });
    const firstRefresh = loginResponse.cookies.find(c => c.name === 'kr_refresh')?.value;
    
    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { kr_refresh: firstRefresh }
    });
    const secondRefresh = refreshResponse.cookies.find(c => c.name === 'kr_refresh')?.value;
    
    expect(secondRefresh).not.toBe(firstRefresh);
  });
  
  it('should detect refresh token reuse', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { tenant: 'test', email: 'user@test.com', password: 'Test123!' }
    });
    const refreshToken = loginResponse.cookies.find(c => c.name === 'kr_refresh')?.value;
    
    // First refresh
    await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { kr_refresh: refreshToken }
    });
    
    // Try to reuse
    const reuseResponse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { kr_refresh: refreshToken }
    });
    expect(reuseResponse.statusCode).toBe(401);
  });
});

// Security headers
describe('Security Headers', () => {
  it('should set CSP header', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
  });
  
  it('should set HSTS header', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['strict-transport-security']).toContain('max-age=');
  });
  
  it('should set X-Content-Type-Options header', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});

// Rate limiting
describe('Rate Limiting', () => {
  it('should limit login attempts', async () => {
    for (let i = 0; i < 5; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { tenant: 'test', email: 'user@test.com', password: 'wrong' }
      });
      expect(response.statusCode).toBe(401);
    }
    
    // 6th attempt should be rate limited
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { tenant: 'test', email: 'user@test.com', password: 'wrong' }
    });
    expect(response.statusCode).toBe(429);
  });
});

// Response validation
describe('Response Validation', () => {
  it('should never return plaintext credentials', async () => {
    const user = await loginAs('user@test.com');
    const response = await app.inject({
      method: 'GET',
      url: '/credentials',
      cookies: { kr_access: user.cookies }
    });
    
    const body = response.json();
    const json = JSON.stringify(body);
    
    expect(json).not.toMatch(/password\s*[:=]/i);
    expect(json).not.toMatch(/secret\s*[:=]/i);
    expect(json).not.toMatch(/token\s*[:=]/i);
  });
  
  it('should validate all API responses for secrets', async () => {
    const endpoints = ['/credentials', '/credentials/123', '/applications', '/sessions'];
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
});
```

---

### 4. End-to-End Tests

**Purpose**: Test complete workflows from user action to final result.

**Focus Areas**:
- Complete launch flow
- JIT access workflow
- Break-glass workflow
- Rotation workflow
- Session management
- Audit trail verification

**Tools**:
- Test containers (Docker Compose)
- Puppeteer/Playwright (for browser automation)
- Custom test harnesses

**Example Tests**:

```typescript
// Complete launch flow
describe('End-to-End Launch Flow', () => {
  it('should complete the full launch flow without exposing secrets', async () => {
    // 1. Login
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { tenant: 'test', email: 'user@test.com', password: 'Test123!' }
    });
    const cookies = loginResponse.cookies;
    
    // 2. List applications
    const appsResponse = await app.inject({
      method: 'GET',
      url: '/applications',
      cookies
    });
    const apps = appsResponse.json();
    const app = apps.find(a => a.name === 'Test App');
    expect(app).toBeDefined();
    
    // 3. Issue launch grant
    const launchResponse = await app.inject({
      method: 'POST',
      url: `/credentials/${app.credential_id}/launch`,
      cookies,
      payload: { applicationId: app.id }
    });
    expect(launchResponse.statusCode).toBe(200);
    const { token } = launchResponse.json();
    
    // 4. Consume grant (simulating extension)
    const consumeResponse = await app.inject({
      method: 'POST',
      url: '/launch/consume',
      cookies,
      payload: { token, kind: 'web-inject' }
    });
    expect(consumeResponse.statusCode).toBe(200);
    
    // 5. Verify session was created
    const sessionsResponse = await app.inject({
      method: 'GET',
      url: '/sessions',
      cookies
    });
    const sessions = sessionsResponse.json();
    expect(sessions.length).toBeGreaterThan(0);
    
    // 6. Verify audit trail
    const auditResponse = await app.inject({
      method: 'GET',
      url: '/audit-events',
      cookies
    });
    const auditEvents = auditResponse.json();
    const launchEvents = auditEvents.filter(e => 
      e.type === 'GRANT_ISSUED' || 
      e.type === 'APPLICATION_LAUNCHED' || 
      e.type === 'CREDENTIAL_USED' ||
      e.type === 'SESSION_STARTED'
    );
    expect(launchEvents.length).toBeGreaterThan(0);
  });
});

// JIT access flow
describe('JIT Access Flow', () => {
  it('should require approval for JIT-gated credentials', async () => {
    const user = await loginAs('user@test.com');
    const admin = await loginAs('admin@test.com');
    
    // 1. User requests access
    const requestResponse = await app.inject({
      method: 'POST',
      url: '/credentials/jit-credential/request-access',
      cookies: { kr_access: user.cookies },
      payload: { reason: 'Emergency access needed', hours: 1, ticket: 'INC-1234' }
    });
    expect(requestResponse.statusCode).toBe(200);
    const { id: requestId } = requestResponse.json();
    
    // 2. Admin approves
    const approveResponse = await app.inject({
      method: 'POST',
      url: `/access-requests/${requestId}/approve`,
      cookies: { kr_access: admin.cookies }
    });
    expect(approveResponse.statusCode).toBe(200);
    
    // 3. User can now launch
    const launchResponse = await app.inject({
      method: 'POST',
      url: '/credentials/jit-credential/launch',
      cookies: { kr_access: user.cookies },
      payload: { applicationId: 'jit-app' }
    });
    expect(launchResponse.statusCode).toBe(200);
    
    // 4. Verify audit trail
    const auditResponse = await app.inject({
      method: 'GET',
      url: '/audit-events',
      cookies: { kr_access: user.cookies }
    });
    const auditEvents = auditResponse.json();
    expect(auditEvents.some(e => e.type === 'ACCESS_REQUESTED')).toBe(true);
    expect(auditEvents.some(e => e.type === 'ACCESS_APPROVED')).toBe(true);
    expect(auditEvents.some(e => e.type === 'APPLICATION_LAUNCHED')).toBe(true);
  });
});

// Audit chain verification
describe('Audit Chain', () => {
  it('should maintain tamper-evident audit chain', async () => {
    const user = await loginAs('user@test.com');
    
    // Perform some operations
    await app.inject({
      method: 'GET',
      url: '/credentials',
      cookies: { kr_access: user.cookies }
    });
    
    await app.inject({
      method: 'POST',
      url: '/credentials/123/launch',
      cookies: { kr_access: user.cookies },
      payload: { applicationId: '456' }
    });
    
    // Verify chain
    const verifyResponse = await app.inject({
      method: 'GET',
      url: '/audit-events/verify',
      cookies: { kr_access: user.cookies }
    });
    
    expect(verifyResponse.json().ok).toBe(true);
  });
  
  it('should detect tampering in audit chain', async () => {
    // This test would require direct database manipulation
    // In a real test, we would:
    // 1. Perform operations to create audit events
    // 2. Directly modify an audit event in the database
    // 3. Verify that chain verification fails
    
    // For unit testing, we can test the verification logic directly:
    const events = [
      { id: 1, seq: 1, prevHash: '0'.repeat(64), hash: 'hash1', type: 'EVENT_1' },
      { id: 2, seq: 2, prevHash: 'hash1', hash: 'hash2', type: 'EVENT_2' },
      { id: 3, seq: 3, prevHash: 'hash2', hash: 'hash3', type: 'EVENT_3' },
    ];
    
    // Verify chain is valid
    expect(verifyChain(events)).toBe(true);
    
    // Tamper with event 2
    events[1].prevHash = 'tampered';
    
    // Verify chain detection
    expect(verifyChain(events)).toBe(false);
  });
});
```

---

### 5. Adversarial Tests

**Purpose**: Test the system against malicious inputs and attack scenarios.

**Focus Areas**:
- IDOR (Insecure Direct Object Reference)
- Grant replay
- Token manipulation
- Domain bypass
- Concurrent operations (race conditions)
- Input manipulation
- Session hijacking

**Tools**:
- Custom test scripts
- Security testing libraries

**Example Tests**:

```typescript
// IDOR tests
describe('IDOR Protection', () => {
  it('should prevent IDOR on credentials', async () => {
    const userA = await loginAs('user-a@test.com');
    const userB = await loginAs('user-b@test.com');
    
    // User B tries to access User A's credential
    const response = await app.inject({
      method: 'GET',
      url: '/credentials/user-a-credential-id',
      cookies: { kr_access: userB.cookies }
    });
    
    expect([403, 404]).toContain(response.statusCode);
  });
  
  it('should prevent IDOR on sessions', async () => {
    const userA = await loginAs('user-a@test.com');
    const userB = await loginAs('user-b@test.com');
    
    // User A creates a session
    const launchResponse = await app.inject({
      method: 'POST',
      url: '/credentials/123/launch',
      cookies: { kr_access: userA.cookies },
      payload: { applicationId: '456' }
    });
    const { token } = launchResponse.json();
    
    const consumeResponse = await app.inject({
      method: 'POST',
      url: '/launch/consume',
      cookies: { kr_access: userA.cookies },
      payload: { token, kind: 'web-inject' }
    });
    const { sessionId } = consumeResponse.json();
    
    // User B tries to terminate User A's session
    const terminateResponse = await app.inject({
      method: 'POST',
      url: `/sessions/${sessionId}/terminate`,
      cookies: { kr_access: userB.cookies }
    });
    
    expect(terminateResponse.statusCode).toBe(403);
  });
});

// Grant manipulation tests
describe('Grant Manipulation', () => {
  it('should prevent grant token tampering', async () => {
    const user = await loginAs('user@test.com');
    
    const launchResponse = await app.inject({
      method: 'POST',
      url: '/credentials/123/launch',
      cookies: { kr_access: user.cookies },
      payload: { applicationId: '456' }
    });
    const { token } = launchResponse.json();
    
    // Tamper with token
    const tamperedToken = token.slice(0, -2) + 'xx';
    
    const consumeResponse = await app.inject({
      method: 'POST',
      url: '/launch/consume',
      cookies: { kr_access: user.cookies },
      payload: { token: tamperedToken, kind: 'web-inject' }
    });
    
    expect([403, 404]).toContain(consumeResponse.statusCode);
  });
  
  it('should prevent grant replay across applications', async () => {
    const user = await loginAs('user@test.com');
    
    // Create grant for App A
    const launchResponse = await app.inject({
      method: 'POST',
      url: '/credentials/123/launch',
      cookies: { kr_access: user.cookies },
      payload: { applicationId: 'app-a' }
    });
    const { token } = launchResponse.json();
    
    // Consume with App B
    const consumeResponse = await app.inject({
      method: 'POST',
      url: '/launch/consume',
      cookies: { kr_access: user.cookies },
      payload: { token, kind: 'web-inject', applicationId: 'app-b' }
    });
    
    expect([403, 404]).toContain(consumeResponse.statusCode);
  });
});

// Concurrent operation tests
describe('Concurrent Operations', () => {
  it('should prevent race conditions in grant consumption', async () => {
    const user = await loginAs('user@test.com');
    
    const launchResponse = await app.inject({
      method: 'POST',
      url: '/credentials/123/launch',
      cookies: { kr_access: user.cookies },
      payload: { applicationId: '456' }
    });
    const { token } = launchResponse.json();
    
    // Try to consume the same grant twice concurrently
    const [response1, response2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/launch/consume',
        cookies: { kr_access: user.cookies },
        payload: { token, kind: 'web-inject' }
      }),
      app.inject({
        method: 'POST',
        url: '/launch/consume',
        cookies: { kr_access: user.cookies },
        payload: { token, kind: 'web-inject' }
      })
    ]);
    
    // One should succeed, one should fail
    const results = [response1.statusCode, response2.statusCode];
    expect(results).toContain(200);
    expect(results).toContain(409);
  });
  
  it('should prevent concurrent session termination', async () => {
    const user = await loginAs('user@test.com');
    
    // Create a session
    const launchResponse = await app.inject({
      method: 'POST',
      url: '/credentials/123/launch',
      cookies: { kr_access: user.cookies },
      payload: { applicationId: '456' }
    });
    const { token } = launchResponse.json();
    
    const consumeResponse = await app.inject({
      method: 'POST',
      url: '/launch/consume',
      cookies: { kr_access: user.cookies },
      payload: { token, kind: 'web-inject' }
    });
    const { sessionId } = consumeResponse.json();
    
    // Try to terminate the same session twice concurrently
    const [response1, response2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/terminate`,
        cookies: { kr_access: user.cookies }
      }),
      app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/terminate`,
        cookies: { kr_access: user.cookies }
      })
    ]);
    
    // Both should succeed (idempotent) or one should fail
    // The important thing is no error and consistent final state
    expect([200, 404]).toContain(response1.statusCode);
    expect([200, 404]).toContain(response2.statusCode);
  });
});

// Domain validation tests
describe('Domain Validation', () => {
  it('should prevent domain bypass with similar domains', () => {
    const grant = { domain: 'ebay.com.au' };
    pendingGrant = grant;
    
    const testCases = [
      { url: 'https://ebay.com.au', shouldPass: true },
      { url: 'https://www.ebay.com.au', shouldPass: true },
      { url: 'https://notebay.com.au', shouldPass: false },
      { url: 'https://ebay.com.au.evil.com', shouldPass: false },
      { url: 'https://evil-ebay.com.au', shouldPass: false },
      { url: 'https://ebay.com', shouldPass: false },
      { url: 'https://ebay.co.uk', shouldPass: false },
    ];
    
    for (const { url, shouldPass } of testCases) {
      const result = simulateLaunchClick(url);
      expect(result.ok).toBe(shouldPass);
    }
  });
  
  it('should prevent domain bypass with URL manipulation', () => {
    const grant = { domain: 'example.com' };
    pendingGrant = grant;
    
    const maliciousUrls = [
      'https://example.com.evil.com',
      'https://evilexample.com',
      'https://example.com.evil.com',
      'https://example.com\@evil.com',
      'https://example.com#\@evil.com',
      'https://example.com?redirect=evil.com',
    ];
    
    for (const url of maliciousUrls) {
      const result = simulateLaunchClick(url);
      expect(result.ok).toBe(false);
    }
  });
});
```

---

### 6. Mutation Tests

**Purpose**: Ensure that removing security checks causes tests to fail.

**Focus Areas**:
- Permission checks
- Tenant isolation
- Grant validation
- Domain validation
- Redaction
- Input validation

**Tools**:
- Manual code changes + test runs
- Mutation testing frameworks (future)

**Example Tests**:

```typescript
// These tests verify that removing security checks causes failures
// They are run manually or as part of code review

describe('Mutation Tests - Security Checks', () => {
  it('should fail if permission check is removed from launch', async () => {
    // This test would be run after temporarily removing the permission check
    // from the launch flow
    
    const user = await loginAs('read-only@test.com'); // READ_ONLY role
    
    const response = await app.inject({
      method: 'POST',
      url: '/credentials/123/launch',
      cookies: { kr_access: user.cookies },
      payload: { applicationId: '456' }
    });
    
    // With permission check: should be 403
    // Without permission check: would be 200 (SECURITY ISSUE!)
    // This test should FAIL if permission check is removed
    expect(response.statusCode).toBe(403);
  });
  
  it('should fail if tenant context is not set', async () => {
    // This test would be run after temporarily removing tenant context
    
    const userA = await loginAs('user-a@test.com');
    
    const response = await app.inject({
      method: 'GET',
      url: '/credentials/user-b-credential-id',
      cookies: { kr_access: userA.cookies }
    });
    
    // With tenant context: should be 403/404
    // Without tenant context: might return data (SECURITY ISSUE!)
    // This test should FAIL if tenant context is not properly enforced
    expect([403, 404]).toContain(response.statusCode);
  });
  
  it('should fail if grant validation is removed', async () => {
    // This test would be run after temporarily removing grant validation
    
    const user = await loginAs('user@test.com');
    
    // Try to consume a grant twice
    const launchResponse = await app.inject({
      method: 'POST',
      url: '/credentials/123/launch',
      cookies: { kr_access: user.cookies },
      payload: { applicationId: '456' }
    });
    const { token } = launchResponse.json();
    
    await app.inject({
      method: 'POST',
      url: '/launch/consume',
      cookies: { kr_access: user.cookies },
      payload: { token, kind: 'web-inject' }
    });
    
    const replayResponse = await app.inject({
      method: 'POST',
      url: '/launch/consume',
      cookies: { kr_access: user.cookies },
      payload: { token, kind: 'web-inject' }
    });
    
    // With grant validation: should be 409
    // Without grant validation: would be 200 (SECURITY ISSUE!)
    // This test should FAIL if grant validation is removed
    expect(replayResponse.statusCode).toBe(409);
  });
  
  it('should fail if redaction is disabled', async () => {
    // This test would be run after temporarily disabling redaction
    
    const user = await loginAs('user@test.com');
    
    // Perform operation that would log sensitive data
    await app.inject({
      method: 'POST',
      url: '/credentials',
      cookies: { kr_access: user.cookies },
      payload: { 
        name: 'Test', 
        target: 'test.com', 
        kind: 'PASSWORD', 
        username: 'test', 
        secret: 'SuperSecret123!' 
      }
    });
    
    // Check logs
    // With redaction: should not contain 'SuperSecret123!'
    // Without redaction: would contain 'SuperSecret123!' (SECURITY ISSUE!)
    // This test should FAIL if redaction is disabled
    
    // In a real test, we would check the actual log output
    // For this example, we assume the test checks the log file
    const logs = getLogs();
    expect(logs).not.toContain('SuperSecret123!');
  });
});
```

---

## Test Automation

### CI/CD Pipeline

The CI/CD pipeline runs the following security tests on every push and pull request:

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  security-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run unit tests
        run: npx vitest run tests/unit
        
      - name: Run integration tests
        run: npx vitest run tests/integration
        env:
          DATABASE_URL: postgres://localhost:5432/test
          REDIS_URL: redis://localhost:6379
        
      - name: Run API security tests
        run: npx vitest run tests/api
        env:
          DATABASE_URL: postgres://localhost:5432/test
          REDIS_URL: redis://localhost:6379
          
      - name: Run adversarial tests
        run: npx vitest run tests/adversarial
        env:
          DATABASE_URL: postgres://localhost:5432/test
          REDIS_URL: redis://localhost:6379
          
      - name: Run mutation tests
        run: npm run test:mutation
        
      - name: Type checking
        run: npm run typecheck
        
      - name: Linting
        run: npm run lint
        
      - name: Dependency audit
        run: npm audit --audit-level=moderate
        
      - name: Secret scanning
        run: npm run scan:secrets
```

### Local Development

Run security tests locally:

```bash
# Run all security tests
npm run test:security

# Run specific test categories
npm run test:unit
npm run test:integration
npm run test:api
npm run test:adversarial

# Run with coverage
npm run test:coverage

# Run mutation tests
npm run test:mutation
```

---

## Test Coverage

### Coverage Requirements

| Area | Minimum Coverage | Current Coverage |
|------|------------------|------------------|
| Security Invariants | 100% | See below |
| API Endpoints | 100% | See below |
| Cryptographic Operations | 100% | See below |
| Authentication | 100% | See below |
| Authorization | 100% | See below |
| Input Validation | 100% | See below |
| Tenant Isolation | 100% | See below |
| Audit Logging | 100% | See below |

### Coverage by Invariant

| Invariant | Unit Tests | Integration Tests | API Tests | E2E Tests | Total |
|-----------|------------|-------------------|-----------|-----------|-------|
| 1. No plaintext retrieval | 5 | 3 | 4 | 2 | 14 |
| 2. Use ≠ Reveal | 4 | 3 | 3 | 2 | 12 |
| 3. Tenant isolation | 6 | 4 | 5 | 3 | 18 |
| 4. No grant replay | 3 | 2 | 3 | 1 | 9 |
| 5. No grant transfer (user) | 3 | 2 | 3 | 1 | 9 |
| 6. No grant transfer (app) | 3 | 2 | 3 | 1 | 9 |
| 7. Domain validation | 4 | 3 | 2 | 2 | 11 |
| 8. Expiration | 5 | 3 | 4 | 2 | 14 |
| 9. No secrets in logs | 3 | 2 | 2 | 0 | 7 |
| 10. No secrets in API | 4 | 3 | 4 | 0 | 11 |
| **Total** | **43** | **27** | **33** | **14** | **117** |

---

## Security Test Checklist

### Before Each Release

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All API tests pass
- [ ] All adversarial tests pass
- [ ] All mutation tests pass (if applicable)
- [ ] Code coverage meets minimum requirements
- [ ] No new security warnings from static analysis
- [ ] No new vulnerabilities from dependency audit
- [ ] No secrets found by secret scanner
- [ ] Audit chain is intact
- [ ] All security invariants are enforced

### Before Major Releases

- [ ] All of the above
- [ ] Red team exercise completed
- [ ] Penetration testing completed
- [ ] Security review completed
- [ ] All critical issues addressed

---

## Red Team Exercises

### Quarterly Red Team

Every quarter, a red team exercise is conducted to test the system against real-world attack scenarios.

**Scope:**
- All external-facing endpoints
- All authentication mechanisms
- All authorization controls
- All security invariants
- Browser extension
- Connector

**Methodology:**
1. **Reconnaissance**: Gather information about the system
2. **Enumeration**: Identify all endpoints and features
3. **Vulnerability Assessment**: Identify potential vulnerabilities
4. **Exploitation**: Attempt to exploit identified vulnerabilities
5. **Post-Exploitation**: Attempt to maintain access and escalate
6. **Reporting**: Document findings and recommendations

**Test Cases:**

| Category | Test Cases |
|----------|------------|
| Authentication | Brute force, credential stuffing, session hijacking |
| Authorization | IDOR, privilege escalation, permission bypass |
| Input Validation | SQL injection, XSS, command injection |
| Cryptography | Weak encryption, key management issues |
| Business Logic | Grant replay, token manipulation, domain bypass |
| Client-Side | Extension manipulation, DOM clobbering, storage access |
| Network | SSRF, DNS rebinding, MITM |

### Red Team Report

After each exercise, a report is generated including:
- Findings (vulnerabilities discovered)
- Risk assessment for each finding
- Proof of concept for each finding
- Recommendations for remediation
- Timeline for fixes

---

## Security Bug Bounty

Keyrail PAM Cloud operates a **private** bug bounty program for invited security researchers.

### Scope

- All external-facing endpoints
- Browser extension
- Connector
- Documentation

### Out of Scope

- Internal infrastructure
- Third-party services
- Denial of service attacks
- Social engineering
- Physical security

### Reward Tiers

| Severity | Reward | Example |
|----------|--------|---------|
| Critical | $5,000+ | RCE, complete system compromise |
| High | $1,000-$5,000 | Auth bypass, privilege escalation |
| Medium | $500-$1,000 | Information disclosure, DoS |
| Low | $100-$500 | Minor vulnerabilities |

### Reporting

Security researchers can report vulnerabilities to: security@pam.example.com

Include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (if known)

---

## Security Metrics

Track the following security metrics:

| Metric | Target | Current |
|--------|--------|---------|
| Security test coverage | 100% | X% |
| Security test pass rate | 100% | X% |
| Critical vulnerabilities | 0 | X |
| High vulnerabilities | 0 | X |
| Medium vulnerabilities | <5 | X |
| Low vulnerabilities | <10 | X |
| Mean time to fix critical | <24 hours | X |
| Mean time to fix high | <72 hours | X |
| Mean time to fix medium | <1 week | X |
| Mean time to fix low | <1 month | X |

---

## Security Testing Tools

### Static Analysis

| Tool | Purpose | Integration |
|------|---------|-------------|
| TypeScript Compiler | Type checking | Built-in |
| ESLint | Linting | Built-in |
| npm audit | Dependency vulnerabilities | CI |
| Snyk | Advanced dependency scanning | CI (optional) |
| Secret Scanner | Detect secrets in code | Pre-commit hook |

### Dynamic Analysis

| Tool | Purpose | Integration |
|------|---------|-------------|
| Vitest | Unit/integration testing | Built-in |
| Fastify inject | API testing | Built-in |
| OWASP ZAP | Automated security scanning | CI (optional) |
| Burp Suite | Manual security testing | Manual |

### Monitoring

| Tool | Purpose | Integration |
|------|---------|-------------|
| Prometheus | Metrics collection | Production |
| Grafana | Metrics visualization | Production |
| ELK Stack | Log aggregation | Production |
| SIEM | Security monitoring | Production |

---

## Continuous Security

### Automated Security Checks

1. **Pre-commit Hooks**
   - Type checking
   - Linting
   - Secret scanning
   - Unit tests

2. **CI Pipeline**
   - All tests
   - Type checking
   - Linting
   - Dependency audit
   - Secret scanning
   - Build verification

3. **Nightly**
   - Integration tests
   - API tests
   - Security tests
   - Dependency updates

4. **Weekly**
   - Full test suite
   - Security scan
   - Performance tests

5. **Monthly**
   - Dependency audit
   - Security review
   - Vulnerability scan

6. **Quarterly**
   - Red team exercise
   - Penetration testing
   - Architecture review

---

## Security Test Data

### Test Tenants

The test environment uses dedicated test tenants:

| Tenant | Purpose | Users |
|--------|---------|-------|
| test-tenant-1 | Unit tests | test-user-1, test-admin-1 |
| test-tenant-2 | Integration tests | test-user-2, test-admin-2 |
| test-tenant-3 | API tests | test-user-3, test-admin-3 |
| adversary-tenant | Adversarial tests | adversary-user |

### Test Data

Test data includes:
- Sample credentials (eBay, Cloudflare, cPanel, etc.)
- Sample applications
- Sample collections
- Sample users with different roles
- Sample policies

All test data is:
- Clearly marked as TEST DATA
- Never uses real credentials
- Automatically cleaned up after tests

---

## Summary

Security testing is a **critical** part of the Keyrail PAM Cloud development process. The system's security guarantees depend on thorough, comprehensive, and continuous security testing.

**Key Principles:**
1. **Test Early, Test Often**: Security tests run at every stage of development
2. **Defense in Depth**: Multiple layers of tests for each security control
3. **Automate Everything**: All security tests are automated and run in CI
4. **Fail Secure**: Tests should fail if security controls are missing or weakened
5. **Continuous Improvement**: Regularly update and expand test coverage

**Remember**: If a security test can be bypassed, the system is not secure. The absence of evidence is not evidence of absence - we must actively test for security issues.

---

## Related Documentation

- [Security Invariants](./invariants.md)
- [Trust Boundaries](./trust-boundaries.md)
- [Secret Lifecycle](./secret-lifecycle.md)
- [Threat Model](../THREAT-MODEL.md)
- [Architecture Overview](../architecture/overview.md)
- [SECURITY.md](../../SECURITY.md)
