import { useState } from 'react';
import { getApiKey, setApiKey } from '../api/llm.js';

export default function Settings({ email, households, householdId, onSwitch, onSignOut, onClose }) {
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
          <span className="label">Google Gemini API key — for expiry estimates</span>
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
          Stored in this browser only — not synced, not in the app bundle.
        </p>
      </div>

      <div className="row">
        <button onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}
