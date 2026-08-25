import type { ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  shield: <path d="M12 3l7 2.6v5.2c0 4.6-3 8.4-7 10.2-4-1.8-7-5.6-7-10.2V5.6L12 3z M9 12l2.2 2.2L15.5 9.7" />,
  shieldX: <path d="M12 3l7 2.6v5.2c0 4.6-3 8.4-7 10.2-4-1.8-7-5.6-7-10.2V5.6L12 3z M9.8 9.8l4.4 4.4 M14.2 9.8l-4.4 4.4" />,
  key: <path d="M14.5 3.5a6 6 0 0 0-5.9 7L3 16.1V21h4.9l1.4-1.4v-2.2h2.2l1.2-1.2a6 6 0 1 0 1.8-12.7z M15.5 8.5h.01" />,
  vault: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="12" cy="12" r="3.4" /><path d="M12 8.6V6.8 M12 17.2v-1.8 M15.4 12h1.8 M6.8 12h1.8" /></>,
  launch: <path d="M5 15l-1.5 5.5L9 19 M14 4c3.5-.5 6 2 5.5 5.5L13 16l-5-5L14 4z M9.5 14.5L7 17 M12.5 8.5h.01" />,
  radar: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12l6-6.5" /><path d="M12 3v2 M21 12h-2 M12 21v-2 M3 12h2" /></>,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.2" /></>,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 20c.6-3.4 2.8-5.3 5.5-5.3s4.9 1.9 5.5 5.3" /><path d="M15.5 5.8a3.2 3.2 0 0 1 0 5.4 M17.6 14.9c1.6.8 2.6 2.5 2.9 5.1" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="1.8" /><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7 M12 14.5v2" /></>,
  unlock: <><rect x="5" y="10.5" width="14" height="9.5" rx="1.8" /><path d="M8 10.5V7.8a4 4 0 0 1 7.8-1.2 M12 14.5v2" /></>,
  eye: <><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  eyeOff: <><path d="M4 4l16 16 M9.9 5.2A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17.5 17.5 0 0 1-3 3.9 M6.1 8.3A16.9 16.9 0 0 0 2.5 12S6 19 12 19a9.3 9.3 0 0 0 3.5-.7" /><path d="M9.5 9.8a2.9 2.9 0 0 0 4 4.1" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  check: <path d="M4.5 12.5l5 5L19.5 7" />,
  x: <path d="M6 6l12 12 M18 6L6 18" />,
  bolt: <path d="M13 2.5L4.5 13.5H11l-1 8L18.5 10H12l1-7.5z" />,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17 M12 3.5c-2.5 2.3-3.8 5.2-3.8 8.5s1.3 6.2 3.8 8.5c2.5-2.3 3.8-5.2 3.8-8.5S14.5 5.8 12 3.5z" /></>,
  server: <><rect x="3.5" y="4" width="17" height="6.5" rx="1.5" /><rect x="3.5" y="13.5" width="17" height="6.5" rx="1.5" /><path d="M7 7.2h.01 M7 16.7h.01 M11 7.2h3 M11 16.7h3" /></>,
  db: <><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" /><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13 M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" /></>,
  terminal: <><rect x="3" y="4.5" width="18" height="15" rx="1.8" /><path d="M7 9l3 3-3 3 M12.5 15.5H17" /></>,
  doc: <><path d="M6 3h8l4 4v14H6V3z M14 3v4h4" /><path d="M9 12h6 M9 15.5h6" /></>,
  filter: <path d="M4 5h16l-6.2 7.2V19l-3.6-2v-4.8L4 5z" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" /></>,
  bell: <><path d="M6 9.5a6 6 0 0 1 12 0c0 5 1.8 6.2 1.8 6.2H4.2S6 14.5 6 9.5z" /><path d="M10 19a2.2 2.2 0 0 0 4 0" /></>,
  chevR: <path d="M9 5.5l6.5 6.5L9 18.5" />,
  chevD: <path d="M5.5 9l6.5 6.5L18.5 9" />,
  plus: <path d="M12 5v14 M5 12h14" />,
  refresh: <><path d="M4.5 12a7.5 7.5 0 0 1 13-5.2L20 9.5 M19.5 12a7.5 7.5 0 0 1-13 5.2L4 14.5" /><path d="M20 4.5v5h-5 M4 19.5v-5h5" /></>,
  fingerprint: <><path d="M7 5.1A8.6 8.6 0 0 1 12 3.5a8.6 8.6 0 0 1 5 1.6 M4.8 8.6a8.7 8.7 0 0 0-.8 3.7c0 2.8-.6 4.6-1.5 6 M19.5 8.9c.3.9.5 2 .5 3.4 0 2.5-.4 4.7-1.2 6.7" /><path d="M12 7.5a4.6 4.6 0 0 0-4.6 4.6c0 2.8-.5 4.9-1.4 6.6 M16.6 12.2c0 3-.4 5.6-1.3 7.8 M12 11.5c0 3.6-.7 6.4-2 8.6" /></>,
  tunnel: <><path d="M4 19v-7a8 8 0 0 1 16 0v7" /><path d="M8 19v-6.5a4 4 0 0 1 8 0V19 M2.5 19h19" /></>,
  ext: <><path d="M9 3.5h6v4.2a2.3 2.3 0 1 0 4.6 0V7H21v6h-3.2a2.3 2.3 0 1 0 0 4.6H21V21h-6v-3.4a2.3 2.3 0 1 0-4.6 0V21H4v-6.5" /></>,
  chip: <><rect x="7" y="7" width="10" height="10" rx="1.6" /><path d="M10 2.5V7 M14 2.5V7 M10 17v4.5 M14 17v4.5 M2.5 10H7 M2.5 14H7 M17 10h4.5 M17 14h4.5" /></>,
  arrowR: <path d="M4 12h15 M13 6l6 6-6 6" />,
  logout: <><path d="M14 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H14" /><path d="M10 12h10.5 M17 8.5l3.5 3.5-3.5 3.5" /></>,
  download: <><path d="M12 3.5V15 M7.5 10.5L12 15l4.5-4.5" /><path d="M4 17.5V20h16v-2.5" /></>,
  copy: <><rect x="8.5" y="8.5" width="12" height="12" rx="1.6" /><path d="M15.5 5.5v-1A1.5 1.5 0 0 0 14 3H5A1.5 1.5 0 0 0 3.5 4.5v9A1.5 1.5 0 0 0 5 15h1" /></>,
  layers: <><path d="M12 3l9 4.8-9 4.8-9-4.8L12 3z" /><path d="M3.6 12.4L12 16.9l8.4-4.5 M3.6 16.6L12 21l8.4-4.4" /></>,
  org: <><rect x="4" y="3.5" width="16" height="17" rx="1.5" /><path d="M8 7.5h2 M14 7.5h2 M8 11.5h2 M14 11.5h2 M10 20.5v-4h4v4" /></>,
  plug: <><path d="M9 3.5V8 M15 3.5V8 M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0V8z" /><path d="M12 17v3.5" /></>,
  alert: <><path d="M12 3.5L22 20H2L12 3.5z" /><path d="M12 10v4.5 M12 17.2h.01" /></>,
  history: <><path d="M3.5 12a8.5 8.5 0 1 1 2.5 6 M3.5 12H7 M3.5 12V8.5" /><path d="M12 7.5V12l3 2" /></>,
  slash: <><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></>,
  play: <path d="M7 4.5l12 7.5-12 7.5v-15z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  wifi: <><path d="M2.5 9a15 15 0 0 1 19 0 M5.5 12.5a10.5 10.5 0 0 1 13 0 M8.5 16a6 6 0 0 1 7 0" /><path d="M12 19.5h.01" /></>,
  rotate: <><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 3.5V8h-4.5" /></>,
  gate: <><path d="M4 20V9l8-5 8 5v11" /><path d="M4 20h16 M9 20v-6h6v6 M12 4v2" /></>,
  scan: <><path d="M3.5 8V5A1.5 1.5 0 0 1 5 3.5h3 M16 3.5h3A1.5 1.5 0 0 1 20.5 5v3 M20.5 16v3a1.5 1.5 0 0 1-1.5 1.5h-3 M8 20.5H5A1.5 1.5 0 0 1 3.5 19v-3" /><path d="M3.5 12h17" /></>,
};

export function I({ n, className = 'w-[18px] h-[18px]', sw = 1.7 }: { n: keyof typeof P & string; className?: string; sw?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {P[n]}
    </svg>
  );
}

export type IconName = keyof typeof P;

/* Brand mark: rail + keyhole */
export function BrandMark({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <rect x="2" y="2" width="36" height="36" rx="9" stroke="var(--gold)" strokeWidth="2" />
      <path d="M10 27V13a10 10 0 0 1 20 0v14" stroke="var(--gold)" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="20" cy="19" r="4" fill="var(--teal)" />
      <path d="M20 22v6" stroke="var(--teal)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
