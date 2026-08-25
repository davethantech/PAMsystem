import { useMemo, useState } from 'react';
import { pam, isPamError } from '../engine/pam';
import type { ProbeResult } from '../engine/types';
import { I } from '../components/icons';
import { Chip, CountRing, Dot, Masked, Modal, Reveal, StatusPill, Toggle, timeAgo } from '../components/ui';
import { usePam } from '../state/store';

/* ============================================================ USERS & ROLES */
const PERMS = [
  'credential.view_metadata', 'credential.use', 'credential.reveal', 'credential.create', 'credential.update', 'credential.delete',
  'application.launch', 'session.start', 'session.terminate', 'session.record.view',
  'user.create', 'user.disable', 'policy.create', 'policy.update', 'audit.view',
];
const ROLE_PERM_GRID: Record<string, string[]> = {
  SUPER_ADMIN: ['*'],
  ORG_ADMIN: ['credential.view_metadata', 'credential.use', 'credential.create', 'credential.update', 'application.launch', 'session.start', 'session.terminate', 'user.create', 'user.disable', 'policy.create', 'policy.update', 'audit.view'],
  PAM_ADMIN: ['credential.view_metadata', 'credential.use', 'credential.create', 'credential.update', 'application.launch', 'session.start', 'session.terminate', 'user.create', 'policy.create', 'policy.update', 'audit.view'],
  SECURITY_ADMIN: ['credential.view_metadata', 'credential.use', 'credential.reveal', 'application.launch', 'session.start', 'session.terminate', 'session.record.view', 'policy.create', 'policy.update', 'audit.view'],
  AUDITOR: ['credential.view_metadata', 'session.record.view', 'audit.view'],
  USER: ['credential.view_metadata', 'credential.use', 'application.launch', 'session.start'],
  READ_ONLY: ['credential.view_metadata'],
};

export function UsersPage() {
  const { snap } = usePam();
  const roles = Object.keys(ROLE_PERM_GRID);
  const has = (role: string, perm: string) => ROLE_PERM_GRID[role].includes('*') || ROLE_PERM_GRID[role].includes(perm);

  return (
    <div className="space-y-6 max-w-[1180px]">
      <Reveal>
        <div className="panel overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--line)] font-display font-semibold">Directory · {snap.users.length} identities</div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>User</th><th>Role</th><th>MFA</th><th>Collections</th><th>Last sign-in</th><th>Status</th></tr></thead>
              <tbody>
                {snap.users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: `hsl(${u.hue} 45% 20%)`, color: `hsl(${u.hue} 85% 72%)` }}>{u.name.split(' ').map((x) => x[0]).join('')}</span>
                        <div>
                          <div className="font-semibold text-[13.5px]">{u.name}</div>
                          <div className="font-mono text-[10.5px] text-[var(--dim)]">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><Chip tone={u.role.includes('ADMIN') ? 'gold' : u.role === 'AUDITOR' ? 'sky' : ''}>{u.role.replace('_', ' ')}</Chip></td>
                    <td><span className="font-mono text-[11px] text-[var(--mut)] flex items-center gap-1.5"><I n="fingerprint" className="w-3.5 h-3.5 text-[var(--teal)]" />{u.mfaMethod}</span></td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {u.collectionIds.length === 0 && <span className="font-mono text-[10.5px] text-[var(--dim)]">—</span>}
                        {u.collectionIds.map((id) => {
                          const c = snap.collections.find((x) => x.id === id);
                          return <span key={id} className="chip !text-[9px]" style={{ color: `hsl(${c?.hue} 70% 68%)`, borderColor: `hsl(${c?.hue} 50% 40% / .5)` }}>{c?.name}</span>;
                        })}
                      </div>
                    </td>
                    <td className="font-mono text-[11px] text-[var(--dim)]">{timeAgo(u.lastLogin)}</td>
                    <td><StatusPill status={u.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Reveal>

      <Reveal delay={80}>
        <div className="panel overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--line)] flex items-center gap-3">
            <span className="font-display font-semibold">RBAC matrix</span>
            <Chip tone="red"><I n="eyeOff" className="w-3 h-3" /> use ≠ reveal</Chip>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base !text-[12px]">
              <thead><tr><th>permission</th>{roles.map((r) => <th key={r} className="!text-center">{r.replace('_', ' ')}</th>)}</tr></thead>
              <tbody>
                {PERMS.map((p) => {
                  const highlight = p === 'credential.use' || p === 'credential.reveal';
                  return (
                    <tr key={p} className={highlight ? 'bg-[rgba(242,180,76,0.05)]' : ''}>
                      <td className={`font-mono text-[11px] ${highlight ? 'text-[var(--amber)] font-semibold' : 'text-[var(--mut)]'}`}>{p}{highlight && <span className="ml-2 text-[9px]">◂ separated by design</span>}</td>
                      {roles.map((r) => (
                        <td key={r} className="text-center">
                          {has(r, p)
                            ? <span className={p === 'credential.reveal' ? 'text-[var(--amber)]' : 'text-[var(--teal)]'}><I n="check" className="w-3.5 h-3.5 inline" sw={2.4} /></span>
                            : <span className="text-[var(--dim)] opacity-50">·</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3.5 border-t border-[var(--line)] text-[12.5px] text-[var(--mut)] leading-relaxed">
            <span className="text-[var(--amber)] font-semibold">credential.use</span> grants a zero-knowledge launch: the broker authenticates on the user's behalf.
            <span className="text-[var(--amber)] font-semibold"> credential.reveal</span> — the only path that can expose plaintext — is held solely by Security Admins,
            and even then only through dual-custody break-glass with a 30-second watermarked window.
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/* ============================================================ SECURITY CONTROLS */
const ATTACKS = [
  ['GET_CRED', 'API inspection', 'GET /api/credentials/:id'],
  ['IDOR', 'IDOR / object swap', 'foreign credential id'],
  ['REPLAY', 'Grant replay', 'consumed launch token'],
  ['LOCALSTORAGE', 'Storage dump', 'localStorage / sessionStorage'],
  ['DEVTOOLS_DOM', 'DevTools / DOM', 'inspect injected fields'],
  ['WEBSOCKET', 'WS sniffing', 'gateway frame capture'],
  ['JWT_FORGE', 'Token forgery', 'tampered JWT claims'],
  ['TENANT_PARAM', 'Tenant tampering', '?tenant=other-org'],
  ['XSS_EXFIL', 'XSS exfiltration', 'script reads vault state'],
  ['CLIPBOARD', 'Clipboard capture', 'copy masked secret'],
  ['SOURCEMAP', 'Bundle search', 'grep JS for secrets'],
  ['DOWNLOAD', 'Export attempt', 'CSV vault download'],
] as const;

export function SecurityPage() {
  const { snap, user, toast } = usePam();
  const [tab, setTab] = useState<'policies' | 'mfa' | 'rotation' | 'breakglass' | 'adversarial'>('policies');
  const [policies, setPolicies] = useState<Record<string, boolean>>({
    'MFA step-up on every launch': true, 'Domain allowlist enforcement (extension)': true,
    'Geo restriction — AU/NZ only': true, 'Concurrent session limit: 2': true,
    'Idle timeout 15 min': true, 'Record all proxied sessions': true, 'Block telnet connectors': true,
  });
  const [probes, setProbes] = useState<Record<string, ProbeResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [bgModal, setBgModal] = useState(false);
  const [bgCred, setBgCred] = useState('cred_root');
  const [bgReason, setBgReason] = useState('');
  const [bgCoSign, setBgCoSign] = useState('');
  const [bgErr, setBgErr] = useState('');
  const [reveal, setReveal] = useState<{ name: string; value: string; expiresAt: number; wm: string } | null>(null);

  const isSecurity = ['SECURITY_ADMIN', 'SUPER_ADMIN'].includes(user!.role);
  const canRotate = ['PAM_ADMIN', 'ORG_ADMIN', 'SUPER_ADMIN', 'SECURITY_ADMIN'].includes(user!.role);

  const runProbe = (id: string, label: string) => {
    setRunning(id);
    window.setTimeout(() => {
      const r = pam.redTeamProbe(id);
      setProbes((p) => ({ ...p, [id]: r }));
      setRunning(null);
      toast(`${label}: blocked & written to audit chain`, 'red');
    }, 650);
  };

  const startBreakGlass = () => {
    setBgErr('');
    try {
      const w = pam.breakGlass(bgCred, bgReason, bgCoSign);
      setReveal({ name: w.credentialName, value: w.value, expiresAt: w.expiresAt, wm: w.watermarkedTo });
      setBgModal(false);
      toast('BREAK-GLASS: dual-custody reveal opened — SIEM paged, 30s window', 'amber');
    } catch (e) { setBgErr(isPamError(e) ? e.message : 'Break-glass failed'); }
  };

  const tabs = [
    ['policies', 'Policies', 'shield'], ['mfa', 'MFA', 'fingerprint'], ['rotation', 'Rotation', 'rotate'],
    ['breakglass', 'Break Glass', 'alert'], ['adversarial', 'Adversarial Tests', 'scan'],
  ] as const;

  return (
    <div className="space-y-5 max-w-[1180px]">
      <Reveal>
        <div className="flex flex-wrap gap-2">
          {tabs.map(([k, label, icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 rounded-lg font-display font-semibold text-[13px] border transition-all cursor-pointer flex items-center gap-2 ${tab === k ? 'border-[rgba(58,214,181,0.5)] text-[var(--teal)] bg-[rgba(58,214,181,0.08)]' : 'border-[var(--line)] text-[var(--mut)] hover:text-[var(--ink)]'}`}>
              <I n={icon} className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>
      </Reveal>

      {tab === 'policies' && (
        <Reveal>
          <div className="grid md:grid-cols-2 gap-4">
            {Object.entries(policies).map(([k, v]) => (
              <div key={k} className="panel p-4 flex items-center gap-4 card-lift">
                <span className={`w-9 h-9 rounded-lg flex items-center justify-center border ${v ? 'text-[var(--teal)] border-[rgba(58,214,181,0.4)] bg-[rgba(58,214,181,0.07)]' : 'text-[var(--dim)] border-[var(--line)]'}`}>
                  <I n={k.includes('MFA') ? 'fingerprint' : k.includes('Domain') ? 'globe' : k.includes('Geo') ? 'radar' : k.includes('session') ? 'clock' : k.includes('timeout') ? 'clock' : k.includes('Record') ? 'doc' : 'slash'} className="w-4 h-4" />
                </span>
                <div className="flex-1">
                  <div className="text-[13.5px] font-semibold">{k}</div>
                  <div className="font-mono text-[10px] text-[var(--dim)]">launch policy · tenant-wide</div>
                </div>
                <Toggle on={v} onChange={(nv) => { setPolicies((p) => ({ ...p, [k]: nv })); toast(`Policy "${k}" ${nv ? 'enabled' : 'disabled'} — POLICY_CHANGED audited`, nv ? 'teal' : 'amber'); }} disabled={!canRotate} />
              </div>
            ))}
          </div>
        </Reveal>
      )}

      {tab === 'mfa' && (
        <Reveal>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { m: 'TOTP authenticator', n: 4, d: 'RFC 6238 · 30s codes', icon: 'clock', tone: 'var(--teal)' },
              { m: 'WebAuthn / passkeys', n: 2, d: 'phishing-resistant · platform + roaming', icon: 'fingerprint', tone: 'var(--sky)' },
              { m: 'Recovery codes', n: 6, d: 'single-use · vault-encrypted', icon: 'key', tone: 'var(--amber)' },
            ].map((x) => (
              <div key={x.m} className="panel p-5 card-lift">
                <div className="flex items-center justify-between">
                  <span style={{ color: x.tone }}><I n={x.icon} className="w-6 h-6" /></span>
                  <span className="font-display font-bold text-[26px]">{x.n}</span>
                </div>
                <div className="font-semibold text-[14px] mt-2">{x.m}</div>
                <div className="font-mono text-[10.5px] text-[var(--dim)] mt-1">{x.d}</div>
              </div>
            ))}
            <div className="panel p-5 md:col-span-3 flex flex-wrap items-center gap-4">
              <Dot tone="var(--teal)" />
              <span className="text-[13.5px] flex-1">Enforce phishing-resistant MFA for all privileged collections — sessions without step-up are downgraded to metadata-only.</span>
              <Chip tone="teal">100% enrolled</Chip>
              <Toggle on disabled onChange={() => {}} />
            </div>
          </div>
        </Reveal>
      )}

      {tab === 'rotation' && (
        <Reveal>
          <div className="panel overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--line)] flex items-center gap-3">
              <span className="font-display font-semibold">Automated rotation</span>
              <span className="font-mono text-[10.5px] text-[var(--dim)]">generate → apply → verify → re-encrypt · failures roll back & alert</span>
            </div>
            <table className="table-base">
              <thead><tr><th>Credential</th><th>Policy</th><th>Last run</th><th>Next run</th><th>Key</th><th>Status</th><th className="text-right">Action</th></tr></thead>
              <tbody>
                {snap.rotation.map((r) => (
                  <tr key={r.credentialId}>
                    <td className="font-semibold">{r.credentialName}</td>
                    <td><Chip>{r.policy}</Chip></td>
                    <td className="font-mono text-[11px] text-[var(--dim)]">{timeAgo(r.lastRun)}</td>
                    <td className="font-mono text-[11px] text-[var(--mut)]">{timeAgo(r.nextRun).replace(' ago', ' from now')}</td>
                    <td><Chip tone="sky">v{snap.credentials.find((c) => c.id === r.credentialId)?.keyVersion}</Chip></td>
                    <td><StatusPill status={r.status} /></td>
                    <td>
                      <button className="btn btn-ghost btn-sm" disabled={!canRotate} onClick={() => {
                        try { pam.rotateNow(r.credentialId); toast(`${r.credentialName}: rotated & verified — old key shredded`, 'teal'); }
                        catch (e) { toast(isPamError(e) ? e.message : 'Rotation failed', 'red'); }
                      }}><I n="rotate" className="w-3.5 h-3.5" /> Rotate now</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      )}

      {tab === 'breakglass' && (
        <Reveal>
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="panel p-6 relative overflow-hidden" style={{ borderColor: 'rgba(217,169,78,0.35)' }}>
              <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, var(--gold), transparent)' }} />
              <div className="flex items-center gap-3">
                <span className="w-12 h-12 rounded-xl border border-[rgba(217,169,78,0.5)] bg-[rgba(217,169,78,0.08)] flex items-center justify-center text-[var(--gold)]"><I n="vault" className="w-6 h-6" /></span>
                <div>
                  <h3 className="font-display font-bold text-[18px]">Emergency access</h3>
                  <p className="font-mono text-[10px] text-[var(--dim)] tracking-wider">DUAL CUSTODY · ENHANCED AUDIT · 30s WINDOW</p>
                </div>
              </div>
              <ol className="mt-5 space-y-2 text-[13px] text-[var(--mut)]">
                {['Strong MFA re-verification', 'Justification + co-sign incident ticket', 'Secondary authorization (second admin)', 'Watermarked, time-boxed reveal', 'SIEM page + full-session recording'].map((s, i) => (
                  <li key={s} className="flex gap-2.5"><span className="font-mono text-[var(--gold)]">{String(i + 1).padStart(2, '0')}</span>{s}</li>
                ))}
              </ol>
              <button className={`btn btn-amber w-full mt-5 ${isSecurity ? '' : 'opacity-50'}`} onClick={() => {
                if (!isSecurity) { toast('Break-glass requires credential.reveal — switch to the Marcus persona', 'red'); return; }
                setBgModal(true);
              }}>
                <I n="alert" className="w-4 h-4" /> {isSecurity ? 'Initiate break-glass' : 'Requires Security Admin'}
              </button>
            </div>
            <div className="panel p-6">
              <h4 className="font-display font-semibold text-[15px] mb-3">Break-glass ledger</h4>
              <div className="space-y-2.5">
                {snap.audit.filter((e) => e.type === 'BREAK_GLASS' || e.type === 'CREDENTIAL_REVEAL').slice(0, 5).map((e) => (
                  <div key={e.id} className="flex items-center gap-3 border border-[var(--line)] rounded-lg p-3">
                    <span className={e.result === 'DENIED' ? 'text-[#ff9d94]' : 'text-[var(--gold)]'}><I n={e.result === 'DENIED' ? 'slash' : 'alert'} className="w-4 h-4" /></span>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[11.5px] font-semibold">{e.type} · {e.result}</div>
                      <div className="text-[11px] text-[var(--dim)] truncate">{e.actorName} → {e.resourceName}</div>
                    </div>
                    <span className="font-mono text-[10px] text-[var(--dim)]">{timeAgo(e.ts)}</span>
                  </div>
                ))}
                {snap.audit.filter((e) => e.type === 'BREAK_GLASS').length === 0 && <p className="text-[12.5px] text-[var(--mut)]">No break-glass events yet.</p>}
              </div>
            </div>
          </div>
        </Reveal>
      )}

      {tab === 'adversarial' && (
        <Reveal>
          <div>
            <p className="text-[13px] text-[var(--mut)] mb-4 max-w-[70ch]">
              Assume the attacker is <span className="text-[var(--ink)]">an authorized user actively trying to steal a secret</span>.
              Run each exfiltration vector against the live engine — every attempt is denied and written to the audit chain.
            </p>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {ATTACKS.map(([id, label, vector]) => {
                const r = probes[id];
                return (
                  <button key={id} onClick={() => !running && runProbe(id, label)}
                    className={`text-left panel p-4 transition-all cursor-pointer ${r ? 'border-[rgba(240,104,92,0.4)]' : 'card-lift'} ${running === id ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-2.5">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center border ${r ? 'text-[#ff9d94] border-[rgba(240,104,92,0.5)] bg-[rgba(240,104,92,0.08)]' : 'text-[var(--sky)] border-[var(--line-strong)]'}`}>
                        <I n={r ? 'slash' : 'scan'} className="w-4 h-4" />
                      </span>
                      <div className="flex-1">
                        <div className="text-[13.5px] font-semibold">{label}</div>
                        <div className="font-mono text-[10px] text-[var(--dim)]">{vector}</div>
                      </div>
                      {r ? <Chip tone="red">BLOCKED</Chip> : <Chip tone="sky">RUN ▸</Chip>}
                    </div>
                    {r && (
                      <div className="mt-3 pt-3 border-t border-[var(--line)] space-y-1 font-mono text-[10.5px] leading-relaxed rise-in">
                        <div className="text-[#ff9d94]">→ {r.outcome}</div>
                        <div className="text-[var(--mut)]">control: {r.control}</div>
                        <div className="text-[var(--dim)]">audit {r.auditId}</div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </Reveal>
      )}

      {/* break-glass modal */}
      <Modal open={bgModal} onClose={() => setBgModal(false)} title="Break-glass — dual custody reveal" tone="amber" width={540}>
        <div className="space-y-4">
          <div>
            <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">CREDENTIAL</label>
            <select className="input mt-1.5" value={bgCred} onChange={(e) => setBgCred(e.target.value)}>
              {snap.credentials.filter((c) => c.access === 'APPROVAL_REQUIRED').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">JUSTIFICATION (min 12 chars, permanently recorded)</label>
            <textarea className="input mt-1.5 min-h-[70px]" value={bgReason} onChange={(e) => setBgReason(e.target.value)} placeholder="e.g. DC01 recovery after ransomware isolation — directory services down…" />
          </div>
          <div>
            <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">CO-SIGN INCIDENT TICKET (second authorizer)</label>
            <input className="input mt-1.5" value={bgCoSign} onChange={(e) => setBgCoSign(e.target.value)} placeholder="INC-4821" />
          </div>
          {bgErr && <p className="text-[#ff9d94] text-[12.5px] font-mono">⊘ {bgErr}</p>}
          <div className="flex gap-3 justify-end">
            <button className="btn btn-ghost" onClick={() => setBgModal(false)}>Abort</button>
            <button className="btn btn-amber" onClick={startBreakGlass}><I n="alert" className="w-4 h-4" /> Open 30s reveal window</button>
          </div>
        </div>
      </Modal>

      {/* reveal window */}
      {reveal && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[rgba(20,8,4,0.85)] backdrop-blur-sm" />
          <div className="relative panel-solid rise-in w-[560px] max-w-[94vw] p-7" style={{ borderTop: '3px solid var(--gold)' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[var(--gold)] font-mono text-[11px] tracking-[0.2em]"><I n="alert" className="w-4 h-4" /> BREAK-GLASS REVEAL ACTIVE</div>
              <CountRing remaining={reveal.expiresAt - Date.now()} total={30_000} size={52} />
            </div>
            <div className="font-semibold text-[15px] mt-3">{reveal.name}</div>
            <div className="mt-3 relative rounded-lg border border-[rgba(217,169,78,0.4)] bg-[rgba(8,16,32,0.8)] p-4 overflow-hidden">
              <div className="absolute inset-0 opacity-[0.07] pointer-events-none flex items-center justify-center font-mono text-[20px] tracking-[0.3em] rotate-[-14deg] whitespace-nowrap">{reveal.wm.toUpperCase()} · {reveal.wm.toUpperCase()}</div>
              <div className="font-mono text-[16px] text-[var(--gold)] break-all relative">{reveal.value}</div>
            </div>
            <p className="font-mono text-[10.5px] text-[var(--dim)] mt-3 leading-relaxed">
              watermarked to <span className="text-[var(--gold)]">{reveal.wm}</span> · screen recording on · SIEM paged ·
              window auto-terminates · rotation recommended after use
            </p>
            <button className="btn btn-primary w-full mt-4" onClick={() => { setReveal(null); toast('Reveal window closed — schedule a rotation', 'amber'); }}>
              <I n="lock" className="w-4 h-4" /> Close & seal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================ SETTINGS */
export function SettingsPage() {
  const { snap, toast } = usePam();
  const [regOpen, setRegOpen] = useState(false);
  const [cName, setCName] = useState('');
  const [cSite, setCSite] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [sso, setSso] = useState({ google: true, entra: true, saml: false });
  const isPriv = ['PAM_ADMIN', 'ORG_ADMIN', 'SUPER_ADMIN', 'SECURITY_ADMIN'].includes(snap.users.find(() => true)?.role ?? '');

  const exportAudit = () => {
    const payload = snap.audit.map(({ hash, prevHash, ...rest }) => ({ ...rest, hash, prevHash }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'keyrail-audit-metadata.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Audit metadata exported — secrets are structurally absent from exports', 'sky');
  };

  return (
    <div className="space-y-5 max-w-[1180px]">
      <div className="grid lg:grid-cols-2 gap-4">
        <Reveal>
          <div className="panel p-5">
            <h3 className="font-display font-semibold text-[15px] mb-3 flex items-center gap-2"><I n="org" className="w-4 h-4 text-[var(--gold)]" /> Organization</h3>
            <div className="space-y-2 font-mono text-[12px]">
              {[['Tenant', snap.tenant.name], ['Tenant ID', snap.tenant.id], ['Region', snap.tenant.region], ['Plan', snap.tenant.plan], ['Deployment', '100% cloud-hosted SaaS — nothing installed by customer']].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-[var(--line)] pb-2"><span className="text-[var(--dim)]">{k}</span><span className="text-right">{v}</span></div>
              ))}
            </div>
            <button className="btn btn-ghost btn-sm mt-4" onClick={exportAudit}><I n="download" className="w-3.5 h-3.5" /> Export audit metadata (JSON)</button>
          </div>
        </Reveal>

        <Reveal delay={70}>
          <div className="panel p-5">
            <h3 className="font-display font-semibold text-[15px] mb-3 flex items-center gap-2"><I n="fingerprint" className="w-4 h-4 text-[var(--teal)]" /> Identity providers</h3>
            <div className="space-y-2.5">
              {([['google', 'Google Workspace OIDC'], ['entra', 'Microsoft Entra ID'], ['saml', 'SAML 2.0 (Okta / ADFS)']] as const).map(([k, label]) => (
                <div key={k} className="flex items-center gap-3 border border-[var(--line)] rounded-lg p-3">
                  <span className="flex-1 text-[13.5px]">{label}</span>
                  {sso[k] && <Chip tone="teal">ACTIVE</Chip>}
                  <Toggle on={sso[k]} onChange={(v) => { setSso((s) => ({ ...s, [k]: v })); toast(`${label} ${v ? 'connected' : 'disconnected'}`, v ? 'teal' : 'amber'); }} />
                </div>
              ))}
            </div>
            <p className="font-mono text-[10.5px] text-[var(--dim)] mt-3">tenant always derived from the signed assertion — never from client input</p>
          </div>
        </Reveal>
      </div>

      <Reveal>
        <div className="panel overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--line)] flex items-center gap-3">
            <I n="tunnel" className="w-4 h-4 text-[var(--sky)]" />
            <span className="font-display font-semibold">Private network connectors</span>
            <span className="font-mono text-[10.5px] text-[var(--dim)]">outbound-only mTLS · no inbound firewall ports · never holds vault keys</span>
            <span className="flex-1" />
            <button className="btn btn-primary btn-sm" onClick={() => setRegOpen(true)}><I n="plus" className="w-3.5 h-3.5" /> Register connector</button>
          </div>
          <table className="table-base">
            <thead><tr><th>Connector</th><th>Site</th><th>Tunnel</th><th>Heartbeat</th><th>Version</th><th>Status</th></tr></thead>
            <tbody>
              {snap.connectors.map((c) => (
                <tr key={c.id}>
                  <td className="font-semibold">{c.name}</td>
                  <td className="text-[var(--mut)] text-[12.5px]">{c.site}</td>
                  <td>{c.mtls && <Chip tone="sky"><I n="lock" className="w-3 h-3" /> mTLS outbound</Chip>}</td>
                  <td className="font-mono text-[11px] text-[var(--dim)]">{timeAgo(c.lastHeartbeat)}</td>
                  <td className="font-mono text-[11px] text-[var(--dim)]">{c.version}</td>
                  <td><StatusPill status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      <Reveal>
        <div className="panel overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--line)] flex items-center gap-3">
            <I n="chip" className="w-4 h-4 text-[var(--gold)]" />
            <span className="font-display font-semibold">API keys</span>
            <span className="font-mono text-[10.5px] text-[var(--dim)]">scoped — no secret-read scope exists</span>
            <span className="flex-1" />
            <button className="btn btn-primary btn-sm" onClick={() => {
              const k = pam.createApiKey('SIEM export key');
              setNewKey(k.token);
              toast('API key minted — audit.read scope only', 'teal');
            }}><I n="plus" className="w-3.5 h-3.5" /> Create key</button>
          </div>
          <table className="table-base">
            <thead><tr><th>Label</th><th>Prefix</th><th>Scopes</th><th>Created</th><th>Last used</th></tr></thead>
            <tbody>
              {snap.apiKeys.map((k) => (
                <tr key={k.id}>
                  <td className="font-semibold">{k.label}</td>
                  <td className="font-mono text-[11.5px] text-[var(--sky)]">{k.prefix}…</td>
                  <td><Chip>{k.scopes[0]}</Chip></td>
                  <td className="font-mono text-[11px] text-[var(--dim)]">{timeAgo(k.createdAt)}</td>
                  <td className="font-mono text-[11px] text-[var(--dim)]">{k.lastUsed ? timeAgo(k.lastUsed) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>
      <span className="hidden">{String(isPriv)}<Masked len={0} /></span>

      {/* register connector modal */}
      <Modal open={regOpen} onClose={() => setRegOpen(false)} title="Register on-prem connector" width={560}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">NAME</label>
              <input className="input mt-1.5" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="ON-PREM-CONN-02" />
            </div>
            <div>
              <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">SITE</label>
              <input className="input mt-1.5" value={cSite} onChange={(e) => setCSite(e.target.value)} placeholder="Melbourne DC · rack A2" />
            </div>
          </div>
          <div className="rounded-lg border border-[var(--line-strong)] bg-[rgba(8,16,32,0.6)] p-4 font-mono text-[11px] leading-relaxed">
            <div className="text-[var(--dim)]"># install on any Windows/Linux host inside your network</div>
            <div className="text-[var(--teal)] mt-1">$ curl -fsSL https://get.keyrail.cloud/conn | sh</div>
            <div className="text-[var(--sky)]">$ keyrail-connector enroll --tenant {snap.tenant.id}</div>
            <div className="text-[var(--mut)] mt-2">→ connector dials OUT over TLS 1.3 · mTLS device identity<br />→ cloud issues authorized commands through the tunnel<br />→ no inbound ports · no vault keys on the device</div>
          </div>
          <div className="flex gap-3 justify-end">
            <button className="btn btn-ghost" onClick={() => setRegOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={cName.length < 3} onClick={() => {
              pam.registerConnector(cName, cSite || 'unspecified site');
              setRegOpen(false); setCName(''); setCSite('');
              toast('Connector registered — outbound mTLS tunnel established', 'teal');
            }}><I n="tunnel" className="w-4 h-4" /> Register</button>
          </div>
        </div>
      </Modal>

      {/* one-time key modal */}
      <Modal open={!!newKey} onClose={() => setNewKey(null)} title="API key — shown once" tone="amber" width={520}>
        <p className="text-[13px] text-[var(--mut)]">Store this now. It cannot be retrieved again — and it can only read audit metadata, never secrets.</p>
        <div className="mt-3 rounded-lg border border-[rgba(242,180,76,0.4)] bg-[rgba(8,16,32,0.8)] p-4 font-mono text-[13px] text-[var(--amber)] break-all">{newKey}</div>
        <div className="flex gap-3 justify-end mt-4">
          <button className="btn btn-ghost" onClick={() => { navigator.clipboard?.writeText(newKey ?? '').catch(() => {}); toast('Key copied to clipboard', 'sky'); }}><I n="copy" className="w-4 h-4" /> Copy</button>
          <button className="btn btn-primary" onClick={() => setNewKey(null)}>Done</button>
        </div>
      </Modal>
    </div>
  );
}
