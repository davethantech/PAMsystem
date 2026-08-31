import { useEffect, useRef, useState, type ReactNode } from 'react';
import { I } from './icons';

export const REDUCED_MOTION = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- time helpers ---------- */
export const fmtClock = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const fmtHM = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const timeAgo = (ts: number) => {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};
export const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};
export const fmtCountdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/* ---------- scroll reveal ---------- */
export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { el.classList.add('in'); io.disconnect(); }
    }, { threshold: 0.08 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

/* ---------- scramble-decode text ---------- */
const GLYPHS = '▚▞#%&$@≠∆0123456789ABCDEF';
export function useDecode(text: string, speed = 26) {
  const [out, setOut] = useState(REDUCED_MOTION ? text : '');
  useEffect(() => {
    if (REDUCED_MOTION) { setOut(text); return; }
    let frame = 0;
    const total = text.length;
    const id = window.setInterval(() => {
      frame++;
      const settled = Math.floor(frame / 2.2);
      let s = '';
      for (let i = 0; i < total; i++) {
        if (i < settled) s += text[i];
        else if (text[i] === ' ') s += ' ';
        else s += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      setOut(s);
      if (settled >= total) window.clearInterval(id);
    }, speed);
    return () => window.clearInterval(id);
  }, [text, speed]);
  return out;
}

/* ---------- count-up number ---------- */
export function CountUp({ to, className = '', suffix = '' }: { to: number; className?: string; suffix?: string }) {
  const [v, setV] = useState(REDUCED_MOTION ? to : 0);
  useEffect(() => {
    if (REDUCED_MOTION) { setV(to); return; }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 900);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <span className={className}>{v.toLocaleString()}{suffix}</span>;
}

/* ---------- primitives ---------- */
export function Chip({ tone = '', children, className = '' }: { tone?: string; children: ReactNode; className?: string }) {
  return <span className={`chip ${tone ? `chip-${tone}` : ''} ${className}`}>{children}</span>;
}

export function Dot({ tone = 'var(--teal)', blink = false }: { tone?: string; blink?: boolean }) {
  return <span className={`inline-block w-[7px] h-[7px] rounded-full ${blink ? 'pulse-dot' : ''}`} style={{ background: tone, boxShadow: `0 0 8px ${tone}` }} />;
}

export function Masked({ len = 14, className = '' }: { len?: number; className?: string }) {
  return <span className={`masked-dots ${className}`}>{'•'.repeat(len)}</span>;
}

export function Panel({ title, sub, right, children, className = '', icon }: {
  title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; icon?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-[var(--line)]">
          <div className="flex items-center gap-2.5">
            {icon && <span className="text-[var(--teal)]"><I n={icon} /></span>}
            <div>
              <h3 className="font-display font-semibold text-[15px] tracking-wide">{title}</h3>
              {sub && <p className="text-[12px] text-[var(--mut)] mt-0.5">{sub}</p>}
            </div>
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Modal({ open, isOpen, onClose, title, children, width = 560, size, tone }: {
  open?: boolean; isOpen?: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number; size?: string; tone?: 'red' | 'amber' | 'teal';
}) {
  const isModalOpen = open ?? isOpen ?? false;
  let resolvedWidth = width;
  if (size === 'lg') resolvedWidth = 720;
  else if (size === 'xl') resolvedWidth = 900;
  else if (size === 'sm') resolvedWidth = 440;

  useEffect(() => {
    if (!isModalOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isModalOpen, onClose]);
  if (!isModalOpen) return null;
  const bar = tone === 'red' ? 'var(--red)' : tone === 'amber' ? 'var(--amber)' : 'var(--teal)';
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[rgba(4,9,18,0.78)] backdrop-blur-[3px]" onClick={onClose} />
      <div className="relative panel-solid rise-in max-h-[88vh] overflow-y-auto" style={{ width: resolvedWidth, maxWidth: '94vw', borderTop: `2px solid ${bar}` }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
          <h3 className="font-display font-semibold text-[16px]">{title}</h3>
          <button onClick={onClose} className="text-[var(--mut)] hover:text-[var(--ink)] transition-colors cursor-pointer" aria-label="Close">
            <I n="x" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

/* ---------- circular countdown ---------- */
export function CountRing({ remaining, total, size = 64, label }: { remaining: number; total: number; size?: number; label?: string }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, remaining / total));
  const danger = remaining < 10_000;
  const color = danger ? 'var(--red)' : 'var(--teal)';
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(122,160,210,0.15)" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - p)} style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s' }} />
      </svg>
      <span className="absolute font-mono text-[12px] font-semibold" style={{ color }}>{label ?? fmtCountdown(remaining)}</span>
    </div>
  );
}

/* ---------- sparkline ---------- */
export function Spark({ data = [5, 12, 8, 16, 10, 18, 14], tone = 'var(--teal)', h = 42, w = 140, className = '' }: { data?: number[]; tone?: string; h?: number; w?: number; className?: string }) {
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 4 - (v / max) * (h - 10)}`).join(' ');
  return (
    <svg width={w} height={h} className={`overflow-visible ${className}`}>
      <polyline points={pts} fill="none" stroke={tone} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={tone} opacity="0.08" />
      <circle cx={w} cy={h - 4 - (data[data.length - 1] / max) * (h - 10)} r="2.6" fill={tone} />
    </svg>
  );
}

/* ---------- toggle ---------- */
export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button onClick={() => !disabled && onChange(!on)} disabled={disabled} aria-pressed={on}
      className="relative w-[38px] h-[21px] rounded-full transition-colors cursor-pointer disabled:opacity-40"
      style={{ background: on ? 'rgba(58,214,181,0.55)' : 'rgba(122,160,210,0.22)', border: '1px solid var(--line-strong)' }}>
      <span className="absolute top-[2px] w-[15px] h-[15px] rounded-full bg-[var(--ink)] transition-all duration-200"
        style={{ left: on ? 19 : 3 }} />
    </button>
  );
}

/* ---------- status pill ---------- */
export function StatusPill({ status, children }: { status: string; children?: ReactNode }) {
  const map: Record<string, { tone: string; label: string }> = {
    ACTIVE: { tone: 'teal', label: 'ACTIVE' },
    SUCCESS: { tone: 'teal', label: 'SUCCESS' },
    VERIFIED: { tone: 'teal', label: 'VERIFIED' },
    HEALTHY: { tone: 'teal', label: 'HEALTHY' },
    PENDING: { tone: 'amber', label: 'PENDING' },
    DUE: { tone: 'amber', label: 'DUE' },
    MEDIUM: { tone: 'amber', label: 'MEDIUM' },
    APPROVED: { tone: 'teal', label: 'APPROVED' },
    DENIED: { tone: 'red', label: 'DENIED' },
    FAILURE: { tone: 'red', label: 'FAILURE' },
    FAILED: { tone: 'red', label: 'FAILED' },
    TERMINATED: { tone: 'red', label: 'TERMINATED' },
    EXPIRED: { tone: 'red', label: 'EXPIRED' },
    HIGH: { tone: 'red', label: 'HIGH' },
    DISABLED: { tone: '', label: 'DISABLED' },
  };
  const m = map[status] ?? { tone: '', label: status };
  return <Chip tone={m.tone}>{children ?? m.label}</Chip>;
}
