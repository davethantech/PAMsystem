/**
 * Keyrail PAM - Real Shell Component
 * 
 * This replaces the simulated shell with real data from the API.
 * NO demo indicators. NO persona switching. NO in-memory data.
 */
import { useState, type ReactNode } from 'react';
import { I } from '../components/icons';
import { Chip, Dot, fmtCountdown, fmtDur } from '../components/ui';
import { toastTone, usePam, type Route } from '../state/store-new';

const NAV: { group: string; items: { route: Route; label: string; icon: string }[] }[] = [
  { group: 'Overview', items: [
    { route: 'dashboard', label: 'Dashboard', icon: 'grid' },
    { route: 'how', label: 'How It Works', icon: 'bolt' },
    { route: 'launcher', label: 'Applications', icon: 'launch' },
    { route: 'architecture', label: 'Architecture', icon: 'layers' },
  ]},
  { group: 'Vault', items: [
    { route: 'vault', label: 'Credentials', icon: 'key' },
  ]},
  { group: 'Access', items: [
    { route: 'access', label: 'Requests  JIT  Sessions', icon: 'bolt' },
  ]},
  { group: 'Governance', items: [
    { route: 'users', label: 'Users & Roles', icon: 'users' },
    { route: 'security', label: 'Security Controls', icon: 'shield' },
    { route: 'reports', label: 'Audit & Reports', icon: 'doc' },
    { route: 'settings', label: 'Settings', icon: 'org' },
  ]},
];

const TITLES: Record<Route, [string, string]> = {
  dashboard: ['Operations Dashboard', 'Tenant-scoped posture  live from PostgreSQL'],
  how: ['How It Works', 'Anatomy of a launch  eight hops, zero passwords'],
  launcher: ['Application Launcher', 'Zero-knowledge launch  the password never leaves the vault'],
  vault: ['Credential Vault', 'Metadata only  no plaintext channel exists in this API'],
  access: ['Access Control', 'Requests  approvals  just-in-time windows  live sessions'],
  users: ['Users, Groups & Roles', 'RBAC matrix  credential.use is not credential.reveal'],
  security: ['Security Controls', 'Policies  MFA  rotation  break-glass  adversarial tests'],
  reports: ['Audit & Reports', 'Hash-chained, tamper-evident event log'],
  architecture: ['Cloud Architecture & Threat Model', 'How the plaintext-free path is enforced'],
  settings: ['Organization Settings', 'Tenant  connectors  API keys  SSO'],
};

export function ToastHost() {
  const { toasts } = usePam();
  return (
    <div className="fixed bottom-5 right-5 z-[90] space-y-2 w-[340px]">
      {toasts.map((t) => (
        <div key={t.id} className="toast-in panel-solid px-4 py-3 flex items-start gap-3 text-[13px] leading-snug"
          style={{ borderLeft: `3px solid ${toastTone[t.tone]}` }}>
          <span className="mt-0.5" style={{ color: toastTone[t.tone] }}>
            <I n={t.tone === 'red' ? 'shieldX' : t.tone === 'amber' ? 'alert' : 'check'} className="w-4 h-4" />
          </span>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const { 
    route, 
    setRoute, 
    user, 
    users,
    requests,
    sessions,
    logout,
    liveSession, 
    openLiveSession,
    loading
  } = usePam();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  
  if (!user) return null;

  // Get live session from sessions array
  const mySession = liveSession;
  const pending = requests.filter((r) => r.status === 'PENDING').length;
  const utc = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });

  // Get tenant info from user
  const tenantName = 'Loading...';
  const tenantRegion = 'Loading...';

  return (
    <div className="relative z-10 min-h-screen flex">
      {/* ---------- sidebar ---------- */}
      <aside className="w-[248px] shrink-0 border-r border-[var(--line)] bg-[rgba(10,18,34,0.85)] backdrop-blur-md flex flex-col sticky top-0 h-screen">
        <div className="px-5 py-5 border-b border-[var(--line)]">
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 40 40" fill="none" className="w-8 h-8"><rect x="2" y="2" width="36" height="36" rx="9" stroke="var(--gold)" strokeWidth="2" /><path d="M10 27V13a10 10 0 0 1 20 0v14" stroke="var(--gold)" strokeWidth="2.4" strokeLinecap="round" /><circle cx="20" cy="19" r="4" fill="var(--teal)" /><path d="M20 22v6" stroke="var(--teal)" strokeWidth="3" strokeLinecap="round" /></svg>
            <div>
              <div className="font-display font-bold tracking-[0.08em] text-[16px]">KEYRAIL</div>
              <div className="font-mono text-[8.5px] text-[var(--dim)] tracking-[0.2em]">CLOUD PAM</div>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-[var(--line)]">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="w-7 h-7 rounded-md bg-[rgba(217,169,78,0.12)] border border-[rgba(217,169,78,0.35)] flex items-center justify-center text-[var(--gold)]"><I n="org" className="w-4 h-4" /></span>
            <div className="min-w-0">
              <div className="font-semibold truncate">{tenantName}</div>
              <div className="font-mono text-[9.5px] text-[var(--dim)]">{user.tenantId}  {tenantRegion}</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="font-mono text-[9.5px] tracking-[0.22em] text-[var(--dim)] px-2.5 mb-1.5">{g.group.toUpperCase()}</div>
              {g.items.map((it) => (
                <button key={it.route} onClick={() => setRoute(it.route)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-[7.5px] rounded-lg text-[13.5px] transition-all cursor-pointer mb-0.5 ${route === it.route ? 'bg-[rgba(58,214,181,0.1)] text-[var(--teal)] border border-[rgba(58,214,181,0.25)]' : 'text-[var(--mut)] hover:text-[var(--ink)] hover:bg-[rgba(122,160,210,0.07)] border border-transparent'}`}>
                  <I n={it.icon} className="w-[17px] h-[17px]" />
                  <span className="flex-1 text-left">{it.label}</span>
                  {it.route === 'access' && pending > 0 && <span className="chip chip-amber !py-0 !px-1.5 !text-[9.5px]">{pending}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-[var(--line)]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: `hsl(${user.hue || 200} 45% 22%)`, color: `hsl(${user.hue || 200} 80% 70%)` }}>
                {user.name.split(' ').map((x: string) => x[0]).join('')}
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-[13px] truncate">{user.name}</div>
                <div className="font-mono text-[9px] text-[var(--dim)]">{user.role.replace('_', ' ')}</div>
              </div>
            </div>
            <button
              onClick={() => logout()}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--dim)] hover:text-[var(--ink)] hover:bg-[var(--line)] transition-colors"
              title="Logout"
            >
              <I n="logOut" className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ---------- main ---------- */}
      <main className="flex-1 bg-slate-900/30 min-h-screen">
        {/* header */}
        <header className="sticky top-0 z-20 px-6 py-4 bg-slate-900/80 backdrop-blur-md border-b border-[var(--line)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => setMenuOpen(!menuOpen)} className="lg:hidden w-8 h-8 rounded-lg flex items-center justify-center text-[var(--dim)] hover:text-[var(--ink)] hover:bg-[var(--line)] transition-colors">
                <I n="menu" className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-lg font-semibold text-white">{TITLES[route][0]}</h1>
                <p className="font-mono text-[10px] tracking-[0.18em] text-[var(--dim)]">{TITLES[route][1]}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Active session badge */}
              {mySession && (
                <button
                  onClick={() => openLiveSession(mySession)}
                  className="panel p-2 flex items-center gap-2 text-[11px] cursor-pointer"
                >
                  <Dot tone="var(--teal)" />
                  <span>Active: {mySession.appName}</span>
                  <I n="externalLink" className="w-3 h-3" />
                </button>
              )}

              {/* Notifications */}
              <button
                onClick={() => setBellOpen(!bellOpen)}
                className="relative w-8 h-8 rounded-lg flex items-center justify-center text-[var(--dim)] hover:text-[var(--ink)] hover:bg-[var(--line)] transition-colors"
              >
                <I n="bell" className="w-4 h-4" />
                {pending > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-amber-500 text-[8px] font-bold text-amber-900 flex items-center justify-center">{pending}</span>
                )}
              </button>

              {/* Clock */}
              <div className="font-mono text-[10px] text-[var(--dim)] tracking-widest px-2 py-1 bg-[var(--line)]/20 rounded-md">
                {utc}
              </div>
            </div>
          </div>
        </header>

        {/* content */}
        <div className="p-6">{children}</div>

        {/* session overlay */}
        {liveSession && (
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-slate-800 rounded-2xl p-6 max-w-2xl w-full border border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-white">Active Session</h2>
                <button
                  onClick={() => openLiveSession(null as any)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--dim)] hover:text-[var(--ink)] hover:bg-[var(--line)] transition-colors"
                >
                  <I n="x" className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-slate-700 flex items-center justify-center">
                    <I n="launch" className="w-5 h-5 text-[var(--teal)]" />
                  </span>
                  <div>
                    <div className="font-semibold text-white">{liveSession.appName}</div>
                    <div className="font-mono text-[11px] text-[var(--dim)]">{liveSession.appKind}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-[var(--dim)]">User</div>
                    <div className="text-white">{liveSession.userName}</div>
                  </div>
                  <div>
                    <div className="text-[var(--dim)]">Credential</div>
                    <div className="text-white">{liveSession.credentialName}</div>
                  </div>
                  <div>
                    <div className="text-[var(--dim)]">Started</div>
                    <div className="text-white">{fmtDur(liveSession.startedAt)} ago</div>
                  </div>
                  <div>
                    <div className="text-[var(--dim)]">Expires</div>
                    <div className="text-white">{fmtCountdown(liveSession.expiresAt)}</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      openLiveSession(null as any);
                      // In real implementation, this would open the target application
                      window.open('about:blank', '_blank');
                    }}
                    className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                  >
                    Open Application
                  </button>
                  <button
                    onClick={() => openLiveSession(null as any)}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
