import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createWorkspace, mergeWorkspace, STORAGE_KEY } from './lib/domain.js';
import { apiRequest } from './lib/supabase.js';
import { useAuth } from './auth.jsx';

const Context = createContext();
const memoryStorage = { getItem: () => null, setItem: () => { throw Error('Storage blocked'); }, removeItem: () => {} };
function browserStorage() { try { return window.localStorage; } catch { return memoryStorage; } }
function loadLocal() {
  try { const raw = browserStorage().getItem(STORAGE_KEY); return raw ? mergeWorkspace(JSON.parse(raw)) : createWorkspace(); }
  catch { return createWorkspace(); }
}

export function WorkspaceProvider({ children }) {
  const { session, ready: authReady } = useAuth();
  const [workspace, setWorkspace] = useState(loadLocal);
  const [storageError, setStorageError] = useState('');
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const authenticated = Boolean(session?.access_token && !session?.isDemo);

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    const load = async () => {
      setWorkspaceReady(false); setStorageError('');
      setWorkspace(loadLocal());
      try {
        if (!authenticated) return;
        const result = await apiRequest('/api/settings');
        if (cancelled) return;
        const remote = result?.workspace;
        if (remote) {
          setWorkspace(current => ({
            ...current,
            business: {
              ...current.business,
              name: current.business.name || remote.name || '',
              area: current.business.area || remote.address || '',
            },
          }));
        }
      } catch (error) {
        if (!cancelled) setStorageError(`Workspace backend tidak dapat dimuat: ${error.message}`);
      } finally { if (!cancelled) setWorkspaceReady(true); }
    };
    load();
    return () => { cancelled = true; };
  }, [authReady, authenticated, session?.access_token]);

  const patch = useCallback((section, values) => setWorkspace((prev) => {
    const next = typeof values === 'function' ? values(prev[section]) : { ...prev[section], ...values };
    const changed = JSON.stringify(prev[section]) !== JSON.stringify(next);
    return { ...prev, [section]: next, ...(['business', 'brand', 'campaign', 'meta'].includes(section) && changed && prev.execution.status !== 'draft' ? { execution: { ...prev.execution, status: 'draft', progress: 0, receiptId: null, approvedSnapshot: null } } : {}) };
  }), []);

  useEffect(() => {
    if (!authReady || !workspaceReady) return;
    try { browserStorage().setItem(STORAGE_KEY, JSON.stringify(workspace)); setStorageError(''); }
    catch { setStorageError('Penyimpanan browser penuh atau diblokir.'); }
  }, [workspace, authReady, workspaceReady]);

  useEffect(() => {
    const handle = (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try { setWorkspace(mergeWorkspace(JSON.parse(event.newValue))); } catch { setStorageError('Perubahan dari tab lain tidak dapat dibaca.'); }
    };
    window.addEventListener('storage', handle); return () => window.removeEventListener('storage', handle);
  }, [authenticated]);

  const reset = useCallback(async () => {
    browserStorage().removeItem(STORAGE_KEY);
    setWorkspace(createWorkspace()); setStorageError('');
  }, []);
  const importWorkspace = useCallback((value) => {
    const next = mergeWorkspace(value);
    browserStorage().setItem(STORAGE_KEY, JSON.stringify(next));
    setWorkspace(next); setStorageError('');
  }, []);
  return <Context.Provider value={{ workspace, patch, setWorkspace, storageError, reset, importWorkspace, workspaceReady, connected: authenticated }}>{children}</Context.Provider>;
}
export const useWorkspace = () => useContext(Context);
