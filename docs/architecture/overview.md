# Keyrail PAM Cloud - Architecture Overview

## System Overview

Keyrail PAM Cloud is a **multi-tenant, cloud-hosted Privileged Access Management (PAM) SaaS platform** that enables authorized users to **use** privileged credentials without ever being able to **view**, copy, export, or retrieve them.

### Core Principle

> **A user can USE a privileged account but cannot VIEW, COPY, EXPORT, RETRIEVE, or otherwise obtain the underlying credential.**

This is enforced technically through:
- Capability-based launch with single-use, time-bound grants
- Envelope encryption with hardware-backed KMS
- Isolated-world browser injection
- Strict tenant isolation
- Comprehensive audit logging

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                              INTERNET                                  │
└─────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                            EDGE LAYER                                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────────┐ │
│  │   Nginx     │    │   WAF       │    │   DDoS Protection             │ │
│  │   (TLS 1.3) │    │   (Optional) │    │   (Cloud Provider)           │ │
│  └──────┬──────┘    └──────┬──────┘    └─────────────┬───────────────┘ │
│         │                  │                        │                 │
└─────────┼──────────────────┼────────────────────────┼─────────────────┘
          │                  │                        │
          ▼                  ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         APPLICATION LAYER                               │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    FRONTEND (Static)                               │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │ │
│  │  │   Next.js    │  │   React      │  │   Tailwind CSS           │  │ │
│  │  │   (SSR/SSG)   │  │   (TypeScript)│  │   (Accessible Components) │  │ │
│  │  └──────────────┘  └──────────────┘  └─────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                    │                                       │
│                                    ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    API GATEWAY                                      │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │ │
│  │  │   Fastify    │  │   (Future:   │  │   Security Middleware:   │  │ │
│  │  │   (Current)   │  │    NestJS)    │  │   - CSRF Protection       │  │ │
│  │  │              │  │              │  │   - CORS Restrictions     │  │ │
│  │  └──────────────┘  └──────────────┘  │   - Rate Limiting          │  │ │
│  │                                          │   - Input Validation       │  │ │
│  │                                          │   - Secure Headers         │  │ │
│  │                                          └─────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SERVICE LAYER                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   Auth      │  │   Tenants    │  │   Users     │  │   Groups    │  │
│  │   Service   │  │   Service    │  │   Service    │  │   Service    │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   Vault     │  │   Credentials│  │   Collections│  │   Applications│ │
│  │   Service    │  │   Service    │  │   Service    │  │   Service    │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   Launch    │  │   Broker     │  │   Sessions   │  │   Approvals  │  │
│  │   Service    │  │   Service    │  │   Service    │  │   Service    │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   Rotation  │  │   Audit      │  │   Connectors │  │   Notifications│ │
│  │   Service    │  │   Service    │  │   Service    │  │   Service    │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA LAYER                                     │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    PostgreSQL                                      │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │ │
│  │  │   Tenant     │  │   User       │  │   Credential             │  │ │
│  │  │   Data       │  │   Data       │  │   Data (Encrypted)        │  │ │
│  │  └──────────────┘  └──────────────┘  └─────────────────────────┘  │ │
│  │  - Row Level Security (RLS) on all tenant tables                   │ │
│  │  - UUID identifiers                                               │ │
│  │  - Foreign keys and constraints                                   │ │
│  │  - Indexes for performance                                        │ │
│  │  - Point-in-Time Recovery (PITR)                                  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                    │                                       │
│                                    ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    Redis                                             │ │
│  │  - Session storage                                                 │ │
│  │  - Rate limiting cache                                             │ │
│  │  - Background job queues                                           │ │
│  │  - Temporary data storage                                          │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         KMS LAYER                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    Cloud KMS/HSM                                    │ │
│  │  - AWS KMS / Azure Key Vault / Google Cloud KMS                    │ │
│  │  - Hardware Security Module (HSM) backed                           │ │
│  │  - Master keys never leave hardware                                │ │
│  │  - Audit logging of all key operations                              │ │
│  │  - Key rotation support                                            │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Network Topology

### Production Deployment

```
┌─────────────────────────────────────────────────────────────────────┐
│                              VPC                                        │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    Public Subnet                                  │ │
│  │  ┌─────────────┐  ┌─────────────┐                                │ │
│  │  │   Nginx     │  │   WAF       │                                │ │
│  │  │   (Edge)    │  │   (Optional) │                                │ │
│  │  └─────────────┘  └─────────────┘                                │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                    │                                       │
│                                    ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    Private Subnet (API)                            │ │
│  │  ┌─────────────┐  ┌─────────────┐                                │ │
│  │  │  Frontend   │  │   Backend    │                                │ │
│  │  │   (Static)  │  │   (API)      │                                │ │
│  │  └─────────────┘  └─────────────┘                                │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                    │                                       │
│                                    ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    Private Subnet (Vault)                          │ │
│  │  ┌─────────────┐  ┌─────────────┐                                │ │
│  │  │  PostgreSQL │  │    Redis    │                                │ │
│  │  │   (DB)      │  │   (Cache)    │                                │ │
│  │  └─────────────┘  └─────────────┘                                │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                    │                                       │
│                                    ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    KMS Subnet                                      │ │
│  │  ┌─────────────────────────────────────────────────────────┐   │ │
│  │  │                    Cloud KMS/HSM                            │   │ │
│  │  └─────────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Local Development

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Docker Compose                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │
│  │   Nginx     │  │  Frontend    │  │   Backend    │                  │
│  │   (Edge)    │  │   (Vite)     │  │   (Fastify)  │                  │
│  └──────┬──────┘  └─────────────┘  └──────┬───────┘                  │
│         │                             │                              │
│         ▼                             ▼                              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Internal Networks                             │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │   │
│  │  │   API       │  │   Vault      │  │   Internal                │ │   │
│  │  │   Network    │  │   Network    │  │   Network                │ │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────────┬───────────────┘ │   │
│  │         │                │                   │                   │   │
│  │         ▼                ▼                   ▼                   │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │   │
│  │  │  Connector  │  │  PostgreSQL │  │    Redis    │           │   │
│  │  │  Gateway    │  │             │  │             │           │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │   │
│  │                                                             │   │
│  │                              ┌─────────────┐                      │   │
│  │                              │  Connector   │                      │   │
│  │                              │  (Customer)  │                      │   │
│  │                              └─────────────┘                      │   │
│  └─────────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### Credential Launch Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  User    │────▶│ Frontend │────▶│  Backend │────▶│  Vault   │
│          │     │          │     │   (API)   │     │ Service  │
└──────────┘     └──────────┘     └──────┬─────┘     └──────────┘
                                          │
                                          ▼
                                   ┌──────────┐
                                   │  Grant   │
                                   │  Issued  │
                                   └────┬─────┘
                                        │
┌──────────┐     ┌──────────┐     ┌──────▼─────┐     ┌──────────┐
│ Browser  │◀────│ Extension│◀────│ Consume   │◀────│  Broker  │
│          │     │          │     │  Grant    │     │  Service │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
       ▲                ▲
       │                │
       ▼                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Target Application                            │
│                  (e.g., eBay, Cloudflare, cPanel)                       │
└─────────────────────────────────────────────────────────────────┘
```

1. **User Authentication**: User logs in via frontend, MFA verified
2. **Grant Request**: User selects application, backend validates RBAC and policies
3. **Grant Issued**: Backend creates single-use, time-bound grant token
4. **Grant Consumption**: Extension receives grant, validates domain
5. **Credential Broker**: Broker decrypts credential in trusted boundary
6. **Injection**: Isolated-world script injects credentials and submits form
7. **Cleanup**: Credentials zeroized from memory, grant marked as used
8. **Audit**: All operations recorded in hash-chained audit log

### Encryption Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        ENCRYPTION                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  Plaintext   │───▶│  Tenant DEK  │───▶│  AES-256-GCM │      │
│  │  Secret      │    │  (from KMS)  │    │  Encryption   │      │
│  └──────────────┘    └──────────────┘    └──────┬───────┘      │
│                                                   │              │
│                                                   ▼              │
│                                            ┌──────────────┐        │
│                                            │ Ciphertext   │        │
│                                            │ + Nonce      │        │
│                                            │ + Auth Tag   │        │
│                                            └──────┬───────┘        │
│                                                   │              │
└─────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                      STORAGE                                      │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    PostgreSQL                                │ │
│  │  - credentials.secret_ciphertext                            │ │
│  │  - credentials.secret_nonce                                 │ │
│  │  - credentials.secret_tag                                    │ │
│  │  - credentials.key_version                                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Service Boundaries

### Tenant Service
- Manages tenant lifecycle (creation, suspension, deletion)
- Handles tenant isolation configuration
- Manages tenant-specific KMS keys

### Authentication Service
- Handles user authentication (email/password, OIDC, SAML)
- Manages sessions and cookies
- Enforces MFA (TOTP, WebAuthn, recovery codes)
- Handles session lifecycle (creation, refresh, revocation)

### Authorization Service
- Manages RBAC (roles, permissions, user assignments)
- Enforces permission checks
- Handles group membership

### Vault Service
- Manages encrypted credential storage
- Handles encryption/decryption operations
- Manages key rotation
- Enforces access controls on credentials

### Launch Service
- Issues launch grants
- Validates launch requests
- Manages grant lifecycle (creation, consumption, expiration)

### Broker Service
- Decrypts credentials in trusted boundary
- Performs authentication operations
- Zeroizes plaintext secrets after use
- Manages session recording

### Application Service
- Manages application definitions
- Handles application-credential mappings
- Manages connector configurations

### Session Service
- Tracks active sessions
- Manages session recording
- Handles session termination

### Approval Service
- Manages access requests
- Handles approval workflows
- Enforces JIT access policies

### Rotation Service
- Manages password rotation
- Handles rotation scheduling
- Verifies rotation results
- Manages rollback on failure

### Audit Service
- Records all sensitive operations
- Maintains hash-chained audit log
- Provides audit verification

### Connector Service
- Manages customer-side connectors
- Handles connector authentication (mTLS)
- Manages connector lifecycle

### Notification Service
- Sends email/alert notifications
- Manages notification preferences
- Handles notification delivery

---

## Trust Boundaries

See [Trust Boundaries](../security/trust-boundaries.md) for detailed trust boundary analysis.

---

## Security Principles

1. **Use Without View**: Users can use credentials but never see them
2. **Defense in Depth**: Multiple layers of security controls
3. **Least Privilege**: Minimum necessary permissions for all operations
4. **Separation of Duties**: Critical operations require multiple authorizations
5. **Complete Audit Trail**: All sensitive operations are logged and tamper-evident
6. **Fail Secure**: System fails in a secure state by default
7. **Zero Trust**: Never trust, always verify

---

## Compliance Considerations

Keyrail PAM Cloud is designed to support compliance with:

- **SOC 2 Type II**: Security, availability, processing integrity
- **ISO 27001**: Information security management
- **PCI DSS**: Payment card industry data security
- **HIPAA**: Healthcare information protection
- **GDPR**: General data protection regulation
- **NIST SP 800-53**: Security and privacy controls

Specific compliance features:
- Role-based access control (RBAC)
- Multi-factor authentication (MFA)
- Session recording and auditing
- Encryption at rest and in transit
- Key management with HSM
- Tamper-evident audit logs
- Separation of duties
- Just-in-time access
