import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { I } from '../components/icons';
import { Chip, Dot, Reveal, REDUCED_MOTION } from '../components/ui';
import { usePam } from '../state/store';

interface Hop {
  node: string;
  title: string;
  line: string;
  wire: { label: string; tone?: string }[];
  guards: string[];
  secret: 'none' | 'memory' | 'zeroized';
  where: string;
}

const HOPS: Hop[] = [
  {
    node: 'Browser', title: 'The launch click',
    line: 'Chetan opens the launcher and presses Open on “eBay Admin”. The UI can make exactly one credential-related call.',
    wire: [{ label: 'POST /credentials/:id/launch' }, { label: 'HttpOnly session cookie', tone: 'sky' }],
    guards: ['TLS 1.3 to the edge', 'Strict CSP — no inline script, no vault state in the page', 'No plaintext parameter exists to send'],
    secret: 'none', where: 'The secret is ciphertext in a private subnet. The browser has never seen it.',
  },
  {
    node: 'API Gateway', title: 'Identity & tenant, derived — never supplied',
    line: 'The gateway verifies the short-lived access token and derives the tenant from the signed session. Anything the client claims about itself is ignored.',
    wire: [{ label: 'verified principal' }, { label: 'tenant from token', tone: 'gold' }],
    guards: ['?tenant=other-org is dropped', 'RBAC: credential.use ✓ · credential.reveal ✗', 'Rate limiting + CSRF check'],
    secret: 'none', where: 'Still nowhere near a plaintext. The request carries capability, not identity claims.',
  },
  {
    node: 'PAM Service', title: 'The policy gate',
    line: 'Launch policy is evaluated like a firewall: collection membership, JIT window, MFA step-up freshness, device and geo rules, concurrent-session ceiling.',
    wire: [{ label: 'policy verdict', tone: 'teal' }],
    guards: ['eBay Admin lives in “Cloud Platform” — Chetan is a member', 'MFA verified < 5 min ago', '2-session ceiling not reached'],
    secret: 'none', where: 'A failed gate here writes ACCESS_DENIED to the chain and stops. No vault call is even attempted.',
  },
  {
    node: 'PAM Service', title: 'A capability is minted',
    line: 'Not a secret — a key. A cryptographically random, single-use grant bound to this user, this tenant, this credential, this domain, valid 30 seconds.',
    wire: [{ label: 'grant token (30s TTL)', tone: 'gold' }, { label: 'hash stored — token shown once' }],
    guards: ['Replay impossible: consumed flag + FOR UPDATE row lock', 'Expiry enforced at consumption, not display', 'Revocable server-side at any moment'],
    secret: 'none', where: 'The grant can open exactly one door, once. Stealing it after use buys nothing.',
  },
  {
    node: 'Broker Enclave', title: 'The only decryption that ever happens',
    line: 'The vault service — unreachable from the internet — unwraps the tenant DEK via KMS and decrypts the ciphertext inside a guarded memory region.',
    wire: [{ label: 'KMS: unwrap DEK', tone: 'gold' }, { label: 'ciphertext → memory', tone: 'red' }],
    guards: ['FORCE row-level security, tenant pinned to the transaction', 'HSM-backed master key never leaves hardware', 'Decryption callback scoped — the buffer cannot escape the function'],
    secret: 'memory', where: 'Plaintext exists in broker memory for ~250 ms. This is the entire exposure surface of the platform.',
  },
  {
    node: 'Injector', title: 'Authentication as an operation',
    line: 'The browser connector receives an injection program — selectors plus an opaque handle — and runs it in an isolated world the page cannot read.',
    wire: [{ label: 'opaque input events', tone: 'teal' }, { label: 'native setters — no DOM plaintext' }],
    guards: ['Domain allowlist: ebay.com.au or it refuses', 'Page JavaScript cannot observe the write', 'Nothing touches localStorage, URLs, or logs'],
    secret: 'memory', where: 'The field fills. To the page it looks like typing; to the vault it looks like nothing left.',
  },
  {
    node: 'eBay', title: 'Signed in — by the broker, not the human',
    line: 'eBay sees an ordinary login. Chetan sees his dashboard through the session gateway, watermarked, recorded, and time-boxed.',
    wire: [{ label: 'normal authenticated session' }, { label: 'gateway proxy frames', tone: 'sky' }],
    guards: ['Gateway relays operations, never the secret', 'Session recording + watermark on every frame', 'JIT window auto-terminates the session'],
    secret: 'memory', where: 'Chetan is using the account. He has learned nothing about the password — there was nothing to learn.',
  },
  {
    node: 'Audit', title: 'Zeroize, seal, chain',
    line: 'The broker overwrites its memory, the grant is marked consumed, and eight hash-linked events close the loop. The secret is gone again.',
    wire: [{ label: 'memory zeroized', tone: 'teal' }, { label: 'hash-chained audit events', tone: 'gold' }],
    guards: ['Grant replay now returns “already consumed” — secret not decrypted', 'Chain verified nightly + on demand', 'Rotation policy can re-seal under a fresh DEK'],
    secret: 'zeroized', where: 'Back to ciphertext under KMS. Total plaintext dwell time: a quarter of a second, in one place, once.',
  },
];

const NODES = ['Browser', 'Edge / WAF', 'API Gateway', 'PAM Service', 'Vault + KMS', 'Broker Enclave', 'Injector', 'eBay'];

export default function HowItWorks() {
  const { setRoute } = usePam();
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(!REDUCED_MOTION);
  const [dwell, setDwell] = useState(250);
  const timer = useRef<number | null>(null);

  const hop = HOPS[step];
  const activeNode = useMemo(() => {
    // map step → path node index (8 steps, 8 nodes)
    return Math.min(step, NODES.length - 1);
  }, [step]);

  const next = useCallback(() => setStep((s) => (s + 1) % HOPS.length), []);
  const prev = useCallback(() => setStep((s) => (s - 1 + HOPS.length) % HOPS.length), []);

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(next, 3800);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [playing, next]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { setPlaying(false); next(); }
      if (e.key === 'ArrowLeft') { setPlaying(false); prev(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [next, prev]);

  // dwell countdown when the secret is in memory
  useEffect(() => {
    if (hop.secret !== 'memory') return;
    setDwell(250);
    const id = window.setInterval(() => setDwell((d) => (d <= 10 ? 250 : d - 10)), 140);
    return () => window.clearInterval(id);
  }, [step, hop.secret]);

  const secretLabel = hop.secret === 'none' ? 'NOWHERE' : hop.secret === 'memory' ? 'BROKER MEMORY' : 'ZEROIZED';
  const secretTone = hop.secret === 'none' ? 'var(--teal)' : hop.secret === 'memory' ? 'var(--amber)' : 'var(--teal)';

  return (
    <div className="space-y-6 max-w-[1180px]">
      {/* header strip — the characteristic opening: the path itself */}
      <Reveal>
        <div className="panel p-5 relative overflow-hidden">
          <div className="scanline" />
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[260px]">
              <div className="font-mono text-[10px] tracking-[0.24em] text-[var(--teal)]">ANATOMY OF A LAUNCH</div>
              <h2 className="font-display font-bold text-[26px] leading-tight mt-1">
                Chetan clicks <span className="text-[var(--teal)]">Open</span>. Eight hops. Zero passwords.
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost btn-sm" onClick={() => { setPlaying(false); prev(); }} aria-label="Previous step"><I n="chevR" className="w-4 h-4 rotate-180" /></button>
              <button className={`btn btn-sm ${playing ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPlaying((p) => !p)}>
                {playing ? <><I n="stop" className="w-3.5 h-3.5" /> Pause</> : <><I n="launch" className="w-3.5 h-3.5" /> Autoplay</>}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setPlaying(false); next(); }} aria-label="Next step"><I n="chevR" className="w-4 h-4" /></button>
              <span className="font-mono text-[12px] text-[var(--mut)] tabular-nums ml-1">{String(step + 1).padStart(2, '0')} / {HOPS.length}</span>
            </div>
          </div>

          {/* the path */}
          <div className="mt-6 overflow-x-auto pb-1">
            <svg viewBox="0 0 980 92" className="w-full min-w-[760px]">
              {NODES.map((n, i) => {
                const x = 20 + i * 122;
                const done = i < activeNode;
                const active = i === activeNode;
                const color = active ? 'var(--teal)' : done ? 'rgba(58,214,181,0.65)' : 'rgba(122,160,210,0.4)';
                return (
                  <g key={n} onClick={() => { setPlaying(false); setStep(i); }} style={{ cursor: 'pointer' }}>
                    {i < NODES.length - 1 && (
                      <line x1={x + 96} y1={40} x2={x + 122} y2={40} stroke="rgba(122,160,210,0.3)" strokeWidth="1.5" className={active ? 'dash-flow' : ''} strokeDasharray={active ? '4 7' : undefined} />
                    )}
                    <rect x={x} y={18} width={96} height={44} rx={9}
                      fill={active ? 'rgba(58,214,181,0.12)' : 'rgba(17,31,56,0.85)'}
                      stroke={color} strokeWidth={active ? 1.8 : 1.1} />
                    <text x={x + 48} y={44} textAnchor="middle" fill={active ? 'var(--ink)' : 'var(--mut)'}
                      style={{ font: `${active ? 700 : 500} 10.5px "Space Grotesk"` }}>{n}</text>
                    {active && <circle cx={x + 48} cy={10} r={3.5} fill="var(--teal)" className="pulse-dot" />}
                  </g>
                );
              })}
              {/* travelling packet */}
              <circle r={4.5} fill="var(--teal)" opacity={playing && !REDUCED_MOTION ? 0.95 : 0}>
                <animateMotion dur="3.8s" repeatCount="indefinite"
                  path={`M${20 + 48} 40 H ${20 + activeNode * 122 + 48}`} />
              </circle>
            </svg>
          </div>

          {/* step dots */}
          <div className="flex gap-1.5 mt-2">
            {HOPS.map((_, i) => (
              <button key={i} onClick={() => { setPlaying(false); setStep(i); }} aria-label={`Step ${i + 1}`}
                className="h-[5px] rounded-full transition-all duration-300 cursor-pointer"
                style={{ width: i === step ? 34 : 14, background: i === step ? 'var(--teal)' : i < step ? 'rgba(58,214,181,0.4)' : 'rgba(122,160,210,0.22)' }} />
            ))}
          </div>
        </div>
      </Reveal>

      {/* stage */}
      <div className="grid lg:grid-cols-[1fr_330px] gap-4" onMouseEnter={() => playing && setPlaying(false)}>
        <Reveal key={step}>
          <div className="panel p-6 rise-in" key={`stage-${step}`}>
            <div className="flex items-start gap-5">
              <div className="font-display font-bold text-[54px] leading-none text-[var(--teal)] opacity-90 tabular-nums" style={{ textShadow: '0 0 30px rgba(58,214,181,0.35)' }}>
                {String(step + 1).padStart(2, '0')}
              </div>
              <div className="flex-1">
                <div className="font-mono text-[10px] tracking-[0.22em] text-[var(--dim)]">{hop.node.toUpperCase()}</div>
                <h3 className="font-display font-bold text-[22px] leading-tight mt-0.5">{hop.title}</h3>
                <p className="text-[13.5px] text-[var(--mut)] mt-2 leading-relaxed max-w-[62ch]">{hop.line}</p>
              </div>
            </div>

            <div className="mt-5 grid md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-[var(--line)] p-4 bg-[rgba(8,16,32,0.5)]">
                <div className="font-mono text-[9.5px] tracking-[0.2em] text-[var(--dim)] mb-2.5">ON THE WIRE AT THIS HOP</div>
                <div className="flex flex-wrap gap-1.5">
                  {hop.wire.map((w) => <Chip key={w.label} tone={w.tone ?? ''}>{w.label}</Chip>)}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--line)] p-4 bg-[rgba(8,16,32,0.5)]">
                <div className="font-mono text-[9.5px] tracking-[0.2em] text-[var(--dim)] mb-2.5">GUARDS AN ATTACKER MEETS HERE</div>
                <ul className="space-y-1.5">
                  {hop.guards.map((g) => (
                    <li key={g} className="flex gap-2 text-[12px] text-[var(--mut)] leading-snug">
                      <span className="text-[var(--teal)] shrink-0 mt-[3px]"><I n="shield" className="w-3 h-3" /></span>{g}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* secret location strip */}
            <div className="mt-5 rounded-lg border p-4" style={{ borderColor: `${secretTone}55`, background: `${secretTone}0d` }}>
              <div className="flex items-center gap-3">
                <span className="relative flex w-3 h-3">
                  {hop.secret === 'memory' && <span className="absolute inset-0 rounded-full pulse-dot" style={{ background: secretTone, boxShadow: `0 0 12px ${secretTone}` }} />}
                  <span className="relative w-3 h-3 rounded-full" style={{ background: secretTone, opacity: 0.9 }} />
                </span>
                <div className="font-mono text-[11px] tracking-[0.18em]" style={{ color: secretTone }}>
                  PLAINTEXT LOCATION: {secretLabel}
                  {hop.secret === 'memory' && <span className="ml-3 text-[var(--ink)] tabular-nums">dwell ≈ {dwell} ms</span>}
                </div>
                <span className="flex-1" />
                {hop.secret === 'zeroized' && <Chip tone="teal"><I n="check" className="w-3 h-3" sw={2.4} /> EXPOSURE CLOSED</Chip>}
              </div>
              {/* location meter */}
              <div className="mt-3 h-[6px] rounded-full bg-[rgba(8,16,32,0.9)] relative overflow-hidden">
                <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
                  style={{
                    width: hop.secret === 'none' ? '4%' : hop.secret === 'memory' ? `${55 + ((250 - dwell) / 250) * 20}%` : '100%',
                    background: hop.secret === 'memory' ? 'linear-gradient(90deg, rgba(58,214,181,0.25), var(--amber))' : 'rgba(58,214,181,0.4)',
                  }} />
              </div>
              <div className="flex justify-between font-mono text-[9px] text-[var(--dim)] mt-1.5 tracking-wider">
                <span>CIPHERTEXT AT REST</span><span>BROKER MEMORY</span><span>ZEROIZED</span>
              </div>
              <p className="text-[12px] text-[var(--mut)] mt-2.5 leading-snug">{hop.where}</p>
            </div>
          </div>
        </Reveal>

        {/* rail */}
        <Reveal delay={90}>
          <div className="space-y-4">
            <div className="panel p-5">
              <div className="font-mono text-[10px] tracking-[0.2em] text-[var(--dim)] mb-3">THREE INVARIANTS</div>
              <div className="space-y-3.5">
                {[
                  ['No plaintext route', 'The API has no endpoint that returns a secret — probes get 404s that are audited.', 'slash'],
                  ['Grants, not secrets', 'Single-use 30s capabilities bound to user, tenant, credential and domain.', 'key'],
                  ['Zeroize after use', 'The buffer is overwritten before the call returns; memory is the whole attack surface.', 'rotate'],
                ].map(([t, d, ic]) => (
                  <div key={t} className="flex gap-3">
                    <span className="w-8 h-8 rounded-lg border border-[rgba(58,214,181,0.35)] bg-[rgba(58,214,181,0.06)] text-[var(--teal)] flex items-center justify-center shrink-0"><I n={ic} className="w-4 h-4" /></span>
                    <div>
                      <div className="text-[13px] font-semibold leading-tight">{t}</div>
                      <p className="text-[11.5px] text-[var(--mut)] mt-0.5 leading-snug">{d}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel p-5">
              <div className="font-mono text-[10px] tracking-[0.2em] text-[var(--dim)] mb-3">WHAT THE USER KNOWS</div>
              <div className="space-y-2 text-[12.5px]">
                <div className="flex items-center gap-2 text-[var(--teal)]"><I n="check" className="w-3.5 h-3.5" sw={2.4} /> “I can open eBay Admin.”</div>
                <div className="flex items-center gap-2 text-[#ff9d94]"><I n="x" className="w-3.5 h-3.5" sw={2.4} /> “The eBay Admin password is…” <span className="font-mono text-[10px] text-[var(--dim)]">— unknowable</span></div>
              </div>
              <button className="btn btn-ghost btn-sm w-full mt-4" onClick={() => setRoute('security')}>
                <I n="scan" className="w-3.5 h-3.5" /> Now try to break it — adversarial tests
              </button>
              <button className="btn btn-primary btn-sm w-full mt-2" onClick={() => setRoute('launcher')}>
                <I n="launch" className="w-3.5 h-3.5" /> Watch it live — open an application
              </button>
            </div>
          </div>
        </Reveal>
      </div>

      {/* production mapping */}
      <Reveal>
        <div className="panel overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--line)] flex items-center gap-2.5">
            <I n="layers" className="w-4 h-4 text-[var(--sky)]" />
            <span className="font-display font-semibold text-[15px]">Same mechanism, two execution modes</span>
          </div>
          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--line)]">
            <div className="p-5">
              <Chip tone="sky">THIS CONSOLE · runs now</Chip>
              <p className="text-[12.5px] text-[var(--mut)] mt-3 leading-relaxed">
                The entire control plane executes in-browser inside a sealed engine module: the launch pipeline you just stepped
                through, the RBAC gates, the hash-chained audit log, the denials. Plaintext lives only in module-private memory,
                so <span className="text-[var(--ink)]">the UI genuinely cannot display it</span> — the demo is enforcing the real
                workflow, not imitating it.
              </p>
            </div>
            <div className="p-5">
              <Chip tone="gold">PRODUCTION STACK · in /backend, /database, /connector</Chip>
              <p className="text-[12.5px] text-[var(--mut)] mt-3 leading-relaxed">
                The identical sequence runs across real services: Fastify gateway → PAM service → vault in a private subnet →
                KMS/HSM → broker enclave → MV3 isolated-world injector or SSH/RDP proxy. There the guarantee becomes cryptographic:
                secrets are AES-256-GCM ciphertext under tenant DEKs, and no network path to plaintext exists at all.
              </p>
            </div>
          </div>
          <div className="px-5 py-3 border-t border-[var(--line)] flex items-center gap-2 font-mono text-[10.5px] text-[var(--dim)]">
            <Dot tone="var(--teal)" blink /> the invariant is identical in both: <span className="text-[var(--teal)]">use the account · never meet the password</span>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
