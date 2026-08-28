/**
 * Keyrail PAM - Real Login Screen
 * 
 * This replaces the simulated login with real API calls.
 * NO hardcoded users. NO demo passwords. NO persona switching.
 */
import { useEffect, useState, useCallback } from 'react';
import { usePam } from '../state/store-new';
import { BrandMark } from '../components/icons';

// Removed: PERSONAS, demo data, simulated telemetry

export default function Login() {
  const { 
    beginLogin, 
    beginSso, 
    verifyMfa, 
    mfaCtx, 
    loading,
    checkInitialSetup
  } = usePam();
  
  const [method, setMethod] = useState<'password' | 'sso'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [shake, setShake] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  // Check if system needs setup on mount
  useEffect(() => {
    checkInitialSetup();
  }, [checkInitialSetup]);

  const fail = useCallback((m: string) => {
    setErr(m);
    setShake(true);
    window.setTimeout(() => setShake(false), 500);
  }, []);

  const submitPw = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    
    if (!email.trim() || !password.trim()) {
      fail('Please enter both email and password');
      setBusy(false);
      return;
    }
    
    try {
      await beginLogin(email, password);
    } catch (ex) {
      fail(ex instanceof Error ? ex.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }, [beginLogin, email, password, fail]);

  const submitMfa = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    
    if (!code.trim() || code.length !== 6) {
      fail('Please enter a valid 6-digit code');
      setBusy(false);
      return;
    }
    
    try {
      await verifyMfa(code);
    } catch (ex) {
      fail(ex instanceof Error ? ex.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }, [verifyMfa, code, fail]);

  const doSso = useCallback((p: 'GOOGLE' | 'ENTRA') => {
    setBusy(true);
    beginSso(p);
  }, [beginSso]);

  // Show MFA form if MFA is required
  if (mfaCtx) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-8 border border-slate-700/50 animate-fade-in">
            <div className="text-center mb-8">
              <div className="text-4xl mb-4">🔐</div>
              <h1 className="text-2xl font-bold text-white">MFA Required</h1>
              <p className="text-slate-400 mt-2">
                Enter the 6-digit code from your authenticator app
              </p>
            </div>

            {err && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-sm text-red-400">{err}</p>
              </div>
            )}

            <form onSubmit={submitMfa} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Verification Code
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  maxLength={6}
                  autoFocus
                  className={`w-full px-4 py-3 rounded-lg bg-slate-700/50 border ${
                    err ? 'border-red-500' : 'border-slate-600'
                  } text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 text-center text-xl tracking-widest font-mono`}
                />
              </div>

              <button
                type="submit"
                disabled={busy || loading}
                className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-800 text-white font-medium py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
              >
                {busy || loading ? 'Verifying...' : 'Verify & Login'}
              </button>

              <button
                type="button"
                onClick={() => { setCode(''); setErr(''); }}
                className="w-full text-sm text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-8 border border-slate-700/50 animate-fade-in">
          <div className="text-center mb-8">
            <div className="text-4xl mb-4">🔐</div>
            <h1 className="text-2xl font-bold text-white">Keyrail PAM</h1>
            <p className="text-slate-400 mt-2">
              Use the account. Never see the secret.
            </p>
          </div>

          <div className="flex justify-center gap-2 mb-6">
            <button
              onClick={() => setMethod('password')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                method === 'password'
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              Password
            </button>
            <button
              onClick={() => setMethod('sso')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                method === 'sso'
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              SSO
            </button>
          </div>

          {err && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg animate-shake">
              <p className="text-sm text-red-400">{err}</p>
            </div>
          )}

          {method === 'password' ? (
            <form onSubmit={submitPw} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourcompany.com"
                  autoComplete="email"
                  autoFocus
                  className={`w-full px-4 py-3 rounded-lg bg-slate-700/50 border ${
                    err ? 'border-red-500' : 'border-slate-600'
                  } text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500`}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className={`w-full px-4 py-3 rounded-lg bg-slate-700/50 border ${
                    err ? 'border-red-500' : 'border-slate-600'
                  } text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500`}
                />
              </div>

              <button
                type="submit"
                disabled={busy || loading}
                className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-800 text-white font-medium py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
              >
                {busy || loading ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Logging in...
                  </>
                ) : (
                  'Login'
                )}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-center text-sm text-slate-400">
                Sign in using your identity provider
              </p>
              
              <button
                onClick={() => doSso('GOOGLE')}
                disabled={busy || loading}
                className="w-full bg-white text-slate-900 font-medium py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-3 hover:bg-slate-100"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Sign in with Google
              </button>

              <button
                onClick={() => doSso('ENTRA')}
                disabled={busy || loading}
                className="w-full bg-slate-700 text-white font-medium py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-3 hover:bg-slate-600"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.69 7.45c.37-.27.6-.7.6-1.14C19.29 4.91 17.33 3 14.79 3 12.25 3 10.16 4.91 10.16 7.45c0 .44.23.87.6 1.14.37.27.88.38 1.4.23.52-.15 1.08-.07 1.58.23.5.3.83.78.83 1.4v.03c0 .62-.34 1.17-.87 1.58-.53.41-1.14.64-1.83.64-.69 0-1.32-.23-1.83-.64-.53-.41-.87-.96-.87-1.58v-.03c0-.62.34-1.17.87-1.58.53-.41 1.14-.64 1.83-.64.69 0 1.32.23 1.83.64.53.41.87.96.87 1.58v.03c0 .62-.34 1.17-.87 1.58-.53.41-1.14.64-1.83.64-.69 0-1.32-.23-1.83-.64-.53-.41-.87-.96-.87-1.58v-.85c0-2.25 1.5-4.15 3.5-4.15.88 0 1.7.28 2.35.73.65.45 1.12 1.06 1.4 1.82.28.76.28 1.65.01 2.41-.27.76-.78 1.37-1.48 1.82-.7.45-1.58.73-2.55.73-1.98 0-3.62-1.9-3.62-4.35 0-1.24.48-2.35 1.2-3.22C9.16 8.03 8.63 7.45 8.01 6.75c-.62-.7-1.01-1.55-1.01-2.55 0-.99.36-1.87 1.01-2.55.62-.7 1.15-1.28 1.81-1.65.66-.37 1.41-.56 2.25-.56.84 0 1.69.19 2.41.56.72.37 1.25.95 1.58 1.65.33.7.49 1.51.49 2.41 0 .9-.16 1.7-.49 2.41z"/>
                </svg>
                Sign in with Microsoft Entra
              </button>
            </div>
          )}

          <div className="mt-6 text-center">
            <button
              onClick={() => setMethod(method === 'password' ? 'sso' : 'password')}
              className="text-sm text-slate-400 hover:text-white transition-colors"
            >
              {method === 'password' ? 'Use SSO instead' : 'Use password instead'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
