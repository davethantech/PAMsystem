/**
 * Keyrail PAM - Real Vault Screen
 * 
 * This replaces the simulated vault with real data from the API.
 * NO simulated credentials. NO hardcoded data.
 */
import { useMemo, useState, useEffect, useCallback } from 'react';
import { I } from '../components/icons';
import { Chip, Masked, Modal, Reveal, StatusPill, timeAgo } from '../components/ui';
import { usePam } from '../state/store';
import api from '../api/client';
import type { Credential } from '../api/client';

const KIND_ICON: Record<string, string> = { 
  PASSWORD: 'key', 
  API_KEY: 'chip', 
  SSH_KEY: 'terminal', 
  TOKEN: 'bolt', 
  CERT: 'doc', 
  NOTE: 'doc',
  SECRET: 'key'
};

const KIND_LABEL: Record<string, string> = {
  PASSWORD: 'Password',
  API_KEY: 'API Key',
  SSH_KEY: 'SSH Key',
  TOKEN: 'Token',
  CERT: 'Certificate',
  NOTE: 'Secure Note',
  SECRET: 'Secret'
};

export default function Vault() {
  const { user, setRoute, toast } = usePam();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [collections, setCollections] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [col, setCol] = useState('ALL');
  const [selected, setSelected] = useState<Credential | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch credentials and collections
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // Fetch credentials
        const creds = await api.credentials.list();
        setCredentials(creds);
        
        // Fetch collections
        const cols = await api.collections.list();
        setCollections(cols);
        
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to load credentials';
        setError(errorMsg);
        toast(errorMsg, 'red');
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchData();
  }, [toast]);

  const isAdmin = ['PAM_ADMIN', 'ORG_ADMIN', 'SUPER_ADMIN', 'SECURITY_ADMIN'].includes(user!.role);

  const list = useMemo(() => credentials.filter((c) => {
    if (col !== 'ALL' && c.collectionId !== col) return false;
    if (q && !`${c.name} ${c.target} ${c.username}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [credentials, q, col]);

  const handleReveal = useCallback(async (credId: string) => {
    try {
      toast('Access request required - secrets are never revealed to the browser', 'amber');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Access denied', 'red');
    }
  }, [toast]);

  const handleLaunch = useCallback((cred: Credential) => {
    setRoute('launcher');
    toast(`Launching ${cred.name} - authentication will be brokered`, 'teal');
  }, [setRoute, toast]);

  const handleDelete = useCallback(async (credId: string, credName: string) => {
    if (!window.confirm(`Delete "${credName}"? This cannot be undone.`)) return;
    
    try {
      await api.credentials.delete(credId);
      setCredentials(prev => prev.filter(c => c.id !== credId));
      toast(`"${credName}" deleted`, 'teal');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'red');
    }
  }, [toast]);

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
        <h3 className="text-xl font-semibold text-white mb-2">Error Loading Vault</h3>
        <p className="text-slate-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-[1180px]">
      <Reveal>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--line)] bg-[rgba(8,16,32,0.6)] w-[260px]">
            <I n="search" className="w-4 h-4 text-[var(--dim)]" />
            <input 
              className="bg-transparent outline-none text-[13px] flex-1" 
              placeholder="Search name, target, account..." 
              value={q} 
              onChange={(e) => setQ(e.target.value)} 
            />
          </div>
          <select 
            className="input !w-[190px] !py-2 text-[13px]" 
            value={col} 
            onChange={(e) => setCol(e.target.value)}
          >
            <option value="ALL">All collections</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <span className="flex-1" />
          <Chip><I n="lock" className="w-3.5 h-3.5" /> AES-256-GCM envelope - KMS-wrapped DEKs</Chip>
          <Chip tone="red"><I n="eyeOff" className="w-3.5 h-3.5" /> plaintext: zero endpoints</Chip>
          {isAdmin && (
            <button 
              className="btn btn-primary btn-sm" 
              onClick={() => setRoute('settings')}
            >
              <I n="plus" className="w-3.5 h-3.5" /> New credential
            </button>
          )}
        </div>
      </Reveal>

      <Reveal delay={50}>
        <div className="panel p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Credentials ({list.length})</h3>
            <div className="font-mono text-[9.5px] text-[var(--dim)]">
              All secrets encrypted - Never transmitted in plaintext
            </div>
          </div>
          
          {list.length === 0 ? (
            <div className="text-center py-12 text-[var(--dim)]">
              <I n="key" className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p>No credentials found</p>
              {isAdmin && (
                <button 
                  className="btn btn-primary mt-4" 
                  onClick={() => setRoute('settings')}
                >
                  <I n="plus" className="w-4 h-4" /> Add your first credential
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)] border-b border-[var(--line)]">
                    <th className="pb-3 pr-4">NAME</th>
                    <th className="pb-3 pr-4">TYPE</th>
                    <th className="pb-3 pr-4">TARGET</th>
                    <th className="pb-3 pr-4">USERNAME</th>
                    <th className="pb-3 pr-4">COLLECTION</th>
                    <th className="pb-3 pr-4">CREATED</th>
                    <th className="pb-3">ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr 
                      key={c.id} 
                      className="border-b border-[var(--line)]/50 hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="py-3 pr-4">
                        <div className="font-medium text-white">{c.name}</div>
                        <div className="font-mono text-[9.5px] text-[var(--dim)]">{c.id.slice(0, 8)}</div>
                      </td>
                      <td className="py-3 pr-4">
                        <Chip tone="teal" className="!text-[9px]">
                          <I n={KIND_ICON[c.kind] || 'key'} className="w-3 h-3 mr-1" />
                          {KIND_LABEL[c.kind] || c.kind}
                        </Chip>
                      </td>
                      <td className="py-3 pr-4 font-mono text-[11px]">{c.target}</td>
                      <td className="py-3 pr-4 font-mono text-[11px]">{c.username}</td>
                      <td className="py-3 pr-4">
                        {collections.find(col => col.id === c.collectionId)?.name || 'N/A'}
                      </td>
                      <td className="py-3 pr-4 font-mono text-[9.5px] text-[var(--dim)]">
                        {timeAgo(c.createdAt)}
                      </td>
                      <td className="py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleLaunch(c)}
                            className="btn btn-ghost btn-xs"
                            title="Launch"
                          >
                            <I n="launch" className="w-3.5 h-3.5" />
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                onClick={() => setSelected(c)}
                                className="btn btn-ghost btn-xs"
                                title="View details"
                              >
                                <I n="eye" className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDelete(c.id, c.name)}
                                className="btn btn-ghost btn-xs text-red-400 hover:text-red-300"
                                title="Delete"
                              >
                                <I n="trash" className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Reveal>

      {selected && (
        <Modal isOpen={!!selected} onClose={() => setSelected(null)} title="Credential Details">
          <div className="space-y-4">
            <div>
              <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">NAME</label>
              <div className="text-white font-medium">{selected.name}</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">TYPE</label>
                <div className="text-white">{KIND_LABEL[selected.kind] || selected.kind}</div>
              </div>
              <div>
                <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">CREATED</label>
                <div className="text-white font-mono text-[11px]">{new Date(selected.createdAt).toLocaleString()}</div>
              </div>
              <div>
                <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">TARGET</label>
                <div className="text-white font-mono text-[11px]">{selected.target}</div>
              </div>
              <div>
                <label className="font-mono text-[9.5px] tracking-[0.16em] text-[var(--dim)]">USERNAME</label>
                <div className="text-white font-mono text-[11px]">{selected.username}</div>
              </div>
            </div>
            <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
              <p className="text-[var(--dim)] text-sm text-center">
                <I n="lock" className="w-4 h-4 inline mr-1" />
                Secret is encrypted and never displayed
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
