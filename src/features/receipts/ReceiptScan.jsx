import { useRef, useState } from 'react';
import { useInventory } from '../../context/InventoryContext.jsx';
import { lookupFood, PREFER } from '../../api/foodLookup.js';
import { hasApiKey, matchReceiptLines } from '../../api/llm.js';
import { gramsPerUnit } from '../../api/portion.js';
import { recognizeReceiptText } from './ocr.js';
import { chunk } from './matching.js';
import { extractCandidateLines, toRows, acceptFoodMatch, includedRows } from './receipts.js';
import { guessCategory } from '../inventory/categoryGuess.js';
import ReceiptReview from './ReceiptReview.jsx';
import './receipts.css';

/**
 * Photo of a receipt -> a product per line -> the fridge.
 *
 * Reading and resolving happen here; confirming happens in ReceiptReview, one
 * card at a time. The split matters: everything in this file is automatic and
 * should need no one watching it, and everything in that one is a person
 * saying yes.
 *
 *  1. OCR reads the photo, client-side, no key.
 *  2. Regex pulls out the priced lines and the counts printed beside them,
 *     and a table expands the till's abbreviations using the shop named in
 *     the header. No model — this is clerical work with a right answer.
 *  3. Each row searches the food catalogue on its own, brand-first when the
 *     receipt named a brand, so matches land one at a time.
 *  4. Gemini picks between the real candidates, five rows per call, and says
 *     per field whether it is sure.
 *
 * Without an API key step 4 falls back to a name-overlap rule: worse, but the
 * feature keeps working offline and out of quota, and everything it guesses
 * is flagged so a guess never reads as a decision.
 */
export default function ReceiptScan({ onClose }) {
  const { addItem } = useInventory();
  const [state, setState] = useState('idle'); // idle | ocr | review | saving | error
  const [progress, setProgress] = useState(0);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [location, setLocation] = useState('fridge');
  const abort = useRef(null);

  function updateRow(id, patch) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function resolve(staged) {
    const signal = abort.current?.signal;

    // Searches run together and each row updates itself, so the queue fills
    // in rather than sitting blank.
    const searched = await Promise.all(staged.map(async (row) => {
      let candidates = [];
      try {
        ({ results: candidates } = await lookupFood(row.query || row.name, {
          limit: 8, signal,
          // A receipt line that named a brand wants that brand's product, not
          // the curated generic entry for the same food.
          prefer: row.brand ? PREFER.BRANDED : PREFER.AUTO,
          brand: row.brand
        }));
      } catch { /* offline or rate-limited: decide with no candidates */ }
      updateRow(row.id, { candidates, state: 'deciding' });
      return { ...row, candidates, state: 'deciding' };
    }));

    if (!hasApiKey()) {
      setNote('No Gemini key — matched on name alone. Check anything marked.');
      for (const row of searched) {
        const picked = row.candidates.find((f) => acceptFoodMatch(row.name, f)) || null;
        updateRow(row.id, {
          state: 'done',
          matchedFood: picked,
          review: { match: !picked, quantity: !row.weighed }
        });
      }
      return;
    }

    // Five at a time: one call per item would make a twenty-line receipt a
    // twenty-call receipt, which is a quota bill you'd feel.
    for (const group of chunk(searched, 5)) {
      try {
        const decided = await matchReceiptLines(group, { signal });
        for (const row of decided) updateRow(row.id, row);
      } catch (e) {
        if (e.name === 'AbortError') return;
        // One chunk failing shouldn't cost the rest of the receipt.
        setNote(e.message || 'Some rows could not be checked automatically.');
        for (const row of group) {
          updateRow(row.id, {
            state: 'done',
            matchedFood: row.candidates[0] || null,
            review: { name: true, match: true, quantity: true }
          });
        }
      }
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
      const staged = toRows(candidates, text);
      setRows(staged);
      setState('review');
      abort.current?.abort();
      abort.current = new AbortController();
      void resolve(staged);
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
        const food = row.matchedFood;
        // The number that makes macros possible. Without it a counted item
        // contributes nothing at all, however carefully it was logged. A
        // portion the person picked by name wins over anything worked out.
        const grams = row.serving?.grams ?? gramsPerUnit(food, row.unit).grams;
        await addItem({
          name: row.name.trim(),
          quantity: row.quantity,
          unit: row.unit,
          location,
          category: guessCategory(row.name) || 'other',
          food_db_id: food?.food_db_id || null,
          grams_each: grams,
          // The matched product knows how big it is. Keeping that is what
          // makes "26% of the jar" sayable and per-100 g macros usable
          // without anyone typing a weight — the scan path already did this
          // and the two had drifted apart.
          pack_grams: food?.package_grams ?? null
        });
      }
      onClose();
    } catch (err) {
      setError(err.message || String(err));
      setState('review');
    }
  }

  if (state === 'review' || state === 'saving') {
    return (
      <ReceiptReview
        rows={rows}
        onChange={updateRow}
        onSave={save}
        onClose={onClose}
        location={location}
        onLocationChange={setLocation}
        saving={state === 'saving'}
        note={note}
        error={error}
      />
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card stack modal receipt-scan" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Scan a receipt">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Scan a receipt</h2>
          <button className="link-button" onClick={onClose}>Close</button>
        </div>

        {state === 'ocr' ? (
          <p className="muted">Reading the photo… {Math.round(progress * 100)}%</p>
        ) : (
          <>
            <p className="muted">
              Take a photo of a receipt, or upload one. You'll confirm each item before
              anything is added.
            </p>
            <input type="file" accept="image/*" capture="environment" onChange={onFileChange} />
            {error && <p className="error label">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
