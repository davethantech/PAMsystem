/**
 * Keyrail PAM - Real Launcher Screen
 * 
 * This replaces the simulated launcher with real data from the API.
 * NO MockApp component. NO hardcoded applications.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { I } from '../components/icons';
import { Chip, CountRing, Dot, Masked, Modal, Reveal, fmtDur, fmtHM, timeAgo, REDUCED_MOTION } from '../components/ui';
import { usePam } from '../state/store';
import api from '../api/client';
import type { Application, Credential } from '../api/client';

/* ---------------- app glyphs (original geometric marks) ---------------- */
export function AppGlyph({ app, size = 40 }: { app: any; size?: number }) {
  const c = `hsl(${app.hue || 200} 70% 62%)`;
  const bg = `hsl(${app.hue || 200} 45% 16%)`;
  const bd = `hsl(${app.hue || 200} 50% 34%)`;
  const inner: Record<string, React.ReactNode> = {
    web: <><circle cx="20" cy="20" r="12" stroke={c} strokeWidth="2.2" fill="none" /><path d="M12 20l8-8M20 12l-8 8" stroke={c} strokeWidth="2.2" fill="none" /></>,
    database: <><ellipse cx="20" cy="12" rx="11" ry="4.5" stroke={c} strokeWidth="2.2" fill="none" /><path d="M9 12v15c0 2.5 4.9 4.5 11 4.5s11-2 11-4.5V12M9 19.5c0 2.5 4.9 4.5 11 4.5s11-2 11-4.5" stroke={c} strokeWidth="2.2" fill="none" /></>,
    ssh: <><rect x="7" y="9" width="26" height="22" rx="3" stroke={c} strokeWidth="2.2" fill="none" /><path d="M13 16l5 4.5-5 4.5M21 26h7" stroke={c} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></>,
    api: <><circle cx="20" cy="20" r="8" stroke={c} strokeWidth="2.2" fill="none" /><path d="M20 12v8M12 20h8" stroke={c} strokeWidth="2.2" fill="none" /></>,
    rdp: <><rect x="8" y="8" width="24" height="24" rx="2" stroke={c} strokeWidth="2.2" fill="none" /><path d="M12 12h16M12 16h12M12 20h8" stroke={c} strokeWidth="2.2" fill="none" /></>,
  };
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} style={{ background: bg, border: `1px solid ${bd}`, borderRadius: 10 }} aria-hidden="true">
      {inner[app.kind?.toLowerCase() || 'web'] ?? inner.web}
    </svg>
  );
}

/* ---------------- request access modal (shared with Access page) ---------------- */
export function RequestAccessModal({ credId, onClose }: { credId: string | null; onClose: () => void }) {
  const { toast } = usePam();
  const [reason, setReason] = useState('');
  const [ticket, setTicket] = useState('');
  const [hours, setHours] = useState(1);
  const [err, setErr] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!reason.trim()) {
      setErr('Business justification is required');
      return;
    }
    
    setIsSubmitting(true);
    try {
      if (!credId) return;
      
      await api.accessRequests.create({
        credentialId: credId,
        reason,
        durationHours: hours,
        ticketReference: ticket || undefined,
      });
      
      toast('Access request sent to PAM admins - you will be notified on approval', 'amber');
      onClose();
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setIsSubmitting(false);
    }
  }, [credId, reason, hours, ticket, onClose, toast]);

  return (
    <Modal isOpen={!!credId} onClose={onClose} title="Request just-in-time access" tone="amber">
      <div className="space-y-4">
        <div>
          <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">CREDENTIAL</label>
          <div className="input mt-1.5 opacity-80">Credential selected</div>
        </div>
        <div>
          <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">BUSINESS JUSTIFICATION (required, audited)</label>
          <textarea 
            className="input mt-1.5 min-h-[74px]" 
            value={reason} 
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Production DNS change for AU promo launch..."
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">WINDOW (HOURS)</label>
            <select 
              className="input mt-1.5" 
              value={hours} 
              onChange={(e) => setHours(Number(e.target.value))}
            >
              {[0.5, 1, 2, 4, 8].map((h) => <option key={h} value={h}>{h}h</option>)}
            </select>
          </div>
          <div>
            <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">TICKET REFERENCE</label>
            <input 
              className="input mt-1.5" 
              value={ticket} 
              onChange={(e) => setTicket(e.target.value)} 
              placeholder="CHG-2215"
            />
          </div>
        </div>
        {err && <p className="text-[#ff9d94] text-[12.5px] font-mono">\u2298 {err}</p>}
        <p className="text-[11.5px] text-[var(--mut)] leading-relaxed">
          <span className="text-[var(--amber)]">Policy:</span> this account requires approval. On approval you get a
          time-boxed launch window - then the permission evaporates automatically.
        </p>
        <div className="flex gap-3 justify-end">
          <button className="btn btn-ghost" onClick={onClose} disabled={isSubmitting}>Cancel</button>
          <button className="btn btn-amber" onClick={handleSubmit} disabled={isSubmitting}>
            <I n="bolt" className="w-4 h-4" /> {isSubmitting ? 'Submitting...' : 'Submit request'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function LaunchModal({ app, cred, onClose }: { app: any; cred: any; onClose: () => void }) {
  const { toast } = usePam();
  const [session, setSession] = useState<any>(null);
  const [status, setStatus] = useState<string>('STARTING');
  const [error, setError] = useState<string>('');
  const [challengeMsg, setChallengeMsg] = useState<string>('');
  const launchedRef = useRef(false);

  useEffect(() => {
    if (launchedRef.current) return;
    launchedRef.current = true;

    const startLaunch = async () => {
      try {
        setStatus('STARTING');
        const res = await api.launchSessions.launch(app.id);
        setSession(res);
        setStatus(res.status || 'STARTING');
        toast(`Launching ${app.name} in Playwright Chromium...`, 'teal');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Launch failed');
        setStatus('FAILED');
      }
    };

    startLaunch();
  }, [app, toast]);

  useEffect(() => {
    if (!session?.sessionId || status === 'AUTHENTICATED' || status === 'FAILED' || status === 'CLOSED') {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const s = await api.launchSessions.get(session.sessionId);
        setStatus(s.status);
        if (s.challengeMessage) setChallengeMsg(s.challengeMessage);
        if (s.error) setError(s.error);
      } catch {
        // Polling catch
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [session, status]);

  const handleCloseSession = async () => {
    if (session?.sessionId) {
      await api.launchSessions.close(session.sessionId).catch(() => {});
    }
    onClose();
  };

  if (error) {
    return (
      <Modal isOpen={!!app} onClose={onClose} title="Launch Error" tone="red">
        <div className="text-center py-4">
          <I n="alert" className="w-12 h-12 mx-auto mb-4 text-red-500" />
          <p className="text-white mb-4">{error}</p>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </Modal>
    );
  }

  const stepsList = [
    { label: 'Authorizing Keyrail launch', detail: 'RBAC evaluation & zero-knowledge policy check' },
    { label: 'Spawning Playwright Chromium', detail: 'Isolated browser context — no user profile leaks' },
    { label: 'Navigating to target site', detail: app.url || app.domain },
    { label: 'Injecting zero-knowledge credentials', detail: 'Brokered in backend enclave memory' },
    { label: 'Verifying session state', detail: status === 'AUTHENTICATED' ? 'Authenticated' : 'Evaluating DOM state' },
  ];

  const currentStepIdx = 
    status === 'STARTING' ? 1 :
    status === 'AUTHENTICATING' ? 3 :
    status === 'AUTHENTICATED' || status === 'CHALLENGE_REQUIRED' ? 5 : 2;

  return (
    <Modal isOpen={!!app} onClose={handleCloseSession} title={`Launching ${app.name}`} tone="teal">
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <AppGlyph app={app} size={48} />
          <div>
            <div className="font-semibold text-white text-base">{app.name}</div>
            <div className="font-mono text-[11px] text-[var(--dim)]">{app.kind} • Credential: {cred.name}</div>
          </div>
        </div>

        <div className="space-y-2">
          {stepsList.map((s, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 p-3 rounded-lg transition-all ${
                i < currentStepIdx
                  ? 'bg-[rgba(58,214,181,0.06)] border border-[rgba(58,214,181,0.2)] text-[var(--teal)]'
                  : i === currentStepIdx
                  ? 'bg-[rgba(58,214,181,0.12)] border border-[rgba(58,214,181,0.4)] text-[var(--teal)]'
                  : 'border border-[var(--line)] text-[var(--mut)]'
              }`}
            >
              <Dot tone={i <= currentStepIdx ? 'var(--teal)' : 'var(--mut)'} />
              <div className="flex-1">
                <div className="font-medium text-xs">{s.label}</div>
                <div className="font-mono text-[10px] text-[var(--dim)]">{s.detail}</div>
              </div>
              {i === currentStepIdx && status !== 'AUTHENTICATED' && status !== 'CHALLENGE_REQUIRED' && (
                <div className="w-4 h-4 border-2 border-[var(--teal)] border-t-transparent rounded-full animate-spin" />
              )}
              {i < currentStepIdx && (
                <I n="check" className="w-4 h-4 text-[var(--teal)]" />
              )}
            </div>
          ))}
        </div>

        {status === 'CHALLENGE_REQUIRED' && (
          <div className="p-4 bg-amber-500/10 rounded-lg border border-amber-500/30 space-y-2">
            <div className="font-semibold text-amber-400 text-sm flex items-center gap-2">
              <I n="alert" className="w-4 h-4" /> Additional Verification Required
            </div>
            <p className="text-xs text-amber-200/80 leading-relaxed">
              {challengeMsg || 'Please complete CAPTCHA / 2FA in the visible Chromium window on your screen. Keyrail will automatically detect when verification succeeds.'}
            </p>
          </div>
        )}

        {status === 'AUTHENTICATED' && (
          <div className="p-4 bg-[rgba(58,214,181,0.1)] rounded-lg border border-[rgba(58,214,181,0.3)] space-y-2">
            <div className="flex items-center gap-2 text-[var(--teal)] font-semibold text-sm">
              <I n="check" className="w-4 h-4" /> Playwright Session Active
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              The visible Chromium browser window on your screen is authenticated. You can continue using your session.
            </p>
          </div>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <button className="btn btn-ghost" onClick={handleCloseSession}>
            {status === 'AUTHENTICATED' ? 'Done / Hide Modal' : 'Cancel & Close Browser'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- target session overlay ---------------- */
export function TargetSessionOverlay() {
  const { liveSession, openLiveSession } = usePam();
  
  if (!liveSession) return null;
  
  return (
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
              <div className="text-white">{fmtHM(liveSession.expiresAt - Date.now())}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const targetUrl = (liveSession as any).targetUrl || (liveSession as any).url || ((liveSession as any).domain ? ((liveSession as any).domain.startsWith('http') ? (liveSession as any).domain : 'https://' + (liveSession as any).domain) : 'https://www.ebay.com.au/');
                openLiveSession(null as any);
                window.open(targetUrl, '_blank');
              }}
              className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <I n="launch" className="w-4 h-4" /> Open Application
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
  );
}

/* ---------------- add application modal ---------------- */
export function AddAppModal({ 
  credentials, 
  collections, 
  onClose, 
  onSuccess 
}: { 
  credentials: Credential[]; 
  collections: any[]; 
  onClose: () => void; 
  onSuccess: (newApp: Application) => void; 
}) {
  const { toast, refreshApplications } = usePam();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'WEB' | 'SSH' | 'RDP' | 'DB' | 'NETWORK'>('WEB');
  const [domain, setDomain] = useState('');
  const [url, setUrl] = useState('');
  const [credentialId, setCredentialId] = useState(credentials[0]?.id || '');
  const [collectionId, setCollectionId] = useState(collections[0]?.id || '');
  const [err, setErr] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErr('Application name is required');
      return;
    }
    if (!domain.trim()) {
      setErr('Target domain or host is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.applications.create({
        name: name.trim(),
        description: description.trim(),
        kind,
        domain: domain.trim(),
        url: url.trim() || (kind === 'WEB' ? `https://${domain.trim()}` : domain.trim()),
        credentialId: credentialId || credentials[0]?.id || '',
        collectionId: collectionId || collections[0]?.id || '',
      });

      const newApp: Application = {
        id: res.id || `app_${Date.now()}`,
        name: name.trim(),
        description: description.trim(),
        kind,
        domain: domain.trim(),
        url: url.trim() || (kind === 'WEB' ? `https://${domain.trim()}` : domain.trim()),
        credentialId: credentialId || credentials[0]?.id || '',
        collectionId: collectionId || collections[0]?.id || '',
        viaConnector: false,
        authFlow: 'ISOLATED_WORLD_INJECTION',
      };

      toast(`Application "${name}" created successfully`, 'teal');
      refreshApplications();
      onSuccess(newApp);
      onClose();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed to create application');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Add New Application" tone="teal">
      <form onSubmit={handleSubmit} className="space-y-4">
        {err && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {err}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Application Name *</label>
          <input
            type="text"
            className="input w-full"
            placeholder="e.g. Datadog APM Console"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
          <input
            type="text"
            className="input w-full"
            placeholder="e.g. Observability and performance metrics dashboard"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Application Type</label>
            <select
              className="input w-full"
              value={kind}
              onChange={(e) => setKind(e.target.value as any)}
            >
              <option value="WEB">Web App (HTTPS)</option>
              <option value="DB">Database (Postgres/MySQL)</option>
              <option value="SSH">SSH Server</option>
              <option value="RDP">RDP Remote Desktop</option>
              <option value="NETWORK">Network Device / Router</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Target Host / Domain *</label>
            <input
              type="text"
              className="input w-full"
              placeholder="e.g. app.datadoghq.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              required
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Target Connection URL</label>
          <input
            type="text"
            className="input w-full font-mono text-xs"
            placeholder="https://app.datadoghq.com or psql://db-host:5432"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Associated Credential</label>
            <select
              className="input w-full"
              value={credentialId}
              onChange={(e) => setCredentialId(e.target.value)}
            >
              {credentials.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.target})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Collection</label>
            <select
              className="input w-full"
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
            >
              {collections.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-3 justify-end pt-4 border-t border-[var(--line)]">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            <I n="plus" className="w-4 h-4 mr-1" />
            {isSubmitting ? 'Creating...' : 'Create Application'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- main launcher ---------------- */
export default function Launcher() {
  const { user, setRoute, toast, applications, credentials, collections, refreshApplications, refreshCredentials, refreshCollections } = usePam();
  const [q, setQ] = useState('');
  const [col, setCol] = useState('ALL');
  const [launching, setLaunching] = useState<{ app: Application; cred: Credential } | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [isAddingApp, setIsAddingApp] = useState(false);

  useEffect(() => {
    refreshApplications();
    refreshCredentials();
    refreshCollections();
  }, []);

  const isAdmin = ['PAM_ADMIN', 'ORG_ADMIN', 'SUPER_ADMIN', 'SECURITY_ADMIN'].includes(user!.role);

  const list = useMemo(() => applications.filter((a) => {
    if (col !== 'ALL' && a.collectionId !== col) return false;
    if (q && !`${a.name} ${a.description} ${a.targetUrl}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [applications, q, col]);

  const handleLaunch = useCallback((app: Application) => {
    // Find the credential for this application
    const cred = credentials.find(c => c.id === app.credentialId);
    if (!cred) {
      toast('No credential found for this application', 'red');
      return;
    }
    
    // Check if access requires approval
    if (cred.access === 'APPROVAL_REQUIRED') {
      setRequesting(cred.id);
    } else {
      setLaunching({ app, cred });
    }
  }, [credentials, toast]);



  return (
    <div className="space-y-5 max-w-[1180px]">
      <Reveal>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--line)] bg-[rgba(8,16,32,0.6)] w-[260px]">
            <I n="search" className="w-4 h-4 text-[var(--dim)]" />
            <input 
              className="bg-transparent outline-none text-[13px] flex-1" 
              placeholder="Search applications..." 
              value={q} 
              onChange={(e) => setQ(e.target.value)} 
            />
          </div>
          <select 
            className="input !w-[190px] !py-2 text-[13px]" 
            value={col} 
            onChange={(e) => setCol(e.target.value)}
          >
            <option value="ALL">All collections</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <span className="flex-1" />
          <Chip><I n="launch" className="w-3.5 h-3.5" /> Zero-knowledge launch</Chip>
          <Chip tone="teal"><I n="shield" className="w-3.5 h-3.5" /> Brokered authentication</Chip>
          {isAdmin && (
            <button 
              className="btn btn-primary btn-sm" 
              onClick={() => setIsAddingApp(true)}
            >
              <I n="plus" className="w-3.5 h-3.5" /> New application
            </button>
          )}
        </div>
      </Reveal>

      {/* Applications grid */}
      <Reveal delay={50}>
        <div className="panel p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Applications ({list.length})</h3>
            <div className="font-mono text-[9.5px] text-[var(--dim)]">
              Credentials never exposed to browser
            </div>
          </div>
          
          {list.length === 0 ? (
            <div className="text-center py-12 text-[var(--dim)]">
              <I n="launch" className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p>No applications found</p>
              {isAdmin && (
                <button 
                  className="btn btn-primary mt-4" 
                  onClick={() => setIsAddingApp(true)}
                >
                  <I n="plus" className="w-4 h-4" /> Add your first application
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {list.map((app) => {
                const cred = credentials.find(c => c.id === app.credentialId);
                return (
                  <div 
                    key={app.id} 
                    className="panel p-4 card-lift cursor-pointer hover:bg-slate-800/50 transition-colors"
                    onClick={() => handleLaunch(app)}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <AppGlyph app={app} />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-white truncate">{app.name}</div>
                        <div className="font-mono text-[10px] text-[var(--dim)] truncate">{app.description}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap gap-1">
                        {cred && (
                          <Chip tone="teal" className="!text-[8px] !py-0.5">
                            {cred.name}
                          </Chip>
                        )}
                        {app.access === 'APPROVAL_REQUIRED' && (
                          <Chip tone="amber" className="!text-[8px] !py-0.5">
                            <I n="bolt" className="w-2.5 h-2.5 mr-0.5" /> Approval required
                          </Chip>
                        )}
                      </div>
                      <I n="chevronRight" className="w-4 h-4 text-[var(--dim)]" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Reveal>

      {/* Add application modal */}
      {isAddingApp && (
        <AddAppModal 
          credentials={credentials}
          collections={collections}
          onClose={() => setIsAddingApp(false)}
          onSuccess={() => refreshApplications()}
        />
      )}

      {/* Launch modal */}
      {launching && (
        <LaunchModal 
          app={launching.app} 
          cred={launching.cred} 
          onClose={() => setLaunching(null)}
        />
      )}

      {/* Request access modal */}
      {requesting && (
        <RequestAccessModal 
          credId={requesting} 
          onClose={() => setRequesting(null)}
        />
      )}
    </div>
  );
}
