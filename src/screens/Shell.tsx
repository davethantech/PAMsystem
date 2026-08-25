import { useState, type ReactNode } from 'react';
import { I } from '../components/icons';
import { Chip, Dot, fmtCountdown, fmtDur } from '../components/ui';
import { toastTone, usePam, type Route } from '../state/store';

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
    { route: 'access', label: 'Requests · JIT · Sessions', icon: 'bolt' },
  ]},
  { group: 'Governance', items: [
    { route: 'users', label: 'Users & Roles', icon: 'users' },
    { route: 'security', label: 'Security Controls', icon: 'shield' },
    { route: 'reports', label: 'Audit & Reports', icon: 'doc' },
    { route: 'settings', label: 'Settings', icon: 'org' },
  ]},
];

const TITLES: Record<Route, [string, string]> = {
  dashboard: ['Operations Dashboard', 'Tenant-scoped posture · live from the control plane'],
  how: ['How It Works', 'Anatomy of a launch — eight hops, zero passwords'],
  launcher: ['Application Launcher', 'Zero-knowledge launch — the password never leaves the vault'],
  vault: ['Credential Vault', 'Metadata only — no plaintext channel exists in this API'],
  access: ['Access Control', 'Requests · approvals · just-in-time windows · live sessions'],
  users: ['Users, Groups & Roles', 'RBAC matrix — credential.use is not credential.reveal'],
  security: ['Security Controls', 'Policies · MFA · rotation · break-glass · adversarial tests'],
  reports: ['Audit & Reports', 'Hash-chained, tamper-evident event log'],
  architecture: ['Cloud Architecture & Threat Model', 'How the plaintext-free path is enforced'],
  settings: ['Organization Settings', 'Tenant · connectors · API keys · SSO'],
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
  const { route, setRoute, user, snap, tick, logout, switchPersona, liveSession, openLiveSession } = usePam();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  if (!user) return null;

  const mySession = liveSession && snap.sessions.find((s) => s.id === liveSession.id);
  const pending = snap.requests.filter((r) => r.status === 'PENDING').length;
  const utc = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });
  void tick;

  return (
    <div className="relative z-10 min-h-screen flex">
      {/* ---------- sidebar ---------- */}
      <aside className="w-[248px] shrink-0 border-r border-[var(--line)] bg-[rgba(10,18,34,0.85)] backdrop-blur-md flex flex-col sticky top-0 h-screen">
        <div className="px-5 py-5 border-b border-[var(--line)]">
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 40 40" fill="none" className="w-8 h-8"><rect x="2" y="2" width="36" height="36" rx="9" stroke="var(--gold)" strokeWidth="2" /><path d="M10 27V13a10 10 0 0 1 20 0v14" stroke="var(--gold)" strokeWidth="2.4" strokeLinecap="round" /><circle cx="20" cy="19" r="4" fill="var(--teal)" /><path d="M20 22v6" stroke="var(--teal)" strokeWidth="3" strokeLinecap="round" /></svg>
            <div>
              <div className="font-display font-bold tracking-[0.08em] text-[16px]">KEYRAIL</div>
              <div className="font-mono text-[8.5px] text-[var(--dim)] tracking-[0.2em]">CLOUD PAM CONTROL PLANE</div>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-[var(--line)]">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="w-7 h-7 rounded-md bg-[rgba(217,169,78,0.12)] border border-[rgba(217,169,78,0.35)] flex items-center justify-center text-[var(--gold)]"><I n="org" className="w-4 h-4" /></span>
            <div className="min-w-0">
              <div className="font-semibold truncate">{snap.tenant.name}</div>
              <div className="font-mono text-[9.5px] text-[var(--dim)]">{snap.tenant.id} · {snap.tenant.region}</div>
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

        <div className="p-3 border-t border-[var(--line)] relative">
          {menuOpen && (
            <div className="absolute bottom-[64px] left-3 right-3 panel-solid p-2 rise-in z-50">
              <div className="font-mono text-[9.5px] tracking-[0.18em] text-[var(--dim)] px-2 py-1.5">SWITCH DEMO PERSONA</div>
              {snap.users.filter((u) => u.status === 'ACTIVE').map((u) => (
                <button key={u.id} onClick={() => { switchPersona(u.id); setMenuOpen(false); }}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-[12.5px] flex items-center gap-2 transition-colors cursor-pointer ${u.id === user.id ? 'text-[var(--teal)] bg-[rgba(58,214,181,0.08)]' : 'hover:bg-[rgba(122,160,210,0.08)]'}`}>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: `hsl(${u.hue} 45% 22%)`, color: `hsl(${u.hue} 80% 70%)` }}>{u.name.split(' ').map((x) => x[0]).join('')}</span>
                  <span className="flex-1">{u.name}</span>
                  <span className="font-mono text-[9px] text-[var(--dim)]">{u.role.replace('_', ' ')}</span>
                </button>
              ))}
              <button onClick={logout} className="w-full text-left px-2 py-1.5 rounded-md text-[12.5px] text-[#ff9d94] hover:bg-[rgba(240,104,92,0.1)] flex items-center gap-2 cursor-pointer mt-1 border-t border-[var(--line)] pt-2">
                <I n="logout" className="w-4 h-4" /> Sign out
              </button>
            </div>
          )}
          <button onClick={() => setMenuOpen((v) => !v)} className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[rgba(122,160,210,0.08)] transition-colors cursor-pointer">
            <span className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold border" style={{ background: `hsl(${user.hue} 45% 20%)`, color: `hsl(${user.hue} 85% 72%)`, borderColor: `hsl(${user.hue} 50% 40%)` }}>
              {user.name.split(' ').map((x) => x[0]).join('')}
            </span>
            <span className="flex-1 text-left min-w-0">
              <span className="block text-[13px] font-semibold truncate">{user.name}</span>
              <span className="block font-mono text-[9.5px] text-[var(--dim)]">{user.role.replace('_', ' ')} · {user.authMethod}</span>
            </span>
            <I n="chevD" className="w-3.5 h-3.5 text-[var(--dim)]" />
          </button>
        </div>
      </aside>

      {/* ---------- main ---------- */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[rgba(10,18,34,0.82)] backdrop-blur-md px-7 py-3.5 flex items-center gap-5">
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-[18px] leading-tight truncate">{TITLES[route][0]}</h1>
            <p className="text-[11.5px] text-[var(--mut)] truncate">{TITLES[route][1]}</p>
          </div>
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--line)] bg-[rgba(8,16,32,0.6)] text-[var(--dim)] text-[12px] w-[210px]">
            <I n="search" className="w-3.5 h-3.5" /> <span className="flex-1">Search vault…</span> <span className="font-mono text-[9.5px] border border-[var(--line-strong)] rounded px-1">⌘K</span>
          </div>
          <div className="font-mono text-[12px] text-[var(--mut)] tabular-nums hidden sm:block">
            <span className="text-[var(--dim)]">UTC</span> {utc}
          </div>
          <div className="relative">
            <button onClick={() => setBellOpen((v) => !v)} className="relative p-2 rounded-lg border border-[var(--line)] hover:border-[var(--line-strong)] transition-colors cursor-pointer">
              <I n="bell" className="w-4 h-4 text-[var(--mut)]" />
              {snap.alerts.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--red)] text-[9px] font-bold flex items-center justify-center text-white">{snap.alerts.length}</span>}
            </button>
            {bellOpen && (
              <div className="absolute right-0 top-[46px] w-[340px] panel-solid p-3 rise-in z-50">
                <div className="font-mono text-[10px] tracking-[0.18em] text-[var(--dim)] mb-2">SECURITY ALERTS</div>
                {snap.alerts.length === 0 && <p className="text-[12.5px] text-[var(--mut)]">No open alerts.</p>}
                {snap.alerts.map((a) => (
                  <div key={a.id} className="border-b border-[var(--line)] py-2 last:border-0">
                    <div className="flex items-center gap-2">
                      <Chip tone={a.severity === 'HIGH' ? 'red' : 'amber'}>{a.severity}</Chip>
                      <span className="text-[12.5px] font-semibold flex-1">{a.title}</span>
                    </div>
                    <p className="text-[11.5px] text-[var(--mut)] mt-1 leading-snug">{a.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 px-7 py-6 pb-24" onClick={() => { setMenuOpen(false); setBellOpen(false); }}>
          {children}
        </main>

        {/* proxied session mini-bar */}
        {mySession && mySession.status === 'ACTIVE' && (
          <button onClick={() => openLiveSession(mySession)}
            className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[70] panel-solid px-5 py-2.5 flex items-center gap-4 cursor-pointer hover:border-[rgba(58,214,181,0.5)] transition-colors"
            style={{ border: '1px solid rgba(58,214,181,0.4)', boxShadow: '0 12px 40px -12px rgba(4,12,26,0.9)' }}>
            <span className="w-2 h-2 rounded-full bg-[var(--red)] rec-blink" />
            <span className="font-display font-semibold text-[13px]">Proxied session · {mySession.appName}</span>
            <span className="font-mono text-[12px] text-[var(--teal)] tabular-nums">{fmtDur(Date.now() - mySession.startedAt)}</span>
            <Chip tone="teal">RETURN <I n="arrowR" className="w-3 h-3" /></Chip>
            {mySession.expiresAt && <span className="font-mono text-[11px] text-[var(--dim)]">auto-ends {fmtCountdown(mySession.expiresAt - Date.now())}</span>}
          </button>
        )}
      </div>
    </div>
  );
}
