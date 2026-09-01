/**
 * Keyrail API client.
 * Real HTTP only: backend failures are surfaced to the UI instead of converted
 * into fabricated users, credentials, IDs, or empty lists.
 */
const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api';
let tenantSlug: string | null = null;

export function configureTenant(slug: string) { tenantSlug = slug; }
export function getTenantSlug() { return tenantSlug; }
function apiUrl(path: string) { return `${API_BASE}${path}`; }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public auditId?: string) {
    super(message); this.name = 'ApiError';
  }
}

async function apiRequest<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : await response.text().catch(() => '');
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'message' in payload ? String((payload as any).message) : `HTTP ${response.status}: ${response.statusText}`;
    const code = typeof payload === 'object' && payload && 'error' in payload ? String((payload as any).error) : 'HTTP_ERROR';
    const auditId = typeof payload === 'object' && payload && 'auditId' in payload ? String((payload as any).auditId) : undefined;
    throw new ApiError(response.status, code, message, auditId);
  }
  return payload as T;
}

export interface User { id:string; name:string; email:string; role:string; title?:string; status:'ACTIVE'|'DISABLED'|'LOCKED'; mfaRequired:boolean; lastLoginAt?:string; createdAt:string; tenantId:string; }
export interface SessionUser { id:string; name:string; email:string; role:string; tenantId:string; authMethod:string; sessionId:string; issuedAt:number; hue?:string; }
export type Credential = CredentialMetadata;
export interface CredentialMetadata { id:string; name:string; target:string; kind:'PASSWORD'|'API_KEY'|'SSH_KEY'|'TOKEN'|'SECURE_NOTE'|'RECOVERY_CODES'; username:string; keyVersion:number; rotationPolicy:string; access:'PERMANENT'|'APPROVAL_REQUIRED'|'ONE_TIME'|'SCHEDULED'|'EMERGENCY'; jitWindowMin?:number; health:'VERIFIED'|'PENDING'|'FAILED'; rotatedAt:string; lastUsedAt?:string; secretLength:number; createdAt:string; collectionIds:string[]; }
export interface Application { id:string; name:string; kind:'WEB'|'SSH'|'RDP'|'DB'|'NETWORK'; domain:string; url:string; credentialId:string; viaConnector:boolean; authFlow:string; collectionId?:string; description?:string; targetUrl?:string; access?:string; }
export interface Collection { id:string; name:string; description?:string; memberUserIds:string[]; }
export interface SessionRec { id:string; userId:string; userName:string; credentialId:string; credentialName:string; appId:string; appName:string; appKind:string; startedAt:number; expiresAt:number; status:'ACTIVE'|'EXPIRED'|'TERMINATED'; ip:string; device:string; gateway:string; recording:boolean; injectedBy:string; endedAt?:number; }
export interface AccessRequest { id:string; userId:string; userName:string; credentialId:string; credentialName:string; reason:string; ticket?:string; hours:number; status:'PENDING'|'APPROVED'|'DENIED'|'EXPIRED'; createdAt:number; decidedAt?:number; approverName?:string; expiresAt?:number; }
export interface AuditEvent { id:string; seq:number; ts:number; tenantId:string; actorId:string; actorName:string; type:string; resourceId?:string; resourceName?:string; result:'SUCCESS'|'FAILURE'|'DENIED'; meta?:string; ip:string; hash:string; prevHash:string; }
export interface LaunchSession { sessionId:string; appName:string; credentialName:string; targetUrl:string; status:string; startedAt:number; expiresAt:number; error?:string; challengeMessage?:string; }
export interface LoginResponse { mfaRequired:boolean; mfaToken?:string; user?:{name:string;email:string}; }

export const authApi = {
  checkInitialSetup: () => apiRequest<{requiresSetup:boolean;hasUsers:boolean}>('GET','/setup/check'),
  initializeSystem: async (params:{organizationName:string;adminName:string;adminEmail:string;adminPassword:string;tenantSlug:string}) => {
    const response = await apiRequest<{ok:boolean;user:SessionUser}>('POST','/setup/initialize',params); tenantSlug = params.tenantSlug; return response;
  },
  login: (email:string,password:string,tenant?:string) => apiRequest<LoginResponse>('POST','/auth/login',{email,password,tenant:tenant || tenantSlug || 'meridian'}),
  verifyMfa: (mfaToken:string,code:string) => apiRequest<{ok:boolean}>('POST','/auth/mfa',{mfaToken,code}),
  me: () => apiRequest<User>('GET','/me'),
  logout: () => apiRequest<{ok:boolean}>('POST','/auth/logout'),
  refresh: () => apiRequest<{ok:boolean}>('POST','/auth/refresh'),
};

export const userApi = {
  list: () => apiRequest<User[]>('GET','/users'),
  get: (userId:string) => apiRequest<User>('GET',`/users/${userId}`),
  create: (params:any) => apiRequest<{id:string}>('POST','/users',params),
  update: (userId:string,params:any) => apiRequest<{ok:boolean}>('PATCH',`/users/${userId}`,params),
  delete: (userId:string) => apiRequest<{ok:boolean}>('DELETE',`/users/${userId}`),
  invite: (email:string,role:string,collectionIds:string[]) => apiRequest<{ok:boolean;inviteToken:string}>('POST','/users/invite',{email,role,collectionIds}),
  completeInvite: (inviteToken:string,password:string,name:string) => apiRequest<{ok:boolean}>('POST','/users/invite/complete',{inviteToken,password,name}),
  changePassword: (currentPassword:string,newPassword:string) => apiRequest<{ok:boolean}>('POST','/users/password/change',{currentPassword,newPassword}),
  resetPassword: (userId:string) => apiRequest<{ok:boolean;resetToken:string}>('POST',`/users/${userId}/password/reset`),
};

export const collectionApi = {
  list: () => apiRequest<Collection[]>('GET','/collections'),
  get: (id:string) => apiRequest<Collection>('GET',`/collections/${id}`),
  create: (params:any) => apiRequest<{id:string}>('POST','/collections',params),
  update: (id:string,params:any) => apiRequest<{ok:boolean}>('PATCH',`/collections/${id}`,params),
  delete: (id:string) => apiRequest<{ok:boolean}>('DELETE',`/collections/${id}`),
  addUser: (collectionId:string,userId:string) => apiRequest<{ok:boolean}>('POST',`/collections/${collectionId}/users/${userId}`),
  removeUser: (collectionId:string,userId:string) => apiRequest<{ok:boolean}>('DELETE',`/collections/${collectionId}/users/${userId}`),
};

export const credentialApi = {
  list: () => apiRequest<CredentialMetadata[]>('GET','/credentials'),
  get: (id:string) => apiRequest<CredentialMetadata>('GET',`/credentials/${id}`),
  create: (params:any) => apiRequest<{id:string;keyVersion:number}>('POST','/credentials',params),
  update: (id:string,params:any) => apiRequest<{ok:boolean}>(`PATCH`,`/credentials/${id}`,params),
  delete: (id:string) => apiRequest<{ok:boolean}>('DELETE',`/credentials/${id}`),
  requestAccess: (id:string,reason:string,hours:number,ticket?:string) => apiRequest<{id:string}>('POST',`/credentials/${id}/request-access`,{reason,hours,ticket}),
  rotate: (id:string) => apiRequest<{ok:boolean;newKeyVersion:number}>('POST',`/credentials/${id}/rotate`),
  history: (id:string) => apiRequest<any[]>('GET',`/credentials/${id}/history`),
};

export const applicationApi = {
  list: () => apiRequest<Application[]>('GET','/applications'),
  get: (id:string) => apiRequest<Application>('GET',`/applications/${id}`),
  create: (params:any) => apiRequest<{id:string}>('POST','/applications',params),
  update: (id:string,params:any) => apiRequest<{ok:boolean}>(`PATCH`,`/applications/${id}`,params),
  delete: (id:string) => apiRequest<{ok:boolean}>('DELETE',`/applications/${id}`),
  launchRealSession: (id:string) => apiRequest<LaunchSession>('POST',`/applications/${id}/launch`,{}),
};

export const launchSessionsApi = {
  launch: (id:string) => apiRequest<LaunchSession>('POST',`/applications/${id}/launch`,{}),
  get: (id:string) => apiRequest<LaunchSession>('GET',`/launch-sessions/${id}`),
  list: () => apiRequest<LaunchSession[]>('GET','/launch-sessions'),
  close: (id:string) => apiRequest<{ok:boolean}>('POST',`/launch-sessions/${id}/close`),
};

export const sessionApi = {
  list: () => apiRequest<SessionRec[]>('GET','/sessions'),
  get: (id:string) => apiRequest<SessionRec>(`GET`,`/sessions/${id}`),
  create: (params:{credentialId:string;applicationId:string}) => launchSessionsApi.launch(params.applicationId),
  terminate: (id:string) => apiRequest<{ok:boolean}>('POST',`/sessions/${id}/terminate`),
  terminateAll: (userId:string) => apiRequest<{ok:boolean}>('POST',`/users/${userId}/sessions/terminate`),
};

export const approvalApi = {
  list: () => apiRequest<AccessRequest[]>('GET','/access-requests'),
  get: (id:string) => apiRequest<AccessRequest>('GET',`/access-requests/${id}`),
  create: (params:{credentialId:string;reason:string;hours?:number;durationHours?:number;ticket?:string;ticketReference?:string}) => credentialApi.requestAccess(params.credentialId,params.reason,params.hours ?? params.durationHours ?? 1,params.ticket ?? params.ticketReference),
  approve: (id:string,comment?:string) => apiRequest<{ok:boolean}>('POST',`/access-requests/${id}/approve`,{comment}),
  deny: (id:string,comment?:string) => apiRequest<{ok:boolean}>('POST',`/access-requests/${id}/deny`,{comment}),
};

export const auditApi = {
  list: (params?:{type?:string;limit?:number;offset?:number}) => {
    const q = new URLSearchParams(); if(params?.type)q.set('type',params.type); if(params?.limit)q.set('limit',String(params.limit)); if(params?.offset)q.set('offset',String(params.offset));
    return apiRequest<AuditEvent[]>('GET',`/audit-events${q.toString()?`?${q}`:''}`);
  },
  get: (id:string) => apiRequest<AuditEvent>('GET',`/audit-events/${id}`),
  export: (params:any) => apiRequest<{ok:boolean;downloadUrl:string}>('POST','/audit-events/export',params),
  verifyChain: () => apiRequest<{ok:boolean;valid:boolean;lastHash:string}>('GET','/audit-events/verify-chain'),
};

export const policyApi = {
  list: () => apiRequest<any[]>('GET','/policies'),
  create: (params:any) => apiRequest<{id:string}>('POST','/policies',params),
  update: (id:string,params:any) => apiRequest<{ok:boolean}>(`PATCH`,`/policies/${id}`,params),
  delete: (id:string) => apiRequest<{ok:boolean}>(`DELETE`,`/policies/${id}`),
};
export const connectorApi = {
  list: () => apiRequest<any[]>('GET','/connectors'),
  register: (params:any) => apiRequest<{id:string}>('POST','/connectors',params),
  status: (id:string) => apiRequest<any>('GET',`/connectors/${id}/status`),
  revoke: (id:string) => apiRequest<{ok:boolean}>('POST',`/connectors/${id}/revoke`),
};
export const tenantApi = {
  me: () => apiRequest<any>('GET','/tenant'),
  get() { return this.me(); },
  update: (params:any) => apiRequest<{ok:boolean}>('PATCH','/tenant',params),
};
export const healthApi = { check: () => apiRequest<{ok:boolean;ts:number}>('GET','/healthz') };
export const api = { auth:authApi, user:userApi, users:userApi, collection:collectionApi, collections:collectionApi, credential:credentialApi, credentials:credentialApi, application:applicationApi, applications:applicationApi, session:sessionApi, sessions:sessionApi, launchSessions:launchSessionsApi, approval:approvalApi, accessRequests:approvalApi, requests:approvalApi, audit:auditApi, policy:policyApi, connector:connectorApi, tenant:tenantApi, health:healthApi };
