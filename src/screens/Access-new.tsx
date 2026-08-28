/**
 * Keyrail PAM - Real Access Control Screen
 * 
 * This replaces the simulated access control with real data from the API.
 * NO simulated requests. NO hardcoded data.
 */
import { useState, useEffect, useCallback } from 'react';
import { I } from '../components/icons';
import { Chip, CountRing, Dot, Modal, Reveal, StatusPill, fmtDur, fmtHM, timeAgo } from '../components/ui';
import { usePam } from '../state/store';
import api from '../api/client';

type Tab = 'requests' | 'approvals' | 'jit' | 'sessions';

export default function Access() {
  const { user, toast, openLiveSession, setRoute } = usePam();
  const [tab, setTab] = useState<Tab>('requests');
  const [requests, setRequests] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isApprover = ['PAM_ADMIN', 'ORG_ADMIN', 'SUPER_ADMIN', 'SECURITY_ADMIN'].includes(user!.role);
  const canTerminate = ['PAM_ADMIN', 'ORG_ADMIN', 'SUPER_ADMIN', 'SECURITY_ADMIN'].includes(user!.role);

  // Fetch access requests and sessions
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // Fetch access requests
        const reqs = await api.accessRequests.list();
        setRequests(reqs);
        
        // Fetch sessions
        const sess = await api.sessions.list();
        setSessions(sess);
        
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to load access data';
        setError(errorMsg);
        toast(errorMsg, 'red');
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchData();
  }, [toast]);

  const pending = requests.filter((r) => r.status === 'PENDING');
  const live = requests.filter((r) => r.status === 'APPROVED' && (r.expiresAt ?? 0) > Date.now());
  const activeSessions = sessions.filter((s) => s.status === 'ACTIVE');

  const handleDecide = useCallback(async (id: string, ok: boolean) => {
    try {
      if (ok) {
        await api.accessRequests.approve(id);
        toast('Approved - JIT window opened and the requester can now launch', 'teal');
      } else {
        await api.accessRequests.deny(id);
        toast('Request denied - event recorded', 'red');
      }
      // Refresh data
      const reqs = await api.accessRequests.list();
      setRequests(reqs);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Action failed', 'red');
    }
  }, [toast]);

  const handleTerminate = useCallback(async (sessionId: string) => {
    try {
      await api.sessions.terminate(sessionId);
      toast('Session terminated', 'teal');
      // Refresh sessions
      const sess = await api.sessions.list();
      setSessions(sess);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Termination failed', 'red');
    }
  }, [toast]);

  const tabs: { k: Tab; label: string; n?: number }[] = [
    { k: 'requests', label: 'Requests', n: requests.length },
    { k: 'approvals', label: 'Approvals', n: pending.length },
    { k: 'jit', label: 'JIT Windows', n: live.length },
    { k: 'sessions', label: 'Active Sessions', n: activeSessions.length },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-500 mb-4">
          <I n="alert" className="w-12 h-12 mx-auto" />
        </div>
        <h3 className="text-xl font-semibold text-white mb-2">Error Loading Access Data</h3>
        <p className="text-slate-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-[1180px]">
      <Reveal>
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`px-4 py-2 rounded-lg font-display font-semibold text-[13px] border transition-all cursor-pointer flex items-center gap-2 ${tab === t.k ? 'border-[rgba(58,214,181,0.5)] text-[var(--teal)] bg-[rgba(58,214,181,0.08)]' : 'border-[var(--line)] text-[var(--mut)] hover:text-[var(--ink)]'}`}>
              {t.label}
              {t.n !== undefined && t.n > 0 && <span className="font-mono text-[10px] px-1.5 rounded-full bg-[rgba(122,160,210,0.12)]">{t.n}</span>}
            </button>
          ))}
          <span className="flex-1" />
          <button className="btn btn-primary btn-sm" onClick={() => setRoute('launcher')}>
            <I n="plus" className="w-3.5 h-3.5" /> New access request
          </button>
        </div>
      </Reveal>

      {/* Tab content */}
      <Reveal delay={50}>
        <div className="panel p-6">
          {tab === 'approvals' && (
            <div>
              <h3 className="font-semibold text-white mb-4">Pending Approvals ({pending.length})</h3>
              {pending.length === 0 ? (
                <div className="text-center py-8 text-[var(--dim)]">
                  <I n="bolt" className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>No pending approvals</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pending.map((r) => (
                    <div key={r.id} className="flex items-center gap-4 p-4 rounded-lg bg-slate-800/50 border border-slate-700/50">
                      <div className="w-10 h-10 rounded-xl bg-slate-700 flex items-center justify-center">
                        <I n="bolt" className="w-5 h-5 text-amber-500" />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-white">{r.credentialName}</div>
                        <div className="font-mono text-[10px] text-[var(--dim)]">
                          Requested by {r.requesterName} - {timeAgo(r.requestedAt)}
                        </div>
                      </div>
                      {isApprover && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleDecide(r.id, true)}
                            className="btn btn-primary btn-xs"
                          >
                            <I n="check" className="w-3.5 h-3.5" /> Approve
                          </button>
                          <button
                            onClick={() => handleDecide(r.id, false)}
                            className="btn btn-ghost btn-xs text-red-400"
                          >
                            <I n="x" className="w-3.5 h-3.5" /> Deny
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'requests' && (
            <div>
              <h3 className="font-semibold text-white mb-4">All Requests ({requests.length})</h3>
              {requests.length === 0 ? (
                <div className="text-center py-8 text-[var(--dim)]">
                  <I n="bolt" className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>No access requests found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {requests.map((r) => (
                    <div key={r.id} className="flex items-center gap-4 p-4 rounded-lg bg-slate-800/50 border border-slate-700/50">
                      <div className="w-10 h-10 rounded-xl bg-slate-700 flex items-center justify-center">
                        <I n={r.status === 'APPROVED' ? 'check' : r.status === 'DENIED' ? 'x' : 'bolt'} 
                           className={`w-5 h-5 ${r.status === 'APPROVED' ? 'text-teal-500' : r.status === 'DENIED' ? 'text-red-500' : 'text-amber-500'}`} 
                        />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-white">{r.credentialName}</div>
                        <div className="font-mono text-[10px] text-[var(--dim)]">
                          {r.requesterName} - {timeAgo(r.requestedAt)}
                        </div>
                      </div>
                      <StatusPill status={r.status}>{r.status}</StatusPill>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'jit' && (
            <div>
              <h3 className="font-semibold text-white mb-4">Active JIT Windows ({live.length})</h3>
              {live.length === 0 ? (
                <div className="text-center py-8 text-[var(--dim)]">
                  <I n="clock" className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>No active JIT windows</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {live.map((r) => (
                    <div key={r.id} className="flex items-center gap-4 p-4 rounded-lg bg-slate-800/50 border border-slate-700/50">
                      <div className="w-10 h-10 rounded-xl bg-slate-700 flex items-center justify-center">
                        <I n="clock" className="w-5 h-5 text-teal-500" />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-white">{r.credentialName}</div>
                        <div className="font-mono text-[10px] text-[var(--dim)]">
                          Approved for {r.requesterName} - Expires {fmtDur(r.expiresAt - Date.now())}
                        </div>
                      </div>
                      {canTerminate && (
                        <button
                          onClick={() => handleDecide(r.id, false)}
                          className="btn btn-ghost btn-xs text-red-400"
                        >
                          <I n="x" className="w-3.5 h-3.5" /> Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'sessions' && (
            <div>
              <h3 className="font-semibold text-white mb-4">Active Sessions ({activeSessions.length})</h3>
              {activeSessions.length === 0 ? (
                <div className="text-center py-8 text-[var(--dim)]">
                  <I n="radar" className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>No active sessions</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeSessions.map((s) => (
                    <div key={s.id} className="flex items-center gap-4 p-4 rounded-lg bg-slate-800/50 border border-slate-700/50">
                      <div className="w-10 h-10 rounded-xl bg-slate-700 flex items-center justify-center">
                        <I n="radar" className="w-5 h-5 text-sky-500" />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-white">{s.applicationName}</div>
                        <div className="font-mono text-[10px] text-[var(--dim)]">
                          {s.userName} - Started {timeAgo(s.startedAt)}
                        </div>
                      </div>
                      {canTerminate && (
                        <button
                          onClick={() => handleTerminate(s.id)}
                          className="btn btn-ghost btn-xs text-red-400"
                        >
                          <I n="x" className="w-3.5 h-3.5" /> Terminate
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Reveal>
    </div>
  );
}
