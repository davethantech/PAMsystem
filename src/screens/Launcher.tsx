import { useEffect, useMemo, useRef, useState } from 'react';
import { pam, isPamError } from '../engine/pam';
import type { AppMeta, CredMeta, GrantMeta, SessionRec } from '../engine/types';
import { I } from '../components/icons';
import { Chip, CountRing, Dot, Masked, Modal, Reveal, fmtDur, fmtHM, timeAgo, REDUCED_MOTION } from '../components/ui';
import { usePam } from '../state/store';

/* ---------------- app glyphs (original geometric marks) ---------------- */
export function AppGlyph({ app, size = 40 }: { app: AppMeta; size?: number }) {
  const c = `hsl(${app.hue} 70% 62%)`;
  const bg = `hsl(${app.hue} 45% 16%)`;
  const bd = `hsl(${app.hue} 50% 34%)`;
  const inner: Record<string, React.ReactNode> = {
    ebay: <><circle cx="13" cy="20" r="6" stroke={c} strokeWidth="2.2" fill="none" /><path d="M22 11l6 6-13 13-6-6L22 11z" stroke={c} strokeWidth="2.2" fill="none" strokeLinejoin="round" /><path d="M25 14l.01.01" stroke={c} strokeWidth="3" strokeLinecap="round" /></>,
    cloudflare: <><path d="M11 26a7 7 0 0 1 2-13.7A9 9 0 0 1 30.5 15 6 6 0 0 1 30 27H13" stroke={c} strokeWidth="2.2" fill="none" strokeLinecap="round" /><path d="M17 31l4-5h4l-4 5h-4z" fill={c} /></>,
    cpanel: <><rect x="9" y="9" width="22" height="8" rx="2" stroke={c} strokeWidth="2.2" fill="none" /><rect x="9" y="22" width="22" height="8" rx="2" stroke={c} strokeWidth="2.2" fill="none" /><path d="M13.5 13h.01M13.5 26h.01" stroke={c} strokeWidth="3" strokeLinecap="round" /></>,
    unleashed: <><path d="M20 8l11 5.5v11L20 30l-11-5.5v-11L20 8z" stroke={c} strokeWidth="2.2" fill="none" strokeLinejoin="round" /><path d="M9.5 13.5L20 19l10.5-5.5M20 19v11" stroke={c} strokeWidth="2" fill="none" strokeLinejoin="round" /></>,
    db: <><ellipse cx="20" cy="12" rx="11" ry="4.5" stroke={c} strokeWidth="2.2" fill="none" /><path d="M9 12v15c0 2.5 4.9 4.5 11 4.5s11-2 11-4.5V12M9 19.5c0 2.5 4.9 4.5 11 4.5s11-2 11-4.5" stroke={c} strokeWidth="2.2" fill="none" /></>,
    terminal: <><rect x="7" y="9" width="26" height="22" rx="3" stroke={c} strokeWidth="2.2" fill="none" /><path d="M13 16l5 4.5-5 4.5M21 26h7" stroke={c} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></>,
  };
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} style={{ background: bg, border: `1px solid ${bd}`, borderRadius: 10 }} aria-hidden="true">
      {inner[app.glyph] ?? inner.db}
    </svg>
  );
}

/* ---------------- request access modal (shared with Access page) ---------------- */
export function RequestAccessModal({ credId, onClose }: { credId: string | null; onClose: () => void }) {
  const { snap, toast } = usePam();
  const [reason, setReason] = useState('');
  const [ticket, setTicket] = useState('');
  const [hours, setHours] = useState(1);
  const [err, setErr] = useState('');
  const cred = snap.credentials.find((c) => c.id === credId);
  const options = snap.credentials.filter((c) => c.access === 'APPROVAL_REQUIRED');
  const submit = () => {
    try {
      pam.requestAccess(credId!, reason, hours, ticket);
      toast('Access request sent to PAM admins — you will be notified on approval', 'amber');
      onClose();
    } catch (e) { setErr(isPamError(e) ? e.message : 'Request failed'); }
  };
  return (
    <Modal open={!!credId} onClose={onClose} title="Request just-in-time access" tone="amber">
      <div className="space-y-4">
        <div>
          <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">CREDENTIAL</label>
          <div className="input mt-1.5 opacity-80">{cred?.name ?? '—'}</div>
        </div>
        <div>
          <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">BUSINESS JUSTIFICATION (required, audited)</label>
          <textarea className="input mt-1.5 min-h-[74px]" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Production DNS change for AU promo launch…" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">WINDOW (HOURS)</label>
            <select className="input mt-1.5" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {[0.5, 1, 2, 4, 8].map((h) => <option key={h} value={h}>{h}h</option>)}
            </select>
          </div>
          <div>
            <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">TICKET REFERENCE</label>
            <input className="input mt-1.5" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="CHG-2215" />
          </div>
        </div>
        {err && <p className="text-[#ff9d94] text-[12.5px] font-mono">⊘ {err}</p>}
        <p className="text-[11.5px] text-[var(--mut)] leading-relaxed">
          <span className="text-[var(--amber)]">Policy:</span> this account requires approval. On approval you get a
          time-boxed launch window — then the permission evaporates automatically.
        </p>
        <div className="flex gap-3 justify-end">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-amber" onClick={submit}><I n="bolt" className="w-4 h-4" /> Submit request</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- launch pipeline modal ---------------- */
const STEPS = [
  { label: 'Identity & MFA verified', detail: 'session cookie · device bound' },
  { label: 'RBAC evaluation', detail: 'credential.use ✓ · credential.reveal ✗' },
  { label: 'Launch policy & collection check', detail: 'membership · JIT window · geo/device rules' },
  { label: 'Single-use grant issued', detail: '30s TTL · tenant+user+app bound' },
  { label: 'Broker decrypts in enclave', detail: 'plaintext exists only in KMS-backed memory' },
  { label: 'Inject via isolated world', detail: 'DOM-opaque · zeroized after submit' },
];

export function LaunchModal({ app, cred, onClose }: { app: AppMeta; cred: CredMeta; onClose: () => void }) {
  const { toast, openLiveSession } = usePam();
  const [step, setStep] = useState(0);
  const [grant, setGrant] = useState<GrantMeta | null>(null);
  const [error, setError] = useState('');
  const consumed = useRef(false);
  const stepMs = REDUCED_MOTION ? 120 : 520;

  useEffect(() => {
    if (error) return;
    if (step < 3) {
      const t = window.setTimeout(() => setStep((s) => s + 1), stepMs);
      return () => window.clearTimeout(t);
    }
    if (step === 3 && !grant) {
      try { setGrant(pam.createGrant(cred.id)); }
      catch (e) { setError(isPamError(e) ? `${e.message}` : 'Grant issuance failed'); }
      return;
    }
    if (step === 3 && grant) {
      const t = window.setTimeout(() => setStep(4), stepMs);
      return () => window.clearTimeout(t);
    }
    if (step >= 4) {
      const t = window.setTimeout(() => {
        if (step === 4) { setStep(5); return; }
        if (!consumed.current && grant) {
          consumed.current = true;
          try {
            const rec = pam.consumeGrant(grant.grantId);
            toast(`${app.name} launched — secret injected, never displayed`, 'teal');
            openLiveSession(rec);
            onClose();
          } catch (e) { setError(isPamError(e) ? e.message : 'Launch failed'); }
        }
      }, step === 4 ? stepMs : stepMs + 260);
      return () => window.clearTimeout(t);
    }
  }, [step, grant, error, app, cred, onClose, openLiveSession, toast, stepMs]);

  const remaining = grant ? grant.expiresAt - Date.now() : 30_000;

  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2.5"><AppGlyph app={app} size={30} /> Secure launch — {app.name}</span>} width={620}>
      {error ? (
        <div className="text-center py-8">
          <div className="mx-auto w-14 h-14 rounded-full border border-[rgba(240,104,92,0.5)] bg-[rgba(240,104,92,0.1)] flex items-center justify-center text-[#ff9d94] mb-4"><I n="shieldX" className="w-7 h-7" /></div>
          <h4 className="font-display font-bold text-[17px]">Launch blocked by policy</h4>
          <p className="text-[var(--mut)] text-[13px] mt-2 max-w-[46ch] mx-auto leading-relaxed">{error}</p>
          <p className="font-mono text-[10.5px] text-[var(--dim)] mt-3">event written to the tamper-evident audit chain</p>
          <button className="btn btn-ghost mt-5" onClick={onClose}>Understood</button>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-1">
              {STEPS.map((s, i) => {
                const done = i < step;
                const active = i === step;
                return (
                  <div key={s.label} className={`flex items-start gap-3 px-3 py-2 rounded-lg border transition-all duration-300 ${done ? 'border-[rgba(58,214,181,0.3)] bg-[rgba(58,214,181,0.05)]' : active ? 'border-[rgba(95,168,242,0.4)] bg-[rgba(95,168,242,0.06)]' : 'border-[var(--line)] opacity-45'}`}>
                    <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-[var(--teal)] text-[#062019]' : active ? 'border border-[var(--sky)] text-[var(--sky)]' : 'border border-[var(--line-strong)] text-[var(--dim)]'}`}>
                      {done ? <I n="check" className="w-3 h-3" sw={2.4} /> : active ? <span className="w-2 h-2 rounded-full bg-[var(--sky)] pulse-dot" /> : <span className="font-mono text-[9px]">{i + 1}</span>}
                    </span>
                    <div>
                      <div className="text-[13px] font-semibold leading-tight">{s.label}</div>
                      <div className="font-mono text-[10px] text-[var(--dim)] mt-0.5">{s.detail}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-col items-center justify-center gap-4 border border-dashed border-[var(--line-strong)] rounded-lg p-5 bg-[rgba(8,16,32,0.5)]">
              <CountRing remaining={remaining} total={30_000} size={92} />
              <div className="text-center">
                <div className="font-mono text-[10px] tracking-[0.18em] text-[var(--dim)]">LAUNCH GRANT</div>
                <div className="font-mono text-[12.5px] text-[var(--teal)] mt-1">{grant ? `${grant.grantId.slice(0, 12)}…${grant.tokenTail}` : 'awaiting issuance…'}</div>
                <div className="font-mono text-[10px] text-[var(--dim)] mt-2 leading-relaxed">
                  single-use · 30s TTL<br />bound: {cred.username} @ {app.domain}
                </div>
              </div>
              <div className="w-full border-t border-[var(--line)] pt-3 space-y-1.5 font-mono text-[10.5px]">
                <div className="flex justify-between"><span className="text-[var(--dim)]">username</span><span className="text-[var(--mut)]">{cred.username}</span></div>
                <div className="flex justify-between"><span className="text-[var(--dim)]">secret</span><Masked len={12} /></div>
                <div className="flex justify-between"><span className="text-[var(--dim)]">key version</span><span className="text-[var(--mut)]">DEK v{cred.keyVersion}</span></div>
              </div>
            </div>
          </div>
          <p className="text-center font-mono text-[10.5px] text-[var(--dim)] mt-4">
            the plaintext is decrypted inside the broker enclave and handed to an isolated-world injector — your browser receives an <span className="text-[var(--teal)]">operation</span>, not a password
          </p>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- proxied target session overlay ---------------- */
function MockApp({ app, rec }: { app: AppMeta; rec: SessionRec }) {
  const rows = useMemo(() => ({
    ebay: [
      ['ORD-88213', 'Wireless ANC headset ×2', '$219.00', 'Paid · packing'],
      ['ORD-88212', 'USB-C dock station', '$148.50', 'Paid · packing'],
      ['ORD-88209', 'Mech. keyboard 75%', '$129.00', 'Shipped'],
      ['ORD-88204', '4K webcam bundle', '$189.99', 'Shipped'],
      ['ORD-88201', 'Laptop stand alu.', '$59.00', 'Delivered'],
    ],
    cloudflare: [
      ['meridian.shop', 'A', '203.0.113.80', 'Proxied · auto'],
      ['www.meridian.shop', 'CNAME', 'meridian.shop', 'Proxied · auto'],
      ['api.meridian.shop', 'A', '203.0.113.81', 'Proxied · WAF on'],
      ['mail.meridian.shop', 'MX', 'aspmx.l.google.com', 'DNS only'],
      ['_dmarc.meridian.shop', 'TXT', 'v=DMARC1; p=reject', 'DNS only'],
    ],
    cpanel: [
      ['File Manager', '38.2 GB / 60 GB'], ['MySQL Databases', '4 databases'], ['Email Accounts', '22 accounts'],
      ['SSL/TLS', 'AutoSSL valid'], ['Backups', 'today 03:00'], ['phpMyAdmin', 'v5.2'],
    ],
    unleashed: [
      ['SKU-1042', 'ANC Headset v2', 'Sydney', '342', 'OK'],
      ['SKU-1077', 'USB-C Dock', 'Sydney', '18', 'LOW'],
      ['SKU-1101', 'Keyboard 75%', 'Melbourne', '121', 'OK'],
      ['SKU-1130', '4K Webcam', 'Sydney', '64', 'OK'],
      ['SKU-1155', 'Laptop Stand', 'Brisbane', '0', 'REORDER'],
    ],
  }), []);

  if (app.kind === 'DB' || app.kind === 'SSH') {
    return (
      <div className="h-full bg-[#070d18] p-5 font-mono text-[12.5px] leading-relaxed text-[#a8c4e6] overflow-auto">
        <div className="text-[var(--dim)]">brokered via gw-ap.keyrail.cloud → CONN-01 · keystrokes proxied, credential held server-side</div>
        <div className="mt-3 text-[var(--teal)]">{app.kind === 'DB' ? 'psql (16.2) — connected to orders@db-int.meridian.local:5432' : 'netadmin@sw-core-01:~$'}</div>
        {app.kind === 'DB' ? (
          <>
            <div className="mt-2 text-[var(--mut)]">orders=&gt; <span className="text-[var(--ink)]">SELECT region, count(*) FROM orders WHERE created_at &gt; now()-interval '1h' GROUP BY 1;</span></div>
            <pre className="mt-2 text-[11.5px]">{` region | count
--------+-------
 AU-N   |   412
 AU-S   |   388
 NZ     |    97`}</pre>
            <div className="mt-2 text-[var(--mut)]">orders=&gt; <span className="inline-block w-2 h-4 bg-[var(--teal)] animate-pulse align-middle" /></div>
          </>
        ) : (
          <>
            <div className="mt-2">show interface status</div>
            <pre className="mt-2 text-[11.5px]">{`PORT      STATUS   SPEED   DUPLEX
Gi1/0/1   up       10G     full
Gi1/0/2   up       10G     full
Gi1/0/3   down     auto    auto`}</pre>
            <div className="mt-2 text-[var(--teal)]">sw-core-01# <span className="inline-block w-2 h-4 bg-[var(--teal)] animate-pulse align-middle" /></div>
          </>
        )}
      </div>
    );
  }

  if (app.glyph === 'cpanel') {
    return (
      <div className="p-6 overflow-auto h-full">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {(rows.cpanel as string[][]).map(([t, s]) => (
            <div key={t} className="panel p-4 card-lift cursor-default">
              <div className="font-display font-semibold text-[14px]">{t}</div>
              <div className="font-mono text-[11px] text-[var(--mut)] mt-1">{s}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const isEb = app.glyph === 'ebay';
  const cols = isEb ? ['Order', 'Item', 'Total', 'Status'] : app.glyph === 'cloudflare' ? ['Record', 'Type', 'Content', 'Proxy'] : ['SKU', 'Product', 'Warehouse', 'On hand', 'Status'];
  const data = (rows as Record<string, string[][]>)[app.glyph] ?? rows.unleashed;

  return (
    <div className="p-6 overflow-auto h-full">
      <div className="grid grid-cols-3 gap-3 mb-5">
        {(isEb ? [['Orders today', '127'], ['Revenue', 'AU$18,410'], ['Open cases', '3']]
          : app.glyph === 'cloudflare' ? [['Requests (24h)', '4.2M'], ['Threats blocked', '1,208'], ['Cache ratio', '96.4%']]
          : [['SKUs tracked', '1,284'], ['Low stock', '7'], ['POs open', '12']]).map(([k, v]) => (
          <div key={k} className="panel p-4">
            <div className="font-mono text-[10px] tracking-[0.16em] text-[var(--dim)]">{k.toUpperCase()}</div>
            <div className="font-display font-bold text-[24px] mt-1">{v}</div>
          </div>
        ))}
      </div>
      <div className="panel overflow-hidden">
        <table className="table-base">
          <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{data.map((r) => <tr key={r[0]}>{r.map((cell, j) => <td key={j} className={j === 0 ? 'font-mono text-[12px] text-[var(--sky)]' : ''}>{cell}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

export function TargetSessionOverlay() {
  const { liveSession, closeLiveSession, snap, toast } = usePam();
  const rec = liveSession ? snap.sessions.find((s) => s.id === liveSession.id) : null;
  const app = rec ? snap.apps.find((a) => a.id === rec.appId) : null;
  const cred = rec ? snap.credentials.find((c) => c.id === rec.credentialId) : null;
  const [showInjection, setShowInjection] = useState(true);

  useEffect(() => { if (rec) setShowInjection(true); }, [rec?.id]);
  useEffect(() => {
    if (!showInjection) return;
    const t = window.setTimeout(() => setShowInjection(false), REDUCED_MOTION ? 300 : 2400);
    return () => window.clearTimeout(t);
  }, [showInjection, rec?.id]);

  if (!rec || !app) return null;
  const expired = rec.status !== 'ACTIVE';
  const remaining = rec.expiresAt ? rec.expiresAt - Date.now() : 0;
  const wm = `KEYRAIL · ${rec.userName.toUpperCase()} · ${rec.id.toUpperCase()} · PROXIED`;

  const terminate = () => {
    try { pam.terminateSession(rec.id); toast('Session terminated — grant scope revoked, recording sealed', 'red'); } catch { /* noop */ }
    closeLiveSession();
  };

  return (
    <div className="fixed inset-0 z-[75] bg-[rgba(5,10,20,0.96)] flex flex-col">
      {/* gateway chrome */}
      <div className="flex items-center gap-4 px-5 py-2.5 border-b border-[var(--line-strong)] bg-[var(--bg1)]">
        <span className="flex items-center gap-2 font-mono text-[11px] text-[var(--teal)]">
          <span className="w-2 h-2 rounded-full bg-[var(--red)] rec-blink" /> REC
        </span>
        <span className="font-mono text-[11px] text-[var(--mut)] truncate">via <span className="text-[var(--sky)]">{rec.gateway}</span> · TLS 1.3 · isolated world</span>
        <span className="font-mono text-[11px] text-[var(--dim)] hidden md:block">{app.domain}</span>
        <span className="flex-1" />
        <span className="font-mono text-[12px] text-[var(--amber)] tabular-nums">{fmtDur(Date.now() - rec.startedAt)}</span>
        {rec.expiresAt && !expired && <CountRing remaining={remaining} total={30 * 60_000} size={40} />}
        <button className="btn btn-ghost btn-sm" onClick={closeLiveSession}><I n="chevD" className="w-3.5 h-3.5 rotate-90" /> Console</button>
        <button className="btn btn-danger btn-sm" onClick={terminate}><I n="stop" className="w-3.5 h-3.5" /> Terminate</button>
      </div>

      {/* injection proof strip */}
      <div className="flex items-center gap-5 px-5 py-2 border-b border-[var(--line)] bg-[rgba(58,214,181,0.05)] font-mono text-[11px]">
        <span className="text-[var(--teal)] flex items-center gap-1.5"><I n="check" className="w-3.5 h-3.5" /> auto-authenticated as <span className="text-[var(--ink)]">{cred?.username}</span></span>
        <span className="text-[var(--dim)] hidden sm:flex items-center gap-1.5"><I n="lock" className="w-3.5 h-3.5" /> password field: <Masked len={10} /> (opaque handle — DOM-unreadable)</span>
        <span className="text-[var(--dim)] hidden lg:block">secret zeroized from broker memory ✓</span>
        <span className="flex-1" />
        <Chip tone="teal">ZERO PLAINTEXT PATH</Chip>
      </div>

      {/* target app */}
      <div className="flex-1 relative overflow-hidden">
        <div className="watermark" style={{ backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 74px, rgba(233,241,252,0.6) 74px, rgba(233,241,252,0.6) 75px)` }}>
          <div className="font-mono text-[15px] tracking-[0.3em] leading-[76px] text-[var(--ink)]">{wm}&nbsp;&nbsp;&nbsp;{wm}&nbsp;&nbsp;&nbsp;{wm}<br />{wm}&nbsp;&nbsp;&nbsp;{wm}&nbsp;&nbsp;&nbsp;{wm}<br />{wm}&nbsp;&nbsp;&nbsp;{wm}&nbsp;&nbsp;&nbsp;{wm}<br />{wm}&nbsp;&nbsp;&nbsp;{wm}&nbsp;&nbsp;&nbsp;{wm}<br />{wm}&nbsp;&nbsp;&nbsp;{wm}&nbsp;&nbsp;&nbsp;{wm}<br />{wm}&nbsp;&nbsp;&nbsp;{wm}&nbsp;&nbsp;&nbsp;{wm}<br />{wm}&nbsp;&nbsp;&nbsp;{wm}&nbsp;&nbsp;&nbsp;{wm}<br />{wm}&nbsp;&nbsp;&nbsp;{wm}&nbsp;&nbsp;&nbsp;{wm}</div>
        </div>
        {!expired ? <MockApp app={app} rec={rec} /> : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center rise-in">
              <div className="mx-auto w-16 h-16 rounded-full border border-[rgba(240,104,92,0.5)] bg-[rgba(240,104,92,0.08)] flex items-center justify-center text-[#ff9d94] mb-4"><I n="clock" className="w-8 h-8" /></div>
              <h3 className="font-display font-bold text-[20px]">Session {rec.status.toLowerCase()}</h3>
              <p className="text-[var(--mut)] text-[13px] mt-2 max-w-[44ch]">The JIT window closed or an admin terminated this session. The launch grant is revoked and the recording is sealed to audit.</p>
              <button className="btn btn-primary mt-5" onClick={closeLiveSession}>Return to console</button>
            </div>
          </div>
        )}
        {/* injection moment */}
        {showInjection && !expired && (
          <div className="absolute inset-0 z-40 bg-[rgba(6,12,24,0.94)] flex items-center justify-center">
            <div className="text-center rise-in">
              <div className="mx-auto w-[74px] h-[74px] rounded-full border-2 border-[rgba(58,214,181,0.5)] flex items-center justify-center relative">
                <span className="absolute inset-0 rounded-full radar-sweep" />
                <I n="key" className="w-8 h-8 text-[var(--teal)]" />
              </div>
              <div className="font-display font-bold text-[19px] mt-4">Injecting credential…</div>
              <div className="font-mono text-[11px] text-[var(--dim)] mt-2 leading-relaxed">
                isolated-world injector → {app.domain}<br />
                username filled · password written as opaque input event<br />
                <span className="text-[var(--teal)]">page JavaScript cannot observe the secret</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- launcher page ---------------- */
export default function Launcher() {
  const { snap, user, setRoute } = usePam();
  const [launching, setLaunching] = useState<{ app: AppMeta; cred: CredMeta } | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [filter, setFilter] = useState('ALL');

  const visible = useMemo(() => {
    const list: { app: AppMeta; cred: CredMeta; allowed: boolean; approvedWindow?: number }[] = [];
    snap.apps.forEach((app) => {
      const cred = snap.credentials.find((c) => c.id === app.credentialId);
      if (!cred) return;
      const sees = ['SUPER_ADMIN', 'ORG_ADMIN', 'PAM_ADMIN', 'SECURITY_ADMIN', 'AUDITOR'].includes(user!.role) ||
        cred.collectionIds.some((id) => user!.collectionIds.includes(id));
      if (!sees) return;
      const approved = snap.requests.find((r) => r.credentialId === cred.id && r.userId === user!.id && r.status === 'APPROVED' && (r.expiresAt ?? 0) > Date.now());
      const allowed = cred.access !== 'APPROVAL_REQUIRED' || !!approved;
      list.push({ app, cred, allowed, approvedWindow: approved?.expiresAt });
    });
    return list.filter((x) => filter === 'ALL' || x.app.kind === filter);
  }, [snap, user, filter]);

  const launches = snap.audit.filter((e) => e.type === 'APPLICATION_LAUNCHED').slice(0, 6);

  return (
    <div className="space-y-6 max-w-[1180px]">
      <Reveal>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5">
            {['ALL', 'WEB', 'DB', 'SSH'].map((k) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`px-3 py-1.5 rounded-lg font-mono text-[11px] tracking-wider border transition-all cursor-pointer ${filter === k ? 'border-[rgba(58,214,181,0.5)] text-[var(--teal)] bg-[rgba(58,214,181,0.08)]' : 'border-[var(--line)] text-[var(--mut)] hover:text-[var(--ink)]'}`}>
                {k}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <Chip tone="teal"><I n="ext" className="w-3.5 h-3.5" /> Browser connector connected · v3.2</Chip>
          <Chip><I n="globe" className="w-3.5 h-3.5" /> domain-allowlist enforced</Chip>
        </div>
      </Reveal>

      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {visible.map(({ app, cred, allowed, approvedWindow }, i) => (
          <Reveal key={app.id} delay={i * 60}>
            <div className="panel card-lift p-5 flex flex-col h-full relative overflow-hidden group">
              <div className="absolute top-0 left-0 right-0 h-[2px] opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: `linear-gradient(90deg, transparent, hsl(${app.hue} 70% 62%), transparent)` }} />
              <div className="flex items-start gap-3.5">
                <AppGlyph app={app} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-display font-bold text-[16px] truncate">{app.name}</h3>
                    {app.viaConnector && <Chip tone="sky"><I n="tunnel" className="w-3 h-3" />CONNECTOR</Chip>}
                  </div>
                  <p className="text-[12px] text-[var(--mut)] mt-0.5 leading-snug">{app.blurb}</p>
                </div>
              </div>
              <div className="mt-4 space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between gap-2"><span className="text-[var(--dim)]">account</span><span className="text-[var(--mut)] truncate">{cred.username}</span></div>
                <div className="flex justify-between gap-2"><span className="text-[var(--dim)]">domain</span><span className="text-[var(--sky)] truncate">{app.domain}</span></div>
                <div className="flex justify-between gap-2"><span className="text-[var(--dim)]">secret</span><Masked len={10} /></div>
                <div className="flex justify-between gap-2"><span className="text-[var(--dim)]">last launch</span><span className="text-[var(--mut)]">{cred.lastUsedAt ? timeAgo(cred.lastUsedAt) : '—'}</span></div>
              </div>
              <div className="mt-4 pt-3 border-t border-[var(--line)] flex items-center gap-2">
                {allowed ? (
                  <>
                    <button className="btn btn-primary flex-1" onClick={() => setLaunching({ app, cred })}>
                      <I n="launch" className="w-4 h-4" /> Open
                    </button>
                    {cred.access === 'APPROVAL_REQUIRED' && approvedWindow && (
                      <Chip tone="amber"><I n="clock" className="w-3 h-3" />JIT {fmtCountdownSafe(approvedWindow - Date.now())}</Chip>
                    )}
                    {cred.access === 'PERMANENT' && <Chip tone="teal">PERMANENT</Chip>}
                  </>
                ) : (
                  <>
                    <button className="btn btn-amber flex-1" onClick={() => setRequesting(cred.id)}>
                      <I n="bolt" className="w-4 h-4" /> Request access
                    </button>
                    <Chip tone="amber">APPROVAL REQ.</Chip>
                  </>
                )}
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="panel lg:col-span-2 overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--line)] font-display font-semibold text-[14px]">Recent launches <span className="text-[var(--dim)] font-mono text-[10.5px] ml-2">APPLICATION_LAUNCHED · metadata only</span></div>
            <table className="table-base">
              <thead><tr><th>When</th><th>Actor</th><th>Application</th><th>Grant</th></tr></thead>
              <tbody>
                {launches.map((e) => (
                  <tr key={e.id}>
                    <td className="font-mono text-[11.5px] text-[var(--dim)]">{fmtHM(e.ts)}</td>
                    <td>{e.actorName}</td>
                    <td className="text-[var(--sky)]">{e.resourceName}</td>
                    <td className="font-mono text-[11px] text-[var(--dim)]">{e.meta?.split(' ')[1] ?? '—'} · consumed ✓</td>
                  </tr>
                ))}
                {launches.length === 0 && <tr><td colSpan={4} className="text-[var(--mut)]">No launches yet — open an application above.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="panel p-5">
            <div className="font-display font-semibold text-[14px] mb-3">Why no "show password"?</div>
            <ul className="space-y-2.5 text-[12.5px] text-[var(--mut)] leading-snug">
              <li className="flex gap-2"><Dot /> <span><span className="text-[var(--ink)]">No plaintext endpoint.</span> The API surface has no route that returns a secret — only capability grants.</span></li>
              <li className="flex gap-2"><Dot tone="var(--amber)" /> <span><span className="text-[var(--ink)]">use ≠ reveal.</span> Launch rights and reveal rights are separate permissions; yours are launch-only.</span></li>
              <li className="flex gap-2"><Dot tone="var(--sky)" /> <span><span className="text-[var(--ink)]">Isolated-world injection.</span> Credentials are written to login fields opaquely, then zeroized.</span></li>
            </ul>
            <button className="btn btn-ghost btn-sm mt-4 w-full" onClick={() => setRoute('security')}>Run adversarial tests <I n="arrowR" className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </Reveal>

      {launching && <LaunchModal app={launching.app} cred={launching.cred} onClose={() => setLaunching(null)} />}
      <RequestAccessModal credId={requesting} onClose={() => setRequesting(null)} />
    </div>
  );
}

function fmtCountdownSafe(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}
