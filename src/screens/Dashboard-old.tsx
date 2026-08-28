import { useMemo } from 'react';
import { pam } from '../engine/pam';
import { I } from '../components/icons';
import { Chip, CountUp, Dot, Panel, Reveal, Spark, StatusPill, fmtDur, timeAgo } from '../components/ui';
import { usePam } from '../state/store';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function PostureRing({ score }: { score: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const color = score > 85 ? 'var(--teal)' : score > 70 ? 'var(--amber)' : 'var(--red)';
  return (
    <div className="relative w-[116px] h-[116px]">
      <svg width="116" height="116" className="-rotate-90">
        <circle cx="58" cy="58" r={r} fill="none" stroke="rgba(122,160,210,0.14)" strokeWidth="7" />
        <circle cx="58" cy="58" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.2,0.7,0.2,1)' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <CountUp to={score} className="font-display font-bold text-[28px]" />
        <span className="font-mono text-[8.5px] tracking-[0.2em] text-[var(--dim)]">POSTURE</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { snap, user, setRoute, toast, tick } = usePam();
  void tick;

  const activeSessions = snap.sessions.filter((s) => s.status === 'ACTIVE');
  const pending = snap.requests.filter((r) => r.status === 'PENDING');
  const denied1h = snap.audit.filter((e) => e.result === 'DENIED' && Date.now() - e.ts < 3600_000).length;
  const launchesWeek = snap.launchSeries.reduce((a, b) => a + b, 0);
  const dueRotations = snap.rotation.filter((r) => r.status === 'DUE').length;

  const posture = useMemo(() => {
    let s = 96;
    s -= snap.alerts.length * 5;
    s -= dueRotations * 3;
    s -= Math.min(6, denied1h);
    return Math.max(55, s);
  }, [snap.alerts.length, dueRotations, denied1h]);

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const stats = [
    { label: 'Protected accounts', value: snap.credentials.length, icon: 'key', tone: 'var(--teal)', note: `${snap.credentials.filter((c) => c.health === 'VERIFIED').length} verified` },
    { label: 'Active sessions', value: activeSessions.length, icon: 'radar', tone: 'var(--sky)', note: 'proxied & recorded', live: true },
    { label: 'Launches · 14 days', value: launchesWeek, icon: 'launch', tone: 'var(--gold)', note: `peak ${Math.max(...snap.launchSeries)}/day` },
    { label: 'Pending approvals', value: pending.length, icon: 'bolt', tone: 'var(--amber)', note: 'JIT requests' },
    { label: 'Denied events · 1h', value: denied1h, icon: 'shieldX', tone: 'var(--red)', note: 'all audited' },
    { label: 'Rotations due', value: dueRotations, icon: 'rotate', tone: 'var(--mut)', note: `${snap.rotation.length} policies` },
  ];

  const maxCol = Math.max(...snap.collections.map((c) => snap.credentials.filter((x) => x.collectionIds.includes(c.id)).length), 1);

  return (
    <div className="space-y-6 max-w-[1180px]">
      {/* greeting + posture */}
      <Reveal>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex-1 min-w-[260px]">
            <h2 className="font-display font-bold text-[26px] tracking-tight">
              {greet}, {user?.name.split(' ')[0]} <span className="text-[var(--teal)]">— the vault is sealed.</span>
            </h2>
            <p className="text-[var(--mut)] text-[13.5px] mt-1.5 max-w-[64ch]">
              {snap.credentials.length} privileged accounts under management for <span className="text-[var(--ink)]">{snap.tenant.name}</span>.
              Every launch is brokered, recorded, and plaintext-free. Your role: <Chip tone="teal" className="!text-[10px]">{user?.role.replace('_', ' ')}</Chip>
            </p>
            <div className="flex gap-2.5 mt-4">
              <button className="btn btn-primary" onClick={() => setRoute('launcher')}><I n="launch" className="w-4 h-4" /> Open applications</button>
              <button className="btn btn-ghost" onClick={() => setRoute('access')}><I n="bolt" className="w-4 h-4" /> Access requests</button>
            </div>
          </div>
          <div className="flex items-center gap-5 panel px-6 py-4">
            <PostureRing score={posture} />
            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex items-center gap-2"><Dot /> tenant isolation <span className="text-[var(--teal)]">enforced</span></div>
              <div className="flex items-center gap-2"><Dot tone="var(--sky)" /> KMS envelope keys <span className="text-[var(--sky)]">v{snap.credentials[0]?.keyVersion}</span></div>
              <div className="flex items-center gap-2"><Dot tone={snap.alerts.length ? 'var(--red)' : 'var(--teal)'} /> alerts <span>{snap.alerts.length} open</span></div>
              <div className="flex items-center gap-2"><Dot tone="var(--amber)" /> audit chain <span className="text-[var(--amber)]">#{snap.audit[0]?.hash.slice(0, 8)}</span></div>
            </div>
          </div>
        </div>
      </Reveal>

      {/* stats band */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {stats.map((s, i) => (
          <Reveal key={s.label} delay={i * 50}>
            <div className="panel p-4 card-lift h-full">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">{s.label.toUpperCase()}</span>
                <span style={{ color: s.tone }}><I n={s.icon} className="w-4 h-4" /></span>
              </div>
              <div className="flex items-baseline gap-2 mt-2">
                <CountUp to={s.value} className="font-display font-bold text-[26px]" />
                {s.live && <span className="w-1.5 h-1.5 rounded-full bg-[var(--sky)] pulse-dot" />}
              </div>
              <div className="font-mono text-[10px] text-[var(--dim)] mt-0.5">{s.note}</div>
            </div>
          </Reveal>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* launch activity */}
        <Reveal className="lg:col-span-2">
          <Panel title="Launch activity" sub="Secure launches per day · last 14 days" icon="launch"
            right={<Chip tone="teal"><I n="check" className="w-3 h-3" /> 100% brokered</Chip>}>
            <div className="px-5 py-4">
              <svg viewBox="0 0 560 150" className="w-full h-[170px]" preserveAspectRatio="none">
                {(() => {
                  const max = Math.max(...snap.launchSeries);
                  const pts = snap.launchSeries.map((v, i) => [10 + (i / (snap.launchSeries.length - 1)) * 540, 138 - (v / max) * 118]);
                  const line = pts.map((p) => p.join(',')).join(' ');
                  return (
                    <>
                      {[0.25, 0.5, 0.75].map((f) => (
                        <line key={f} x1="10" x2="550" y1={138 - f * 118} y2={138 - f * 118} stroke="rgba(122,160,210,0.1)" strokeDasharray="3 6" />
                      ))}
                      <polygon points={`10,138 ${line} 550,138`} fill="url(#gradLaunch)" />
                      <polyline points={line} fill="none" stroke="var(--teal)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
                      {pts.map((p, i) => (
                        <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 4 : 2.4} fill={i === pts.length - 1 ? 'var(--teal)' : '#0d1830'} stroke="var(--teal)" strokeWidth="1.6">
                          {i === pts.length - 1 && <animate attributeName="r" values="4;6;4" dur="1.6s" repeatCount="indefinite" />}
                        </circle>
                      ))}
                      <defs>
                        <linearGradient id="gradLaunch" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--teal)" stopOpacity="0.28" />
                          <stop offset="100%" stopColor="var(--teal)" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                    </>
                  );
                })()}
              </svg>
              <div className="flex justify-between font-mono text-[9.5px] text-[var(--dim)] px-1">
                {DAYS.map((d, i) => <span key={i}>{d}</span>)}
              </div>
            </div>
          </Panel>
        </Reveal>

        {/* live audit */}
        <Reveal delay={100}>
          <Panel title="Live audit stream" sub="hash-chained · tamper-evident" icon="doc"
            right={<span className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--teal)]"><span className="w-1.5 h-1.5 rounded-full bg-[var(--teal)] pulse-dot" />LIVE</span>}>
            <div className="max-h-[300px] overflow-y-auto">
              {snap.audit.slice(0, 9).map((e, i) => (
                <div key={e.id} className={`px-4 py-2.5 border-b border-[var(--line)] flex items-start gap-2.5 ${i === 0 ? 'tick-flash' : ''}`}>
                  <span className={`mt-1 ${e.result === 'DENIED' || e.result === 'FAILURE' ? 'text-[#ff9d94]' : 'text-[var(--teal)]'}`}>
                    <I n={e.result === 'DENIED' || e.result === 'FAILURE' ? 'slash' : 'check'} className="w-3.5 h-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-semibold">{e.type}</span>
                      <span className="font-mono text-[9.5px] text-[var(--dim)]">#{e.hash.slice(0, 6)}</span>
                    </div>
                    <div className="text-[11px] text-[var(--mut)] truncate">{e.actorName}{e.resourceName ? ` → ${e.resourceName}` : ''}</div>
                  </div>
                  <span className="font-mono text-[9.5px] text-[var(--dim)] shrink-0">{timeAgo(e.ts)}</span>
                </div>
              ))}
            </div>
            <button className="w-full py-2.5 text-[12px] font-display font-semibold text-[var(--sky)] hover:bg-[rgba(95,168,242,0.06)] transition-colors cursor-pointer border-t border-[var(--line)]"
              onClick={() => setRoute('reports')}>
              Open full audit log →
            </button>
          </Panel>
        </Reveal>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* sessions */}
        <Reveal className="lg:col-span-2">
          <Panel title="Active privileged sessions" sub="proxied through the cloud gateway · recording on" icon="radar"
            right={<Chip tone="red"><span className="w-1.5 h-1.5 rounded-full bg-[var(--red)] rec-blink" />{activeSessions.length} LIVE</Chip>}>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>User</th><th>Application</th><th>Started</th><th>Duration</th><th>Gateway</th><th>Status</th></tr></thead>
                <tbody>
                  {activeSessions.map((s) => (
                    <tr key={s.id}>
                      <td className="font-semibold">{s.userName}</td>
                      <td className="text-[var(--sky)]">{s.appName}</td>
                      <td className="font-mono text-[11.5px] text-[var(--dim)]">{new Date(s.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="font-mono text-[12px] text-[var(--teal)] tabular-nums">{fmtDur(Date.now() - s.startedAt)}</td>
                      <td className="font-mono text-[10.5px] text-[var(--dim)]">{s.gateway}</td>
                      <td><StatusPill status={s.status} /></td>
                    </tr>
                  ))}
                  {activeSessions.length === 0 && <tr><td colSpan={6} className="text-[var(--mut)]">No active sessions.</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>
        </Reveal>

        {/* collections + approvals */}
        <div className="space-y-4">
          <Reveal delay={80}>
            <Panel title="Collection coverage" icon="layers">
              <div className="px-5 py-4 space-y-3">
                {snap.collections.map((c) => {
                  const n = snap.credentials.filter((x) => x.collectionIds.includes(c.id)).length;
                  return (
                    <div key={c.id}>
                      <div className="flex justify-between text-[12px] mb-1">
                        <span className="font-semibold" style={{ color: `hsl(${c.hue} 70% 70%)` }}>{c.name}</span>
                        <span className="font-mono text-[10.5px] text-[var(--dim)]">{n} creds · {c.memberUserIds.length} members</span>
                      </div>
                      <div className="h-[6px] rounded-full bg-[rgba(122,160,210,0.12)] overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${(n / maxCol) * 100}%`, background: `hsl(${c.hue} 65% 55%)` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </Reveal>
          <Reveal delay={140}>
            <Panel title="Pending approvals" icon="bolt">
              <div className="px-5 py-3 space-y-2.5">
                {pending.length === 0 && <p className="text-[12.5px] text-[var(--mut)] py-2">Queue clear — no pending requests.</p>}
                {pending.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 border border-[var(--line)] rounded-lg p-2.5">
                    <span className="w-7 h-7 rounded-full bg-[rgba(242,180,76,0.12)] border border-[rgba(242,180,76,0.4)] flex items-center justify-center text-[var(--amber)]"><I n="bolt" className="w-3.5 h-3.5" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-semibold truncate">{r.userName} → {r.credentialName}</div>
                      <div className="font-mono text-[10px] text-[var(--dim)]">{r.ticket} · {r.hours}h window · {timeAgo(r.createdAt)}</div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => {
                      if (['PAM_ADMIN', 'SECURITY_ADMIN', 'ORG_ADMIN', 'SUPER_ADMIN'].includes(user!.role)) setRoute('access');
                      else toast('Only PAM/Security admins can approve — try the Priya or Marcus persona', 'amber');
                    }}>Review</button>
                  </div>
                ))}
              </div>
            </Panel>
          </Reveal>
        </div>
      </div>
      {/* hidden usage to keep pam import meaningful for future inline actions */}
      <span className="hidden">{typeof pam.snapshot === 'function' ? '' : ''}</span>
    </div>
  );
}
