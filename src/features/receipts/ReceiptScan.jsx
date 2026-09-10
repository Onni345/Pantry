import { useRef, useState } from 'react';
import { useInventory } from '../../context/InventoryContext.jsx';
import { hasApiKey, scanReceipt } from '../../api/llm.js';
import { lookupFood } from '../../api/foodLookup.js';
import { withMatch, includedRows } from './receipts.js';
import { guessCategory } from '../inventory/categoryGuess.js';
import { UNITS_BY_DIMENSION, DIMENSIONS, unitLabel } from '../../units.js';
import FoodSearchInput from '../../components/FoodSearchInput.jsx';
import './receipts.css';

/**
 * Photo-a-receipt → editable staging list → "mass add" to the fridge.
 *
 * Nothing here writes to inventory until Save: `scanReceipt` only ever
 * returns rows, and food matching (below) only ever attaches a candidate to
 * a row. The actual write reuses `addItem` from InventoryContext — the same
 * function the manual add form uses — so a receipt-added item is
 * indistinguishable from a hand-added one and there is exactly one place
 * that knows how to add an item to a household.
 */
export default function ReceiptScan({ onClose }) {
  const { addItem } = useInventory();
  const [state, setState] = useState('idle'); // idle | reading | staging | saving | error | no-key
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  function updateRow(id, patch) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  /**
   * Fires one food-lookup per row, each landing independently as it
   * resolves — a receipt can have 20 lines, and the user should see matches
   * appear rather than wait for the slowest one.
   */
  function matchAll(staged) {
    for (const row of staged) {
      lookupFood(row.name, { limit: 1 })
        .then(({ results }) => updateRow(row.id, withMatch(row, results[0] || null)))
        .catch(() => updateRow(row.id, withMatch(row, null)));
    }
  }

  async function onFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    if (!hasApiKey()) { setState('no-key'); return; }

    setState('reading');
    setError('');
    try {
      const { base64, mimeType } = await fileToBase64(file);
      const staged = await scanReceipt(base64, mimeType);
      if (staged.length === 0) throw new Error('No food items found on that receipt.');
      setRows(staged);
      setState('staging');
      matchAll(staged);
    } catch (err) {
      setError(err.message || String(err));
      setState('error');
    }
  }

  async function save() {
    setState('saving');
    setError('');
    try {
      for (const row of includedRows(rows)) {
        await addItem({
          name: row.name.trim(),
          quantity: row.quantity,
          unit: row.unit,
          location: 'pantry',
          category: guessCategory(row.name) || 'other',
          food_db_id: row.matchedFood?.food_db_id || null
        });
      }
      onClose();
    } catch (err) {
      setError(err.message || String(err));
      setState('staging');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card stack modal receipt-scan" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Scan a receipt</h2>
          <button className="link-button" onClick={onClose}>Close</button>
        </div>

        {state === 'no-key' && (
          <p className="muted">
            Receipt scanning needs a Gemini API key. Add one in Settings, then come back here.
          </p>
        )}

        {(state === 'idle' || state === 'error') && (
          <>
            <p className="muted">
              Take a photo of a receipt, or upload one. Nothing is added to your inventory
              until you review and save it below.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onFileChange}
            />
            {error && <p className="error label">{error}</p>}
          </>
        )}

        {state === 'reading' && <p className="muted">Reading the receipt…</p>}

        {(state === 'staging' || state === 'saving') && (
          <>
            <div className="stack-tight receipt-rows">
              {rows.map((row) => (
                <ReceiptRow key={row.id} row={row} onChange={(patch) => updateRow(row.id, patch)} />
              ))}
            </div>

            {error && <p className="error label">{error}</p>}

            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="label muted">
                {includedRows(rows).length} of {rows.length} items will be added
              </span>
              <button
                className="primary"
                onClick={save}
                disabled={state === 'saving' || includedRows(rows).length === 0}
              >
                {state === 'saving' ? 'Adding…' : 'Add to fridge'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReceiptRow({ row, onChange }) {
  return (
    <div className="card stack-tight receipt-row">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <label className="row" style={{ gap: 'var(--space-1)' }}>
          <input
            type="checkbox"
            checked={row.include}
            onChange={(e) => onChange({ include: e.target.checked })}
          />
          <span className="label muted">Include</span>
        </label>
        {row.price != null && (
          <input
            className="receipt-price"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={row.price}
            onChange={(e) => onChange({ price: Number(e.target.value) })}
            title="Price — not saved yet; budgeting comes later"
          />
        )}
      </div>

      {row.matchStatus === 'matched' ? (
        <FoodSearchInput
          value={row.name}
          selected={row.matchedFood}
          onChange={(name) => onChange({ name })}
          onSelect={(food) => onChange({ name: food.name, matchStatus: 'matched', matchedFood: food })}
          onClear={() => onChange({ matchStatus: 'not_found', matchedFood: null })}
        />
      ) : (
        <div className="stack-tight">
          <span className="label muted">
            {row.matchStatus === 'searching' ? 'Matching…' : 'NOT FOUND — search manually'}
          </span>
          <FoodSearchInput
            value={row.name}
            selected={null}
            onChange={(name) => onChange({ name })}
            onSelect={(food) => onChange({ name: food.name, matchStatus: 'matched', matchedFood: food })}
            onClear={() => {}}
          />
        </div>
      )}

      <div className="field-grid">
        <label className="stack-tight">
          <span className="label">Qty</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={row.quantity}
            onChange={(e) => onChange({ quantity: Number(e.target.value) })}
          />
        </label>
        <label className="stack-tight">
          <span className="label">Unit</span>
          <select value={row.unit} onChange={(e) => onChange({ unit: e.target.value })}>
            <optgroup label="Count">
              {UNITS_BY_DIMENSION[DIMENSIONS.COUNT].map((u) => (
                <option key={u} value={u}>{unitLabel(u)}</option>
              ))}
            </optgroup>
            <optgroup label="Weight">
              {UNITS_BY_DIMENSION[DIMENSIONS.WEIGHT].map((u) => (
                <option key={u} value={u}>{unitLabel(u)}</option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>
    </div>
  );
}

/** File → { base64, mimeType }, stripping the `data:...;base64,` prefix Gemini doesn't want. */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve({ base64: result.slice(comma + 1), mimeType: file.type || 'image/jpeg' });
    };
    reader.readAsDataURL(file);
  });
}
