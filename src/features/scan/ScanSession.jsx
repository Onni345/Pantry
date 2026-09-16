import { useCallback, useRef, useState } from 'react';
import { useInventory } from '../../context/InventoryContext.jsx';
import { lookupFood, loadServings, PREFER } from '../../api/foodLookup.js';
import { readPlu, pluQuery, isPluCode } from '../../api/plu.js';
import { productAmount } from '../inventory/amounts.js';
import { guessCategory } from '../inventory/categoryGuess.js';
import Scanner from '../../components/Scanner.jsx';
import ReceiptReview from '../receipts/ReceiptReview.jsx';
import './scan.css';

/**
 * Shop mode: scan everything, confirm once.
 *
 * The camera stays open and items queue up behind it, because unpacking a bag
 * is a run of identical actions and stopping to confirm each one turns a
 * thirty-second job into a three-minute one. Confirmation reuses the receipt
 * card queue — a scanned item and a receipt line are the same kind of thing
 * once they have a product attached, so they get the same screen.
 *
 * Two kinds of code, one flow:
 *
 *   barcode (8-14 digits)  -> the exact packet, straight from the databases
 *   PLU     (4-5 digits)   -> loose produce, from a table shipped in the app
 *
 * Both resolve to an ordinary food object, so everything downstream — the
 * card, the portions, the macros — is unchanged.
 */
export default function ScanSession({ onClose }) {
  const { addItem } = useInventory();
  const [rows, setRows] = useState([]);
  const [stage, setStage] = useState('scanning'); // scanning | review | saving
  const [location, setLocation] = useState('pantry');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const seen = useRef(new Set());

  const updateRow = useCallback((id, patch) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  /** A code arrives. Stage it immediately, resolve it behind. */
  const onCode = useCallback(async (code) => {
    // The same packet scanned twice is almost always a double-read, not two
    // packets. Bumping the quantity is right far more often than adding a row.
    if (seen.current.has(code)) {
      setRows((rs) => rs.map((r) => (r.code === code ? { ...r, quantity: r.quantity + 1 } : r)));
      setNote('Already scanned — added one more.');
      return;
    }
    seen.current.add(code);

    const plu = isPluCode(code) ? readPlu(code) : null;
    const id = crypto.randomUUID();

    const row = {
      id,
      code,
      rawName: code,
      name: plu ? (plu.organic ? `Organic ${plu.name}` : plu.name) : `Item ${code}`,
      kind: plu ? 'produce' : 'barcode',
      quantity: 1,
      unit: plu ? 'item' : 'pack',
      price: null,
      include: true,
      decided: false,
      state: 'searching',
      candidates: [],
      matchedFood: null,
      review: {},
      retailer: null,
      brand: null
    };
    setRows((rs) => [...rs, row]);
    setNote('');

    try {
      const query = plu ? pluQuery(code) : code;
      const { results } = await lookupFood(query, {
        limit: 6,
        // A barcode is exact, so nothing needs ranking toward a brand; a
        // produce name wants the plain lab-analysed entry.
        prefer: plu ? PREFER.GENERIC : PREFER.AUTO
      });

      const best = results[0] || null;
      const full = best ? await loadServings(best) : null;

      // A matched product is always tracked as servings x macros-per-serving
      // — never the whole package standing in for one serving, which is what
      // defaulting to `row.unit` ('pack') used to do downstream.
      const amount = full ? productAmount(full) : null;

      updateRow(id, {
        state: 'done',
        candidates: results,
        matchedFood: full,
        name: full?.name || row.name,
        unit: amount ? amount.unit : row.unit,
        quantity: amount?.defaultQuantity ?? row.quantity,
        // Nothing found means nothing found — flag it and let the card offer
        // the search, rather than leaving a row that looks settled.
        review: full ? {} : { name: true, match: true }
      });
    } catch {
      updateRow(id, { state: 'done', review: { name: true, match: true } });
    }
  }, [updateRow]);

  async function save() {
    setStage('saving');
    setError('');
    try {
      for (const row of rows.filter((r) => r.include && r.name.trim())) {
        const food = row.matchedFood;
        const amount = food ? productAmount(food) : null;
        await addItem({
          name: row.name.trim(),
          quantity: row.quantity,
          unit: amount ? amount.unit : row.unit,
          location,
          category: guessCategory(row.name) || 'other',
          food_db_id: food?.food_db_id || null,
          // Always the product's own per-serving weight, never the package
          // weight standing in for it — see `productAmount`.
          grams_each: amount ? amount.grams_each : null,
          pack_grams: null
        });
      }
      onClose();
    } catch (e) {
      setError(e.message || String(e));
      setStage('review');
    }
  }

  if (stage === 'review' || stage === 'saving') {
    return (
      <ReceiptReview
        rows={rows}
        onChange={updateRow}
        onSave={save}
        onClose={onClose}
        location={location}
        onLocationChange={setLocation}
        saving={stage === 'saving'}
        note={note}
        error={error}
      />
    );
  }

  const settled = rows.filter((r) => r.state === 'done' && r.matchedFood).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card stack modal scan-session" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Scan">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Scan</h2>
          <button className="link-button" onClick={onClose}>Close</button>
        </div>

        <Scanner onCode={onCode} onClose={onClose} hint="Barcode, or a produce sticker" />

        {note && <p className="label muted">{note}</p>}

        {/* Newest first: the thing you just scanned is the thing you want to
            see confirmed, without hunting down a growing list. */}
        <ul className="scan-list">
          {[...rows].reverse().map((r) => (
            <li key={r.id} className="scan-line">
              <span
                className={`dot dot-${r.state !== 'done' ? 'working' : r.matchedFood ? 'high' : 'low'}`}
                aria-hidden="true"
              />
              <span className="scan-name">{r.name}</span>
              <span className="label muted">
                {r.state !== 'done' ? 'looking up…' : r.matchedFood ? r.kind : 'not found'}
                {r.quantity > 1 ? ` · ×${r.quantity}` : ''}
              </span>
            </li>
          ))}
        </ul>

        <div className="row scan-footer">
          <span className="label muted">
            {rows.length === 0
              ? 'Nothing scanned yet'
              : `${rows.length} scanned · ${settled} identified`}
          </span>
          <button className="primary" disabled={rows.length === 0} onClick={() => setStage('review')}>
            Review {rows.length || ''}
          </button>
        </div>
      </div>
    </div>
  );
}
