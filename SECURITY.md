# Keyrail PAM Cloud - Security Documentation

## Overview

This document provides a comprehensive overview of the security architecture, controls, and best practices for Keyrail PAM Cloud. It is intended for security teams, auditors, and administrators.

---

## Security Principles

Keyrail PAM Cloud is built on the following security principles:

### 1. Use Without View

> **Core Principle**: Users can **use** privileged credentials but cannot **view**, copy, export, or retrieve them.

This is enforced through:
- Capability-based launch with single-use grants
- Isolated-world browser injection
- Trusted execution boundary for decryption
- No API endpoints that return plaintext credentials
- Comprehensive audit logging

### 2. Defense in Depth

Multiple layers of security controls protect sensitive data:
- **Network Layer**: Firewalls, network segmentation, TLS
- **Application Layer**: Authentication, authorization, rate limiting
- **Data Layer**: Encryption at rest and in transit, RLS
- **Audit Layer**: Tamper-evident logging

### 3. Least Privilege

All operations require the minimum necessary permissions. Users, services, and systems have only the access they need to perform their functions.

### 4. Separation of Duties

Critical operations require multiple authorizations:
- Break-glass access requires dual-custody
- JIT access requires approval
- Administrative operations are logged and audited

### 5. Complete Audit Trail

All sensitive operations are recorded in a tamper-evident audit log with hash chaining.

### 6. Fail Secure

The system is designed to fail in a secure state by default. Any error or uncertainty results in denial of access.

### 7. Zero Trust

Never trust, always verify. All requests are authenticated, authorized, and validated regardless of source.

---

## Security Architecture

### Trust Boundaries

See [Trust Boundaries](./docs/security/trust-boundaries.md) for detailed trust boundary analysis.

### Security Invariants

See [Security Invariants](./docs/security/invariants.md) for the non-negotiable security properties that must always hold.

### Secret Lifecycle

See [Secret Lifecycle](./docs/security/secret-lifecycle.md) for how secrets are protected throughout their lifecycle.

---

## Authentication and Authorization

### Authentication Methods

Keyrail supports multiple authentication methods:

1. **Email/Password**
   - Argon2id password hashing
   - Minimum password complexity requirements
   - Brute-force protection with account lockout
   - Rate limiting

2. **OIDC Providers**
   - Google Workspace
   - Microsoft Entra ID (Azure AD)
   - Any OIDC-compliant identity provider

3. **SAML**
   - Enterprise SAML identity providers
   - Service Provider (SP) initiated flow
   - Identity Provider (IdP) initiated flow

4. **Multi-Factor Authentication (MFA)**
   - TOTP (Time-based One-Time Password)
   - WebAuthn / Passkeys
   - Recovery codes
   - Step-up authentication for sensitive operations

### Session Management

- **Session Tokens**: Short-lived access JWT (5 minutes)
- **Refresh Tokens**: Longer-lived refresh tokens with rotation
- **Cookie Settings**: HttpOnly, Secure, SameSite=Strict
- **Token Storage**: Never in localStorage or sessionStorage
- **Token Revocation**: Immediate revocation on logout or suspicious activity
- **Refresh Token Reuse Detection**: Detects token theft and revokes entire session family

### RBAC (Role-Based Access Control)

#### Built-in Roles

| Role | Description | Key Permissions |
|------|-------------|-----------------|
| SUPER_ADMIN | Full system access | `*` (all permissions) |
| ORG_ADMIN | Organization administrator | credential.view_metadata, credential.use, credential.create, credential.update, application.launch, session.start, session.terminate, user.create, user.disable, policy.create, policy.update, audit.view |
| PAM_ADMIN | PAM administrator | credential.view_metadata, credential.use, credential.create, credential.update, application.launch, session.start, session.terminate, user.create, policy.create, policy.update, audit.view |
| SECURITY_ADMIN | Security administrator | credential.view_metadata, credential.use, **credential.reveal**, application.launch, session.start, session.terminate, session.record.view, policy.create, policy.update, audit.view |
| AUDITOR | Read-only auditor | credential.view_metadata, session.record.view, audit.view |
| USER | Standard user | credential.view_metadata, credential.use, application.launch, session.start |
| READ_ONLY | Read-only user | credential.view_metadata |

**Critical Note**: `credential.use` and `credential.reveal` are **disjoint permissions**. Holding launch rights does NOT imply reveal rights.

#### Permission Matrix

See the [RBAC section in Architecture Overview](./docs/architecture/overview.md#security-principles) for the complete permission matrix.

---

## Data Protection

### Encryption

#### Field-Level Encryption

- **Algorithm**: AES-256-GCM (Authenticated Encryption with Associated Data)
- **Key Size**: 256 bits
- **Nonce**: 12 bytes (96 bits) - unique per encryption
- **Authentication Tag**: 16 bytes (128 bits)

#### Envelope Encryption

```
Plaintext Secret
    │
    ▼
┌─────────────────────┐
│  AES-256-GCM        │  ← DEK (Data Encryption Key)
│  Encryption         │
└─────────┬─────────┘
          │
          ▼
┌─────────────────────┐
│  Ciphertext         │
│  + Nonce            │
│  + Auth Tag         │  ← Stored in database
└─────────────────────┘
          │
          ▼
┌─────────────────────┐
│  DEK                │  ← Wrapped by KMS
└─────────┬─────────┘
          │
          ▼
┌─────────────────────┐
│  Cloud KMS/HSM      │  ← Master keys never leave hardware
│  Wrapped DEK        │
└─────────────────────┘
```

#### Key Management

- **Tenant DEK**: Each tenant has one or more Data Encryption Keys
- **Key Versioning**: Each DEK has a version number
- **Key Rotation**: DEKs can be rotated, re-encrypting all credentials
- **KMS Integration**: DEKs are wrapped by cloud KMS (AWS KMS, Azure Key Vault, Google Cloud KMS)
- **Local Development**: Ephemeral in-memory keys for development (NOT for production)

### Encrypted Data

The following data is encrypted at rest:

| Data | Encryption | Notes |
|------|------------|-------|
| Credential secrets | AES-256-GCM | Password, API key, SSH key, token, etc. |
| Credential usernames | AES-256-GCM | Optional, based on configuration |
| MFA seeds | AES-256-GCM | TOTP seeds, WebAuthn credentials |
| API key tokens | AES-256-GCM | Stored as hash only, not plaintext |
| Break-glass tokens | Redis with TTL | Temporary, watermarked |

### Data at Rest

- **Database**: All sensitive data is encrypted
- **Backups**: Encrypted backups with separate key management
- **Logs**: Secrets are redacted before logging
- **Cache**: Redis does not store plaintext secrets

### Data in Transit

- **TLS 1.3**: All external communication uses TLS 1.3
- **Internal Networks**: Docker internal networks are used for service-to-service communication
- **mTLS**: Connector communication uses mutual TLS

---

## Network Security

### Network Architecture

#### Production Deployment

```
Internet
   │
   ▼
┌─────────────────┐
│   Cloud Load    │
│   Balancer      │  ← Terminates TLS, WAF, DDoS protection
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Edge          │
│   (Nginx)       │  ← Security headers, rate limiting
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   API Network   │  ← Private subnet
│                 │
│  ┌───────────┐  ┌───────────┐
│  │ Frontend  │  │ Backend   │
│  │ (Static)  │  │ (API)     │
│  └───────────┘  └───────────┘
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Vault Network │  ← Private subnet, no public access
│                 │
│  ┌───────────┐  ┌───────────┐
│  │ PostgreSQL│  │  Redis    │
│  │           │  │           │
│  └───────────┘  └───────────┘
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   KMS           │  ← Cloud KMS/HSM, separate VPC/subnet
└─────────────────┘
```

### Security Controls

#### Firewall Rules

| Source | Destination | Port | Protocol | Purpose |
|--------|-------------|------|----------|---------|
| Internet | Edge (Nginx) | 80 | TCP | HTTP (redirect to HTTPS) |
| Internet | Edge (Nginx) | 443 | TCP | HTTPS |
| Edge | Frontend | 80 | TCP | Internal HTTP |
| Edge | Backend | 8080 | TCP | API |
| Backend | PostgreSQL | 5432 | TCP | Database |
| Backend | Redis | 6379 | TCP | Cache |
| Connector Gateway | Connectors | 8081 | TCP | Connector communication |
| All | All | - | ICMP | Ping (rate limited) |

**All other traffic is DENIED by default.**

#### SSRF Protection

- **Blocked Destinations**:
  - 127.0.0.1, localhost, 0.0.0.0
  - Private RFC1918 networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
  - Link-local addresses (169.254.0.0/16)
  - IPv6 local addresses (::1, fe80::/10)
  - Metadata endpoints (169.254.169.254, etc.)
  - Internal DNS targets

- **Protection Methods**:
  - DNS resolution validation
  - IP address validation after DNS resolution
  - URL parsing and validation
  - Blocklist of reserved/private IP ranges

#### DNS Security

- **DNS over TLS (DoT)**: For external DNS queries
- **DNS Rebinding Protection**: Validate after DNS resolution
- **Hostname Validation**: Strict hostname matching

---

## Application Security

### Input Validation

- **Request Body**: Zod schema validation
- **Query Parameters**: Type validation and sanitization
- **Headers**: Size limits and format validation
- **File Uploads**: Type, size, and content validation
- **SQL Injection**: Parameterized queries (never string concatenation)
- **XSS**: Output encoding, CSP headers
- **Command Injection**: Never execute user-supplied commands

### Security Headers

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

### Rate Limiting

- **Global Rate Limit**: 300 requests per minute per IP
- **Login Rate Limit**: 5 attempts per minute per IP (then lockout)
- **MFA Rate Limit**: 10 attempts per minute per user
- **API Rate Limit**: Configurable per endpoint

### Session Security

- **Cookie Settings**:
  - HttpOnly: true (prevents JavaScript access)
  - Secure: true (HTTPS only)
  - SameSite: Strict (prevents CSRF)
  - Path: / (or specific path)
  - Max-Age: Appropriate for token type

- **Token Rotation**: Refresh tokens are rotated on each use
- **Reuse Detection**: Detects and blocks reused refresh tokens
- **Family Revocation**: Reusing a refresh token revokes all tokens in the family

### CSRF Protection

- **SameSite Cookies**: Strict mode prevents most CSRF
- **CSRF Tokens**: For forms (defense in depth)
- **Origin Validation**: Validates Origin/Referer headers

### XSS Protection

- **CSP Headers**: Restrict script sources
- **Output Encoding**: Automatic encoding of user-supplied data
- **Content-Type**: Proper headers for all responses
- **No inline scripts**: All scripts from trusted sources
- **Isolated World**: Browser extension uses isolated context

### Clickjacking Protection

- **X-Frame-Options**: DENY
- **Frame-Ancestors**: 'none' in CSP

---

## Credential Security

### Credential Storage

- **Never Plaintext**: Credentials are always encrypted at rest
- **Envelope Encryption**: AES-256-GCM with KMS-wrapped DEKs
- **Field-Level**: Each secret is encrypted separately
- **Metadata Separation**: Metadata (name, target) is not encrypted, but access is controlled

### Credential Access

#### Launch Flow Security

1. **Authentication**: User must be authenticated with valid session
2. **Authorization**: User must have `credential.use` and `application.launch` permissions
3. **Collection Check**: User must have access to the collection containing the credential
4. **JIT Check**: If credential requires approval, user must have an active JIT window
5. **Policy Check**: Device, geo, concurrency, and other policies must be satisfied
6. **Grant Creation**: Single-use, time-bound (30s), cryptographically random token
7. **Grant Binding**: Token is bound to tenant, user, credential, application, domain
8. **Grant Consumption**: Token is validated and marked as used atomically
9. **Broker Execution**: Credential is decrypted and used in trusted boundary
10. **Memory Zeroization**: Plaintext is zeroized immediately after use

#### Reveal Prevention

- **No API Endpoints**: There are no endpoints that return plaintext credentials
- **Permission Separation**: `credential.reveal` is separate from `credential.use`
- **Break-Glass Only**: Only Security Admins with `credential.reveal` can access plaintext
- **Break-Glass Controls**:
  - Requires detailed justification (min 12 chars)
  - Requires co-sign ticket (INC-1234 format)
  - Requires second approver (different user)
  - Watermarked with admin info
  - Time-bound (30 seconds)
  - Fully audited

### Credential Types Supported

| Type | Storage | Launch Method | Notes |
|------|---------|---------------|-------|
| Password | Encrypted | Form injection | Standard username/password |
| API Key | Encrypted | Header injection | For REST APIs |
| SSH Key | Encrypted | SSH proxy | Private key for SSH |
| Token | Encrypted | Header injection | Bearer tokens, etc. |
| Client Secret | Encrypted | Form/header injection | OAuth client secrets |
| Certificate | Encrypted | mTLS | Client certificates |
| Secure Note | Encrypted | Display (with restrictions) | Encrypted notes |
| Recovery Code | Encrypted | Display (with restrictions) | One-time codes |
| OTP Seed | Encrypted | TOTP generation | For MFA enrollment |

---

## Browser Extension Security

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser Extension                               │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    Manifest V3                                  │ │
│  │  - Service Worker (background)                               │ │
│  │  - Content Scripts (isolated world)                         │ │
│  │  - Popup UI                                                │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Security Controls

#### Service Worker (Background)

- **Token Storage**: Grant tokens are held in memory only, never in chrome.storage
- **Domain Validation**: Strict domain matching before injection
- **Token Consumption**: Single-use tokens consumed immediately
- **No Secret Storage**: Never stores plaintext secrets
- **External Message Handling**: Rejects all external messages

#### Content Scripts (Isolated World)

- **Isolated Context**: Runs in ISOLATED world, invisible to page JavaScript
- **Native DOM Access**: Uses native property descriptors to set form values
- **No DOM Pollution**: Does not modify DOM in observable ways
- **Memory Zeroization**: Zeroizes secrets immediately after injection
- **Origin Validation**: Validates page origin before injection

#### Popup

- **Minimal Privileges**: Only requests necessary permissions
- **No Secret Display**: Never displays plaintext secrets
- **Secure Communication**: Uses HttpOnly cookies for authentication

### Permissions

```json
{
  "permissions": [
    "activeTab",
    "scripting",
    "cookies",
    "alarms"
  ],
  "host_permissions": [
    "https://pam.keyrail.cloud/*"
  ]
}
```

### Content Security Policy

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'none'"
  }
}
```

### Domain Validation

- **Exact Match**: `example.com` matches only `example.com`
- **Subdomain Match**: `*.example.com` matches `sub.example.com` but not `example.com`
- **Strict Parsing**: Uses URL parser, not string manipulation
- **No Wildcards**: Wildcard domains are not allowed
- **No Overlaps**: Prevents `example.com` from matching `notexample.com`

---

## Connector Security

### Architecture

```
┌─────────────────────┐       ┌─────────────────┐
│   Customer Network   │       │   PAM Cloud      │
│                     │       │                 │
│  ┌───────────────┐  │       │  ┌───────────┐  │
│  │  Connector    │  │◄──────┼─►│ Gateway   │  │
│  │  (Outbound)   │  │  mTLS │  │           │  │
│  └───────────────┘  │       │  └───────────┘  │
│                     │       │                 │
└─────────────────────┘       └─────────────────┘
```

### Security Controls

#### Connector

- **Outbound-Only**: Only establishes outbound connections, no inbound ports
- **mTLS Authentication**: Mutual TLS with device certificate
- **Tenant Binding**: Each connector is bound to a specific tenant
- **Device Identity**: Unique device certificate fingerprint
- **Command Allowlist**: Only predefined commands are allowed
- **Heartbeat**: Regular heartbeat to gateway
- **Version Reporting**: Reports version for compatibility and updates
- **No Vault Keys**: Never receives vault master keys

#### Connector Gateway

- **mTLS Termination**: Terminates mTLS connections
- **Certificate Validation**: Validates device certificates
- **Tenant Isolation**: Routes commands to correct tenant
- **Command Authorization**: Validates commands against allowlist
- **Rate Limiting**: Limits commands per connector
- **Audit Logging**: Logs all connector operations

### mTLS Configuration

- **Certificate Authority**: PAM Cloud acts as CA for connector certificates
- **Certificate Lifecycle**: Certificates have expiration and rotation
- **Revocation**: Certificates can be revoked immediately
- **Key Usage**: Separate keys for authentication and encryption

### Command Allowlist

| Command Type | Description | Allowed |
|--------------|-------------|---------|
| ssh | SSH connection | ✓ |
| rdp | RDP connection | ✓ |
| db-query | Database query | ✓ |
| http | HTTP request | ✓ |
| exec | Command execution | ✗ (Blocked) |
| shell | Shell access | ✗ (Blocked) |
| file-read | File read | ✗ (Blocked) |
| file-write | File write | ✗ (Blocked) |

---

## Audit and Compliance

### Audit Logging

#### Audit Event Types

See [Audit Service](./docs/architecture/services.md#16-audit-service) for the complete list of audit event types.

#### Audit Event Structure

```typescript
interface AuditEvent {
  id: string;
  seq: number;
  ts: number;
  tenantId: string;
  actorId: string | null;
  actorName: string;
  type: AuditType;
  resourceId?: string;
  resourceName?: string;
  result: 'SUCCESS' | 'DENIED' | 'FAILURE';
  meta?: string; // Pre-redacted
  sourceIp?: string;
  deviceFp?: string;
  prevHash: string;
  hash: string;
}
```

#### Hash Chaining

Each audit event's hash is computed as:
```
hash = sha256(prev_hash | type | actor_id | timestamp | meta)
```

This creates a chain where:
- Each event's hash depends on the previous event's hash
- Any modification to an event breaks the chain
- Verification can detect tampering

#### Verification

- **Automatic**: Chain is verified periodically
- **On-Demand**: Via API endpoint `/audit-events/verify`
- **Alerting**: Tampering attempts trigger alerts

### Secret Redaction

All audit event meta fields and log messages are processed through a redaction function that removes:
- Passwords
- Secrets
- Tokens
- API keys
- OTP values
- Private keys
- Session cookies
- Encryption keys

Redaction patterns:
```typescript
const SECRET_PATTERNS = [
  /(password|secret|token|api_?key|otp|nonce)["']?\s*[:=]\s*["']?[^"'\s,}]{4,}/gi,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];
```

### Compliance Features

| Requirement | Implementation |
|-------------|----------------|
| Access Control | RBAC with fine-grained permissions |
| Authentication | MFA, OIDC, SAML, password |
| Audit Logging | Tamper-evident, hash-chained |
| Data Encryption | AES-256-GCM, KMS-backed |
| Key Management | Cloud KMS/HSM |
| Session Recording | Optional session recording |
| Separation of Duties | Dual-custody for break-glass |
| Just-in-Time Access | Approval workflows |
| Least Privilege | Role-based permissions |
| Data Retention | Configurable retention policies |

---

## Incident Response

### Security Incident Classification

| Severity | Description | Response Time |
|----------|-------------|---------------|
| Critical | Active exploitation, data breach | Immediate |
| High | Potential compromise, significant impact | Within 1 hour |
| Medium | Security vulnerability, limited impact | Within 24 hours |
| Low | Security improvement, no immediate risk | Within 1 week |

### Incident Response Procedure

1. **Detection**: Identify and confirm the incident
2. **Containment**: Isolate affected systems
3. **Eradication**: Remove the threat
4. **Recovery**: Restore normal operations
5. **Lessons Learned**: Document and improve

### Security Contacts

| Role | Responsibility | Contact |
|------|---------------|---------|
| Security Team | Security incidents, vulnerabilities | security@pam.example.com |
| On-Call Engineer | 24/7 incident response | +1-XXX-XXX-XXXX |
| Compliance Officer | Compliance issues | compliance@pam.example.com |

---

## Security Testing

See [Security Testing](./docs/security/security-testing.md) for detailed security testing procedures.

---

## Security Checklist

### Pre-Deployment

- [ ] All required environment variables are set
- [ ] All secrets are properly protected (not in code or config files)
- [ ] Database is properly configured with RLS
- [ ] KMS is properly configured
- [ ] TLS certificates are valid and not expired
- [ ] Security headers are configured
- [ ] Rate limiting is configured
- [ ] Audit logging is enabled
- [ ] All security tests pass

### Post-Deployment

- [ ] Health checks are passing
- [ ] Security headers are present in responses
- [ ] TLS configuration is correct (TLS 1.3, strong ciphers)
- [ ] Database connections are encrypted
- [ ] Redis connections are secure
- [ ] All services are running
- [ ] Audit chain is intact

### Regular Maintenance

- [ ] Rotate all credentials regularly
- [ ] Rotate TLS certificates
- [ ] Rotate KMS keys (as per policy)
- [ ] Review audit logs for anomalies
- [ ] Update dependencies
- [ ] Run security scans
- [ ] Test backups and restore
- [ ] Review and update security policies

---

## Security Best Practices

### For Administrators

1. **Principle of Least Privilege**: Grant only the permissions users need
2. **Regular Audits**: Review user permissions and access regularly
3. **MFA Everywhere**: Require MFA for all users, especially admins
4. **Session Management**: Monitor active sessions, terminate suspicious ones
5. **Break-Glass Controls**: Use dual-custody for break-glass access
6. **JIT Access**: Use just-in-time access for privileged credentials
7. **Rotation**: Rotate credentials regularly
8. **Monitoring**: Set up alerts for security events

### For Users

1. **Strong Passwords**: Use strong, unique passwords
2. **MFA**: Enable MFA on your account
3. **Device Security**: Keep your devices secure and up-to-date
4. **Session Security**: Log out when done, don't share sessions
5. **Report Suspicious Activity**: Report any suspicious activity immediately
6. **Follow Policies**: Follow your organization's security policies

### For Developers

1. **Never Log Secrets**: Use the redaction function for all logs
2. **Validate All Inputs**: Validate and sanitize all user inputs
3. **Use DTOs**: Never return database entities directly
4. **Tenant Isolation**: Always use tenant context from authenticated session
5. **Error Handling**: Don't expose sensitive information in errors
6. **Security Testing**: Run security tests regularly
7. **Dependency Updates**: Keep dependencies up-to-date
8. **Code Reviews**: All code changes should be reviewed for security

---

## Security Vulnerability Disclosure

If you discover a security vulnerability in Keyrail PAM Cloud, please:

1. **Do NOT** disclose publicly
2. **Do NOT** exploit the vulnerability
3. **Do** report it to the security team immediately

### Reporting

Send vulnerability reports to: security@pam.example.com

Include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested mitigation (if known)

### Response

You can expect:
- Acknowledgment within 24 hours
- Regular updates on progress
- Credit in release notes (if desired)

---

## Related Documentation

- [Architecture Overview](./docs/architecture/overview.md)
- [Trust Boundaries](./docs/security/trust-boundaries.md)
- [Security Invariants](./docs/security/invariants.md)
- [Secret Lifecycle](./docs/security/secret-lifecycle.md)
- [Security Testing](./docs/security/security-testing.md)
- [Threat Model](./docs/THREAT-MODEL.md)
- [Deployment Guide](./docs/DEPLOYMENT.md)
