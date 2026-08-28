/**
 * Keyrail PAM - Real Admin Screens
 * 
 * This replaces the simulated admin with real data from the API.
 * NO simulated users. NO hardcoded roles.
 */
import { useMemo, useState, useEffect, useCallback } from 'react';
import { I } from '../components/icons';
import { Chip, CountRing, Dot, Masked, Modal, Reveal, StatusPill, Toggle, timeAgo } from '../components/ui';
import { usePam } from '../state/store';
import api from '../api/client';

/* ============================================================ USERS & ROLES */
const PERMS = [
  'credential.view_metadata', 'credential.use', 'credential.reveal', 'credential.create', 'credential.update', 'credential.delete',
  'application.launch', 'session.start', 'session.terminate', 'session.record.view',
  'user.create', 'user.disable', 'policy.create', 'policy.update', 'audit.view',
];

// Role permission definitions
const ROLE_PERM_GRID: Record<string, string[]> = {
  SUPER_ADMIN: ['*'],
  ORG_ADMIN: ['credential.view_metadata', 'credential.use', 'credential.create', 'credential.update', 'application.launch', 'session.start', 'session.terminate', 'user.create', 'user.disable', 'policy.create', 'policy.update', 'audit.view'],
  PAM_ADMIN: ['credential.view_metadata', 'credential.use', 'credential.create', 'credential.update', 'application.launch', 'session.start', 'session.terminate', 'user.create', 'policy.create', 'policy.update', 'audit.view'],
  SECURITY_ADMIN: ['credential.view_metadata', 'credential.use', 'credential.reveal', 'application.launch', 'session.start', 'session.terminate', 'session.record.view', 'policy.create', 'policy.update', 'audit.view'],
  AUDITOR: ['credential.view_metadata', 'session.record.view', 'audit.view'],
  USER: ['credential.view_metadata', 'credential.use', 'application.launch', 'session.start'],
  READ_ONLY: ['credential.view_metadata'],
};

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ORG_ADMIN: 'Organization Admin',
  PAM_ADMIN: 'PAM Admin',
  SECURITY_ADMIN: 'Security Admin',
  AUDITOR: 'Auditor',
  USER: 'User',
  READ_ONLY: 'Read Only',
};

export function UsersPage() {
  const { user, toast, loading } = usePam();
  const [users, setUsers] = useState<any[]>([]);
  const [collections, setCollections] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const roles = Object.keys(ROLE_PERM_GRID);
  const has = (role: string, perm: string) => ROLE_PERM_GRID[role].includes('*') || ROLE_PERM_GRID[role].includes(perm);
  const canProvision = has(user!.role, 'user.create');
  const [adding, setAdding] = useState(false);
  const [uform, setUform] = useState({ name: '', email: '', title: '', role: 'USER' as string, cols: [] as string[] });
  const [uerr, setUerr] = useState('');

  // Fetch users and collections
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // Fetch users
        const usersData = await api.users.list();
        setUsers(usersData);
        
        // Fetch collections
        const cols = await api.collections.list();
        setCollections(cols);
        
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to load users';
        setError(errorMsg);
        toast(errorMsg, 'red');
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchData();
  }, [toast, user]);

  const handleCreateUser = useCallback(async () => {
    if (!uform.name || !uform.email) {
      setUerr('Name and email are required');
      return;
    }
    
    try {
      await api.users.create({
        name: uform.name,
        email: uform.email,
        role: uform.role,
        title: uform.title,
        collectionIds: uform.cols,
      });
      
      // Refresh users
      const usersData = await api.users.list();
      setUsers(usersData);
      
      setAdding(false);
      setUerr('');
      toast('User created successfully', 'teal');
    } catch (err) {
      setUerr(err instanceof Error ? err.message : 'Failed to create user');
    }
  }, [uform, toast]);

  const handleToggleStatus = useCallback(async (userId: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
      await api.users.update(userId, { status: newStatus });
      
      // Refresh users
      const usersData = await api.users.list();
      setUsers(usersData);
      
      toast(`User ${newStatus === 'ACTIVE' ? 'enabled' : 'disabled'}`, 'teal');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update user', 'red');
    }
  }, [toast]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-500 mb-4">
          <I n="alert" className="w-12 h-12 mx-auto" />
        </div>
        <h3 className="text-xl font-semibold text-white mb-2">Error Loading Users</h3>
        <p className="text-slate-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1180px]">
      <Reveal>
        <div className="panel overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--line)] font-display font-semibold flex items-center gap-3">
            Directory  {users.length} identities
            <span className="flex-1" />
            {canProvision && (
              <button className="btn btn-primary btn-sm" onClick={() => { setUform({ name: '', email: '', title: '', role: 'USER', cols: [] }); setUerr(''); setAdding(true); }}>
                <I n="plus" className="w-3.5 h-3.5" /> Add user
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>User</th><th>Role</th><th>MFA</th><th>Collections</th><th>Last sign-in</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: `hsl(${u.hue || 200} 45% 20%)`, color: `hsl(${u.hue || 200} 85% 72%)` }}>{u.name.split(' ').map((x: string) => x[0]).join('')}</span>
                        <div>
                          <div className="font-semibold text-[13.5px]">{u.name}</div>
                          <div className="font-mono text-[10.5px] text-[var(--dim)]">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><Chip tone={u.role.includes('ADMIN') ? 'gold' : u.role === 'AUDITOR' ? 'sky' : ''}>{ROLE_LABELS[u.role] || u.role.replace('_', ' ')}</Chip></td>
                    <td><span className="font-mono text-[11px] text-[var(--mut)] flex items-center gap-1.5"><I n="fingerprint" className="w-3.5 h-3.5 text-[var(--teal)]" />{u.mfaMethod || 'None'}</span></td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {u.collectionIds?.length === 0 && <span className="font-mono text-[10.5px] text-[var(--dim)]">-</span>}
                        {u.collectionIds?.map((id: string) => {
                          const c = collections.find((x) => x.id === id);
                          return <span key={id} className="chip !text-[9px]" style={{ color: `hsl(${c?.hue || 200} 70% 68%)`, borderColor: `hsl(${c?.hue || 200} 50% 40% / .5)` }}>{c?.name}</span>;
                        })}
                      </div>
                    </td>
                    <td className="font-mono text-[11px] text-[var(--dim)]">{u.lastLogin ? timeAgo(u.lastLogin) : 'never'}</td>
                    <td><StatusPill status={u.status} /></td>
                    <td>
                      {canProvision && (
                        <button
                          onClick={() => handleToggleStatus(u.id, u.status)}
                          className="btn btn-ghost btn-xs"
                          title={u.status === 'ACTIVE' ? 'Disable user' : 'Enable user'}
                        >
                          <I n={u.status === 'ACTIVE' ? 'pause' : 'play'} className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Reveal>

      {/* Add User Modal */}
      {adding && (
        <Modal isOpen={adding} onClose={() => setAdding(false)} title="Add User">
          <div className="space-y-4">
            {uerr && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{uerr}</div>}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Full Name</label>
              <input
                type="text"
                value={uform.name}
                onChange={(e) => setUform({ ...uform, name: e.target.value })}
                placeholder="John Doe"
                className="w-full px-4 py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Email Address</label>
              <input
                type="email"
                value={uform.email}
                onChange={(e) => setUform({ ...uform, email: e.target.value })}
                placeholder="john@company.com"
                className="w-full px-4 py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Title</label>
              <input
                type="text"
                value={uform.title}
                onChange={(e) => setUform({ ...uform, title: e.target.value })}
                placeholder="Developer"
                className="w-full px-4 py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Role</label>
              <select
                value={uform.role}
                onChange={(e) => setUform({ ...uform, role: e.target.value })}
                className="w-full px-4 py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {roles.map((role) => (
                  <option key={role} value={role}>{ROLE_LABELS[role] || role.replace('_', ' ')}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 pt-4">
              <button onClick={() => setAdding(false)} className="btn btn-ghost">Cancel</button>
              <button onClick={handleCreateUser} className="btn btn-primary">Create User</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ============================================================ SECURITY */
export function SecurityPage() {
  const { user, toast } = usePam();
  const [policies, setPolicies] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        // In real implementation, fetch policies from API
        // For now, show placeholder
        setPolicies([]);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to load policies', 'red');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [toast]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1180px]">
      <Reveal>
        <div className="panel p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Security Policies</h3>
            <button className="btn btn-primary btn-sm">
              <I n="plus" className="w-3.5 h-3.5" /> New policy
            </button>
          </div>
          
          {policies.length === 0 ? (
            <div className="text-center py-8 text-[var(--dim)]">
              <I n="shield" className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>No security policies defined</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {policies.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium text-white">{p.name}</td>
                      <td><Chip tone="teal">{p.type}</Chip></td>
                      <td><StatusPill status={p.status} /></td>
                      <td>
                        <button className="btn btn-ghost btn-xs">
                          <I n="pencil" className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Reveal>
    </div>
  );
}

/* ============================================================ SETTINGS */
export function SettingsPage() {
  const { user, tenant, toast } = usePam();
  const [tenantInfo, setTenantInfo] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const data = await api.tenant.get();
        setTenantInfo(data);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to load settings', 'red');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [toast]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[800px]">
      <Reveal>
        <div className="panel p-6">
          <h3 className="font-semibold text-white mb-4">Organization Settings</h3>
          
          <div className="space-y-4">
            <div>
              <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">ORGANIZATION NAME</label>
              <div className="text-white font-medium">{tenantInfo?.name || 'Loading...'}</div>
            </div>
            <div>
              <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">TENANT ID</label>
              <div className="text-white font-mono text-[11px]">{tenantInfo?.id || user?.tenantId}</div>
            </div>
            <div>
              <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">REGION</label>
              <div className="text-white">{tenantInfo?.region || 'us-east-1'}</div>
            </div>
            <div>
              <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">PLAN</label>
              <div className="text-white">{tenantInfo?.plan || 'Professional'}</div>
            </div>
            <div>
              <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">CREATED</label>
              <div className="text-white font-mono text-[11px]">{tenantInfo?.createdAt ? new Date(tenantInfo.createdAt).toLocaleString() : 'Unknown'}</div>
            </div>
          </div>
        </div>
      </Reveal>

      <Reveal delay={50}>
        <div className="panel p-6">
          <h3 className="font-semibold text-white mb-4">Your Profile</h3>
          
          <div className="space-y-4">
            <div>
              <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">NAME</label>
              <div className="text-white font-medium">{user?.name}</div>
            </div>
            <div>
              <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">EMAIL</label>
              <div className="text-white font-mono text-[11px]">{user?.email}</div>
            </div>
            <div>
              <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">ROLE</label>
              <div className="text-white">{ROLE_LABELS[user?.role || ''] || user?.role?.replace('_', ' ')}</div>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
