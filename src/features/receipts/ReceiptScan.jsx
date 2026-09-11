import { useState } from 'react';
import { useInventory } from '../../context/InventoryContext.jsx';
import { lookupFood } from '../../api/foodLookup.js';
import { recognizeReceiptText } from './ocr.js';
import {
  extractCandidateLines, toRows, acceptFoodMatch, withMatch, includedRows
} from './receipts.js';
import { guessCategory } from '../inventory/categoryGuess.js';
import { UNITS_BY_DIMENSION, DIMENSIONS, unitLabel } from '../../units.js';
import { LOCATIONS } from '../../db/schema.js';
import FoodSearchInput from '../../components/FoodSearchInput.jsx';
import './receipts.css';

/**
 * Photo-a-receipt → editable staging list → "mass add" to the fridge.
 *
 * OCR the photo, pull out the priced lines, show them, add the ones you tick.
 * No model call anywhere in that path, so it works offline with no API key.
 * Nothing is written until Save, which uses the same `addItem` the manual
 * form does.
 */
export default function ReceiptScan({ onClose }) {
  const { addItem } = useInventory();
  const [state, setState] = useState('idle'); // idle | ocr | staging | saving | error
  const [progress, setProgress] = useState(0);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [location, setLocation] = useState('fridge');

  function updateRow(id, patch) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  /**
   * Looks each row up in the food database for its macros, independently so
   * a slow one doesn't hold up the rest. A row that finds nothing plausible
   * just carries no macros — better than a confident wrong match.
   */
  function matchAll(staged) {
    for (const row of staged) {
      lookupFood(row.name, { limit: 8 })
        .then(({ results }) => updateRow(row.id, withMatch(row, results.find((f) => acceptFoodMatch(row.name, f)) || null)))
        .catch(() => updateRow(row.id, withMatch(row, null)));
    }
  }

  async function onFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    setState('ocr');
    setProgress(0);
    setError('');
    try {
      const text = await recognizeReceiptText(file, { onProgress: setProgress });
      const candidates = extractCandidateLines(text);
      if (candidates.length === 0) {
        throw new Error('Could not find any priced item lines on that receipt.');
      }
      const staged = toRows(candidates);
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
          location,
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

        {(state === 'idle' || state === 'error') && (
          <>
            <p className="muted">
              Take a photo of a receipt, or upload one. Nothing is added to your inventory
              until you review and save it below.
            </p>
            <input type="file" accept="image/*" capture="environment" onChange={onFileChange} />
            {error && <p className="error label">{error}</p>}
          </>
        )}

        {state === 'ocr' && (
          <p className="muted">Reading the photo… {Math.round(progress * 100)}%</p>
        )}

        {(state === 'staging' || state === 'saving') && (
          <>
            <div className="receipt-rows">
              {rows.map((row) => (
                <ReceiptRow key={row.id} row={row} onChange={(patch) => updateRow(row.id, patch)} />
              ))}
            </div>

            {error && <p className="error label">{error}</p>}

            <div className="row receipt-footer">
              {/* One shelf for the whole shop — a receipt is usually unpacked
                  into the same place, and per-row pickers would be nine
                  dropdowns to answer one question. Individual items move
                  later from their card. */}
              <label className="row receipt-destination">
                <span className="label muted">Put in</span>
                <select value={location} onChange={(e) => setLocation(e.target.value)}>
                  {LOCATIONS.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </label>
              <span className="label muted">
                {includedRows(rows).length} of {rows.length}
              </span>
              <button
                className="primary"
                onClick={save}
                disabled={state === 'saving' || includedRows(rows).length === 0}
              >
                {state === 'saving' ? 'Adding…' : `Add to ${location}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Named so smoke-render.mjs can render a staged row directly.
export function ReceiptRow({ row, onChange }) {
  return (
    <div className="receipt-row">
      <input
        type="checkbox"
        checked={row.include}
        onChange={(e) => onChange({ include: e.target.checked })}
        title="Include in save"
      />

      <div className="receipt-row-name">
        <FoodSearchInput
          value={row.name}
          selected={null}
          onChange={(name) => onChange({ name })}
          onSelect={(food) => onChange({ matchStatus: 'matched', matchedFood: food })}
          onClear={() => {}}
        />
      </div>

      {/* Own line under the name on a phone; same line on a laptop. */}
      <div className="receipt-fields">
        <input
          className="receipt-qty"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={row.quantity}
          onChange={(e) => onChange({ quantity: Number(e.target.value) })}
          aria-label="Quantity"
        />

        <select
          className="receipt-unit"
          value={row.unit}
          onChange={(e) => onChange({ unit: e.target.value })}
          aria-label="Unit"
        >
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

        {/* Read-only: there's nowhere to store a price yet, so an editable
            box would silently drop the edit. Shown because it's the fastest
            way to tell which row is which. */}
        <span className="receipt-price">
          {row.price == null ? '' : row.price.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
