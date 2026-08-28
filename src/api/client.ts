/**
 * Keyrail PAM - Real API Client
 * 
 * This client communicates with the real backend API.
 * NO in-memory simulation. NO hardcoded data. NO demo users.
 * 
 * All operations go through HTTP to the backend, which persists to PostgreSQL.
 */

const API_BASE = import.meta.env.NEXT_PUBLIC_API_URL || import.meta.env.VITE_API_URL || '/api';

// Configuration - will be set during initial setup
let tenantSlug: string | null = null;

export function configureTenant(slug: string) {
  tenantSlug = slug;
}

export function getTenantSlug() {
  return tenantSlug;
}

// Helper to build URLs with tenant context
function apiUrl(path: string): string {
  // For now, we'll use the default tenant or pass it in headers
  // In production, tenant is derived from the JWT
  return `${API_BASE}${path}`;
}

// HTTP client with error handling
async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<T> {
  const url = apiUrl(path);
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    // Try to get error details
    try {
      const errorData = await response.json();
      throw new ApiError(
        response.status,
        errorData.error || 'UNKNOWN_ERROR',
        errorData.message || 'An error occurred',
        errorData.auditId
      );
    } catch {
      throw new ApiError(
        response.status,
        'NETWORK_ERROR',
        `HTTP ${response.status}: ${response.statusText}`
      );
    }
  }

  return response.json() as Promise<T>;
}

// Custom error class
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public auditId?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Type definitions for API responses

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  title?: string;
  status: 'ACTIVE' | 'DISABLED' | 'LOCKED';
  mfaRequired: boolean;
  lastLoginAt?: string;
  createdAt: string;
  tenantId: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantId: string;
  authMethod: string;
  sessionId: string;
  issuedAt: number;
}

export interface CredentialMetadata {
  id: string;
  name: string;
  target: string;
  kind: 'PASSWORD' | 'API_KEY' | 'SSH_KEY' | 'TOKEN' | 'SECURE_NOTE' | 'RECOVERY_CODES';
  username: string;
  keyVersion: number;
  rotationPolicy: string;
  access: 'PERMANENT' | 'APPROVAL_REQUIRED' | 'ONE_TIME' | 'SCHEDULED' | 'EMERGENCY';
  jitWindowMin?: number;
  health: 'VERIFIED' | 'PENDING' | 'FAILED';
  rotatedAt: string;
  lastUsedAt?: string;
  secretLength: number;
  createdAt: string;
  collectionIds: string[];
}

export interface Application {
  id: string;
  name: string;
  kind: 'WEB' | 'SSH' | 'RDP' | 'DB' | 'NETWORK';
  domain: string;
  url: string;
  credentialId: string;
  viaConnector: boolean;
  authFlow: string;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  memberUserIds: string[];
}

export interface SessionRec {
  id: string;
  userId: string;
  userName: string;
  credentialId: string;
  credentialName: string;
  appId: string;
  appName: string;
  appKind: string;
  startedAt: number;
  expiresAt: number;
  status: 'ACTIVE' | 'EXPIRED' | 'TERMINATED';
  ip: string;
  device: string;
  gateway: string;
  recording: boolean;
  injectedBy: string;
  endedAt?: number;
}

export interface AccessRequest {
  id: string;
  userId: string;
  userName: string;
  credentialId: string;
  credentialName: string;
  reason: string;
  ticket?: string;
  hours: number;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
  createdAt: number;
  decidedAt?: number;
  approverName?: string;
  expiresAt?: number;
}

export interface AuditEvent {
  id: string;
  seq: number;
  ts: number;
  tenantId: string;
  actorId: string;
  actorName: string;
  type: string;
  resourceId?: string;
  resourceName?: string;
  result: 'SUCCESS' | 'FAILURE' | 'DENIED';
  meta?: string;
  ip: string;
  hash: string;
  prevHash: string;
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
}

export interface Snapshot {
  version: number;
  tenant: {
    id: string;
    name: string;
    slug: string;
    region: string;
    plan: string;
  };
  users: User[];
  collections: Collection[];
  credentials: CredentialMetadata[];
  apps: Application[];
  grants: GrantMeta[];
  sessions: SessionRec[];
  requests: AccessRequest[];
  audit: AuditEvent[];
  connectors: any[];
  apiKeys: any[];
  rotation: any[];
  alerts: any[];
  launchSeries: number[];
}

export interface LoginResponse {
  mfaRequired: boolean;
  mfaToken?: string;
  user?: { name: string; email: string };
}

export interface MfaVerifyResponse {
  ok: boolean;
}

// ============================================================================
// AUTHENTICATION API
// ============================================================================

export const authApi = {
  // Check if initial setup is needed
  async checkInitialSetup(): Promise<{ requiresSetup: boolean; hasUsers: boolean }> {
    try {
      const response = await apiRequest<{ requiresSetup: boolean; hasUsers: boolean }>(
        'GET',
        '/setup/check'
      );
      return response;
    } catch (error) {
      // If we get a 404, assume we need setup
      if (error instanceof ApiError && error.status === 404) {
        return { requiresSetup: true, hasUsers: false };
      }
      throw error;
    }
  },

  // Initialize the system (first admin, first tenant)
  async initializeSystem(params: {
    organizationName: string;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
    tenantSlug: string;
  }): Promise<{ ok: boolean; user: SessionUser }> {
    const response = await apiRequest<{ ok: boolean; user: SessionUser }>(
      'POST',
      '/setup/initialize',
      params
    );
    tenantSlug = params.tenantSlug;
    return response;
  },

  // Login with email/password
  async login(email: string, password: string, tenant?: string): Promise<LoginResponse> {
    const body: { email: string; password: string; tenant?: string } = {
      email,
      password,
    };
    if (tenant) {
      body.tenant = tenant;
    }
    return apiRequest<LoginResponse>('POST', '/auth/login', body);
  },

  // Verify MFA (TOTP)
  async verifyMfa(mfaToken: string, code: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>('POST', '/auth/mfa', { mfaToken, code });
  },

  // Get current user
  async me(): Promise<User> {
    return apiRequest<User>('GET', '/me');
  },

  // Logout
  async logout(): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>('POST', '/auth/logout');
  },

  // Refresh session
  async refresh(): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>('POST', '/auth/refresh');
  },
};

// ============================================================================
// USER MANAGEMENT API
// ============================================================================

export const userApi = {
  // List all users
  async list(): Promise<User[]> {
    return apiRequest<User[]>('GET', '/users');
  },

  // Get a specific user
  async get(userId: string): Promise<User> {
    return apiRequest<User>(`GET`, `/users/${userId}`);
  },

  // Create a new user
  async create(params: {
    name: string;
    email: string;
    title?: string;
    role: string;
    collectionIds: string[];
    password?: string; // If provided, set initial password
    sendInvite: boolean; // Whether to send invitation email
  }): Promise<{ id: string }> {
    return apiRequest<{ id: string }>('POST', '/users', params);
  },

  // Update a user
  async update(userId: string, params: {
    name?: string;
    title?: string;
    role?: string;
    collectionIds?: string[];
    status?: 'ACTIVE' | 'DISABLED';
  }): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`PATCH`, `/users/${userId}`, params);
  },

  // Delete a user
  async delete(userId: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`DELETE`, `/users/${userId}`);
  },

  // Invite a user (send email invitation)
  async invite(email: string, role: string, collectionIds: string[]): Promise<{ ok: boolean; inviteToken: string }> {
    return apiRequest<{ ok: boolean; inviteToken: string }>('POST', '/users/invite', {
      email,
      role,
      collectionIds,
    });
  },

  // Complete invitation (set password)
  async completeInvite(inviteToken: string, password: string, name: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>('POST', '/users/invite/complete', {
      inviteToken,
      password,
      name,
    });
  },

  // Change password
  async changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>('POST', '/users/password/change', {
      currentPassword,
      newPassword,
    });
  },

  // Reset password (admin)
  async resetPassword(userId: string): Promise<{ ok: boolean; resetToken: string }> {
    return apiRequest<{ ok: boolean; resetToken: string }>(`POST`, `/users/${userId}/password/reset`);
  },
};

// ============================================================================
// COLLECTION API
// ============================================================================

export const collectionApi = {
  // List all collections
  async list(): Promise<Collection[]> {
    return apiRequest<Collection[]>('GET', '/collections');
  },

  // Get a specific collection
  async get(collectionId: string): Promise<Collection> {
    return apiRequest<Collection>(`GET`, `/collections/${collectionId}`);
  },

  // Create a new collection
  async create(params: {
    name: string;
    description?: string;
    memberUserIds: string[];
  }): Promise<{ id: string }> {
    return apiRequest<{ id: string }>('POST', '/collections', params);
  },

  // Update a collection
  async update(collectionId: string, params: {
    name?: string;
    description?: string;
    memberUserIds?: string[];
  }): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`PATCH`, `/collections/${collectionId}`, params);
  },

  // Delete a collection
  async delete(collectionId: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`DELETE`, `/collections/${collectionId}`);
  },

  // Add user to collection
  async addUser(collectionId: string, userId: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`POST`, `/collections/${collectionId}/users/${userId}`);
  },

  // Remove user from collection
  async removeUser(collectionId: string, userId: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`DELETE`, `/collections/${collectionId}/users/${userId}`);
  },
};

// ============================================================================
// CREDENTIAL API
// ============================================================================

export const credentialApi = {
  // List all credentials (metadata only, NEVER secrets)
  async list(): Promise<CredentialMetadata[]> {
    return apiRequest<CredentialMetadata[]>('GET', '/credentials');
  },

  // Get a specific credential (metadata only)
  async get(credentialId: string): Promise<CredentialMetadata> {
    return apiRequest<CredentialMetadata>(`GET`, `/credentials/${credentialId}`);
  },

  // Create a new credential
  async create(params: {
    name: string;
    target: string;
    kind: 'PASSWORD' | 'API_KEY' | 'SSH_KEY' | 'TOKEN' | 'SECURE_NOTE' | 'RECOVERY_CODES';
    username: string;
    secret: string; // This is encrypted server-side
    collectionIds: string[];
    access: 'PERMANENT' | 'APPROVAL_REQUIRED' | 'ONE_TIME' | 'SCHEDULED' | 'EMERGENCY';
    rotationPolicy?: string;
    jitWindowMin?: number;
  }): Promise<{ id: string; keyVersion: number }> {
    return apiRequest<{ id: string; keyVersion: number }>('POST', '/credentials', params);
  },

  // Update credential metadata (NOT the secret)
  async update(credentialId: string, params: {
    name?: string;
    target?: string;
    username?: string;
    rotationPolicy?: string;
    access?: 'PERMANENT' | 'APPROVAL_REQUIRED' | 'ONE_TIME' | 'SCHEDULED' | 'EMERGENCY';
    jitWindowMin?: number;
    collectionIds?: string[];
  }): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`PATCH`, `/credentials/${credentialId}`, params);
  },

  // Delete a credential
  async delete(credentialId: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`DELETE`, `/credentials/${credentialId}`);
  },

  // Request access to a credential (JIT)
  async requestAccess(credentialId: string, reason: string, hours: number, ticket?: string): Promise<{ id: string }> {
    return apiRequest<{ id: string }>(`POST`, `/credentials/${credentialId}/request-access`, {
      reason,
      hours,
      ticket,
    });
  },

  // Rotate a credential
  async rotate(credentialId: string): Promise<{ ok: boolean; newKeyVersion: number }> {
    return apiRequest<{ ok: boolean; newKeyVersion: number }>(`POST`, `/credentials/${credentialId}/rotate`);
  },

  // Get credential usage history
  async history(credentialId: string): Promise<any[]> {
    return apiRequest<any[]>(`GET`, `/credentials/${credentialId}/history`);
  },
};

// ============================================================================
// APPLICATION API
// ============================================================================

export const applicationApi = {
  // List all applications
  async list(): Promise<Application[]> {
    return apiRequest<Application[]>('GET', '/applications');
  },

  // Get a specific application
  async get(applicationId: string): Promise<Application> {
    return apiRequest<Application>(`GET`, `/applications/${applicationId}`);
  },

  // Create a new application
  async create(params: {
    name: string;
    kind: 'WEB' | 'SSH' | 'RDP' | 'DB' | 'NETWORK';
    domain: string;
    url: string;
    credentialId: string;
    loginSelectors?: Record<string, string>;
    authFlow?: string;
    blurb?: string;
  }): Promise<{ id: string }> {
    return apiRequest<{ id: string }>('POST', '/applications', params);
  },

  // Update an application
  async update(applicationId: string, params: {
    name?: string;
    domain?: string;
    url?: string;
    credentialId?: string;
    loginSelectors?: Record<string, string>;
    authFlow?: string;
    blurb?: string;
  }): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`PATCH`, `/applications/${applicationId}`, params);
  },

  // Delete an application
  async delete(applicationId: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`DELETE`, `/applications/${applicationId}`);
  },

  // Launch an application
  async launch(credentialId: string, applicationId: string): Promise<GrantMeta> {
    return apiRequest<GrantMeta>(`POST`, `/credentials/${credentialId}/launch`, {
      applicationId,
    });
  },

  // Consume a launch grant (called by browser extension)
  async consumeGrant(token: string, kind: 'web-inject' | 'ssh-proxy' | 'rdp-proxy' | 'db-proxy'): Promise<SessionRec> {
    return apiRequest<SessionRec>('POST', '/launch/consume', {
      token,
      kind,
    });
  },
};

// ============================================================================
// SESSION API
// ============================================================================

export const sessionApi = {
  // List active sessions
  async list(): Promise<SessionRec[]> {
    return apiRequest<SessionRec[]>('GET', '/sessions');
  },

  // Get a specific session
  async get(sessionId: string): Promise<SessionRec> {
    return apiRequest<SessionRec>(`GET`, `/sessions/${sessionId}`);
  },

  // Terminate a session
  async terminate(sessionId: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`POST`, `/sessions/${sessionId}/terminate`);
  },

  // Terminate all sessions for a user
  async terminateAll(userId: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`POST`, `/users/${userId}/sessions/terminate`);
  },
};

// ============================================================================
// ACCESS REQUEST / APPROVAL API
// ============================================================================

export const approvalApi = {
  // List access requests
  async list(): Promise<AccessRequest[]> {
    return apiRequest<AccessRequest[]>('GET', '/access-requests');
  },

  // Get a specific request
  async get(requestId: string): Promise<AccessRequest> {
    return apiRequest<AccessRequest>(`GET`, `/access-requests/${requestId}`);
  },

  // Approve a request
  async approve(requestId: string, comment?: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`POST`, `/access-requests/${requestId}/approve`, {
      comment,
    });
  },

  // Deny a request
  async deny(requestId: string, comment?: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`POST`, `/access-requests/${requestId}/deny`, {
      comment,
    });
  },
};

// ============================================================================
// AUDIT API
// ============================================================================

export const auditApi = {
  // List audit events
  async list(params?: { type?: string; limit?: number; offset?: number }): Promise<AuditEvent[]> {
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    
    const path = `/audit-events${query.toString() ? '?' + query.toString() : ''}`;
    return apiRequest<AuditEvent[]>('GET', path);
  },

  // Get a specific audit event
  async get(eventId: string): Promise<AuditEvent> {
    return apiRequest<AuditEvent>(`GET`, `/audit-events/${eventId}`);
  },

  // Export audit events (for SIEM)
  async export(params: { type?: string; startTime?: string; endTime?: string }): Promise<{ ok: boolean; downloadUrl: string }> {
    return apiRequest<{ ok: boolean; downloadUrl: string }>('POST', '/audit-events/export', params);
  },

  // Verify audit chain integrity
  async verifyChain(): Promise<{ ok: boolean; valid: boolean; lastHash: string }> {
    return apiRequest<{ ok: boolean; valid: boolean; lastHash: string }>('GET', '/audit-events/verify-chain');
  },
};

// ============================================================================
// POLICY API
// ============================================================================

export const policyApi = {
  // List access policies
  async list(): Promise<any[]> {
    return apiRequest<any[]>('GET', '/policies');
  },

  // Create a policy
  async create(params: {
    name: string;
    rule: Record<string, unknown>;
    enabled?: boolean;
  }): Promise<{ id: string }> {
    return apiRequest<{ id: string }>('POST', '/policies', params);
  },

  // Update a policy
  async update(policyId: string, params: {
    name?: string;
    rule?: Record<string, unknown>;
    enabled?: boolean;
  }): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`PATCH`, `/policies/${policyId}`, params);
  },

  // Delete a policy
  async delete(policyId: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`DELETE`, `/policies/${policyId}`);
  },
};

// ============================================================================
// CONNECTOR API
// ============================================================================

export const connectorApi = {
  // List connectors
  async list(): Promise<any[]> {
    return apiRequest<any[]>('GET', '/connectors');
  },

  // Register a new connector
  async register(params: {
    name: string;
    site: string;
    deviceCertFp: string;
  }): Promise<{ id: string }> {
    return apiRequest<{ id: string }>('POST', '/connectors', params);
  },

  // Get connector status
  async status(connectorId: string): Promise<any> {
    return apiRequest<any>(`GET`, `/connectors/${connectorId}/status`);
  },

  // Revoke a connector
  async revoke(connectorId: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`POST`, `/connectors/${connectorId}/revoke`);
  },
};

// ============================================================================
// TENANT API
// ============================================================================

export const tenantApi = {
  // Get current tenant info
  async me(): Promise<{
    id: string;
    name: string;
    slug: string;
    region: string;
    plan: string;
    createdAt: string;
  }> {
    return apiRequest<{
      id: string;
      name: string;
      slug: string;
      region: string;
      plan: string;
      createdAt: string;
    }>('GET', '/tenant');
  },

  // Update tenant
  async update(params: {
    name?: string;
    region?: string;
    plan?: string;
  }): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>('PATCH', '/tenant', params);
  },
};

// ============================================================================
// HEALTH CHECK
// ============================================================================

export const healthApi = {
  async check(): Promise<{ ok: boolean; ts: number }> {
    return apiRequest<{ ok: boolean; ts: number }>('GET', '/healthz');
  },
};

// ============================================================================
// Export all APIs
// ============================================================================

export const api = {
  auth: authApi,
  user: userApi,
  collection: collectionApi,
  credential: credentialApi,
  application: applicationApi,
  session: sessionApi,
  approval: approvalApi,
  audit: auditApi,
  policy: policyApi,
  connector: connectorApi,
  tenant: tenantApi,
  health: healthApi,
};

export default api;
