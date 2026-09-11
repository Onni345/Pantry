import { useState } from 'react';
import { useInventory } from '../../context/InventoryContext.jsx';
import { describe, niceNumber, pluralize } from '../../units.js';
import { CATEGORIES, LOCATIONS } from '../../db/schema.js';
import './sheet.css';

/**
 * Tap an item, get this. Consuming is the whole point, so it's the top half
 * and takes one tap; everything else is folded behind "Edit details".
 *
 * Nothing here deletes. Food gets used up, and "Finished" says that honestly
 * — the item and its history stay, which is also what makes Undo possible.
 */
export default function ItemSheet({ item, onClose }) {
  const { logAmount, markEmpty, undoLast, removeItem } = useInventory();
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState('');
  const [details, setDetails] = useState(false);
  const [undoable, setUndoable] = useState(false);

  const counted = item.base_unit !== 'g';
  const noun = counted && item.display_unit !== 'count' ? item.display_unit : 'item';
  const step = counted ? 1 : 50;

  async function run(fn, { undo = true } = {}) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setUndoable(undo);
    } finally {
      setBusy(false);
    }
  }

  const consume = (value) =>
    run(() => logAmount(item.id, { value, unit: counted ? 'count' : 'g', direction: 'remove' }));
  const restock = (value) =>
    run(() => logAmount(item.id, { value, unit: counted ? 'count' : 'g', direction: 'add' }));

  // Quick amounts that mean something for this item rather than fixed numbers:
  // half of what's left, and all of it.
  const half = Math.round((item.quantity / 2) * 100) / 100;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={item.name}>
        <div className="sheet-grip" aria-hidden="true" />

        <div className="sheet-head">
          <div>
            <h2>{item.name}</h2>
            <p className="label muted">{item.location}</p>
          </div>
          <button className="link-button" onClick={onClose}>Close</button>
        </div>

        <p className="sheet-qty">
          {describe(item)}
          {item.quantity === 0 && <span className="label muted"> · all gone</span>}
        </p>

        <div className="row sheet-step">
          <button onClick={() => consume(step)} disabled={busy || item.quantity <= 0}>
            −{counted ? 1 : `${step}g`}
          </button>
          <button onClick={() => restock(step)} disabled={busy}>
            +{counted ? 1 : `${step}g`}
          </button>
        </div>

        <div className="row wrap sheet-quick">
          {item.quantity > 0 && half > 0 && (
            <button onClick={() => consume(half)} disabled={busy}>
              Used half ({niceNumber(half)} {counted ? pluralize(noun, half) : 'g'})
            </button>
          )}
          {item.quantity > 0 && (
            <button onClick={() => run(() => markEmpty(item.id))} disabled={busy}>
              Finished it
            </button>
          )}
        </div>

        <form
          className="row sheet-custom"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Number(custom);
            if (v > 0) { consume(v); setCustom(''); }
          }}
        >
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={counted ? `Used how many ${pluralize(noun, 2)}?` : 'Used how many grams?'}
            aria-label="Custom amount used"
          />
          <button type="submit" disabled={busy || !(Number(custom) > 0)}>Use</button>
        </form>

        {undoable && (
          <div className="row sheet-undo">
            <span className="label muted">Logged.</span>
            <button
              className="link-button"
              onClick={() => run(() => undoLast(item.id), { undo: false })}
              disabled={busy}
            >
              Undo
            </button>
          </div>
        )}

        <button className="link-button sheet-more" onClick={() => setDetails((v) => !v)}>
          {details ? 'Hide details' : 'Edit details'}
        </button>

        {details && <Details item={item} onDone={onClose} removeItem={removeItem} />}
      </div>
    </div>
  );
}

/**
 * Progressive disclosure: the fields nobody needs in order to eat something.
 * Missing values are left missing rather than demanded.
 */
function Details({ item, onDone, removeItem }) {
  const { updateItem } = useInventory();
  const [form, setForm] = useState({
    location: item.location,
    category: item.category,
    expiry_date: item.expiry_date || ''
  });
  const [saved, setSaved] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const set = (k) => async (e) => {
    const next = { ...form, [k]: e.target.value };
    setForm(next);
    await updateItem(item.id, { [k]: e.target.value || null });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="stack-tight sheet-details">
      <div className="field-grid">
        <label className="stack-tight">
          <span className="label muted">Where</span>
          <select value={form.location} onChange={set('location')}>
            {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="stack-tight">
          <span className="label muted">Group</span>
          <select value={form.category} onChange={set('category')}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>

      <label className="stack-tight">
        <span className="label muted">Use by {item.expiry_estimated ? '(estimated)' : ''}</span>
        <input type="date" value={form.expiry_date} onChange={set('expiry_date')} />
      </label>

      <p className="label muted">
        Bought {item.added > 0 ? describe({ ...item, quantity: item.added }) : 'an unknown amount'}
        {item.created_at ? ` on ${new Date(item.created_at).toLocaleDateString()}` : ''}.
      </p>

      {saved && <p className="label muted">Saved</p>}

      <div className="row wrap">
        {confirmRemove ? (
          <>
            <span className="label muted">Remove it entirely?</span>
            <button className="danger-text" onClick={async () => { await removeItem(item.id); onDone(); }}>
              Remove
            </button>
            <button onClick={() => setConfirmRemove(false)}>Keep</button>
          </>
        ) : (
          <button className="link-button danger-text" onClick={() => setConfirmRemove(true)}>
            Remove from inventory
          </button>
        )}
      </div>
    </div>
  );
}
