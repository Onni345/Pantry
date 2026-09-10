import { useState, useMemo } from 'react';
import { enterableUnits, unitLabel, toBase, formatBase } from '../units.js';
import './AmountEntry.css';

/**
 * Amount + unit entry for a single use/add.
 *
 * Shows the result live, so 2 oz reads as 56.7 g before you commit it.
 */
export default function AmountEntry({ item, direction, onSubmit, onCancel }) {
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState(item.display_unit || item.base_unit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const units = useMemo(() => enterableUnits(item.base_unit), [item.base_unit]);

  const preview = useMemo(() => {
    const n = Number(value);
    if (!value || !Number.isFinite(n) || n <= 0) return null;
    try {
      return { value: toBase(n, unit, item.base_unit) };
    } catch (e) {
      return { error: e.message };
    }
  }, [value, unit, item.base_unit]);

  const removingTooMuch =
    direction === 'remove' && preview?.value > item.quantity + 1e-9;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit({ value: Number(value), unit });
    } catch (err) {
      setError(err.message || String(err));
      setBusy(false);
    }
  }

  return (
    <form className="amount-entry stack-tight" onSubmit={submit}>
      <div className="amount-fields">
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Amount"
          aria-label="Amount"
          autoFocus
        />
        <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit">
          {units.map((u) => (
            <option key={u} value={u}>{unitLabel(u)}</option>
          ))}
        </select>
      </div>

      {preview?.error && <p className="error label">{preview.error}</p>}

      {preview && !preview.error && (
        <p className="label muted">
          {direction === 'add' ? 'Adds' : 'Uses'}{' '}
          {formatBase(preview.value, item.base_unit)}
          {!removingTooMuch && direction === 'remove' && (
            <> · {formatBase(item.quantity - preview.value, item.base_unit)} left</>
          )}
        </p>
      )}

      {removingTooMuch && (
        <p className="label warn">
          That's more than the {formatBase(item.quantity, item.base_unit)} on record.
          It will be logged and the total shown as 0 — use “Finished it” if it's just gone.
        </p>
      )}

      {error && <p className="error label">{error}</p>}

      <div className="row">
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          className="primary"
          type="submit"
          disabled={busy || !preview || preview.error || Number(value) <= 0}
        >
          {busy ? 'Saving…' : direction === 'add' ? 'Add' : 'Use'}
        </button>
      </div>
    </form>
  );
}
