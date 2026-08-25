import { useMemo, useState } from 'react';
import { I } from '../components/icons';
import { Chip, Reveal, StatusPill, fmtDur, fmtHM } from '../components/ui';
import { usePam } from '../state/store';

const TYPE_TONE: Record<string, string> = {
  ACCESS_DENIED: 'red', GRANT_REPLAY_BLOCKED: 'red', MFA_FAILURE: 'red', CREDENTIAL_REVEAL: 'amber',
  BREAK_GLASS: 'amber', ACCESS_REQUESTED: 'amber', PASSWORD_ROTATED: 'sky', RED_TEAM_PROBE: 'red',
};

export default function Reports() {
  const { snap, toast } = usePam();
  const [type, setType] = useState('ALL');
  const [result, setResult] = useState('ALL');
  const [q, setQ] = useState('');

  const types = useMemo(() => [...new Set(snap.audit.map((e) => e.type))].sort(), [snap.audit]);

  const filtered = snap.audit.filter((e) =>
    (type === 'ALL' || e.type === type) &&
    (result === 'ALL' || e.result === result) &&
    (!q || `${e.actorName} ${e.type} ${e.resourceName ?? ''} ${e.meta ?? ''}`.toLowerCase().includes(q.toLowerCase())),
  );

  const chain = useMemo(() => {
    let ok = 0;
    for (let i = 0; i < snap.audit.length - 1; i++) {
      if (snap.audit[i].prevHash === snap.audit[i + 1].hash) ok++;
    }
    return { ok, total: snap.audit.length - 1 };
  }, [snap.audit]);

  const denied = snap.audit.filter((e) => e.result === 'DENIED' || e.result === 'FAILURE').length;
  const active = snap.sessions.filter((s) => s.status === 'ACTIVE').length;
  const recorded = snap.sessions.filter((s) => s.recording).length;

  const exportCsv = () => {
    const head = 'seq,ts,actor,type,resource,result,hash,prev_hash';
    const rows = filtered.map((e) => [e.seq, new Date(e.ts).toISOString(), e.actorName, e.type, e.resourceName ?? '', e.result, e.hash, e.prevHash].join(','));
    const blob = new Blob([[head, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'keyrail-audit.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('CSV exported — metadata only, secrets are structurally absent', 'sky');
  };

  return (
    <div className="space-y-5 max-w-[1180px]">
      <div className="grid sm:grid-cols-4 gap-3">
        {[
          { k: 'Events on chain', v: snap.audit.length, tone: 'var(--teal)' },
          { k: 'Chain links verified', v: `${chain.ok}/${chain.total}`, tone: chain.ok === chain.total ? 'var(--teal)' : 'var(--red)' },
          { k: 'Denied / failed', v: denied, tone: 'var(--red)' },
          { k: 'Sessions recorded', v: `${recorded}/${snap.sessions.length}`, tone: 'var(--sky)' },
        ].map((s, i) => (
          <Reveal key={s.k} delay={i * 50}>
            <div className="panel p-4 card-lift">
              <div className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">{s.k.toUpperCase()}</div>
              <div className="font-display font-bold text-[24px] mt-1" style={{ color: s.tone }}>{s.v}</div>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <div className="panel overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--line)] flex flex-wrap items-center gap-3">
            <span className="font-display font-semibold flex items-center gap-2"><I n="doc" className="w-4 h-4 text-[var(--teal)]" /> Audit chain</span>
            <Chip tone={chain.ok === chain.total ? 'teal' : 'red'}>
              <I n={chain.ok === chain.total ? 'check' : 'alert'} className="w-3 h-3" /> {chain.ok === chain.total ? 'integrity verified' : 'chain broken'}
            </Chip>
            <span className="flex-1" />
            <input className="input !w-[190px] !py-1.5 text-[12.5px]" placeholder="Filter events…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input !w-[190px] !py-1.5 text-[12.5px]" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="ALL">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="input !w-[120px] !py-1.5 text-[12.5px]" value={result} onChange={(e) => setResult(e.target.value)}>
              {['ALL', 'SUCCESS', 'DENIED', 'FAILURE'].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={exportCsv}><I n="download" className="w-3.5 h-3.5" /> CSV</button>
          </div>
          <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
            <table className="table-base !text-[12.5px]">
              <thead className="sticky top-0 bg-[var(--panel-solid)]">
                <tr><th>#</th><th>Time</th><th>Actor</th><th>Event</th><th>Resource</th><th>Detail</th><th>Result</th><th>Hash link</th></tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td className="font-mono text-[10.5px] text-[var(--dim)]">{e.seq}</td>
                    <td className="font-mono text-[11px] text-[var(--dim)] whitespace-nowrap">{fmtHM(e.ts)}</td>
                    <td className="font-semibold whitespace-nowrap">{e.actorName}</td>
                    <td><Chip tone={TYPE_TONE[e.type] ?? ''}>{e.type}</Chip></td>
                    <td className="text-[var(--sky)] whitespace-nowrap">{e.resourceName ?? '—'}</td>
                    <td className="max-w-[280px] truncate text-[var(--mut)] text-[11.5px]" title={e.meta}>{e.meta ?? '—'}</td>
                    <td><StatusPill status={e.result} /></td>
                    <td className="font-mono text-[10px] text-[var(--dim)] whitespace-nowrap">
                      <span className="text-[var(--mut)]">#{e.hash.slice(0, 6)}</span> ← #{e.prevHash.slice(0, 6)}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={8} className="text-[var(--mut)]">No events match the filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </Reveal>

      <Reveal>
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="panel overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--line)] font-display font-semibold">Session report</div>
            <table className="table-base !text-[12.5px]">
              <thead><tr><th>Session</th><th>User → App</th><th>Length</th><th>Status</th></tr></thead>
              <tbody>
                {snap.sessions.slice(0, 6).map((s) => (
                  <tr key={s.id}>
                    <td className="font-mono text-[10.5px] text-[var(--dim)]">{s.id}</td>
                    <td>{s.userName} → <span className="text-[var(--sky)]">{s.appName}</span></td>
                    <td className="font-mono text-[11.5px]">{fmtDur((s.endedAt ?? Date.now()) - s.startedAt)}</td>
                    <td><StatusPill status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 py-3 border-t border-[var(--line)] font-mono text-[10.5px] text-[var(--dim)] flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--sky)]" /> {active} active · recordings sealed & encrypted at rest
            </div>
          </div>

          <div className="panel overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--line)] font-display font-semibold">Access review — who can use what</div>
            <table className="table-base !text-[12.5px]">
              <thead><tr><th>Credential</th>{snap.users.filter((u) => u.status === 'ACTIVE').map((u) => <th key={u.id} className="!text-center">{u.name.split(' ')[0]}</th>)}</tr></thead>
              <tbody>
                {snap.credentials.map((c) => (
                  <tr key={c.id}>
                    <td className="text-[12px] font-semibold whitespace-nowrap">{c.name.split('—')[0]}</td>
                    {snap.users.filter((u) => u.status === 'ACTIVE').map((u) => {
                      const admin = ['SUPER_ADMIN', 'ORG_ADMIN', 'PAM_ADMIN', 'SECURITY_ADMIN'].includes(u.role);
                      const member = c.collectionIds.some((id) => u.collectionIds.includes(id));
                      const ok = admin || member;
                      return (
                        <td key={u.id} className="text-center">
                          {ok ? <span className="text-[var(--teal)]"><I n="check" className="w-3.5 h-3.5 inline" sw={2.4} /></span> : <span className="text-[var(--dim)] opacity-40">·</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 py-3 border-t border-[var(--line)] font-mono text-[10.5px] text-[var(--dim)]">
              ✓ = launch rights via collection / admin role · reveal rights are a separate matrix (Security Admins only)
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
