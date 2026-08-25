import { useState } from 'react';
import { I } from '../components/icons';
import { Chip, Reveal } from '../components/ui';

function Box({ x, y, w, h, title, sub, tone = 'var(--teal)', onClick, active }: {
  x: number; y: number; w: number; h: number; title: string; sub?: string; tone?: string; onClick?: () => void; active?: boolean;
}) {
  return (
    <g onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }} opacity={active === false ? 0.45 : 1}>
      <rect x={x} y={y} width={w} height={h} rx="9" fill={active ? 'rgba(58,214,181,0.10)' : 'rgba(17,31,56,0.9)'}
        stroke={active ? tone : 'rgba(122,160,210,0.3)'} strokeWidth={active ? 1.8 : 1.2} />
      <text x={x + w / 2} y={y + (sub ? h / 2 - 4 : h / 2 + 4)} textAnchor="middle" fill="var(--ink)"
        style={{ font: '600 12.5px "Space Grotesk"' }}>{title}</text>
      {sub && <text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" fill="var(--dim)" style={{ font: '400 9.5px "IBM Plex Mono"' }}>{sub}</text>}
    </g>
  );
}

const DETAILS: Record<string, { title: string; body: string }> = {
  edge: { title: 'Public edge — TLS 1.3 only', body: 'Cloud load balancer terminates TLS, applies WAF, DDoD shielding, rate limiting and HSTS/CSP headers. Nothing behind it is internet-reachable.' },
  web: { title: 'Web frontend (React)', body: 'Static, stateless, served from CDN. Holds zero secrets — the vault state simply does not exist client-side. Strict CSP forbids inline script.' },
  api: { title: 'API gateway — authn/authz', body: 'Verifies short-lived access tokens, derives the tenant from the signed session (never the request), enforces RBAC + rate limits + CSRF.' },
  pam: { title: 'PAM service', body: 'Evaluates launch policy: collection membership, JIT windows, device/geo rules — then mints single-use 30s grants. Stateless, auto-scaled.' },
  vault: { title: 'Vault service (isolated)', body: 'The only service that may touch ciphertext. Lives in a private subnet with no public route. Envelope encryption: per-tenant DEKs wrapped by KMS.' },
  audit: { title: 'Audit service', body: 'Append-only, hash-chained events. Secrets are redacted at the API boundary — there is nothing sensitive to leak.' },
  kms: { title: 'Cloud KMS / HSM', body: 'Master keys never leave HSM hardware. DEK rotation, key versions, and per-tenant key isolation are managed here.' },
  gw: { title: 'Credential injection gateway', body: 'Consumes a grant inside a trusted execution boundary, decrypts for the minimum duration, and drives an isolated-world injector or SSH/RDP proxy. Plaintext is zeroized immediately.' },
  ext: { title: 'Browser connector (MV3)', body: 'Domain-aware: rejects injection unless the tab matches the credential’s allowlisted domain. Communicates only with scoped grants.' },
  targets: { title: 'Target applications', body: 'eBay, Cloudflare, cPanel, Unleashed, databases, network devices. They see a normal login — performed by the broker, not the human.' },
  conn: { title: 'On-prem connector', body: 'Outbound-only mTLS tunnel from the customer network. Receives authorized commands; holds no vault keys; requires zero inbound ports.' },
  db: { title: 'PostgreSQL (private)', body: 'Row-level tenant scoping, encrypted at rest, PITR backups, multi-AZ replication. Not publicly addressable.' },
};

export default function Architecture() {
  const [sel, setSel] = useState<string>('gw');
  const d = DETAILS[sel];

  return (
    <div className="space-y-6 max-w-[1180px]">
      <Reveal>
        <div className="panel p-5 lg:p-7">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <h2 className="font-display font-bold text-[20px]">Multi-tenant cloud control plane</h2>
            <Chip tone="teal">100% SaaS — customers install nothing</Chip>
            <Chip>click a component ↓</Chip>
          </div>
          <p className="text-[13px] text-[var(--mut)] max-w-[78ch]">
            One shared, isolated control plane per tenant. The plaintext path is deliberately narrow:
            it exists only inside the broker enclave, for the minimum time, and never crosses to a browser.
          </p>
          <div className="grid lg:grid-cols-[1fr_320px] gap-6 mt-4">
            <svg viewBox="0 0 940 590" className="w-full h-auto">
              <defs>
                <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0L10 5L0 10z" fill="rgba(122,160,210,0.55)" />
                </marker>
                <marker id="arrT" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0L10 5L0 10z" fill="var(--teal)" />
                </marker>
              </defs>

              {/* tenant boundary */}
              <rect x="200" y="150" width="720" height="420" rx="14" fill="none" stroke="rgba(217,169,78,0.25)" strokeDasharray="6 6" />
              <text x="216" y="172" fill="var(--gold)" style={{ font: '500 9.5px "IBM Plex Mono"', letterSpacing: '0.14em' }}>TENANT ISOLATION BOUNDARY · tnt_meridian_01</text>

              {/* private subnet */}
              <rect x="640" y="330" width="260" height="120" rx="12" fill="rgba(95,168,242,0.04)" stroke="rgba(95,168,242,0.25)" strokeDasharray="4 5" />
              <text x="654" y="348" fill="var(--sky)" style={{ font: '500 9px "IBM Plex Mono"', letterSpacing: '0.12em' }}>PRIVATE SUBNET · NO PUBLIC ROUTE</text>

              {/* internet + edge */}
              <Box x={380} y={20} w={180} h={44} title="Internet" sub="user browser · TLS 1.3" tone="var(--sky)" active={false} />
              <Box x={330} y={95} w={280} h={44} title="Cloud LB / API Gateway" sub="WAF · rate-limit · HSTS/CSP" onClick={() => setSel('edge')} active={sel === 'edge'} />
              <line x1="470" y1="64" x2="470" y2="93" stroke="rgba(122,160,210,0.5)" strokeWidth="1.4" markerEnd="url(#arr)" />

              <Box x={240} y={185} w={200} h={50} title="Web Frontend" sub="React · CDN · stateless" onClick={() => setSel('web')} active={sel === 'web'} />
              <Box x={500} y={185} w={220} h={50} title="AuthN / AuthZ Gateway" sub="tokens · RBAC · tenant derive" onClick={() => setSel('api')} active={sel === 'api'} />
              <line x1="430" y1="139" x2="360" y2="183" stroke="rgba(122,160,210,0.5)" strokeWidth="1.4" markerEnd="url(#arr)" />
              <line x1="510" y1="139" x2="590" y2="183" stroke="rgba(122,160,210,0.5)" strokeWidth="1.4" markerEnd="url(#arr)" />

              <Box x={240} y={280} w={180} h={54} title="PAM Service" sub="policy · grants · JIT" onClick={() => setSel('pam')} active={sel === 'pam'} />
              <Box x={460} y={280} w={160} h={54} title="Vault Service" sub="sealed secrets" tone="var(--gold)" onClick={() => setSel('vault')} active={sel === 'vault'} />
              <Box x={660} y={185} w={220} h={50} title="Audit Service" sub="hash-chained · append-only" onClick={() => setSel('audit')} active={sel === 'audit'} />
              <line x1="560" y1="235" x2="340" y2="278" stroke="rgba(122,160,210,0.5)" strokeWidth="1.4" markerEnd="url(#arr)" />
              <line x1="600" y1="235" x2="545" y2="278" stroke="rgba(122,160,210,0.5)" strokeWidth="1.4" markerEnd="url(#arr)" />
              <line x1="620" y1="210" x2="658" y2="210" stroke="rgba(122,160,210,0.5)" strokeWidth="1.4" markerEnd="url(#arr)" />

              <Box x={470} y={370} w={140} h={50} title="KMS / HSM" sub="DEK wrapping · rotation" tone="var(--gold)" onClick={() => setSel('kms')} active={sel === 'kms'} />
              <line x1="540" y1="334" x2="540" y2="368" stroke="rgba(217,169,78,0.6)" strokeWidth="1.4" markerEnd="url(#arr)" />

              <Box x={680} y={370} w={190} h={50} title="PostgreSQL" sub="RLS · PITR · replicated" tone="var(--sky)" onClick={() => setSel('db')} active={sel === 'db'} />

              <Box x={240} y={400} w={200} h={54} title="Injection Gateway" sub="broker enclave · proxies" onClick={() => setSel('gw')} active={sel === 'gw'} />
              <line x1="330" y1="334" x2="335" y2="398" stroke="var(--teal)" strokeWidth="1.6" markerEnd="url(#arrT)" className="dash-flow" />
              <line x1="420" y1="307" x2="468" y2="307" stroke="rgba(217,169,78,0.6)" strokeWidth="1.4" markerEnd="url(#arr)" />

              <Box x={180} y={495} w={150} h={46} title="Browser Connector" sub="MV3 · domain-aware" onClick={() => setSel('ext')} active={sel === 'ext'} />
              <line x1="300" y1="454" x2="268" y2="493" stroke="var(--teal)" strokeWidth="1.6" markerEnd="url(#arrT)" className="dash-flow" />

              <Box x={390} y={497} w={110} h={42} title="eBay" onClick={() => setSel('targets')} active={sel === 'targets'} />
              <Box x={515} y={497} w={125} h={42} title="Cloudflare" onClick={() => setSel('targets')} active={sel === 'targets'} />
              <Box x={655} y={497} w={105} h={42} title="cPanel" onClick={() => setSel('targets')} active={sel === 'targets'} />
              <Box x={775} y={497} w={120} h={42} title="Unleashed" onClick={() => setSel('targets')} active={sel === 'targets'} />
              <line x1="360" y1="454" x2="440" y2="495" stroke="var(--teal)" strokeWidth="1.5" markerEnd="url(#arrT)" className="dash-flow" />
              <line x1="370" y1="454" x2="575" y2="495" stroke="var(--teal)" strokeWidth="1.5" markerEnd="url(#arrT)" className="dash-flow" />
              <line x1="380" y1="454" x2="705" y2="495" stroke="var(--teal)" strokeWidth="1.5" markerEnd="url(#arrT)" className="dash-flow" />
              <line x1="390" y1="454" x2="830" y2="495" stroke="var(--teal)" strokeWidth="1.5" markerEnd="url(#arrT)" className="dash-flow" />

              {/* on-prem connector */}
              <rect x="30" y="330" width="150" height="110" rx="12" fill="rgba(17,31,56,0.9)" stroke="rgba(95,168,242,0.4)" strokeWidth="1.4" />
              <text x="105" y="356" textAnchor="middle" fill="var(--ink)" style={{ font: '600 12px \"Space Grotesk\"' }}>Customer Network</text>
              <text x="105" y="376" textAnchor="middle" fill="var(--sky)" style={{ font: '500 10px \"IBM Plex Mono\"' }}>PAM Connector</text>
              <text x="105" y="394" textAnchor="middle" fill="var(--dim)" style={{ font: '400 8.5px \"IBM Plex Mono\"' }}>outbound mTLS only</text>
              <text x="105" y="424" textAnchor="middle" fill="var(--dim)" style={{ font: '400 8.5px \"IBM Plex Mono\"' }}>db-int · sw-core-01</text>
              <g onClick={() => setSel('conn')} style={{ cursor: 'pointer' }}>
                <path d="M140 330 C 150 240, 180 200, 238 190" fill="none" stroke="var(--sky)" strokeWidth="1.8" strokeDasharray="5 7" markerEnd="url(#arr)" className="dash-flow" />
                <circle r="3.4" fill="var(--sky)">
                  <animateMotion dur="3.2s" repeatCount="indefinite" path="M140 330 C 150 240, 180 200, 238 190" />
                </circle>
              </g>
              <text x="60" y="250" fill="var(--sky)" style={{ font: '500 8.5px \"IBM Plex Mono\"' }} transform="rotate(-52 92 262)">OUTBOUND TLS · no inbound ports</text>

              {/* animated packets on the launch path */}
              <circle r="4" fill="var(--teal)" opacity="0.9" className="packet">
                <animateMotion dur="5s" repeatCount="indefinite" path="M470 64 L470 120 L560 210 L340 300 L340 430 L440 510" />
              </circle>
              <circle r="3" fill="var(--gold)" opacity="0.85" className="packet">
                <animateMotion dur="4s" begin="1.2s" repeatCount="indefinite" path="M540 307 L540 395" />
              </circle>
            </svg>

            <aside className="panel-solid p-5 self-start sticky top-24">
              <div className="font-mono text-[10px] tracking-[0.2em] text-[var(--teal)] mb-2">COMPONENT</div>
              <h3 className="font-display font-bold text-[16px] leading-snug">{d.title}</h3>
              <p className="text-[12.5px] text-[var(--mut)] mt-2.5 leading-relaxed">{d.body}</p>
              <div className="mt-4 pt-3 border-t border-[var(--line)] font-mono text-[10px] text-[var(--dim)] leading-relaxed">
                plaintext dwell time target: <span className="text-[var(--teal)]">&lt; 250ms</span><br />
                inside broker enclave memory only
              </div>
            </aside>
          </div>
        </div>
      </Reveal>

      <Reveal>
        <div className="panel p-5 lg:p-6">
          <h2 className="font-display font-bold text-[18px] mb-1">The zero-plaintext path</h2>
          <p className="text-[12.5px] text-[var(--mut)] mb-5">What actually happens when Chetan clicks <span className="text-[var(--teal)]">Open → eBay</span></p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ['Launch click', 'POST /credentials/:id/launch — the only credential-related call the UI can make'],
              ['Policy gate', 'tenant (from token) · RBAC use-right · collection · JIT window · device rules'],
              ['Grant minted', 'single-use, 30s, cryptographically bound to user+tenant+app+domain'],
              ['Broker decrypts', 'inside the enclave; plaintext exists only in guarded memory'],
              ['Isolated injection', 'connector writes opaque input events; page JS cannot observe them'],
              ['Zeroize', 'memory wiped; grant consumed; replay impossible'],
              ['Proxied session', 'gateway relays operations — never the secret — with recording on'],
              ['Expiry & audit', 'JIT windows evaporate; every step is hash-chained to the audit log'],
            ].map(([t, s], i) => (
              <div key={t} className="relative panel p-4 card-lift">
                <div className="font-mono text-[10px] text-[var(--teal)] tracking-[0.2em]">{String(i + 1).padStart(2, '0')}</div>
                <div className="font-display font-semibold text-[13.5px] mt-1">{t}</div>
                <p className="text-[11.5px] text-[var(--mut)] mt-1 leading-snug">{s}</p>
                {i < 7 && <span className="hidden lg:block absolute top-1/2 -right-[13px] text-[var(--teal)] z-10"><I n="chevR" className="w-3.5 h-3.5" /></span>}
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      <Reveal>
        <div className="panel overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--line)] flex items-center gap-3">
            <I n="shieldX" className="w-4 h-4 text-[#ff9d94]" />
            <h2 className="font-display font-bold text-[17px]">Threat model — 15 adversaries</h2>
            <span className="font-mono text-[10.5px] text-[var(--dim)]">each with preventive control + detection</span>
          </div>
          <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
            <table className="table-base !text-[12px]">
              <thead className="sticky top-0 bg-[var(--panel-solid)]"><tr><th>#</th><th>Threat</th><th>Attack path</th><th>Preventive control</th><th>Detection / response</th></tr></thead>
              <tbody>
                {[
                  ['Compromised user account', 'Stolen password → portal login', 'MFA mandatory · anomaly-based step-up · device binding', 'Impossible-travel alerts · session revocation'],
                  ['Malicious employee', 'Insider hoarding shared passwords', 'No reveal right for operators · use-only launches', 'Audit chain · launch frequency analytics'],
                  ['Compromised browser', 'Malware reading tabs/storage', 'Isolated-world injection · HttpOnly cookies · no DOM plaintext', 'Extension integrity checks · CSP violation reports'],
                  ['Malicious extension', 'Rogue MV3 asking for inject', 'Domain allowlist per credential · grants bound to domain', 'Connector telemetry · grant misuse alarms'],
                  ['Compromised PAM server', 'Attacker in the control plane', 'Vault subnet isolated · KMS keys in HSM · short grant TTLs', 'Enclave attestation · break-glass paging'],
                  ['Database compromise', 'Dump of credential table', 'AES-256-GCM envelope encryption — ciphertext only', 'KMS access anomalies · canary rows'],
                  ['Cloud account compromise', 'Console access to infra', 'SCPs · private subnets · PITR + cross-region encrypted backups', 'CloudTrail alarms · DR runbook'],
                  ['API abuse', 'Scripted enumeration', 'Rate limits · no plaintext routes · strict schema validation', '429 storms → automatic IP quarantine'],
                  ['Credential replay', 'Reuse of captured grants', 'Single-use grants · 30s TTL · user+tenant binding', 'GRANT_REPLAY_BLOCKED events (see audit)'],
                  ['Session hijacking', 'Cookie theft / fixation', 'Secure+SameSite=Strict · refresh rotation · IP/device pinning', 'Re-auth on context change'],
                  ['Tenant escape', 'Cross-tenant IDOR', 'Tenant derived from token · RLS-style scoping on every query', 'Denied cross-tenant probes audited'],
                  ['Insider administrator', 'Rogue PAM admin', 'Separation of use/reveal · dual-custody break-glass', 'All admin actions hash-chained · SIEM'],
                  ['Connector compromise', 'Tunnel abuse into network', 'mTLS device identity · command allowlist · per-tenant binding', 'Heartbeat anomalies · instant revocation'],
                  ['Supply-chain attack', 'Poisoned dependency', 'Pinned builds · SBOM · secrets scanning · SLSA provenance', 'Dependency drift alerts'],
                  ['Backup compromise', 'Stealing encrypted backups', 'KMS-wrapped backup keys · separate key custody', 'Restore drills · key-access auditing'],
                ].map(([a, b, c, dd], i) => (
                  <tr key={a}>
                    <td className="font-mono text-[10px] text-[var(--dim)]">{String(i + 1).padStart(2, '0')}</td>
                    <td className="font-semibold whitespace-nowrap">{a}</td>
                    <td className="text-[var(--mut)]">{b}</td>
                    <td className="text-[var(--mut)]">{c}</td>
                    <td className="text-[var(--mut)]">{dd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Reveal>

      <Reveal>
        <div className="panel overflow-hidden" style={{ borderColor: 'rgba(58,214,181,0.3)' }}>
          <div className="px-5 py-4 border-b border-[var(--line)] flex flex-wrap items-center gap-3">
            <I n="radar" className="w-4 h-4 text-[var(--teal)]" />
            <h2 className="font-display font-bold text-[17px]">Deployment readiness — honest status</h2>
            <Chip tone="teal">CONSOLE + FULL-STACK SOURCE</Chip>
            <span className="font-mono text-[10.5px] text-[var(--dim)]">every layer now ships in the repo — see paths below</span>
          </div>
          <div className="grid md:grid-cols-2">
            <div className="p-5 border-b md:border-b-0 md:border-r border-[var(--line)]">
              <div className="font-mono text-[10px] tracking-[0.2em] text-[var(--teal)] mb-3">SHIPPED IN THIS REPOSITORY</div>
              <ul className="space-y-2.5 text-[12.5px] text-[var(--mut)] leading-snug">
                {[
                  ['backend/', 'TypeScript/Fastify control plane — sessions, TOTP/WebAuthn/OIDC, RBAC, grant broker, verify-before-store rotation'],
                  ['database/', 'PostgreSQL migrations — 24 tables, UUIDs, FORCE row-level security per tenant'],
                  ['browser-extension/', 'Manifest V3 connector — domain allowlist, isolated-world injection, memory-only grants'],
                  ['connector/', 'Go on-prem bridge — outbound-only mTLS, command + target allowlists, chained local audit'],
                  ['infrastructure/', 'docker-compose dev topology + production k8s manifests (NetworkPolicy default-deny, HPA, PITR) + smoke.mjs end-to-end gate + dev PKI generator'],
                  ['tests/ + backend/tests/', 'Vitest security suites — replay, IDOR, reveal, tenant isolation, chain integrity, cookie hardening'],
                  ['.github/workflows/', 'CI: engine suite → backend compile + migrate + seed + API suite on real Postgres/Redis → connector vet/build → extension bundle'],
                  ['docs/', 'Architecture, 15-threat model, API reference (incl. the routes that do not exist), deployment & DR runbook'],
                ].map(([p, s]) => <li key={p} className="flex gap-2.5"><span className="text-[var(--teal)] shrink-0 mt-0.5"><I n="check" className="w-3.5 h-3.5" sw={2.4} /></span><span><span className="font-mono text-[11.5px] text-[var(--teal)]">{p}</span> {s}</span></li>)}
              </ul>
            </div>
            <div className="p-5">
              <div className="font-mono text-[10px] tracking-[0.2em] text-[var(--amber)] mb-3">REMAINING TO GO LIVE</div>
              <ul className="space-y-2.5 text-[12.5px] text-[var(--mut)] leading-snug">
                {[
                  'Provision a cloud account: VPC subnets, RDS multi-AZ, Redis HA, and an HSM-backed KMS master key per tenant',
                  'Key ceremony + secret-manager wiring (External Secrets Operator) — no plaintext config anywhere',
                  'This console still simulates the cloud in-browser (demo auth shows the TOTP code); point it at the real API to go live',
                  'First green CI run + `node infrastructure/smoke.mjs` against the booted compose stack (the deploy gate)',
                  'Independent penetration test, monitoring/alerting, and the DR game-day before first customer data',
                ].map((s) => <li key={s} className="flex gap-2.5"><span className="text-[var(--amber)] shrink-0 mt-0.5"><I n="alert" className="w-3.5 h-3.5" /></span>{s}</li>)}
              </ul>
            </div>
          </div>
          <div className="px-5 py-3 border-t border-[var(--line)] font-mono text-[10.5px] text-[var(--dim)]">
            verdict: <span className="text-[var(--teal)]">source-complete</span> — deploy the console today, stand up the stack with
            <span className="text-[var(--sky)]"> docker compose up</span> · <span className="text-[var(--amber)]">production gate</span> = cloud provisioning + key ceremony + pentest
          </div>
        </div>
      </Reveal>

      <div className="grid lg:grid-cols-3 gap-4">
        <Reveal>
          <div className="panel p-5 h-full">
            <h3 className="font-display font-semibold text-[15px] mb-3 flex items-center gap-2"><I n="globe" className="w-4 h-4 text-[var(--teal)]" /> Cloud-only by contract</h3>
            <ul className="space-y-2 text-[12.5px] text-[var(--mut)] leading-snug">
              <li className="flex gap-2"><span className="text-[var(--red)]">✗</span> no PAM servers, databases, or vaults installed by customers</li>
              <li className="flex gap-2"><span className="text-[var(--teal)]">✓</span> customer needs: a browser, internet, optional connector for private networks</li>
              <li className="flex gap-2"><span className="text-[var(--teal)]">✓</span> provider operates: identity, vault, gateway, KMS, audit, HA</li>
              <li className="flex gap-2"><span className="text-[var(--teal)]">✓</span> deployable on AWS / Azure / GCP — Docker + Kubernetes manifests</li>
            </ul>
          </div>
        </Reveal>
        <Reveal delay={70}>
          <div className="panel p-5 h-full">
            <h3 className="font-display font-semibold text-[15px] mb-3 flex items-center gap-2"><I n="layers" className="w-4 h-4 text-[var(--sky)]" /> High availability</h3>
            <ul className="space-y-2 text-[12.5px] text-[var(--mut)] leading-snug">
              <li className="flex gap-2"><span className="text-[var(--sky)]">▸</span> multi-AZ API + PAM fleets behind the load balancer</li>
              <li className="flex gap-2"><span className="text-[var(--sky)]">▸</span> PostgreSQL: synchronous replication + PITR (5-min RPO)</li>
              <li className="flex gap-2"><span className="text-[var(--sky)]">▸</span> encrypted, cross-region backups · quarterly DR game-days</li>
              <li className="flex gap-2"><span className="text-[var(--sky)]">▸</span> rolling deploys · health-checked auto-scaling · Redis queues</li>
            </ul>
          </div>
        </Reveal>
        <Reveal delay={140}>
          <div className="panel p-5 h-full">
            <h3 className="font-display font-semibold text-[15px] mb-3 flex items-center gap-2"><I n="db" className="w-4 h-4 text-[var(--gold)]" /> Schema surface</h3>
            <div className="flex flex-wrap gap-1.5">
              {['tenants', 'users', 'groups', 'roles', 'permissions', 'user_roles', 'collections', 'credentials', 'credential_versions', 'applications', 'application_credentials', 'access_policies', 'access_requests', 'approvals', 'sessions', 'session_events', 'audit_events', 'connectors', 'devices', 'mfa_methods', 'api_keys', 'encryption_keys', 'rotation_jobs', 'notifications'].map((t) => (
                <span key={t} className="chip !text-[9.5px]">{t}</span>
              ))}
            </div>
            <p className="font-mono text-[10px] text-[var(--dim)] mt-3">UUID PKs · FKs · tenant-scoped indexes · soft deletes · created/updated stamps</p>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
