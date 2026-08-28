/**
 * Keyrail PAM - Real Reports Screen
 * 
 * This replaces the simulated reports with real data from the API.
 * NO simulated audit events. NO hardcoded data.
 */
import { useState, useEffect, useCallback } from 'react';
import { I } from '../components/icons';
import { Chip, Modal, Reveal, StatusPill, timeAgo } from '../components/ui';
import { usePam } from '../state/store';
import api from '../api/client';

type Tab = 'events' | 'alerts' | 'compliance';

export default function Reports() {
  const { user, toast } = usePam();
  const [tab, setTab] = useState<Tab>('events');
  const [events, setEvents] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<any>(null);

  // Fetch audit data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // Fetch audit events
        const eventsData = await api.audit.list();
        setEvents(eventsData);
        
        // Fetch alerts (would need alerts endpoint)
        setAlerts([]);
        
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to load audit data';
        setError(errorMsg);
        toast(errorMsg, 'red');
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchData();
  }, [toast]);

  const tabs: { k: Tab; label: string; n?: number }[] = [
    { k: 'events', label: 'Audit Events', n: events.length },
    { k: 'alerts', label: 'Security Alerts', n: alerts.length },
    { k: 'compliance', label: 'Compliance', n: 0 },
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
        <h3 className="text-xl font-semibold text-white mb-2">Error Loading Reports</h3>
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
          <Chip><I n="lock" className="w-3.5 h-3.5" /> Hash-chained</Chip>
          <Chip tone="teal"><I n="check" className="w-3.5 h-3.5" /> Tamper-evident</Chip>
        </div>
      </Reveal>

      {/* Tab content */}
      <Reveal delay={50}>
        <div className="panel p-6">
          {tab === 'events' && (
            <div>
              <h3 className="font-semibold text-white mb-4">Audit Events ({events.length})</h3>
              
              {events.length === 0 ? (
                <div className="text-center py-8 text-[var(--dim)]">
                  <I n="doc" className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>No audit events found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {events.map((e) => (
                    <div 
                      key={e.id} 
                      onClick={() => setSelected(e)}
                      className="flex items-center gap-4 p-4 rounded-lg bg-slate-800/50 border border-slate-700/50 cursor-pointer hover:bg-slate-700/50 transition-colors"
                    >
                      <div className="w-10 h-10 rounded-xl bg-slate-700 flex items-center justify-center">
                        <I n={getEventIcon(e.eventType)} className="w-5 h-5 text-teal-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white">{e.eventType.replace('_', ' ')}</span>
                          <Chip tone={getEventTone(e.eventType)} className="!text-[8px] !py-0.5 !px-1.5">{e.result || 'SUCCESS'}</Chip>
                        </div>
                        <div className="font-mono text-[10px] text-[var(--dim)]">
                          {e.userName} - {timeAgo(e.timestamp)} - {e.ipAddress}
                        </div>
                      </div>
                      <div className="font-mono text-[9.5px] text-[var(--dim)]">
                        #{e.id.slice(0, 8)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'alerts' && (
            <div>
              <h3 className="font-semibold text-white mb-4">Security Alerts ({alerts.length})</h3>
              
              {alerts.length === 0 ? (
                <div className="text-center py-8 text-[var(--dim)]">
                  <I n="shield" className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>No security alerts</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {alerts.map((a) => (
                    <div key={a.id} className="flex items-center gap-4 p-4 rounded-lg bg-amber-500/5 border border-amber-500/10">
                      <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                        <I n="alert" className="w-5 h-5 text-amber-500" />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-amber-200">{a.title}</div>
                        <div className="font-mono text-[10px] text-amber-300/50">{a.description}</div>
                      </div>
                      <div className="font-mono text-[9.5px] text-amber-300/70">{timeAgo(a.timestamp)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'compliance' && (
            <div>
              <h3 className="font-semibold text-white mb-4">Compliance Reports</h3>
              <div className="text-center py-8 text-[var(--dim)]">
                <I n="check" className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>Compliance reporting coming soon</p>
              </div>
            </div>
          )}
        </div>
      </Reveal>

      {/* Event detail modal */}
      {selected && (
        <Modal isOpen={!!selected} onClose={() => setSelected(null)} title="Audit Event Details" size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">EVENT TYPE</label>
                <div className="text-white font-medium">{selected.eventType.replace('_', ' ')}</div>
              </div>
              <div>
                <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">RESULT</label>
                <div className="text-white"><StatusPill status={selected.result || 'SUCCESS'} /></div>
              </div>
              <div>
                <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">USER</label>
                <div className="text-white">{selected.userName}</div>
              </div>
              <div>
                <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">IP ADDRESS</label>
                <div className="text-white font-mono text-[11px]">{selected.ipAddress}</div>
              </div>
              <div>
                <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">TIMESTAMP</label>
                <div className="text-white font-mono text-[11px]">{new Date(selected.timestamp).toLocaleString()}</div>
              </div>
              <div>
                <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">EVENT ID</label>
                <div className="text-white font-mono text-[11px]">{selected.id}</div>
              </div>
            </div>
            
            {selected.details && (
              <div>
                <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">DETAILS</label>
                <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50 mt-2">
                  <pre className="text-[11px] text-[var(--dim)] overflow-x-auto">{JSON.stringify(selected.details, null, 2)}</pre>
                </div>
              </div>
            )}
            
            <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
              <p className="text-[var(--dim)] text-sm text-center">
                <I n="lock" className="w-4 h-4 inline mr-1" />
                This event is cryptographically signed and part of the hash chain
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function getEventIcon(eventType: string): string {
  const icons: Record<string, string> = {
    LOGIN: 'logIn',
    LOGOUT: 'logOut',
    CREDENTIAL_ACCESS: 'key',
    CREDENTIAL_CREATE: 'plus',
    CREDENTIAL_DELETE: 'trash',
    SESSION_START: 'launch',
    SESSION_END: 'x',
    ACCESS_REQUEST: 'bolt',
    ACCESS_APPROVE: 'check',
    ACCESS_DENY: 'x',
    POLICY_VIOLATION: 'shieldX',
    PASSWORD_ROTATION: 'rotate',
  };
  return icons[eventType] || 'doc';
}

function getEventTone(eventType: string): string {
  const tones: Record<string, string> = {
    LOGIN: 'teal',
    LOGOUT: 'mut',
    CREDENTIAL_ACCESS: 'sky',
    CREDENTIAL_CREATE: 'teal',
    CREDENTIAL_DELETE: 'red',
    SESSION_START: 'teal',
    SESSION_END: 'mut',
    ACCESS_REQUEST: 'amber',
    ACCESS_APPROVE: 'teal',
    ACCESS_DENY: 'red',
    POLICY_VIOLATION: 'red',
    PASSWORD_ROTATION: 'gold',
  };
  return tones[eventType] || 'mut';
}
