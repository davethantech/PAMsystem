import { useState } from 'react';
import { pam, isPamError } from '../engine/pam';
import { I } from '../components/icons';
import { Chip, CountRing, Dot, Modal, Reveal, StatusPill, fmtDur, fmtHM, timeAgo } from '../components/ui';
import { usePam } from '../state/store';
import { RequestAccessModal } from './Launcher';

type Tab = 'requests' | 'approvals' | 'jit' | 'sessions';

export default function Access() {
  const { snap, user, toast, openLiveSession, setRoute } = usePam();
  const [tab, setTab] = useState<Tab>('requests');
  const [picker, setPicker] = useState(false);
  const [requesting, setRequesting] = useState<string | null>(null);
  const isApprover = ['PAM_ADMIN', 'ORG_ADMIN', 'SUPER_ADMIN', 'SECURITY_ADMIN'].includes(user!.role);
  const canTerminate = ['PAM_ADMIN', 'ORG_ADMIN', 'SUPER_ADMIN', 'SECURITY_ADMIN'].includes(user!.role);

  const pending = snap.requests.filter((r) => r.status === 'PENDING');
  const live = snap.requests.filter((r) => r.status === 'APPROVED' && (r.expiresAt ?? 0) > Date.now());
  const activeSessions = snap.sessions.filter((s) => s.status === 'ACTIVE');

  const decide = (id: string, ok: boolean) => {
    try {
      pam.decideRequest(id, ok);
      toast(ok ? 'Approved — JIT window opened and the requester can now launch' : 'Request denied — event recorded', ok ? 'teal' : 'red');
    } catch (e) { toast(isPamError(e) ? e.message : 'Action failed', 'red'); }
  };

  const tabs: { k: Tab; label: string; n?: number }[] = [
    { k: 'requests', label: 'Requests', n: snap.requests.length },
    { k: 'approvals', label: 'Approvals', n: pending.length },
    { k: 'jit', label: 'JIT Windows', n: live.length },
    { k: 'sessions', label: 'Active Sessions', n: activeSessions.length },
  ];

  return (
    <div className="space-y-5 max-w-[1180px]">
      <Reveal>
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`px-4 py-2 rounded-lg font-display font-semibold text-[13px] border transition-all cursor-pointer flex items-center gap-2 ${tab === t.k ? 'border-[rgba(58,214,181,0.5)] text-[var(--teal)] bg-[rgba(58,214,181,0.08)]' : 'border-[var(--line)] text-[var(--mut)] hover:text-[var(--ink)]'}`}>
              {t.label}
              {t.n !== undefined && t.n > 0 && <span className="font-mono text-[10px] px-1.5 rounded-full bg-[rgba(122,160,210,0.12)]">{t.n}</span>}
            </button>
          ))}
          <span className="flex-1" />
          <button className="btn btn-primary btn-sm" onClick={() => setPicker(true)}><I n="plus" className="w-3.5 h-3.5" /> New access request</button>
        </div>
      </Reveal>

      {/* REQUESTS */}
      {tab === 'requests' && (
        <Reveal>
          <div className="panel overflow-hidden">
            <table className="table-base">
              <thead><tr><th>Requester</th><th>Credential</th><th>Reason</th><th>Ticket</th><th>Window</th><th>Submitted</th><th>Status</th></tr></thead>
              <tbody>
                {snap.requests.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.userName}</td>
                    <td className="text-[var(--sky)]">{r.credentialName}</td>
                    <td className="max-w-[260px] text-[var(--mut)] text-[12.5px] leading-snug">{r.reason}</td>
                    <td className="font-mono text-[11px] text-[var(--dim)]">{r.ticket}</td>
                    <td className="font-mono text-[12px]">{r.hours}h</td>
                    <td className="font-mono text-[11px] text-[var(--dim)]">{timeAgo(r.createdAt)}</td>
                    <td><StatusPill status={r.status} />{r.approverName && <div className="font-mono text-[9.5px] text-[var(--dim)] mt-1">by {r.approverName}</div>}</td>
                  </tr>
                ))}
                {snap.requests.length === 0 && <tr><td colSpan={7} className="text-[var(--mut)]">No access requests yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Reveal>
      )}

      {/* APPROVALS */}
      {tab === 'approvals' && (
        <Reveal>
          {!isApprover ? (
            <div className="panel p-10 text-center">
              <I n="lock" className="w-8 h-8 text-[var(--dim)] mx-auto" />
              <p className="text-[var(--mut)] mt-3 text-[13.5px]">Approvals require a PAM or Security admin role.</p>
              <p className="font-mono text-[11px] text-[var(--dim)] mt-1">switch to the Priya or Marcus persona to review the queue</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {pending.length === 0 && <div className="panel p-10 text-center md:col-span-2"><p className="text-[var(--mut)]">Approval queue is clear. 🎯</p></div>}
              {pending.map((r) => (
                <div key={r.id} className="panel p-5 card-lift">
                  <div className="flex items-center gap-2 mb-3">
                    <Chip tone="amber"><I n="bolt" className="w-3 h-3" /> JIT REQUEST</Chip>
                    <span className="font-mono text-[10px] text-[var(--dim)]">{r.id.toUpperCase()} · {timeAgo(r.createdAt)}</span>
                  </div>
                  <div className="text-[14px]"><span className="font-semibold">{r.userName}</span> <span className="text-[var(--mut)]">wants</span> <span className="text-[var(--sky)] font-semibold">{r.credentialName}</span></div>
                  <blockquote className="mt-3 border-l-2 border-[var(--amber)] pl-3 text-[12.5px] text-[var(--mut)] italic leading-relaxed">“{r.reason}”</blockquote>
                  <div className="mt-3 flex gap-2 font-mono text-[10.5px]">
                    <Chip>ticket {r.ticket}</Chip><Chip tone="amber">{r.hours}h window</Chip><Chip>auto-expire ✓</Chip>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button className="btn btn-primary flex-1" onClick={() => decide(r.id, true)}><I n="check" className="w-4 h-4" /> Approve</button>
                    <button className="btn btn-danger flex-1" onClick={() => decide(r.id, false)}><I n="x" className="w-4 h-4" /> Deny</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Reveal>
      )}

      {/* JIT */}
      {tab === 'jit' && (
        <Reveal>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {live.length === 0 && (
              <div className="panel p-10 text-center md:col-span-3">
                <I n="clock" className="w-8 h-8 text-[var(--dim)] mx-auto" />
                <p className="text-[var(--mut)] mt-3 text-[13.5px]">No live just-in-time windows. Approved windows appear here with a countdown — then evaporate.</p>
                <button className="btn btn-ghost btn-sm mt-4" onClick={() => setRoute('launcher')}>Browse launchable applications</button>
              </div>
            )}
            {live.map((r) => (
              <div key={r.id} className="panel p-5 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, var(--amber), transparent)' }} />
                <div className="flex items-center justify-between">
                  <Chip tone="amber"><I n="bolt" className="w-3 h-3" /> JIT ACTIVE</Chip>
                  <CountRing remaining={(r.expiresAt ?? 0) - Date.now()} total={r.hours * 3600_000} size={54} />
                </div>
                <div className="mt-3 text-[14px] font-semibold">{r.credentialName}</div>
                <div className="font-mono text-[10.5px] text-[var(--dim)] mt-1">grantee {r.userName} · approver {r.approverName} · ticket {r.ticket}</div>
                <p className="text-[12px] text-[var(--mut)] mt-2 leading-snug">{r.reason}</p>
                {r.userId === user!.id ? (
                  <button className="btn btn-primary w-full mt-4" onClick={() => setRoute('launcher')}><I n="launch" className="w-4 h-4" /> Launch now</button>
                ) : (
                  <div className="font-mono text-[10.5px] text-[var(--dim)] mt-4 text-center">window bound to {r.userName}</div>
                )}
              </div>
            ))}
            {snap.requests.filter((r) => r.status === 'EXPIRED' || r.status === 'DENIED').slice(0, 3).map((r) => (
              <div key={r.id} className="panel p-5 opacity-55">
                <StatusPill status={r.status} />
                <div className="mt-2 text-[13.5px] font-semibold">{r.credentialName}</div>
                <div className="font-mono text-[10.5px] text-[var(--dim)] mt-1">{r.userName} · decided {r.decidedAt ? timeAgo(r.decidedAt) : '—'} by {r.approverName ?? 'policy'}</div>
              </div>
            ))}
          </div>
        </Reveal>
      )}

      {/* SESSIONS */}
      {tab === 'sessions' && (
        <Reveal>
          <div className="panel overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--line)] flex items-center gap-2">
              <Dot tone="var(--red)" blink />
              <span className="font-display font-semibold text-[14px]">Session gateway monitor</span>
              <span className="font-mono text-[10.5px] text-[var(--dim)]">all traffic proxied · credentials never touch the endpoint</span>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>User</th><th>Application</th><th>Started</th><th>Duration</th><th>Source</th><th>Gateway</th><th>Rec</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
                <tbody>
                  {snap.sessions.map((s) => (
                    <tr key={s.id}>
                      <td className="font-semibold">{s.userName}</td>
                      <td className="text-[var(--sky)]">{s.appName}</td>
                      <td className="font-mono text-[11.5px] text-[var(--dim)]">{fmtHM(s.startedAt)}</td>
                      <td className="font-mono text-[12px] text-[var(--teal)] tabular-nums">{s.status === 'ACTIVE' ? fmtDur(Date.now() - s.startedAt) : fmtDur((s.endedAt ?? s.startedAt) - s.startedAt)}</td>
                      <td>
                        <div className="font-mono text-[10.5px] text-[var(--dim)]">{s.ip}</div>
                        <div className="text-[11px] text-[var(--mut)]">{s.device}</div>
                      </td>
                      <td className="font-mono text-[10.5px] text-[var(--dim)]">{s.gateway}</td>
                      <td>{s.recording && <Chip tone="red"><span className="w-1.5 h-1.5 rounded-full bg-[var(--red)] rec-blink" />REC</Chip>}</td>
                      <td><StatusPill status={s.status} /></td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          {s.status === 'ACTIVE' && s.userId === user!.id && (
                            <button className="btn btn-ghost btn-sm" onClick={() => openLiveSession(s)}>Return</button>
                          )}
                          {s.status === 'ACTIVE' && (s.userId === user!.id || canTerminate) && (
                            <button className="btn btn-danger btn-sm" onClick={() => {
                              try { pam.terminateSession(s.id); toast(`Session ${s.appName} terminated — grant revoked, recording sealed`, 'red'); }
                              catch (e) { toast(isPamError(e) ? e.message : 'Cannot terminate', 'red'); }
                            }}><I n="stop" className="w-3.5 h-3.5" /> Terminate</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Reveal>
      )}

      {/* credential picker for new request */}
      <Modal open={picker} onClose={() => setPicker(false)} title="Choose a credential to request" width={520}>
        <div className="space-y-2">
          {snap.credentials.filter((c) => c.access === 'APPROVAL_REQUIRED').map((c) => (
            <button key={c.id} onClick={() => { setPicker(false); setRequesting(c.id); }}
              className="w-full text-left panel p-3.5 hover:border-[rgba(242,180,76,0.5)] transition-colors cursor-pointer flex items-center gap-3">
              <I n="bolt" className="w-4 h-4 text-[var(--amber)] shrink-0" />
              <span className="flex-1">
                <span className="block text-[13.5px] font-semibold">{c.name}</span>
                <span className="block font-mono text-[10.5px] text-[var(--dim)]">{c.target} · window {c.jitWindowMin}m</span>
              </span>
              <I n="chevR" className="w-4 h-4 text-[var(--dim)]" />
            </button>
          ))}
        </div>
      </Modal>
      <RequestAccessModal credId={requesting} onClose={() => setRequesting(null)} />
    </div>
  );
}
