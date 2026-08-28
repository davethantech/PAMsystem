# Keyrail PAM Cloud - Service Architecture

## Overview

Keyrail PAM Cloud is organized into modular services that can be developed, tested, and deployed independently. This document describes each service, its responsibilities, and its interfaces.

---

## Service Structure

```
backend/
├── src/
│   ├── auth/           # Authentication Service
│   ├── tenants/        # Tenant Service
│   ├── users/          # User Service
│   ├── groups/         # Group Service
│   ├── roles/          # Role Service
│   ├── permissions/    # Permission Service
│   ├── vault/          # Vault Service
│   ├── credentials/    # Credential Service
│   ├── collections/    # Collection Service
│   ├── applications/   # Application Service
│   ├── launch/         # Launch Service
│   ├── broker/         # Broker Service
│   ├── sessions/       # Session Service
│   ├── approvals/      # Approval Service
│   ├── policies/       # Policy Service
│   ├── rotation/       # Rotation Service
│   ├── audit/          # Audit Service
│   ├── connectors/     # Connector Service
│   ├── devices/        # Device Service
│   ├── notifications/  # Notification Service
│   ├── admin/          # Admin Service
│   └── health/         # Health Service
└── tests/
└── Dockerfile
```

---

## Service Catalog

### 1. Authentication Service (`auth/`)

**Responsibilities:**
- User authentication (email/password, OIDC, SAML)
- Session management (creation, refresh, revocation)
- MFA enforcement (TOTP, WebAuthn, recovery codes)
- Device management and binding
- Brute-force protection and rate limiting
- Account lockout

**Key Components:**
- `auth.controller.ts` - HTTP route handlers
- `auth.service.ts` - Business logic
- `password.service.ts` - Password hashing (Argon2id)
- `mfa.service.ts` - MFA methods
- `session.service.ts` - Session lifecycle
- `totp.service.ts` - TOTP implementation
- `webauthn.service.ts` - WebAuthn/passkeys

**Interfaces:**
```typescript
interface AuthService {
  login(tenantSlug: string, email: string, password: string, ip: string): Promise<Session>;
  loginOidc(tenantSlug: string, provider: string, params: Record<string, string>, ip: string): Promise<Session>;
  refreshSession(refreshToken: string): Promise<Session>;
  logout(sessionId: string): Promise<void>;
  enrollMfa(userId: string, method: MfaMethod): Promise<void>;
  verifyMfa(userId: string, method: string, code: string): Promise<boolean>;
  getSession(sessionId: string): Promise<Session | null>;
  revokeSession(sessionId: string): Promise<void>;
  revokeAllUserSessions(userId: string): Promise<void>;
}
```

**Dependencies:**
- Database (users, sessions, mfa_methods)
- Redis (session storage, rate limiting)
- KMS (for encrypting MFA seeds)

**Security Considerations:**
- HttpOnly, Secure, SameSite=Strict cookies
- Refresh token rotation with reuse detection
- Rate limiting on login attempts
- Session binding to IP/device fingerprint

---

### 2. Tenant Service (`tenants/`)

**Responsibilities:**
- Tenant lifecycle management (create, update, suspend, delete)
- Tenant configuration
- Tenant isolation enforcement
- KMS key management per tenant
- Tenant-specific policies

**Key Components:**
- `tenants.controller.ts` - HTTP route handlers
- `tenants.service.ts` - Business logic
- `tenant.context.ts` - Tenant context management

**Interfaces:**
```typescript
interface TenantService {
  createTenant(input: CreateTenantInput): Promise<Tenant>;
  getTenant(tenantId: string): Promise<Tenant | null>;
  updateTenant(tenantId: string, input: UpdateTenantInput): Promise<Tenant>;
  suspendTenant(tenantId: string): Promise<Tenant>;
  deleteTenant(tenantId: string): Promise<void>;
  listTenants(): Promise<Tenant[]>;
  getTenantStats(tenantId: string): Promise<TenantStats>;
  rotateTenantKeys(tenantId: string): Promise<{ version: number }>;
}
```

**Dependencies:**
- Database (tenants, encryption_keys)
- KMS (for DEK generation and wrapping)

**Security Considerations:**
- Tenant ID is always derived from authenticated context
- All tenant operations require appropriate permissions
- Tenant deletion requires confirmation
- KMS keys are tenant-specific

---

### 3. User Service (`users/`)

**Responsibilities:**
- User lifecycle management
- User provisioning and deprovisioning
- User status management (active, disabled, locked)
- User profile management
- User search and listing

**Key Components:**
- `users.controller.ts` - HTTP route handlers
- `users.service.ts` - Business logic
- `user.repository.ts` - Database operations

**Interfaces:**
```typescript
interface UserService {
  createUser(input: CreateUserInput): Promise<User>;
  getUser(userId: string): Promise<User | null>;
  updateUser(userId: string, input: UpdateUserInput): Promise<User>;
  disableUser(userId: string): Promise<User>;
  enableUser(userId: string): Promise<User>;
  deleteUser(userId: string): Promise<void>;
  listUsers(tenantId: string, filters: UserFilters): Promise<PaginatedResult<User>>;
  searchUsers(tenantId: string, query: string): Promise<User[]>;
  getUserPermissions(userId: string): Promise<string[]>;
}
```

**Dependencies:**
- Database (users, user_roles, groups_users)
- Auth Service (for session validation)
- Tenant Service (for tenant context)

**Security Considerations:**
- User operations require appropriate permissions
- User deletion is soft-delete by default
- User status affects authentication
- User search respects tenant isolation

---

### 4. Group Service (`groups/`)

**Responsibilities:**
- Group lifecycle management
- Group membership management
- Group role assignments
- Group permissions

**Key Components:**
- `groups.controller.ts` - HTTP route handlers
- `groups.service.ts` - Business logic
- `group.repository.ts` - Database operations

**Interfaces:**
```typescript
interface GroupService {
  createGroup(input: CreateGroupInput): Promise<Group>;
  getGroup(groupId: string): Promise<Group | null>;
  updateGroup(groupId: string, input: UpdateGroupInput): Promise<Group>;
  deleteGroup(groupId: string): Promise<void>;
  addUserToGroup(groupId: string, userId: string): Promise<void>;
  removeUserFromGroup(groupId: string, userId: string): Promise<void>;
  assignRoleToGroup(groupId: string, roleId: string): Promise<void>;
  removeRoleFromGroup(groupId: string, roleId: string): Promise<void>;
  listGroups(tenantId: string): Promise<Group[]>;
  getGroupMembers(groupId: string): Promise<User[]>;
}
```

**Dependencies:**
- Database (groups, groups_users, groups_roles)
- User Service
- Role Service

**Security Considerations:**
- Group operations require appropriate permissions
- Group membership changes are audited
- Group permissions are inherited by members

---

### 5. Role and Permission Service (`roles/`, `permissions/`)

**Responsibilities:**
- Role lifecycle management
- Permission definitions
- Role-permission mapping
- Built-in roles management
- Custom role creation

**Key Components:**
- `roles.controller.ts` - HTTP route handlers
- `roles.service.ts` - Business logic
- `permissions.service.ts` - Permission management
- `role.repository.ts` - Database operations

**Interfaces:**
```typescript
interface RoleService {
  createRole(input: CreateRoleInput): Promise<Role>;
  getRole(roleId: string): Promise<Role | null>;
  updateRole(roleId: string, input: UpdateRoleInput): Promise<Role>;
  deleteRole(roleId: string): Promise<void>;
  listRoles(tenantId: string): Promise<Role[]>;
  assignPermissionToRole(roleId: string, permissionId: string): Promise<void>;
  removePermissionFromRole(roleId: string, permissionId: string): Promise<void>;
  getRolePermissions(roleId: string): Promise<Permission[]>;
}

interface PermissionService {
  createPermission(input: CreatePermissionInput): Promise<Permission>;
  getPermission(permissionId: string): Promise<Permission | null>;
  listPermissions(): Promise<Permission[]>;
  getBuiltInPermissions(): Promise<Permission[]>;
}
```

**Dependencies:**
- Database (roles, permissions, role_permissions)

**Security Considerations:**
- Built-in roles cannot be deleted
- System roles have special protections
- Permission changes are audited
- Role assignments affect user permissions

---

### 6. Vault Service (`vault/`)

**Responsibilities:**
- Credential encryption and decryption
- Envelope encryption management
- KMS integration
- DEK (Data Encryption Key) lifecycle
- Tenant key rotation

**Key Components:**
- `vault.service.ts` - Core vault operations
- `crypto.service.ts` - Cryptographic operations
- `kms.service.ts` - KMS integration
- `dek.service.ts` - DEK management

**Interfaces:**
```typescript
interface VaultService {
  encrypt(tenantId: string, plaintext: string): Promise<Sealed>;
  decrypt(tenantId: string, sealed: Sealed): Promise<string>;
  withUnsealedSecret<T>(tenantId: string, version: number, sealed: Sealed, fn: (plaintext: string) => Promise<T>): Promise<T>;
  generateDek(tenantId: string): Promise<{ version: number }>;
  getDek(tenantId: string, version: number): Promise<Buffer>;
  rotateTenantDek(tenantId: string): Promise<{ version: number }>;
  sealCredential(tenantId: string, input: SealCredentialInput): Promise<SealedCredential>;
  unsealCredential(tenantId: string, credential: SealedCredential): Promise<string>;
}

interface CryptoService {
  aes256GcmEncrypt(plaintext: string, key: Buffer): Sealed;
  aes256GcmDecrypt(sealed: Sealed, key: Buffer): string;
  generateRandomBytes(length: number): Buffer;
  generateRandomToken(length: number): string;
  sha256(data: Buffer | string): Buffer;
  chainHash(parts: string): string;
}

interface KmsService {
  wrapDek(tenantId: string, dek: Buffer): Promise<Buffer>;
  unwrapDek(tenantId: string, wrapped: Buffer): Promise<Buffer>;
  generateDataKey(tenantId: string): Promise<{ plaintext: Buffer; ciphertext: Buffer }>;
}
```

**Dependencies:**
- Database (encryption_keys)
- KMS (AWS/Azure/GCP or local stub)

**Security Considerations:**
- Plaintext exists only in memory during operations
- Memory is zeroized after use
- DEKs are wrapped by KMS
- Master keys never leave KMS hardware
- All cryptographic operations use authenticated encryption

---

### 7. Credential Service (`credentials/`)

**Responsibilities:**
- Credential lifecycle management
- Credential metadata management
- Credential versioning
- Credential search and filtering
- Credential access control

**Key Components:**
- `credentials.controller.ts` - HTTP route handlers
- `credentials.service.ts` - Business logic
- `credential.repository.ts` - Database operations

**Interfaces:**
```typescript
interface CredentialService {
  createCredential(input: CreateCredentialInput): Promise<Credential>;
  getCredential(credentialId: string): Promise<Credential | null>;
  updateCredential(credentialId: string, input: UpdateCredentialInput): Promise<Credential>;
  deleteCredential(credentialId: string): Promise<void>;
  listCredentials(tenantId: string, filters: CredentialFilters): Promise<PaginatedResult<Credential>>;
  searchCredentials(tenantId: string, query: string): Promise<Credential[]>;
  getCredentialMetadata(credentialId: string): Promise<CredentialMetadata>;
  addCredentialToCollection(credentialId: string, collectionId: string): Promise<void>;
  removeCredentialFromCollection(credentialId: string, collectionId: string): Promise<void>;
  rotateCredentialPassword(credentialId: string, adapters: RotationAdapters): Promise<RotationResult>;
}
```

**Dependencies:**
- Database (credentials, credential_versions, credential_collections)
- Vault Service (for encryption/decryption)
- Collection Service
- Audit Service

**Security Considerations:**
- Credential operations require appropriate permissions
- Credential metadata is visible based on collection membership
- Plaintext credentials are never returned by this service
- Credential deletion is soft-delete by default

---

### 8. Collection Service (`collections/`)

**Responsibilities:**
- Collection lifecycle management
- Collection membership management
- Collection access control
- Collection organization

**Key Components:**
- `collections.controller.ts` - HTTP route handlers
- `collections.service.ts` - Business logic
- `collection.repository.ts` - Database operations

**Interfaces:**
```typescript
interface CollectionService {
  createCollection(input: CreateCollectionInput): Promise<Collection>;
  getCollection(collectionId: string): Promise<Collection | null>;
  updateCollection(collectionId: string, input: UpdateCollectionInput): Promise<Collection>;
  deleteCollection(collectionId: string): Promise<void>;
  listCollections(tenantId: string): Promise<Collection[]>;
  addMemberToCollection(collectionId: string, member: CollectionMember): Promise<void>;
  removeMemberFromCollection(collectionId: string, member: CollectionMember): Promise<void>;
  getCollectionMembers(collectionId: string): Promise<CollectionMember[]>;
  getUserCollections(userId: string): Promise<Collection[]>;
  checkCredentialAccess(userId: string, credentialId: string): Promise<boolean>;
}
```

**Dependencies:**
- Database (collections, collection_members)
- User Service
- Group Service
- Credential Service

**Security Considerations:**
- Collection operations require appropriate permissions
- Collection membership determines credential visibility
- Collections provide scope for JIT access
- Collection changes are audited

---

### 9. Application Service (`applications/`)

**Responsibilities:**
- Application definitions management
- Application-credential mappings
- Application launch configuration
- Connector integration

**Key Components:**
- `applications.controller.ts` - HTTP route handlers
- `applications.service.ts` - Business logic
- `application.repository.ts` - Database operations

**Interfaces:**
```typescript
interface ApplicationService {
  createApplication(input: CreateApplicationInput): Promise<Application>;
  getApplication(applicationId: string): Promise<Application | null>;
  updateApplication(applicationId: string, input: UpdateApplicationInput): Promise<Application>;
  deleteApplication(applicationId: string): Promise<void>;
  listApplications(tenantId: string): Promise<Application[]>;
  mapCredentialToApplication(applicationId: string, credentialId: string): Promise<void>;
  unmapCredentialFromApplication(applicationId: string, credentialId: string): Promise<void>;
  getApplicationCredentials(applicationId: string): Promise<Credential[]>;
  getCredentialApplications(credentialId: string): Promise<Application[]>;
  getApplicationLaunchConfig(applicationId: string): Promise<LaunchConfig>;
}
```

**Dependencies:**
- Database (applications, application_credentials)
- Credential Service
- Connector Service

**Security Considerations:**
- Application operations require appropriate permissions
- Application-credential mappings are many-to-many
- Applications define allowed domains for launch
- Application launch configuration includes selectors for form injection

---

### 10. Launch Service (`launch/`)

**Responsibilities:**
- Launch grant creation
- Launch request validation
- Launch policy enforcement
- Launch grant lifecycle management

**Key Components:**
- `launch.controller.ts` - HTTP route handlers
- `launch.service.ts` - Business logic
- `launch.repository.ts` - Database operations

**Interfaces:**
```typescript
interface LaunchService {
  createLaunchGrant(
    user: Principal,
    credentialId: string,
    applicationId: string,
    context: LaunchContext
  ): Promise<LaunchGrant>;
  validateLaunchRequest(
    user: Principal,
    credentialId: string,
    applicationId: string
  ): Promise<ValidationResult>;
  getLaunchGrant(grantId: string): Promise<LaunchGrant | null>;
  markGrantAsUsed(grantId: string): Promise<void>;
  listActiveGrants(userId: string): Promise<LaunchGrant[]>;
  revokeGrant(grantId: string): Promise<void>;
  cleanupExpiredGrants(): Promise<number>;
}
```

**Dependencies:**
- Database (launch_grants)
- Auth Service (for session validation)
- Credential Service (for credential validation)
- Application Service (for application validation)
- Collection Service (for collection membership validation)
- Policy Service (for launch policy enforcement)
- Audit Service

**Security Considerations:**
- Launch grants are single-use and time-bound (30 seconds)
- Grants are bound to tenant, user, credential, application, domain
- Grant validation is atomic (SELECT FOR UPDATE)
- Replay attempts are denied and audited

---

### 11. Broker Service (`broker/`)

**Responsibilities:**
- Credential decryption in trusted boundary
- Authentication operation execution
- Session creation
- Memory zeroization

**Key Components:**
- `broker.service.ts` - Core broker operations
- `web-injector.service.ts` - Web form injection
- `ssh-proxy.service.ts` - SSH proxy
- `rdp-proxy.service.ts` - RDP proxy
- `db-proxy.service.ts` - Database proxy

**Interfaces:**
```typescript
interface BrokerService {
  consumeGrant(
    principal: Principal,
    token: string,
    perform: (op: { username: string; secret: string; domain: string }) => Promise<{ gateway: string }>
  ): Promise<{ sessionId: string }>;
  injectWebCredentials(
    username: string,
    secret: string,
    selectors: FormSelectors,
    domain: string
  ): Promise<{ gateway: string }>;
  createSshSession(
    username: string,
    secret: string,
    host: string,
    port: number
  ): Promise<{ gateway: string }>;
  createRdpSession(
    username: string,
    secret: string,
    host: string,
    port: number
  ): Promise<{ gateway: string }>;
}
```

**Dependencies:**
- Vault Service (for decryption)
- Session Service (for session creation)
- Audit Service

**Security Considerations:**
- Broker is the ONLY place plaintext credentials are decrypted
- Plaintext exists only in broker memory during operation
- Memory is zeroized after use
- Broker never returns plaintext to caller
- All operations are audited

---

### 12. Session Service (`sessions/`)

**Responsibilities:**
- Session lifecycle management
- Session tracking
- Session recording
- Session termination
- Session query and filtering

**Key Components:**
- `sessions.controller.ts` - HTTP route handlers
- `sessions.service.ts` - Business logic
- `session.repository.ts` - Database operations

**Interfaces:**
```typescript
interface SessionService {
  createSession(input: CreateSessionInput): Promise<Session>;
  getSession(sessionId: string): Promise<Session | null>;
  updateSession(sessionId: string, input: UpdateSessionInput): Promise<Session>;
  terminateSession(sessionId: string): Promise<Session>;
  listSessions(tenantId: string, filters: SessionFilters): Promise<PaginatedResult<Session>>;
  listActiveSessions(userId: string): Promise<Session[]>;
  getSessionRecording(sessionId: string): Promise<SessionRecording | null>;
  startSessionRecording(sessionId: string): Promise<void>;
  stopSessionRecording(sessionId: string): Promise<void>;
  cleanupExpiredSessions(): Promise<number>;
}
```

**Dependencies:**
- Database (sessions, session_events)
- Credential Service
- Application Service
- User Service
- Audit Service

**Security Considerations:**
- Session operations require appropriate permissions
- Sessions can be terminated by owner or admin
- Session recording captures all activity
- Session data respects tenant isolation

---

### 13. Approval Service (`approvals/`)

**Responsibilities:**
- Access request management
- Approval workflow
- Approval state management
- JIT access enforcement

**Key Components:**
- `approvals.controller.ts` - HTTP route handlers
- `approvals.service.ts` - Business logic
- `approval.repository.ts` - Database operations

**Interfaces:**
```typescript
interface ApprovalService {
  createAccessRequest(input: CreateAccessRequestInput): Promise<AccessRequest>;
  getAccessRequest(requestId: string): Promise<AccessRequest | null>;
  listAccessRequests(tenantId: string, filters: AccessRequestFilters): Promise<PaginatedResult<AccessRequest>>;
  approveAccessRequest(requestId: string, approverId: string): Promise<AccessRequest>;
  denyAccessRequest(requestId: string, approverId: string): Promise<AccessRequest>;
  cancelAccessRequest(requestId: string): Promise<AccessRequest>;
  checkJitAccess(userId: string, credentialId: string): Promise<boolean>;
  getActiveJitWindows(userId: string): Promise<AccessRequest[]>;
  cleanupExpiredRequests(): Promise<number>;
}
```

**Dependencies:**
- Database (access_requests, approvals)
- Credential Service
- User Service
- Policy Service
- Audit Service

**Security Considerations:**
- Approval operations require appropriate permissions
- Self-approval is prevented
- Cross-tenant approval is prevented
- JIT windows are time-bound
- All approval actions are audited

---

### 14. Policy Service (`policies/`)

**Responsibilities:**
- Access policy management
- Launch policy management
- Rotation policy management
- Session policy management
- Policy evaluation

**Key Components:**
- `policies.controller.ts` - HTTP route handlers
- `policies.service.ts` - Business logic
- `policy.repository.ts` - Database operations
- `policy.evaluator.ts` - Policy evaluation engine

**Interfaces:**
```typescript
interface PolicyService {
  createPolicy(input: CreatePolicyInput): Promise<Policy>;
  getPolicy(policyId: string): Promise<Policy | null>;
  updatePolicy(policyId: string, input: UpdatePolicyInput): Promise<Policy>;
  deletePolicy(policyId: string): Promise<void>;
  listPolicies(tenantId: string, type: PolicyType): Promise<Policy[]>;
  evaluateLaunchPolicy(user: Principal, credential: Credential, application: Application): Promise<PolicyEvaluationResult>;
  evaluateAccessPolicy(user: Principal, credential: Credential): Promise<PolicyEvaluationResult>;
  evaluateSessionPolicy(user: Principal, session: Session): Promise<PolicyEvaluationResult>;
  getEffectivePolicies(userId: string): Promise<Policy[]>;
}
```

**Dependencies:**
- Database (access_policies)
- User Service
- Credential Service
- Application Service

**Security Considerations:**
- Policy operations require appropriate permissions
- Policies are evaluated in order of precedence
- Policy changes are audited
- Policies are tenant-scoped

---

### 15. Rotation Service (`rotation/`)

**Responsibilities:**
- Password rotation scheduling
- Rotation job execution
- Rotation verification
- Rotation failure handling
- Rotation history

**Key Components:**
- `rotation.controller.ts` - HTTP route handlers
- `rotation.service.ts` - Business logic
- `rotation.repository.ts` - Database operations
- `rotation.scheduler.ts` - Scheduled rotation

**Interfaces:**
```typescript
interface RotationService {
  createRotationJob(input: CreateRotationJobInput): Promise<RotationJob>;
  getRotationJob(jobId: string): Promise<RotationJob | null>;
  updateRotationJob(jobId: string, input: UpdateRotationJobInput): Promise<RotationJob>;
  deleteRotationJob(jobId: string): Promise<void>;
  listRotationJobs(tenantId: string, filters: RotationJobFilters): Promise<PaginatedResult<RotationJob>>;
  executeRotationJob(jobId: string): Promise<RotationResult>;
  verifyRotation(credentialId: string, newSecret: string): Promise<boolean>;
  rotateCredentialNow(credentialId: string, adapters: RotationAdapters): Promise<RotationResult>;
  scheduleCredentialRotation(credentialId: string, schedule: RotationSchedule): Promise<void>;
  cleanupRotationJobs(): Promise<number>;
}

interface RotationAdapters {
  changePassword: (target: string, username: string, oldPassword: string, newPassword: string) => Promise<void>;
  verify: (target: string, username: string, password: string) => Promise<boolean>;
}
```

**Dependencies:**
- Database (password_rotation_jobs, credentials)
- Vault Service (for encryption)
- Credential Service
- Audit Service

**Security Considerations:**
- Rotation operations require appropriate permissions
- Verification is mandatory before persisting new password
- Old password is retained on verification failure
- All rotation operations are audited
- Rotation adapters are pluggable per application type

---

### 16. Audit Service (`audit/`)

**Responsibilities:**
- Audit event recording
- Hash-chain maintenance
- Audit verification
- Audit query and filtering
- Audit export

**Key Components:**
- `audit.controller.ts` - HTTP route handlers
- `audit.service.ts` - Business logic
- `audit.repository.ts` - Database operations
- `audit.redactor.ts` - Secret redaction

**Interfaces:**
```typescript
interface AuditService {
  recordEvent(event: AuditEventInput): Promise<AuditEvent>;
  getAuditEvent(eventId: string): Promise<AuditEvent | null>;
  listAuditEvents(tenantId: string, filters: AuditEventFilters): Promise<PaginatedResult<AuditEvent>>;
  verifyChain(tenantId: string): Promise<VerificationResult>;
  exportAuditEvents(tenantId: string, filters: AuditEventFilters): Promise<ExportResult>;
  redactSecrets(input: string): string;
  cleanupOldEvents(tenantId: string, retentionDays: number): Promise<number>;
}

interface AuditEventInput {
  tenantId: string;
  actorId?: string;
  actorName: string;
  type: AuditType;
  resourceId?: string;
  resourceName?: string;
  result?: 'SUCCESS' | 'DENIED' | 'FAILURE';
  meta?: string;
  sourceIp?: string;
  deviceFp?: string;
}
```

**Dependencies:**
- Database (audit_events)

**Security Considerations:**
- All sensitive operations must record audit events
- Audit events are append-only
- Hash chain provides tamper evidence
- Secrets are redacted from audit meta fields
- Audit data respects tenant isolation

---

### 17. Connector Service (`connectors/`)

**Responsibilities:**
- Connector registration and management
- Connector authentication (mTLS)
- Connector lifecycle management
- Command execution
- Heartbeat monitoring

**Key Components:**
- `connectors.controller.ts` - HTTP route handlers
- `connectors.service.ts` - Business logic
- `connector.repository.ts` - Database operations
- `connector.auth.ts` - mTLS authentication

**Interfaces:**
```typescript
interface ConnectorService {
  registerConnector(input: RegisterConnectorInput): Promise<Connector>;
  getConnector(connectorId: string): Promise<Connector | null>;
  updateConnector(connectorId: string, input: UpdateConnectorInput): Promise<Connector>;
  revokeConnector(connectorId: string): Promise<Connector>;
  listConnectors(tenantId: string): Promise<Connector[]>;
  authenticateConnector(certificate: string): Promise<Connector | null>;
  executeCommand(connectorId: string, command: ConnectorCommand): Promise<CommandResult>;
  getConnectorStatus(connectorId: string): Promise<ConnectorStatus>;
  cleanupInactiveConnectors(): Promise<number>;
}

interface ConnectorCommand {
  type: 'ssh' | 'rdp' | 'db-query' | 'http';
  target: string;
  credentialId: string;
  parameters?: Record<string, string>;
}
```

**Dependencies:**
- Database (connectors)
- Vault Service (for credential decryption)
- Broker Service (for credential use)
- Audit Service

**Security Considerations:**
- Connector authentication uses mTLS
- Connectors are tenant-bound
- Connectors have command allowlists
- Connectors cannot access vault master keys
- Connector operations are audited

---

### 18. Device Service (`devices/`)

**Responsibilities:**
- Device registration and management
- Device fingerprinting
- Device trust management
- Device-based access control

**Key Components:**
- `devices.controller.ts` - HTTP route handlers
- `devices.service.ts` - Business logic
- `device.repository.ts` - Database operations

**Interfaces:**
```typescript
interface DeviceService {
  registerDevice(input: RegisterDeviceInput): Promise<Device>;
  getDevice(deviceId: string): Promise<Device | null>;
  updateDevice(deviceId: string, input: UpdateDeviceInput): Promise<Device>;
  revokeDevice(deviceId: string): Promise<Device>;
  listDevices(tenantId: string, userId?: string): Promise<Device[]>;
  getDeviceFingerprint(request: Request): string;
  isDeviceTrusted(deviceId: string): Promise<boolean>;
  cleanupInactiveDevices(): Promise<number>;
}
```

**Dependencies:**
- Database (devices)
- User Service

**Security Considerations:**
- Device fingerprinting for identification
- Device trust can be used for step-up authentication
- Device revocation prevents access from compromised devices

---

### 19. Notification Service (`notifications/`)

**Responsibilities:**
- Notification creation and delivery
- Notification preferences management
- Notification history
- Notification channels (email, webhook, etc.)

**Key Components:**
- `notifications.controller.ts` - HTTP route handlers
- `notifications.service.ts` - Business logic
- `notification.repository.ts` - Database operations
- `email.service.ts` - Email delivery
- `webhook.service.ts` - Webhook delivery

**Interfaces:**
```typescript
interface NotificationService {
  createNotification(input: CreateNotificationInput): Promise<Notification>;
  getNotification(notificationId: string): Promise<Notification | null>;
  listNotifications(tenantId: string, userId?: string): Promise<PaginatedResult<Notification>>;
  markNotificationAsRead(notificationId: string): Promise<Notification>;
  deleteNotification(notificationId: string): Promise<void>;
  sendEmailNotification(userId: string, subject: string, body: string): Promise<void>;
  sendWebhookNotification(url: string, payload: Record<string, unknown>): Promise<void>;
  cleanupOldNotifications(tenantId: string, retentionDays: number): Promise<number>;
}
```

**Dependencies:**
- Database (notifications)
- User Service
- Email configuration

**Security Considerations:**
- Notifications never contain plaintext credentials
- Notification content is redacted
- Notification delivery is best-effort

---

### 20. Health Service (`health/`)

**Responsibilities:**
- Health check endpoints
- Readiness probes
- Liveness probes
- Dependency health monitoring
- System status

**Key Components:**
- `health.controller.ts` - HTTP route handlers
- `health.service.ts` - Health check logic

**Interfaces:**
```typescript
interface HealthService {
  checkHealth(): Promise<HealthStatus>;
  checkReadiness(): Promise<ReadinessStatus>;
  checkLiveness(): Promise<LivenessStatus>;
  checkDatabase(): Promise<HealthCheckResult>;
  checkRedis(): Promise<HealthCheckResult>;
  checkKms(): Promise<HealthCheckResult>;
  getSystemStatus(): Promise<SystemStatus>;
}
```

**Dependencies:**
- Database
- Redis
- KMS

**Security Considerations:**
- Health endpoints should not expose sensitive information
- Readiness checks should verify all required dependencies
- Liveness checks should be lightweight

---

## Service Communication

### Internal Communication

Services communicate with each other through:

1. **Direct Function Calls**: Within the same process, services call each other directly
2. **Dependency Injection**: Services are injected into other services that depend on them
3. **Event Bus**: For cross-cutting concerns (e.g., audit events)

### External Communication

External communication happens through:

1. **HTTP API**: RESTful endpoints for frontend and external systems
2. **WebSockets**: For real-time updates (optional)
3. **mTLS**: For connector communication

---

## Service Dependencies

```
                    ┌─────────────────┐
                    │   Auth Service  │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼───────┐    ┌───────▼───────┐    ┌───────▼───────┐
│ Tenant Service│    │ User Service  │    │ Device Service │
└───────┬───────┘    └───────┬───────┘    └───────────────┘
        │                    │
        │        ┌───────────▼───────────┐
        │        │                     │
        │   ┌────▼─────┐       ┌───────▼───────┐
        │   │ Group     │       │  Permission    │
        │   │ Service   │       │   Service     │
        │   └────┬─────┘       └───────────────┘
        │        │
        │   ┌────▼─────┐
        │   │ Role      │
        │   │ Service   │
        │   └───────────┘
        │
┌───────▼───────────────────────────────────────────────────────┐
│                        Vault Service                              │
└───────┬───────────────────────────────────────────────────────┘
        │
        │
┌───────▼───────┐    ┌─────────────────────────────────────────┐
│ Credential     │    │                 Broker Service           │
│ Service        │    │  (Trusted Execution Boundary)           │
└───────┬───────┘    └─────────────────┬───────────────────┘
        │                              │
        │        ┌─────────────────────▼─────────────────────┐
        │        │                                       │
        ▼        ▼                                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Collection      │    │ Launch          │    │ Session         │
│ Service         │    │ Service         │    │ Service         │
└─────────────────┘    └────────┬────────┘    └────────┬────────┘
                                    │                   │
                                    ▼                   ▼
                            ┌─────────────────┐    ┌─────────────────┐
                            │ Application      │    │ Approval        │
                            │ Service          │    │ Service         │
                            └─────────────────┘    └────────┬────────┘
                                                        │
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│                    ┌─────────────────┐    ┌─────────────────┐    │
│                    │ Policy          │    │ Rotation        │    │
│                    │ Service         │    │ Service         │    │
│                    └─────────────────┘    └─────────────────┘    │
│                                                                  │
│                    ┌─────────────────┐    ┌─────────────────┐    │
│                    │ Connector       │    │ Notification    │    │
│                    │ Service         │    │ Service         │    │
│                    └─────────────────┘    └─────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   Audit          │
                    │   Service        │
                    │   (All services) │
                    └─────────────────┘
```

---

## Service Lifecycle

### Startup

1. **Configuration Validation**: All required configuration is validated on startup
2. **Database Connection**: Database connection is established and tested
3. **Redis Connection**: Redis connection is established and tested
4. **KMS Initialization**: KMS client is initialized
5. **Service Initialization**: Services are initialized in dependency order
6. **Migration Check**: Database migrations are checked and applied if needed
7. **Health Check**: Initial health check is performed

### Shutdown

1. **Graceful Shutdown Signal**: SIGTERM/SIGINT is caught
2. **Drain Connections**: Active connections are allowed to complete
3. **Cleanup Resources**: Database connections, Redis connections are closed
4. **Memory Zeroization**: Sensitive memory is zeroized
5. **Process Exit**: Process exits cleanly

---

## Service Development Guidelines

### 1. Service Structure

Each service should follow this structure:

```
service-name/
├── service-name.module.ts      # Module definition (NestJS) or index.ts
├── service-name.service.ts     # Core business logic
├── service-name.controller.ts  # HTTP route handlers
├── service-name.repository.ts  # Database operations
├── service-name.entity.ts      # TypeScript types/interfaces
├── service-name.dto.ts         # Data Transfer Objects
├── service-name.constants.ts   # Constants
├── service-name.utils.ts       # Utility functions
└── tests/                      # Service-specific tests
    ├── service-name.service.test.ts
    └── service-name.controller.test.ts
```

### 2. Service Responsibilities

Each service should:
- Have a single, clear responsibility
- Be independently testable
- Have well-defined interfaces
- Not directly access other services' databases
- Use dependency injection for dependencies
- Handle its own errors
- Log appropriately
- Audit sensitive operations

### 3. Service Communication

Services should communicate through:
- Direct function calls (preferred for in-process)
- Dependency injection
- Events (for cross-cutting concerns)
- NOT direct database access between services

### 4. Service Dependencies

Dependencies should flow downward:
- High-level services depend on low-level services
- Circular dependencies should be avoided
- Use interfaces for dependencies to enable mocking

---

## Migration to NestJS

The current implementation uses Fastify. Migration to NestJS will involve:

1. **Module Structure**: Convert each service to a NestJS module
2. **Controllers**: Convert route handlers to NestJS controllers
3. **Providers**: Convert services to NestJS providers
4. **Middleware**: Convert middleware to NestJS interceptors/guards
5. **Validation**: Use class-validator for DTO validation
6. **Dependency Injection**: Use NestJS DI system

### NestJS Module Example

```typescript
// vault.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VaultService } from './vault.service';
import { VaultController } from './vault.controller';
import { CryptoService } from './crypto.service';
import { KmsService } from './kms.service';
import { EncryptionKey } from '../database/entities/encryption-key.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EncryptionKey])],
  controllers: [VaultController],
  providers: [VaultService, CryptoService, KmsService],
  exports: [VaultService],
})
export class VaultModule {}
```

---

## Summary

The Keyrail PAM Cloud service architecture is designed for:

1. **Modularity**: Services are independent and can be developed/tested separately
2. **Maintainability**: Clear responsibilities and well-defined interfaces
3. **Scalability**: Services can be scaled independently
4. **Security**: Each service enforces its own security boundaries
5. **Testability**: Services are designed to be easily testable
6. **Evolvability**: Services can be modified or replaced with minimal impact

This architecture supports the eventual separation of services into microservices while maintaining a monolithic deployment for simplicity in the initial phases.
