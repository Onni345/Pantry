import { useState } from 'react';
import { getApiKey, setApiKey } from '../api/llm.js';
import { useInventory } from '../context/InventoryContext.jsx';

export default function Settings({ email, households, householdId, onSwitch, onSignOut, onClose }) {
  const { clearAllItems, resetIntake, loadSample } = useInventory();
  const [key, setKey] = useState(getApiKey());
  const [saved, setSaved] = useState(false);
  const [storageError, setStorageError] = useState(false);

  function save() {
    const ok = setApiKey(key);
    setStorageError(!ok);
    if (!ok) return;
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="card stack">
      <div className="app-header">
        <h2>Settings</h2>
        <button className="link-button" onClick={onClose}>Close</button>
      </div>

      <div className="stack-tight">
        <span className="label">Signed in as</span>
        <p className="mono">{email}</p>
        <p className="label muted">
          Access follows this address. To add or remove someone, edit the
          allowlist in the Supabase dashboard.
        </p>
      </div>

      {households.length > 1 && (
        <label className="stack-tight">
          <span className="label">Household</span>
          <select value={householdId} onChange={(e) => onSwitch(e.target.value)}>
            {households.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </label>
      )}

      <div className="stack-tight">
        <label className="stack-tight">
          <span className="label">Google Gemini API key — for recipe ideas and expiry estimates</span>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="AIza…"
            autoComplete="off"
            spellCheck="false"
          />
        </label>
        <div className="row">
          <button className="primary" onClick={save}>{saved ? 'Saved' : 'Save key'}</button>
          {getApiKey() && <button onClick={() => { setKey(''); setApiKey(''); }}>Remove</button>}
        </div>
        {storageError && (
          <p className="label error">
            This browser is blocking local storage, so the key cannot be saved.
          </p>
        )}
        <p className="label muted">
          Stored in this browser only — not synced, not in the app bundle. Everything
          else works without it: adding, weighing, sorting and receipt scanning all
          run offline with no key.
        </p>
      </div>

      <div className="stack-tight">
        <span className="label">Reset</span>
        <ConfirmButton
          label="Empty the fridge"
          confirmLabel="Empty it — yes"
          note="Removes every item. What you've already eaten still counts toward intake."
          onConfirm={clearAllItems}
          done={(n) => (n === 0 ? 'Already empty' : `Removed ${n} item${n === 1 ? '' : 's'}`)}
        />
        <ConfirmButton
          label="Undo today's intake"
          confirmLabel="Undo today — yes"
          note="Puts today's intake back to zero. The food goes back in the fridge too — it's an undo, not a delete."
          onConfirm={resetIntake}
          done={(n) => (n === 0 ? 'Nothing logged today' : `Undone for ${n} item${n === 1 ? '' : 's'}`)}
        />
      </div>

      {import.meta.env.DEV && (
        <div className="stack-tight">
          <span className="label">Development</span>
          <ConfirmButton
            label="Load sample kitchen"
            confirmLabel="Replace everything — yes"
            note="Replaces all items with 20 known ones across the fridge, freezer and pantry — mixed food groups, mixed macros, one expired, one finished, and a day's intake already logged. Edit the list in src/dev/sampleFridge.js."
            onConfirm={loadSample}
            done={(n) => `Loaded ${n} items`}
          />
        </div>
      )}

      <div className="row">
        <button onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

/**
 * A destructive action that takes two taps. Deliberately inline rather than a
 * browser confirm() or a modal: it keeps the explanation of what the button
 * does next to the button, and a stray tap costs nothing.
 */
function ConfirmButton({ label, confirmLabel, note, onConfirm, done }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  async function run() {
    setBusy(true);
    try {
      const count = await onConfirm();
      setResult(done(count));
      setTimeout(() => setResult(''), 4000);
    } catch (e) {
      setResult(e.message || String(e));
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <div className="stack-tight">
      <div className="row">
        {armed ? (
          <>
            <button className="danger-text" onClick={run} disabled={busy}>
              {busy ? 'Working…' : confirmLabel}
            </button>
            <button onClick={() => setArmed(false)} disabled={busy}>Cancel</button>
          </>
        ) : (
          <button onClick={() => setArmed(true)}>{label}</button>
        )}
        {result && <span className="label muted">{result}</span>}
      </div>
      <p className="label muted">{note}</p>
    </div>
  );
}
