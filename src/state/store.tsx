import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { pam } from '../engine/pam';
import type { SessionRec, SessionUser, Snapshot } from '../engine/types';

export type Phase = 'login' | 'mfa' | 'console';
export type Route =
  | 'dashboard' | 'how' | 'launcher' | 'vault' | 'access' | 'users'
  | 'security' | 'reports' | 'architecture' | 'settings';

export interface Toast { id: number; msg: string; tone: 'teal' | 'red' | 'amber' | 'sky' }

interface MfaCtx { mfaToken: string; expectedCode: string; user: SessionUser | { name: string; email: string } }

interface Ctx {
  phase: Phase;
  user: SessionUser | null;
  route: Route;
  setRoute: (r: Route) => void;
  snap: Snapshot;
  tick: number;
  toasts: Toast[];
  toast: (msg: string, tone?: Toast['tone']) => void;
  mfaCtx: MfaCtx | null;
  beginLogin: (email: string, password: string) => void;
  beginSso: (p: 'GOOGLE' | 'ENTRA') => void;
  verifyMfa: (code: string) => void;
  logout: () => void;
  switchPersona: (userId: string) => void;
  liveSession: SessionRec | null;
  openLiveSession: (s: SessionRec) => void;
  closeLiveSession: () => void;
}

const PamCtx = createContext<Ctx | null>(null);

export function PamProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('login');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [route, setRoute] = useState<Route>('dashboard');
  const [mfaCtx, setMfaCtx] = useState<MfaCtx | null>(null);
  const [snap, setSnap] = useState<Snapshot>(() => pam.snapshot());
  const [tick, setTick] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [liveSession, setLiveSession] = useState<SessionRec | null>(null);
  const toastId = useRef(0);

  useEffect(() => pam.subscribe(() => setSnap(pam.snapshot())), []);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const toast = useCallback((msg: string, tone: Toast['tone'] = 'teal') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, msg, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const beginLogin = useCallback((email: string, password: string) => {
    const res = pam.login(email, password);
    setMfaCtx({ mfaToken: res.mfaToken, expectedCode: res.expectedCode, user: res.user });
    setPhase('mfa');
  }, []);

  const beginSso = useCallback((p: 'GOOGLE' | 'ENTRA') => {
    const u = pam.sso(p);
    setUser(u);
    setPhase('console');
    setRoute('dashboard');
    toast(`Signed in via ${p === 'GOOGLE' ? 'Google Workspace' : 'Microsoft Entra'} SSO — tenant derived from token`, 'teal');
  }, [toast]);

  const verifyMfa = useCallback((code: string) => {
    if (!mfaCtx) return;
    const u = pam.verifyTotp(mfaCtx.mfaToken, code);
    setUser(u);
    setMfaCtx(null);
    setPhase('console');
    setRoute('dashboard');
    toast(`Welcome back, ${u.name.split(' ')[0]} — session bound to this device`, 'teal');
  }, [mfaCtx, toast]);

  const logout = useCallback(() => {
    pam.logout();
    setUser(null);
    setLiveSession(null);
    setPhase('login');
  }, []);

  const switchPersona = useCallback((userId: string) => {
    const u = pam.switchPersona(userId);
    setUser(u);
    setPhase('console');
    setRoute('dashboard');
    setLiveSession(null);
    toast(`Re-authenticated as ${u.name} (${u.role.replace('_', ' ')})`, 'sky');
  }, [toast]);

  const openLiveSession = useCallback((s: SessionRec) => setLiveSession(s), []);
  const closeLiveSession = useCallback(() => setLiveSession(null), []);

  const value = useMemo<Ctx>(() => ({
    phase, user, route, setRoute, snap, tick, toasts, toast, mfaCtx,
    beginLogin, beginSso, verifyMfa, logout, switchPersona,
    liveSession, openLiveSession, closeLiveSession,
  }), [phase, user, route, snap, tick, toasts, toast, mfaCtx, beginLogin, beginSso, verifyMfa, logout, switchPersona, liveSession, openLiveSession, closeLiveSession]);

  return <PamCtx.Provider value={value}>{children}</PamCtx.Provider>;
}

export function usePam(): Ctx {
  const ctx = useContext(PamCtx);
  if (!ctx) throw new Error('usePam outside provider');
  return ctx;
}

/* toast colors */
export const toastTone: Record<Toast['tone'], string> = {
  teal: 'var(--teal)', red: 'var(--red)', amber: 'var(--amber)', sky: 'var(--sky)',
};
