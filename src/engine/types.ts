export type Role =
  | 'SUPER_ADMIN'
  | 'ORG_ADMIN'
  | 'PAM_ADMIN'
  | 'SECURITY_ADMIN'
  | 'AUDITOR'
  | 'USER'
  | 'READ_ONLY';

export type Permission =
  | 'credential.view_metadata'
  | 'credential.use'
  | 'credential.reveal'
  | 'credential.create'
  | 'credential.update'
  | 'credential.delete'
  | 'application.launch'
  | 'session.start'
  | 'session.terminate'
  | 'session.record.view'
  | 'user.create'
  | 'user.disable'
  | 'policy.create'
  | 'policy.update'
  | 'audit.view';

export interface TenantMeta {
  id: string;
  name: string;
  slug: string;
  region: string;
  plan: string;
}

export interface UserMeta {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: Role;
  title: string;
  hue: number;
  mfaMethod: 'TOTP' | 'WEBAUTHN';
  status: 'ACTIVE' | 'DISABLED';
  lastLogin: number;
  collectionIds: string[];
}

export interface SessionUser extends UserMeta {
  authMethod: 'PASSWORD+TOTP' | 'GOOGLE_SSO' | 'ENTRA_SSO' | 'WEBAUTHN';
  sessionId: string;
  issuedAt: number;
}

export interface CollectionMeta {
  id: string;
  name: string;
  hue: number;
  description: string;
  memberUserIds: string[];
}

export type CredKind = 'PASSWORD' | 'API_KEY' | 'SSH_KEY' | 'TOKEN' | 'CERT' | 'NOTE';
export type AccessMode = 'PERMANENT' | 'JIT' | 'APPROVAL_REQUIRED';

export interface CredVersion {
  v: number;
  ts: number;
  event: string;
}

export interface CredMeta {
  id: string;
  tenantId: string;
  name: string;
  target: string;
  kind: CredKind;
  username: string;
  collectionIds: string[];
  keyVersion: number;
  rotationPolicy: string;
  rotatedAt: number;
  health: 'VERIFIED' | 'PENDING' | 'FAILED';
  access: AccessMode;
  jitWindowMin?: number;
  lastUsedAt?: number;
  versions: CredVersion[];
  secretLen: number;
}

export type AppKind = 'WEB' | 'SSH' | 'RDP' | 'DB' | 'NETWORK';

export interface AppMeta {
  id: string;
  name: string;
  kind: AppKind;
  domain: string;
  url: string;
  hue: number;
  glyph: string;
  credentialId: string;
  viaConnector: boolean;
  blurb: string;
}

export interface GrantMeta {
  grantId: string;
  tokenTail: string;
  credentialId: string;
  credentialName: string;
  appId: string;
  appName: string;
  domain: string;
  issuedAt: number;
  expiresAt: number;
  consumed: boolean;
  usedAt?: number;
}

export type SessionStatus = 'ACTIVE' | 'TERMINATED' | 'EXPIRED';

export interface SessionRec {
  id: string;
  userId: string;
  userName: string;
  credentialId: string;
  credentialName: string;
  appId: string;
  appName: string;
  appKind: AppKind;
  startedAt: number;
  expiresAt?: number;
  endedAt?: number;
  status: SessionStatus;
  ip: string;
  device: string;
  gateway: string;
  recording: boolean;
  injectedBy: string;
}

export type AuditType =
  | 'USER_LOGIN'
  | 'MFA_SUCCESS'
  | 'MFA_FAILURE'
  | 'CREDENTIAL_CREATED'
  | 'CREDENTIAL_UPDATED'
  | 'CREDENTIAL_USED'
  | 'CREDENTIAL_REVEAL'
  | 'APPLICATION_LAUNCHED'
  | 'SESSION_STARTED'
  | 'SESSION_TERMINATED'
  | 'ACCESS_REQUESTED'
  | 'ACCESS_APPROVED'
  | 'ACCESS_DENIED'
  | 'PASSWORD_ROTATED'
  | 'USER_CREATED'
  | 'ROLE_CHANGED'
  | 'POLICY_CHANGED'
  | 'GRANT_ISSUED'
  | 'GRANT_REPLAY_BLOCKED'
  | 'BREAK_GLASS'
  | 'CONNECTOR_REGISTERED'
  | 'API_KEY_CREATED'
  | 'RED_TEAM_PROBE';

export interface AuditEvent {
  id: string;
  seq: number;
  ts: number;
  tenantId: string;
  actorId: string;
  actorName: string;
  type: AuditType;
  resourceName?: string;
  resourceId?: string;
  result: 'SUCCESS' | 'DENIED' | 'FAILURE';
  meta?: string;
  ip: string;
  hash: string;
  prevHash: string;
}

export interface AccessRequest {
  id: string;
  userId: string;
  userName: string;
  credentialId: string;
  credentialName: string;
  reason: string;
  ticket: string;
  hours: number;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
  createdAt: number;
  decidedAt?: number;
  approverName?: string;
  expiresAt?: number;
}

export interface ConnectorMeta {
  id: string;
  name: string;
  site: string;
  status: 'HEALTHY' | 'OFFLINE';
  registeredAt: number;
  mtls: boolean;
  lastHeartbeat: number;
  version: string;
}

export interface ApiKeyMeta {
  id: string;
  label: string;
  prefix: string;
  createdAt: number;
  scopes: string[];
  lastUsed?: number;
}

export interface RotationJob {
  credentialId: string;
  credentialName: string;
  policy: string;
  lastRun: number;
  nextRun: number;
  status: 'HEALTHY' | 'DUE' | 'FAILED';
  history: { ts: number; result: 'SUCCESS' | 'FAILED'; keyVersion: number }[];
}

export interface AlertMeta {
  id: string;
  severity: 'HIGH' | 'MEDIUM';
  title: string;
  detail: string;
  ts: number;
}

export interface RevealWindow {
  credentialId: string;
  credentialName: string;
  value: string;
  issuedAt: number;
  expiresAt: number;
  watermarkedTo: string;
}

export interface ProbeResult {
  attack: string;
  label: string;
  vector: string;
  outcome: string;
  control: string;
  auditId: string;
}

export interface Snapshot {
  version: number;
  tenant: TenantMeta;
  users: UserMeta[];
  collections: CollectionMeta[];
  credentials: CredMeta[];
  apps: AppMeta[];
  grants: GrantMeta[];
  sessions: SessionRec[];
  requests: AccessRequest[];
  audit: AuditEvent[];
  connectors: ConnectorMeta[];
  apiKeys: ApiKeyMeta[];
  rotation: RotationJob[];
  alerts: AlertMeta[];
  launchSeries: number[];
}

export interface PamError {
  code: string;
  message: string;
  auditId?: string;
}
