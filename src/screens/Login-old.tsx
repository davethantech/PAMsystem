import { useEffect, useState } from 'react';
import { pam } from '../engine/pam';
import { isPamError } from '../engine/pam';
import { BrandMark, I } from '../components/icons';
import { CountRing, useDecode, REDUCED_MOTION } from '../components/ui';
import { usePam } from '../state/store';

const PERSONAS = [
  { email: 'chetan@meridian.dev', name: 'Chetan · Operator', role: 'USER' },
  { email: 'priya@meridian.dev', name: 'Priya · PAM Admin', role: 'PAM_ADMIN' },
  { email: 'marcus@meridian.dev', name: 'Marcus · Security', role: 'SECURITY_ADMIN' },
  { email: 'elena@meridian.dev', name: 'Elena · Auditor', role: 'AUDITOR' },
];

function TelemetryRail() {
  const { snap, tick } = usePam();
  const rows = snap.audit.slice(0, 5);
  return (
    <div className="panel p-4 font-mono text-[11px] leading-relaxed w-full max-w-[380px]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[var(--teal)] tracking-[0.18em] text-[10px]">LIVE CONTROL PLANE</span>
        <span className="flex items-center gap-1.5 text-[var(--mut)]"><span className="w-1.5 h-1.5 rounded-full bg-[var(--teal)] pulse-dot" />streaming</span>
      </div>
      <div className="space-y-2">
        {rows.map((e) => (
          <div key={e.id} className="flex gap-2 items-baseline border-b border-[var(--line)] pb-1.5">
            <span className="text-[var(--dim)] shrink-0">{new Date(e.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span className={e.result === 'DENIED' || e.result === 'FAILURE' ? 'text-[#ff9d94]' : 'text-[var(--ink)]'}>{e.type}</span>
            <span className="text-[var(--dim)] truncate">#{e.hash.slice(0, 8)}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div><div className="text-[var(--teal)] text-[15px]">{snap.sessions.filter((s) => s.status === 'ACTIVE').length}</div><div className="text-[var(--dim)] text-[9px] tracking-widest">SESSIONS</div></div>
        <div><div className="text-[var(--amber)] text-[15px]">{snap.requests.filter((r) => r.status === 'PENDING').length}</div><div className="text-[var(--dim)] text-[9px] tracking-widest">PENDING</div></div>
        <div><div className="text-[var(--sky)] text-[15px]">{8 + (tick % 3)}</div><div className="text-[var(--dim)] text-[9px] tracking-widest">KEYS / KMS</div></div>
      </div>
    </div>
  );
}

export default function Login() {
  const { phase, beginLogin, beginSso, verifyMfa, mfaCtx, switchPersona, toast } = usePam();
  const [method, setMethod] = useState<'password' | 'sso' | 'passkey'>('password');
  const [email, setEmail] = useState('chetan@meridian.dev');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [shake, setShake] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const headline = useDecode('USE THE ACCOUNT. NEVER SEE THE SECRET.', 20);

  const fail = (m: string) => { setErr(m); setShake(true); window.setTimeout(() => setShake(false), 500); };

  const submitPw = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try { beginLogin(email, pw || 'demo-password'); }
    catch (ex) { fail(isPamError(ex) ? ex.message : 'Login failed'); }
  };

  const submitMfa = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try { verifyMfa(code); }
    catch (ex) { fail(isPamError(ex) ? ex.message : 'Verification failed'); }
  };

  const doSso = (p: 'GOOGLE' | 'ENTRA') => {
    setBusy(true);
    window.setTimeout(() => { beginSso(p); }, REDUCED_MOTION ? 100 : 900);
  };

  const doPasskey = () => {
    setBusy(true);
    window.setTimeout(() => {
      try { switchPersona('usr_marcus'); toast('FIDO2 passkey assertion verified — no password transmitted', 'teal'); } catch { setBusy(false); }
    }, REDUCED_MOTION ? 100 : 1100);
  };

  useEffect(() => { if (phase === 'mfa') setCode(''); }, [phase]);

  return (
    <div className="relative z-10 min-h-screen flex flex-col lg:flex-row">
      <div className="scanline" />
      {/* ---- left: brand + telemetry ---- */}
      <div className="lg:w-[46%] flex flex-col justify-between p-8 lg:p-12 gap-10 border-b lg:border-b-0 lg:border-r border-[var(--line)]">
        <div className="flex items-center gap-3">
          <BrandMark className="w-10 h-10" />
          <div>
            <div className="font-display font-700 font-bold text-[22px] tracking-[0.08em]">KEYRAIL</div>
            <div className="font-mono text-[10px] text-[var(--mut)] tracking-[0.22em]">CLOUD PRIVILEGED ACCESS MANAGEMENT</div>
          </div>
        </div>

        <div>
          <h1 className="font-display font-bold text-[clamp(26px,3.6vw,44px)] leading-[1.08] tracking-tight font-mono whitespace-pre-wrap min-h-[2.2em]">
            {headline}<span className="text-[var(--teal)] animate-pulse">▌</span>
          </h1>
          <p className="mt-5 text-[var(--mut)] max-w-[52ch] leading-relaxed text-[15px]">
            Keyrail is a multi-tenant SaaS control plane that lets your team <span className="text-[var(--ink)]">launch</span> eBay,
            Cloudflare, cPanel and every other privileged console — while the password itself
            <span className="text-[var(--teal)]"> never reaches a browser, a clipboard, a log, or an API response</span>.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {['SOC 2 Type II', 'ISO 27001', 'FIDO2 / WebAuthn', 'KMS envelope encryption', 'Zero plaintext surface'].map((t) => (
              <span key={t} className="chip">{t}</span>
            ))}
          </div>
        </div>

        <div className="hidden lg:flex flex-col items-start gap-4">
          <TelemetryRail />
          <p className="font-mono text-[10.5px] text-[var(--dim)] leading-relaxed max-w-[46ch]">
            ▲ tenant <span className="text-[var(--mut)]">tnt_meridian_01</span> · region ap-southeast-2 ·
            every event hash-chained to the previous — tamper-evident by construction.
          </p>
        </div>
      </div>

      {/* ---- right: auth gate ---- */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 relative">
        <div className="radar-wrap relative w-[340px] h-[340px] opacity-[0.14] hidden xl:block absolute -right-16 -top-10 pointer-events-none">
          <div className="absolute inset-0 rounded-full border border-[var(--line-strong)]" />
          <div className="absolute inset-[22%] rounded-full border border-[var(--line)]" />
          <div className="radar-sweep" />
        </div>

        <div className={`w-full max-w-[430px] ${shake ? 'shake' : ''}`}>
          {phase === 'mfa' && mfaCtx ? (
            <div className="panel-solid p-8 rise-in">
              <div className="flex items-center gap-2 text-[var(--teal)] font-mono text-[11px] tracking-[0.2em] mb-2">
                <I n="shield" className="w-4 h-4" /> STEP 2 OF 2 — MFA CHALLENGE
              </div>
              <h2 className="font-display font-bold text-[22px]">Verify it's you, {(mfaCtx.user as { name: string }).name.split(' ')[0]}</h2>
              <p className="text-[var(--mut)] text-[13px] mt-1.5">
                Enter the 6-digit code from your authenticator. Wrong codes are rate-limited and audited.
              </p>
              <form onSubmit={submitMfa} className="mt-6 space-y-5">
                <input
                  className="input text-center font-mono text-[22px] tracking-[0.5em]"
                  maxLength={6} value={code} autoFocus placeholder="••••••"
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  aria-label="TOTP code"
                />
                {err && <p className="text-[#ff9d94] text-[12.5px] font-mono">⊘ {err}</p>}
                <button className="btn btn-primary w-full" disabled={code.length !== 6}>
                  <I n="fingerprint" className="w-4 h-4" /> Verify & enter console
                </button>
                <button type="button" onClick={() => window.location.reload()} className="btn btn-ghost w-full">Back to sign in</button>
              </form>

              <div className="mt-6 border border-dashed border-[var(--line-strong)] rounded-lg p-4 flex items-center gap-4 bg-[rgba(58,214,181,0.04)]">
                <CountRing remaining={18_000} total={30_000} size={52} />
                <div>
                  <div className="font-mono text-[10px] text-[var(--dim)] tracking-[0.18em]">DEMO AUTHENTICATOR · TOTP</div>
                  <div className="font-mono text-[24px] font-semibold text-[var(--teal)] tracking-[0.3em]">{mfaCtx.expectedCode}</div>
                  <div className="text-[11px] text-[var(--mut)]">type this code — rotates every 30s in production</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="panel-solid p-8 rise-in">
              <div className="flex items-center gap-2 text-[var(--mut)] font-mono text-[11px] tracking-[0.2em] mb-2">
                <I n="gate" className="w-4 h-4 text-[var(--gold)]" /> SECURE TENANT GATEWAY
              </div>
              <h2 className="font-display font-bold text-[22px]">Sign in to Meridian Retail</h2>

              <div className="mt-5 grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-[rgba(8,16,32,0.7)] border border-[var(--line)]">
                {([['password', 'Password'], ['sso', 'SSO'], ['passkey', 'Passkey']] as const).map(([k, label]) => (
                  <button key={k} onClick={() => { setMethod(k); setErr(''); }}
                    className={`py-2 rounded-md font-display text-[12.5px] font-semibold transition-all cursor-pointer ${method === k ? 'bg-[rgba(58,214,181,0.14)] text-[var(--teal)] border border-[rgba(58,214,181,0.35)]' : 'text-[var(--mut)] border border-transparent hover:text-[var(--ink)]'}`}>
                    {label}
                  </button>
                ))}
              </div>

              {method === 'password' && (
                <form onSubmit={submitPw} className="mt-5 space-y-4">
                  <div>
                    <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">WORK EMAIL</label>
                    <input className="input mt-1.5" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@meridian.dev" />
                  </div>
                  <div>
                    <label className="font-mono text-[10.5px] tracking-[0.16em] text-[var(--dim)]">PASSWORD</label>
                    <input className="input mt-1.5" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••••" />
                  </div>
                  {err && <p className="text-[#ff9d94] text-[12.5px] font-mono">⊘ {err}</p>}
                  <button className="btn btn-primary w-full" disabled={busy}>Continue <I n="arrowR" className="w-4 h-4" /></button>
                  <div>
                    <div className="font-mono text-[10px] tracking-[0.16em] text-[var(--dim)] mb-2">DEMO PERSONAS — click to fill</div>
                    <div className="flex flex-wrap gap-1.5">
                      {PERSONAS.map((p) => (
                        <button type="button" key={p.email} onClick={() => { setEmail(p.email); setPw(''); setErr(''); }}
                          className="chip hover:border-[var(--teal)] hover:text-[var(--teal)] transition-colors cursor-pointer">
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </form>
              )}

              {method === 'sso' && (
                <div className="mt-5 space-y-3">
                  <button className="btn btn-ghost w-full" disabled={busy} onClick={() => doSso('GOOGLE')}>
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z" fill="#5fa8f2" /><path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3.1v2.6A10 10 0 0 0 12 22z" fill="#3ad6b5" /><path d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9z" fill="#f2b44c" /><path d="M12 6c1.5 0 2.8.5 3.8 1.5L18.7 5A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.7 9.4 6 12 6z" fill="#f0685c" /></svg>
                    Google Workspace
                  </button>
                  <button className="btn btn-ghost w-full" disabled={busy} onClick={() => doSso('ENTRA')}>
                    <svg viewBox="0 0 24 24" className="w-4 h-4"><rect x="3" y="3" width="8.5" height="8.5" fill="#f0685c" /><rect x="12.5" y="3" width="8.5" height="8.5" fill="#3ad6b5" /><rect x="3" y="12.5" width="8.5" height="8.5" fill="#5fa8f2" /><rect x="12.5" y="12.5" width="8.5" height="8.5" fill="#f2b44c" /></svg>
                    Microsoft Entra ID
                  </button>
                  <button className="btn btn-ghost w-full opacity-60" disabled>
                    <I n="org" className="w-4 h-4" /> SAML 2.0 IdP (Okta, ADFS…)
                  </button>
                  {busy && <p className="font-mono text-[11.5px] text-[var(--teal)] text-center">↻ verifying OIDC assertion · deriving tenant…</p>}
                  <p className="text-[11.5px] text-[var(--dim)] leading-relaxed">
                    SSO sign-in inherits phishing-resistant MFA from your IdP. The tenant is always derived from the signed token — never from the URL.
                  </p>
                </div>
              )}

              {method === 'passkey' && (
                <div className="mt-6 text-center space-y-5">
                  <button onClick={doPasskey} disabled={busy}
                    className="mx-auto w-[110px] h-[110px] rounded-full border-2 border-[rgba(58,214,181,0.4)] bg-[rgba(58,214,181,0.07)] flex items-center justify-center text-[var(--teal)] hover:bg-[rgba(58,214,181,0.14)] hover:scale-105 transition-all cursor-pointer float-y">
                    <I n="fingerprint" className="w-12 h-12" sw={1.2} />
                  </button>
                  <div>
                    <p className="font-display font-semibold">Touch your passkey</p>
                    <p className="text-[12.5px] text-[var(--mut)] mt-1 max-w-[34ch] mx-auto">WebAuthn assertion — private key never leaves the authenticator. No shared secret to phish.</p>
                  </div>
                  {busy && <p className="font-mono text-[11.5px] text-[var(--teal)]">↻ waiting for authenticator…</p>}
                </div>
              )}
            </div>
          )}

          <p className="text-center font-mono text-[10.5px] text-[var(--dim)] mt-6">
            TLS 1.3 · HSTS · CSP strict · session cookie HttpOnly+SameSite=Strict · brute-force throttled
          </p>
        </div>
      </div>
    </div>
  );
}
