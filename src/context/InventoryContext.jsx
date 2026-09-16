import { createContext, useContext, useReducer, useEffect, useCallback, useState } from 'react';
import * as queries from '../db/queries.js';
import { startSync, syncNow, pendingCount } from '../db/sync.js';

const InventoryContext = createContext(null);

const initial = { items: [], loading: true, error: '' };

function reducer(state, action) {
  switch (action.type) {
    case 'loading':
      return { ...state, loading: true, error: '' };
    case 'loaded':
      return { items: action.items, loading: false, error: '' };
    case 'error':
      return { ...state, loading: false, error: action.error };
    default:
      return state;
  }
}

export function InventoryProvider({ householdId, children }) {
  const [state, dispatch] = useReducer(reducer, initial);

  const [sync, setSync] = useState({ state: 'idle', pending: 0, lastSyncedAt: null, message: '' });

  const refreshPending = useCallback(async () => {
    const pending = await pendingCount();
    setSync((s) => ({ ...s, pending }));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const items = await queries.listItems(householdId);
      dispatch({ type: 'loaded', items });
    } catch (e) {
      dispatch({ type: 'error', error: e.message || String(e) });
    }
  }, [householdId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A cycle can bring in another device's items, so the list is re-derived
  // after every sync rather than only after local writes.
  useEffect(() => {
    const stop = startSync(householdId, {
      onCycle: async (result) => {
        setSync((s) => ({
          ...s,
          state: result.ok ? 'idle' : result.reason === 'offline' ? 'offline' : 'error',
          message: result.message || '',
          lastSyncedAt: result.ok ? new Date().toISOString() : s.lastSyncedAt
        }));
        if (result.ok && (result.items || result.events)) await refresh();
        await refreshPending();
      }
    });
    return stop;
  }, [householdId, refresh, refreshPending]);

  // Each action writes, then re-derives from the log rather than patching
  // local state — so what's on screen is always what the events add up to.
  // Local writes land instantly; the push happens behind them. A failure here
  // is not an error the user needs to see — the row stays queued and retries.
  const afterWrite = useCallback(async () => {
    await refreshPending();
    setSync((s) => ({ ...s, state: 'syncing' }));
    const r = await syncNow(householdId);
    setSync((s) => ({
      ...s,
      state: r.ok ? 'idle' : r.reason === 'offline' ? 'offline' : 'error',
      lastSyncedAt: r.ok ? new Date().toISOString() : s.lastSyncedAt
    }));
    await refreshPending();
  }, [householdId, refreshPending]);

  const addItem = useCallback(
    async (fields) => {
      await queries.addItem(householdId, fields);
      await refresh();
      void afterWrite();
    },
    [householdId, refresh]
  );

  const logAmount = useCallback(
    async (itemId, amount) => {
      await queries.logAmount(householdId, itemId, amount);
      await refresh();
      void afterWrite();
    },
    [householdId, refresh]
  );

  const undoLast = useCallback(
    async (itemId) => {
      await queries.undoLast(householdId, itemId);
      await refresh();
      void afterWrite();
    },
    [householdId, refresh]
  );

  const markEmpty = useCallback(
    async (itemId) => {
      await queries.markEmpty(householdId, itemId);
      await refresh();
      void afterWrite();
    },
    [householdId, refresh]
  );

  const removeItem = useCallback(
    async (itemId) => {
      await queries.removeItem(householdId, itemId);
      await refresh();
      void afterWrite();
    },
    [householdId, refresh]
  );

  const updateItem = useCallback(
    async (itemId, changes) => {
      await queries.updateItem(householdId, itemId, changes);
      await refresh();
      void afterWrite();
    },
    [householdId, refresh]
  );

  const clearAllItems = useCallback(
    async () => {
      const count = await queries.clearAllItems(householdId);
      await refresh();
      void afterWrite();
      return count;
    },
    [householdId, refresh]
  );

  // Dev fixture. `import.meta.env.DEV` is false in a production build, so the
  // whole thing — button, data table and all — is dropped at build time.
  const loadSample = useCallback(
    async () => {
      const { loadSampleFridge } = await import('../dev/sampleFridge.js');
      const count = await loadSampleFridge(householdId, queries);
      await refresh();
      void afterWrite();
      return count;
    },
    [householdId, refresh]
  );

  const resetIntake = useCallback(
    async () => {
      const count = await queries.resetIntake(householdId);
      await refresh();
      void afterWrite();
      return count;
    },
    [householdId, refresh]
  );

  const value = {
    ...state, householdId, sync,
    addItem, logAmount, undoLast, markEmpty, removeItem, updateItem, refresh,
    clearAllItems, resetIntake, loadSample,
    syncNow: () => afterWrite()
  };
  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

export function useInventory() {
  const ctx = useContext(InventoryContext);
  if (!ctx) throw new Error('useInventory must be used inside <InventoryProvider>');
  return ctx;
}
