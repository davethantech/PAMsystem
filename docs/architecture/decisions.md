# Architecture Decisions

This document records significant architectural decisions made during the development of Keyrail PAM Cloud.

## Decision Format

Each decision follows this structure:

- **Status**: Accepted / Rejected / Superseded
- **Context**: The problem or opportunity
- **Decision**: The chosen solution
- **Consequences**: Trade-offs and implications
- **Alternatives Considered**: Other options evaluated

---

## ADR-001: Use NestJS for Backend Framework

- **Status**: Accepted
- **Context**: Need a production-grade, modular, TypeScript-first backend framework that supports dependency injection, middleware, and enterprise patterns.
- **Decision**: Use NestJS as the primary backend framework.
- **Consequences**:
  - Pros: Strong TypeScript support, modular architecture, built-in dependency injection, extensive ecosystem, enterprise-grade patterns
  - Cons: Slight learning curve, larger footprint than minimal frameworks
- **Alternatives Considered**: Fastify (current implementation), Express, Koa, Hono

**Note**: The current implementation uses Fastify for performance. NestJS will be adopted in the next major refactor to align with the master build requirements.

---

## ADR-002: Use Next.js for Frontend Framework

- **Status**: Accepted
- **Context**: Need a modern, performant, SEO-friendly frontend framework with SSR support and excellent TypeScript integration.
- **Decision**: Use Next.js (App Router) for the frontend.
- **Consequences**:
  - Pros: Excellent TypeScript support, SSR/SSG, API routes, file-based routing, large ecosystem
  - Cons: Larger bundle size, server-side dependencies
- **Alternatives Considered**: Vite + React (current implementation), Remix, SvelteKit

**Note**: Current implementation uses Vite + React. Migration to Next.js is planned.

---

## ADR-003: PostgreSQL with Row Level Security

- **Status**: Accepted
- **Context**: Need a production-grade relational database with strong security features for multi-tenancy.
- **Decision**: Use PostgreSQL with FORCE ROW LEVEL SECURITY on all tenant-scoped tables.
- **Consequences**:
  - Pros: Strong multi-tenancy isolation, mature, reliable, excellent TypeScript support via Prisma/TypeORM
  - Cons: RLS adds query planning overhead, requires careful schema design
- **Alternatives Considered**: MongoDB (document store), CockroachDB (distributed SQL), application-level tenant filtering

---

## ADR-004: Envelope Encryption with AES-256-GCM

- **Status**: Accepted
- **Context**: Need to encrypt sensitive credential data at rest while maintaining performance and security.
- **Decision**: Use AES-256-GCM for field-level encryption with envelope encryption pattern.
- **Consequences**:
  - Pros: NIST-approved algorithm, authenticated encryption, hardware acceleration available
  - Cons: Key management complexity, performance overhead for large secrets
- **Alternatives Considered**: AES-256-CBC (rejected due to lack of authentication), XChaCha20-Poly1305 (good but less hardware support)

---

## ADR-005: Cloud KMS for Master Key Management

- **Status**: Accepted
- **Context**: Need to protect master encryption keys with hardware-backed security.
- **Decision**: Use cloud provider KMS (AWS KMS, Azure Key Vault, Google Cloud KMS) for master key management with local stub for development.
- **Consequences**:
  - Pros: Hardware-backed security, audit logging, key rotation, compliance ready
  - Cons: Cloud dependency, latency for key operations, cost
- **Alternatives Considered**: HashiCorp Vault (self-hosted), local HSM, environment variable (rejected for production)

---

## ADR-006: Redis for Caching and Queues

- **Status**: Accepted
- **Context**: Need a fast, reliable in-memory store for sessions, caching, and message queues.
- **Decision**: Use Redis for session storage, rate limiting, and background job queues.
- **Consequences**:
  - Pros: Excellent performance, rich data structures, pub/sub support, persistence options
  - Cons: Additional infrastructure dependency, memory usage
- **Alternatives Considered**: In-memory (process-local, rejected for multi-instance), Memcached (less features)

---

## ADR-007: Capability-Based Launch with Single-Use Grants

- **Status**: Accepted
- **Context**: Need to allow users to use credentials without ever seeing them, while preventing replay and misuse.
- **Decision**: Use capability-based launch with single-use, time-bound, cryptographically random grant tokens.
- **Consequences**:
  - Pros: Strong security guarantees, prevents credential exposure, audit trail
  - Cons: Complexity in implementation, requires careful state management
- **Alternatives Considered**: Session-based access (less granular), JWT-based (harder to revoke)

---

## ADR-008: Isolated World Injection for Browser Extension

- **Status**: Accepted
- **Context**: Need to inject credentials into web pages without exposing them to page JavaScript.
- **Decision**: Use Chrome Extension Manifest V3 with ISOLATED world for content scripts and native DOM manipulation.
- **Consequences**:
  - Pros: Page JavaScript cannot access injected credentials, defense in depth
  - Cons: Limited to Chromium-based browsers, requires extension installation
- **Alternatives Considered**: iframe-based (complex, still vulnerable to parent page), proxy-based (latency, complexity)

---

## ADR-009: Outbound-Only Connector Architecture

- **Status**: Accepted
- **Context**: Need to connect to customer private resources without requiring inbound firewall ports.
- **Decision**: Use outbound-only mTLS connectors that establish connections to the PAM cloud.
- **Consequences**:
  - Pros: No inbound firewall changes, easier deployment, better security
  - Cons: Requires persistent outbound connection, NAT traversal complexity
- **Alternatives Considered**: Inbound connections (rejected due to firewall complexity), VPN (complex, separate infrastructure)

---

## ADR-010: Hash-Chained Audit Log

- **Status**: Accepted
- **Context**: Need tamper-evident audit logging for compliance and security.
- **Decision**: Use hash-chained audit events where each event's hash includes the previous event's hash.
- **Consequences**:
  - Pros: Tamper detection, cryptographic proof of integrity, compliance ready
  - Cons: Chain verification overhead, cannot delete individual events
- **Alternatives Considered**: External append-only log (complex), blockchain-based (overkill)

---

## ADR-011: Separate Use and Reveal Permissions

- **Status**: Accepted
- **Context**: Need to enforce the principle that credential.use does not imply credential.reveal.
- **Decision**: Create separate, disjoint permissions for using credentials vs. revealing them.
- **Consequences**:
  - Pros: Strong security boundary, prevents accidental exposure, audit trail
  - Cons: More complex permission management
- **Alternatives Considered**: Unified permission with flags (rejected as less secure)

---

## ADR-012: Tenant Identity from Authenticated Context

- **Status**: Accepted
- **Context**: Need to prevent tenant ID manipulation attacks.
- **Decision**: Always derive tenant identity from the verified session token, never from client-supplied parameters.
- **Consequences**:
  - Pros: Prevents IDOR attacks, strong security guarantee
  - Cons: Requires careful session management, cannot switch tenants without re-authentication
- **Alternatives Considered**: Client-supplied tenant ID (rejected as insecure), multi-tenant tokens (complex)

---

## ADR-013: No Plaintext Credentials in API Responses

- **Status**: Accepted
- **Context**: Need to ensure credentials are never accidentally exposed through APIs.
- **Decision**: Never return plaintext credentials in any API response. Use DTOs to explicitly define response fields.
- **Consequences**:
  - Pros: Prevents accidental exposure, strong security guarantee
  - Cons: More boilerplate code, requires careful validation
- **Alternatives Considered**: Relying on frontend filtering (rejected as insecure)

---

## ADR-014: Fastify for Current Backend Implementation

- **Status**: Accepted (Temporary)
- **Context**: Need a fast, lightweight HTTP framework for the initial implementation.
- **Decision**: Use Fastify for the current backend implementation with migration path to NestJS.
- **Consequences**:
  - Pros: Excellent performance, TypeScript-first, schema validation, fast startup
  - Cons: Less enterprise patterns than NestJS, will require migration
- **Alternatives Considered**: NestJS (planned for future), Express (less TypeScript-friendly)

---

## ADR-015: Local Development KMS Stub

- **Status**: Accepted
- **Context**: Need to support local development without cloud KMS dependencies.
- **Decision**: Implement a local KMS stub that uses ephemeral in-memory keys for development.
- **Consequences**:
  - Pros: Enables local development, no cloud dependencies
  - Cons: Not suitable for production, keys lost on restart (by design)
- **Alternatives Considered**: Required cloud KMS (rejected as it blocks development), file-based keys (rejected as less secure)

---

## Decision Log

| Date | Decision | Status | Author |
|------|----------|--------|--------|
| 2024-01-XX | ADR-001: NestJS for Backend | Accepted | Architecture Team |
| 2024-01-XX | ADR-002: Next.js for Frontend | Accepted | Architecture Team |
| 2024-01-XX | ADR-003: PostgreSQL with RLS | Accepted | Architecture Team |
| 2024-01-XX | ADR-004: AES-256-GCM Envelope Encryption | Accepted | Security Team |
| 2024-01-XX | ADR-005: Cloud KMS for Master Keys | Accepted | Security Team |
| 2024-01-XX | ADR-006: Redis for Cache/Queue | Accepted | Architecture Team |
| 2024-01-XX | ADR-007: Capability-Based Launch | Accepted | Security Team |
| 2024-01-XX | ADR-008: Isolated World Injection | Accepted | Security Team |
| 2024-01-XX | ADR-009: Outbound-Only Connectors | Accepted | Architecture Team |
| 2024-01-XX | ADR-010: Hash-Chained Audit | Accepted | Security Team |
| 2024-01-XX | ADR-011: Separate Use/Reveal Permissions | Accepted | Security Team |
| 2024-01-XX | ADR-012: Tenant from Auth Context | Accepted | Security Team |
| 2024-01-XX | ADR-013: No Plaintext in API Responses | Accepted | Security Team |
| 2024-01-XX | ADR-014: Fastify (Temporary) | Accepted | Implementation Team |
| 2024-01-XX | ADR-015: Local KMS Stub | Accepted | Implementation Team |

---

## Migration Path

The following migrations are planned:

1. **Backend Framework**: Fastify -> NestJS (Priority: High)
   - Rationale: Better alignment with enterprise patterns, dependency injection, modular architecture
   - Timeline: Next major version

2. **Frontend Framework**: Vite + React -> Next.js (Priority: Medium)
   - Rationale: Better SSR support, API routes, enterprise features
   - Timeline: After backend migration

3. **Database ORM**: Raw SQL -> Prisma/TypeORM (Priority: Medium)
   - Rationale: Type safety, migration management, better maintainability
   - Timeline: After backend migration

4. **Container Orchestration**: Docker Compose -> Kubernetes (Priority: Low)
   - Rationale: Better scaling, high availability, cloud-native deployment
   - Timeline: After core features are stable
