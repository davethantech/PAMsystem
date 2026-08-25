import { useMemo, useState } from 'react';
import { pam, isPamError } from '../engine/pam';
import type { CredMeta } from '../engine/types';
import { I } from '../components/icons';
import { Chip, Masked, Modal, Reveal, StatusPill, timeAgo } from '../components/ui';
import { usePam } from '../state/store';
import { AppGlyph, LaunchModal, RequestAccessModal } from './Launcher';

const KIND_ICON: Record<string, string> = { PASSWORD: 'key', API_KEY: 'chip', SSH_KEY: 'terminal', TOKEN: 'bolt', CERT: 'doc', NOTE: 'doc' };

export default function Vault() {
  const { snap, user, toast } = usePam();
  const [q, setQ] = useState('');
  const [col, setCol] = useState('ALL');
  const [drawer, setDrawer] = useState<CredMeta | null>(null);
  const [denied, setDenied] = useState<{ msg: string; auditId?: string } | null>(null);
  const [deniedShake, setDeniedShake] = useState(0);
  const [launching, setLaunching] = useState<CredMeta | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cstep, setCstep] = useState<'form' | 'reveal'>('form');
  const [cform, setCform] = useState({ name: '', target: '', kind: 'PASSWORD' as CredMeta['kind'], username: '', access: 'PERMANENT' as CredMeta['access'], rotation: 'manual', secret: '', generated: false, jit: 30, cols: [] as string[] });
  const [cerr, setCerr] = useState('');
  const [colModal, setColModal] = useState(false);
  const [colForm, setColForm] = useState({ name: '', description: '', members: [] as string[] });
  const [editing, setEditing] = useState(false);
  const [eform, setEform] = useState({ name: '', access: 'PERMANENT' as CredMeta['access'], rotation: 'manual' });

  const resetCreate = () => { setCform({ name: '', target: '', kind: 'PASSWORD', username: '', access: 'PERMANENT', rotation: 'manual', secret: '', generated: false, jit: 30, cols: [] }); setCstep('form'); setCerr(''); setCreating(false); };

  const sealCredential = () => {
    try {
      const r = pam.createCredential({
        name: cform.name, target: cform.target, kind: cform.kind, username: cform.username,
        secret: cform.secret, collectionIds: cform.cols, access: cform.access,
        jitWindowMin: cform.access === 'PERMANENT' ? undefined : cform.jit, rotationPolicy: cform.rotation,
      });
      toast(`"${cform.name}" sealed under DEK v${r.keyVersion} — the secret is now unrecoverable from this UI`, 'teal');
      resetCreate();
    } catch (e) { setCerr(isPamError(e) ? e.message : 'Create failed'); }
  };

  const openEdit = (c: CredMeta) => { setEform({ name: c.name, access: c.access, rotation: c.rotationPolicy }); setEditing(true); };
  const saveEdit = () => {
    if (!drawer) return;
    try {
      pam.updateCredential(drawer.id, { name: eform.name, access: eform.access, rotationPolicy: eform.rotation });
      toast('Metadata updated — ciphertext untouched, change audited', 'teal');
      setEditing(false); setDrawer(null);
    } catch (e) { toast(isPamError(e) ? e.message : 'Update failed', 'red'); }
  };

  const isAdmin = ['PAM_ADMIN', 'ORG_ADMIN', 'SUPER_ADMIN', 'SECURITY_ADMIN'].includes(user!.role);
  const isSecurity = ['SECURITY_ADMIN', 'SUPER_ADMIN'].includes(user!.role);

  const list = useMemo(() => snap.credentials.filter((c) => {
    if (col !== 'ALL' && !c.collectionIds.includes(col)) return false;
    if (q && !`${c.name} ${c.target} ${c.username}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [snap.credentials, q, col]);

  const tryReveal = (c: CredMeta) => {
    try { pam.attemptReveal(c.id); }
    catch (e) {
      if (isPamError(e)) { setDenied({ msg: e.message, auditId: e.auditId }); setDeniedShake((x) => x + 1); }
    }
  };

  const rotate = (c: CredMeta) => {
    setRotating(true);
    window.setTimeout(() => {
      try {
        pam.rotateNow(c.id);
        toast(`${c.name}: new secret generated → applied → verified → re-encrypted (DEK v${c.keyVersion + 1})`, 'teal');
      } catch (e) { toast(isPamError(e) ? e.message : 'Rotation failed', 'red'); }
      setRotating(false);
      setDrawer(null);
    }, 1400);
  };

  return (
    <div className="space-y-5 max-w-[1180px]">
      <Reveal>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--line)] bg-[rgba(8,16,32,0.6)] w-[260px]">
            <I n="search" className="w-4 h-4 text-[var(--dim)]" />
            <input className="bg-transparent outline-none text-[13px] flex-1" placeholder="Search name, target, account…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input !w-[190px] !py-2 text-[13px]" value={col} onChange={(e) => setCol(e.target.value)}>
            <option value="ALL">All collections</option>
            {snap.collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="flex-1" />
          <Chip><I n="lock" className="w-3.5 h-3.5" /> AES-256-GCM envelope · KMS-wrapped DEKs</Chip>
          <Chip tone="red"><I n="eyeOff" className="w-3.5 h-3.5" /> plaintext: zero endpoints</Chip>
          {isAdmin && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => { setColForm({ name: '', description: '', members: [] }); setColModal(true); }}><I n="plus" className="w-3.5 h-3.5" /> Collection</button>
              <button className="btn btn-primary btn-sm" onClick={() => { resetCreate(); setCreating(true); }}><I n="plus" className="w-3.5 h-3.5" /> New credential</button>
            </>
          )}
        </div>
      </Reveal>

      <Reveal delay={80}>
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Credential</th><th>Account</th><th>Collections</th><th>Access</th><th>Rotation</th><th>Key</th><th>Rights</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="cursor-pointer" onClick={() => setDrawer(c)}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-lg border border-[var(--line-strong)] bg-[rgba(122,160,210,0.06)] flex items-center justify-center text-[var(--gold)]"><I n={KIND_ICON[c.kind]} className="w-4 h-4" /></span>
                        <div>
                          <div className="font-semibold text-[13.5px]">{c.name}</div>
                          <div className="font-mono text-[10.5px] text-[var(--dim)]">{c.target}</div>
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-[12px] text-[var(--mut)]">{c.username}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {c.collectionIds.map((id) => {
                          const cc = snap.collections.find((x) => x.id === id);
                          return <span key={id} className="chip !text-[9.5px]" style={{ color: `hsl(${cc?.hue} 70% 68%)`, borderColor: `hsl(${cc?.hue} 50% 40% / 0.5)` }}>{cc?.name}</span>;
                        })}
                      </div>
                    </td>
                    <td><Chip tone={c.access === 'PERMANENT' ? 'teal' : 'amber'}>{c.access === 'PERMANENT' ? 'PERMANENT' : 'JIT / APPROVAL'}</Chip></td>
                    <td>
                      <div className="font-mono text-[11px] text-[var(--mut)]">{c.rotationPolicy}</div>
                      <div className="font-mono text-[9.5px] text-[var(--dim)]">rotated {timeAgo(c.rotatedAt)}</div>
                    </td>
                    <td><Chip tone="sky">v{c.keyVersion}</Chip></td>
                    <td>
                      <div className="flex gap-1">
                        <span className="chip chip-teal !text-[9px]">USE ✓</span>
                        <span className="chip chip-red !text-[9px]">REVEAL ✗</span>
                      </div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        {!snap.apps.some((a) => a.credentialId === c.id) ? (
                          <span className="chip chip-amber !text-[9px]" title="Onboard an application in the Launcher to make this credential launchable">MAP AN APP ▸</span>
                        ) : c.access === 'PERMANENT' ? (
                          <button className="btn btn-primary btn-sm" onClick={() => setLaunching(c)}><I n="launch" className="w-3.5 h-3.5" /> Launch</button>
                        ) : (
                          <button className="btn btn-amber btn-sm" onClick={() => setRequesting(c.id)}><I n="bolt" className="w-3.5 h-3.5" /> Request</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={8} className="text-[var(--mut)]">No credentials match — or none are visible to your collections.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </Reveal>

      {/* drawer */}
      {drawer && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-[rgba(4,9,18,0.6)]" onClick={() => setDrawer(null)} />
          <aside className="absolute right-0 top-0 bottom-0 w-[440px] max-w-[94vw] panel-solid border-l border-[var(--line-strong)] overflow-y-auto rise-in" style={{ borderRadius: 0 }}>
            <div className="px-6 py-5 border-b border-[var(--line)] flex items-start justify-between sticky top-0 bg-[var(--panel-solid)] z-10">
              <div>
                <div className="font-mono text-[9.5px] tracking-[0.2em] text-[var(--dim)]">{drawer.id.toUpperCase()} · TENANT {snap.tenant.id}</div>
                <h3 className="font-display font-bold text-[18px] mt-1">{drawer.name}</h3>
                <div className="font-mono text-[11.5px] text-[var(--sky)] mt-0.5">{drawer.target}</div>
              </div>
              <button onClick={() => setDrawer(null)} className="text-[var(--mut)] hover:text-[var(--ink)] cursor-pointer"><I n="x" /></button>
            </div>

            <div className="p-6 space-y-5">
              {/* sealed secret */}
              <div className="border border-[rgba(240,104,92,0.3)] bg-[rgba(240,104,92,0.04)] rounded-lg p-4">
                <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] text-[#ff9d94] mb-3"><I n="vault" className="w-4 h-4" /> SEALED SECRET — CIPHERTEXT ONLY</div>
                <div className="space-y-2 font-mono text-[11.5px]">
                  <div className="flex justify-between gap-3"><span className="text-[var(--dim)]">secret</span><Masked len={drawer.secretLen} /></div>
                  <div className="flex justify-between gap-3"><span className="text-[var(--dim)]">ciphertext</span><span className="text-[var(--mut)] truncate max-w-[220px]">{drawer.versions[0] ? `0x${drawer.id.split('_')[1]}f3a9…c41d` : '—'}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-[var(--dim)]">nonce</span><span className="text-[var(--mut)]">96-bit random</span></div>
                  <div className="flex justify-between gap-3"><span className="text-[var(--dim)]">DEK</span><span className="text-[var(--sky)]">aes-256-gcm · v{drawer.keyVersion} · KMS-wrapped</span></div>
                </div>
                <div className="flex gap-2 mt-4">
                  <button className="btn btn-danger btn-sm flex-1" onClick={() => tryReveal(drawer)}><I n="eye" className="w-3.5 h-3.5" /> Attempt reveal</button>
                  {isSecurity ? (
                    <button className="btn btn-amber btn-sm flex-1" onClick={() => toast('Break-glass lives under Security Controls → Break Glass', 'amber')}><I n="alert" className="w-3.5 h-3.5" /> Break glass</button>
                  ) : (
                    <button className="btn btn-ghost btn-sm flex-1 opacity-50" disabled title="requires credential.reveal"><I n="slash" className="w-3.5 h-3.5" /> No reveal right</button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-[12.5px]">
                <div className="panel p-3"><div className="font-mono text-[9.5px] text-[var(--dim)] tracking-wider">ACCOUNT</div><div className="font-mono mt-1">{drawer.username}</div></div>
                <div className="panel p-3"><div className="font-mono text-[9.5px] text-[var(--dim)] tracking-wider">KIND</div><div className="mt-1">{drawer.kind}</div></div>
                <div className="panel p-3"><div className="font-mono text-[9.5px] text-[var(--dim)] tracking-wider">ACCESS MODE</div><div className="mt-1">{drawer.access}{drawer.jitWindowMin ? ` · ${drawer.jitWindowMin}m window` : ''}</div></div>
                <div className="panel p-3"><div className="font-mono text-[9.5px] text-[var(--dim)] tracking-wider">HEALTH</div><div className="mt-1"><StatusPill status={drawer.health} /></div></div>
              </div>

              {isAdmin && !editing && (
                <div className="flex gap-2">
                  <button className="btn btn-ghost flex-1" onClick={() => rotate(drawer)} disabled={rotating}>
                    <I n="rotate" className={`w-4 h-4 ${rotating ? 'animate-spin' : ''}`} /> {rotating ? 'Verifying…' : 'Rotate now'}
                  </button>
                  <button className="btn btn-ghost flex-1" onClick={() => openEdit(drawer)}><I n="doc" className="w-4 h-4" /> Edit metadata</button>
                </div>
              )}
              {isAdmin && editing && (
                <div className="border border-[rgba(58,214,181,0.35)] rounded-lg p-4 space-y-3 rise-in">
                  <div className="font-mono text-[10px] tracking-[0.18em] text-[var(--teal)]">EDIT METADATA — CIPHERTEXT UNTOUCHED</div>
                  <input className="input" value={eform.name} onChange={(e) => setEform((f) => ({ ...f, name: e.target.value }))} />
                  <div className="grid grid-cols-2 gap-3">
                    <select className="input" value={eform.access} onChange={(e) => setEform((f) => ({ ...f, access: e.target.value as CredMeta['access'] }))}>
                      <option value="PERMANENT">PERMANENT</option>
                      <option value="APPROVAL_REQUIRED">JIT / APPROVAL</option>
                      <option value="ONE_TIME">ONE-TIME</option>
                      <option value="EMERGENCY">EMERGENCY</option>
                    </select>
                    <select className="input" value={eform.rotation} onChange={(e) => setEform((f) => ({ ...f, rotation: e.target.value }))}>
                      {['manual', 'every-1d', 'every-7d', 'every-30d', 'every-90d', 'after-session'].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-primary flex-1" onClick={saveEdit}><I n="check" className="w-4 h-4" /> Save & audit</button>
                    <button className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
                  </div>
                </div>
              )}

              <div>
                <div className="font-mono text-[10px] tracking-[0.18em] text-[var(--dim)] mb-2">VERSION HISTORY</div>
                <div className="space-y-0">
                  {drawer.versions.map((v, i) => (
                    <div key={v.v} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className={`w-2.5 h-2.5 rounded-full ${i === 0 ? 'bg-[var(--teal)]' : 'bg-[var(--line-strong)]'}`} />
                        {i < drawer.versions.length - 1 && <span className="w-px flex-1 bg-[var(--line-strong)]" />}
                      </div>
                      <div className="pb-4">
                        <div className="text-[12.5px] font-semibold">DEK v{v.v} <span className="text-[var(--mut)] font-normal">— {v.event}</span></div>
                        <div className="font-mono text-[10px] text-[var(--dim)]">{new Date(v.ts).toLocaleString('en-GB')} · previous key shredded</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* denied modal */}
      <Modal open={!!denied} onClose={() => setDenied(null)} title="Reveal denied — by design" tone="red" width={520}>
        <div key={deniedShake} className="shake">
          <div className="flex items-start gap-4">
            <span className="w-12 h-12 shrink-0 rounded-full border border-[rgba(240,104,92,0.5)] bg-[rgba(240,104,92,0.1)] flex items-center justify-center text-[#ff9d94]"><I n="eyeOff" className="w-6 h-6" /></span>
            <div>
              <p className="text-[13.5px] leading-relaxed">{denied?.msg}</p>
              <div className="mt-3 font-mono text-[10.5px] text-[var(--dim)] space-y-1">
                <div>→ CREDENTIAL_REVEAL · result=DENIED written to audit chain</div>
                <div>→ event id {denied?.auditId}</div>
                <div>→ no plaintext was ever assembled for this request</div>
              </div>
            </div>
          </div>
          <p className="text-[12px] text-[var(--mut)] mt-4 leading-relaxed border-t border-[var(--line)] pt-3">
            This is not a UI restriction you can route around — the engine has <span className="text-[var(--ink)]">no code path</span> that
            returns plaintext for your role. The only exception is dual-custody break-glass held by Security Admins.
          </p>
          <button className="btn btn-primary w-full mt-4" onClick={() => setDenied(null)}>Understood — launch instead</button>
        </div>
      </Modal>

      {launching && (() => {
        const app = snap.apps.find((a) => a.credentialId === launching.id);
        return app ? <LaunchModal app={app} cred={launching} onClose={() => setLaunching(null)} /> : null;
      })()}
      <RequestAccessModal credId={requesting} onClose={() => setRequesting(null)} />

      {/* ---- create credential: form → one-time reveal → sealed forever ---- */}
      <Modal open={creating} onClose={resetCreate} width={640}
        title={cstep === 'form' ? 'New credential — onboard a secret' : 'Store this now — it is shown exactly once'}
        tone={cstep === 'form' ? 'teal' : 'amber'}>
        {cstep === 'form' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">NAME</label>
                <input className="input mt-1.5" placeholder="Stripe — Live API Key" value={cform.name} onChange={(e) => setCform((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">TARGET / HOST</label>
                <input className="input mt-1.5" placeholder="api.stripe.com" value={cform.target} onChange={(e) => setCform((f) => ({ ...f, target: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">KIND</label>
                <select className="input mt-1.5" value={cform.kind} onChange={(e) => setCform((f) => ({ ...f, kind: e.target.value as CredMeta['kind'] }))}>
                  {['PASSWORD', 'API_KEY', 'SSH_KEY', 'TOKEN', 'CERTIFICATE', 'SECURE_NOTE', 'RECOVERY_CODES'].map((k) => <option key={k}>{k}</option>)}
                </select>
              </div>
              <div>
                <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">ACCOUNT / USERNAME</label>
                <input className="input mt-1.5" placeholder="svc-deploy" value={cform.username} onChange={(e) => setCform((f) => ({ ...f, username: e.target.value }))} />
              </div>
              <div>
                <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">ROTATION</label>
                <select className="input mt-1.5" value={cform.rotation} onChange={(e) => setCform((f) => ({ ...f, rotation: e.target.value }))}>
                  {['manual', 'every-1d', 'every-7d', 'every-30d', 'every-90d', 'after-session'].map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">COLLECTIONS (who can launch it)</label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {snap.collections.map((c) => {
                  const on = cform.cols.includes(c.id);
                  return (
                    <button key={c.id} onClick={() => setCform((f) => ({ ...f, cols: on ? f.cols.filter((x) => x !== c.id) : [...f.cols, c.id] }))}
                      className="chip cursor-pointer transition-all" style={on ? { color: `hsl(${c.hue} 75% 68%)`, borderColor: `hsl(${c.hue} 55% 45% / .6)`, background: `hsl(${c.hue} 50% 20% / .35)` } : {}}>
                      {on ? '✓ ' : ''}{c.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-[1fr_150px] gap-4">
              <div>
                <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">ACCESS MODE</label>
                <select className="input mt-1.5" value={cform.access} onChange={(e) => setCform((f) => ({ ...f, access: e.target.value as CredMeta['access'] }))}>
                  <option value="PERMANENT">PERMANENT — collection members can launch</option>
                  <option value="APPROVAL_REQUIRED">JIT — approval window required</option>
                </select>
              </div>
              {cform.access === 'APPROVAL_REQUIRED' && (
                <div>
                  <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">JIT WINDOW (MIN)</label>
                  <input type="number" className="input mt-1.5" value={cform.jit} min={5} max={480} onChange={(e) => setCform((f) => ({ ...f, jit: Number(e.target.value) }))} />
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">SECRET</label>
                <button className="btn btn-ghost btn-sm" onClick={() => { setCform((f) => ({ ...f, secret: pam.proposeSecret(24), generated: true })); setCstep('form'); }}>
                  <I n="rotate" className="w-3.5 h-3.5" /> Generate strong secret
                </button>
              </div>
              <input type="password" className="input mt-1.5 font-mono" placeholder={cform.generated ? 'generated below' : 'paste or type (min 12 chars)'} value={cform.generated ? '' : cform.secret} onChange={(e) => setCform((f) => ({ ...f, secret: e.target.value, generated: false }))} />
              {cform.generated && (
                <div className="mt-2 rounded-lg border border-[rgba(58,214,181,0.4)] bg-[rgba(8,16,32,0.8)] px-4 py-3 font-mono text-[14px] text-[var(--teal)] break-all rise-in">
                  {cform.secret}
                </div>
              )}
            </div>
            {cerr && <p className="text-[#ff9d94] text-[12.5px] font-mono">⊘ {cerr}</p>}
            <div className="flex gap-3 justify-end border-t border-[var(--line)] pt-4">
              <button className="btn btn-ghost" onClick={resetCreate}>Cancel</button>
              <button className="btn btn-primary" onClick={() => { setCerr(''); cform.generated ? setCstep('reveal') : sealCredential(); }}>
                <I n="lock" className="w-4 h-4" /> {cform.generated ? 'Review secret → seal' : 'Seal into vault'}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="rounded-lg border border-[rgba(242,180,76,0.45)] bg-[rgba(8,16,32,0.85)] p-5 relative overflow-hidden">
              <div className="font-mono text-[10px] tracking-[0.2em] text-[var(--amber)] mb-2 flex items-center gap-2"><I n="alert" className="w-3.5 h-3.5" /> ONE-TIME DISPLAY</div>
              <div className="font-mono text-[17px] text-[var(--amber)] break-all select-all">{cform.secret}</div>
            </div>
            <p className="text-[12.5px] text-[var(--mut)] mt-4 leading-relaxed">
              After you seal it, this value exists <span className="text-[var(--ink)]">only as AES-256-GCM ciphertext</span> under the tenant DEK.
              No API, no UI control, no export will ever return it again — not even to you.
            </p>
            <div className="flex gap-3 justify-end mt-5">
              <button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(cform.secret).then(() => toast('Copied — clear your clipboard history', 'amber')).catch(() => {})}><I n="copy" className="w-4 h-4" /> Copy</button>
              <button className="btn btn-primary" onClick={sealCredential}><I n="lock" className="w-4 h-4" /> I've stored it — seal forever</button>
            </div>
          </div>
        )}
      </Modal>

      {/* ---- create collection ---- */}
      <Modal open={colModal} onClose={() => setColModal(false)} title="New collection" width={520}>
        <div className="space-y-4">
          <div>
            <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">NAME</label>
            <input className="input mt-1.5" placeholder="Payments" value={colForm.name} onChange={(e) => setColForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">DESCRIPTION</label>
            <input className="input mt-1.5" placeholder="What belongs here…" value={colForm.description} onChange={(e) => setColForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">MEMBERS (who can see & launch)</label>
            <div className="space-y-1.5 mt-1.5">
              {snap.users.filter((u) => u.status === 'ACTIVE').map((u) => {
                const on = colForm.members.includes(u.id);
                return (
                  <button key={u.id} onClick={() => setColForm((f) => ({ ...f, members: on ? f.members.filter((x) => x !== u.id) : [...f.members, u.id] }))}
                    className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all cursor-pointer ${on ? 'border-[rgba(58,214,181,0.4)] bg-[rgba(58,214,181,0.06)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: `hsl(${u.hue} 45% 22%)`, color: `hsl(${u.hue} 80% 70%)` }}>{u.name.split(' ').map((x) => x[0]).join('')}</span>
                    <span className="flex-1 text-[13px]">{u.name}</span>
                    <span className="font-mono text-[9.5px] text-[var(--dim)]">{u.role.replace('_', ' ')}</span>
                    {on && <I n="check" className="w-3.5 h-3.5 text-[var(--teal)]" sw={2.4} />}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button className="btn btn-ghost" onClick={() => setColModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={() => {
              try {
                pam.createCollection({ name: colForm.name, description: colForm.description, memberUserIds: colForm.members });
                toast(`Collection "${colForm.name}" created — ${colForm.members.length} member(s) granted visibility`, 'teal');
                setColModal(false);
              } catch (e) { toast(isPamError(e) ? e.message : 'Failed', 'red'); }
            }}><I n="plus" className="w-4 h-4" /> Create collection</button>
          </div>
        </div>
      </Modal>
      {/* keep glyph import for drawer parity */}
      <span className="hidden">{typeof AppGlyph === 'function' ? '' : ''}</span>
    </div>
  );
}
