import { useInventory } from '../context/InventoryContext.jsx';

/**
 * Says what sync is doing, and only when it is worth saying.
 *
 * Offline is not an error state here: writes land locally and go up later, so
 * the wording says what will happen rather than what failed.
 */
export default function SyncStatus() {
  const { sync, syncNow } = useInventory();
  const { state, pending, lastSyncedAt } = sync;

  if (state === 'idle' && pending === 0) {
    return (
      <button className="link-button" onClick={syncNow} title={lastSyncedAt || ''}>
        {lastSyncedAt ? `Synced ${relative(lastSyncedAt)}` : 'Sync'}
      </button>
    );
  }

  const text =
    state === 'syncing'
      ? 'Syncing…'
      : state === 'offline'
        ? `Offline · ${pending} waiting`
        : state === 'error'
          ? `Sync failed · ${pending} waiting`
          : `${pending} waiting to sync`;

  return (
    <button className={`link-button${state === 'error' ? ' danger-text' : ''}`} onClick={syncNow}>
      {text}
    </button>
  );
}

function relative(iso) {
  const secs = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}
