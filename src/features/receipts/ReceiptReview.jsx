import { useCallback, useEffect, useMemo, useState } from 'react';
import FoodSearchSheet from '../../components/FoodSearchSheet.jsx';
import { isProductFood, productAmount } from '../inventory/amounts.js';
import { loadServings } from '../../api/foodLookup.js';
import { confidenceOf, includedRows } from './receipts.js';
import { WEIGHT_UNIT_NAMES, NATURAL_UNITS } from '../../units.js';
import { LOCATIONS } from '../../db/schema.js';
import './review.css';

/**
 * One item at a time.
 *
 * A receipt is twelve small yes/no decisions, and a table makes you hold all
 * twelve in your head at once. A card makes you hold one. The work is the
 * same; the feeling is not.
 *
 * The card is confirmation-first, never data-entry-first: price, shop, brand,
 * product, size, and how sure we are — then a big tick and a big bin. Most
 * lines are a glance and a tap. Editing exists, one layer down, for the lines
 * that aren't.
 *
 * On a laptop the queue sits alongside so you can see the shape of the shop
 * and jump around; the card stays the thing you act on, and the whole flow is
 * drivable from the keyboard.
 */
export default function ReceiptReview({
  rows, onChange, onSave, onClose, location, onLocationChange, saving, note, error
}) {
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [searching, setSearching] = useState(false);

  const row = rows[index];
  const decidedCount = rows.filter((r) => r.decided).length;
  const keeping = includedRows(rows.filter((r) => r.decided));
  const done = decidedCount === rows.length;

  const advance = useCallback(() => {
    setIndex((i) => {
      // Next undecided row, wrapping — so accepting in a burst never leaves
      // stragglers behind, and the flow ends when there genuinely is nothing
      // left rather than when you reach the bottom.
      for (let step = 1; step <= rows.length; step++) {
        const j = (i + step) % rows.length;
        if (!rows[j].decided) return j;
      }
      return i;
    });
  }, [rows]);

  const decide = useCallback((include) => {
    if (!row) return;
    onChange(row.id, { include, decided: true });
    advance();
  }, [row, onChange, advance]);

  // The keyboard is the whole point on a laptop: tick, bin, and move, without
  // the hand leaving the home row.
  useEffect(() => {
    if (editing || searching || done) return;
    function onKey(e) {
      if (e.target.matches?.('input, select, textarea')) return;
      if (e.key === 'Enter') { e.preventDefault(); decide(true); }
      else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); decide(false); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setIndex((i) => Math.min(rows.length - 1, i + 1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
      else if (e.key === 'e') { e.preventDefault(); setEditing(true); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, searching, done, decide, rows.length]);

  if (!row) return null;

  return (
    <div className="review-backdrop" onClick={onClose}>
      <div className="review" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Grocery import">

        <aside className="review-queue" aria-label="Items on this receipt">
          <h2 className="review-queue-head">
            Grocery import
            <span className="label muted">{rows.length} items</span>
          </h2>
          <ol className="review-queue-list">
            {rows.map((r, i) => (
              <li key={r.id}>
                <button
                  className={`queue-row${i === index ? ' is-current' : ''}${r.decided ? ' is-decided' : ''}`}
                  onClick={() => setIndex(i)}
                >
                  <span className={`dot dot-${confidenceOf(r)}`} aria-hidden="true" />
                  <span className="queue-name">{r.name || r.rawName}</span>
                  <span className="label muted queue-mark">
                    {r.decided ? (r.include ? '✓' : '✕') : ''}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <div className="review-stage">
          <header className="review-head">
            <button className="link-button" onClick={onClose}>&larr; Close</button>
            {/* A position only means something while there is still a queue. */}
            <span className="label muted">
              {done ? 'All reviewed' : `${index + 1} of ${rows.length}`}
            </span>
          </header>

          {done ? (
            <Summary
              rows={rows}
              keeping={keeping}
              location={location}
              onLocationChange={onLocationChange}
              onSave={onSave}
              saving={saving}
              error={error}
              onReview={() => setIndex(0)}
            />
          ) : (
            <>
              <ItemCard row={row} onEdit={() => setEditing(true)} />

              {note && <p className="label muted review-note">{note}</p>}

              {/* When we couldn't identify it, accepting is still allowed —
                  you did buy something — but it stops being the obvious
                  choice. Finding the product is what the card is asking for,
                  so that is what looks like the answer. */}
              <div className={`review-actions${confidenceOf(row) === 'low' ? ' is-unsure' : ''}`}>
                <button className="act act-discard" onClick={() => decide(false)}>
                  <span className="act-glyph" aria-hidden="true">&#x1F5D1;</span>
                  <span className="act-label">Don't add</span>
                </button>
                <button className="act act-accept" onClick={() => decide(true)}>
                  <span className="act-glyph" aria-hidden="true">&#x2713;</span>
                  <span className="act-label">
                    {confidenceOf(row) === 'low' ? 'Add anyway' : 'Add'}
                  </span>
                </button>
              </div>

              <p className="label muted review-hint">
                Enter to add &middot; Backspace to skip &middot; E to edit
              </p>
            </>
          )}
        </div>

        {editing && (
          <EditSheet
            row={row}
            location={location}
            onLocationChange={onLocationChange}
            onChange={(patch) => onChange(row.id, patch)}
            onSearch={() => { setEditing(false); setSearching(true); }}
            onClose={() => setEditing(false)}
          />
        )}

        {searching && (
          <FoodSearchSheet
            initialQuery={row.query || row.name}
            brand={row.brand}
            title="Find product"
            onPick={async (food) => {
              onChange(row.id, {
                matchedFood: food,
                name: food.name,
                review: { ...row.review, match: false, name: false }
              });
              setSearching(false);
              // One extra call, once the product is settled, for the actual
              // per-serving weight (loadServings can also fill in a missing
              // package weight, which productAmount below may use as a
              // fallback quantity hint).
              const full = await loadServings(food);
              const amount = productAmount(full);
              onChange(row.id, {
                matchedFood: full,
                unit: amount.unit,
                quantity: amount.defaultQuantity ?? row.quantity
              });
            }}
            onClose={() => setSearching(false)}
          />
        )}
      </div>
    </div>
  );
}

/** Price, shop, product, size, confidence, macros. In that order, by size. */
export function ItemCard({ row, onEdit }) {
  const level = confidenceOf(row);
  const food = row.matchedFood;
  const m = food?.macros_per_unit || {};
  const amount = food ? productAmount(food) : null;

  return (
    <div className="item-card">
      {row.price != null && <p className="card-price">${row.price.toFixed(2)}</p>}

      <p className="card-shop label">
        {[row.retailer, food?.brand || row.brand].filter(Boolean).join(' · ') || ' '}
      </p>

      <h3 className="card-name">{food?.name || row.name || row.rawName}</h3>

      <p className="card-size label muted">
        {[
          `${formatQty(row.quantity)} ${qtyUnitLabel(row.unit, row.quantity)}`,
          food?.package_text
        ].filter(Boolean).join(' · ')}
      </p>

      {food?.image && <img className="card-image" src={food.image} alt="" />}

      <Badge level={level} row={row} />

      {m.calories != null && (
        <dl className="card-macros">
          <div><dt className="label muted">Calories</dt><dd>{Math.round(m.calories)} <span className="label muted">/100g</span></dd></div>
          {m.protein_g != null && <div><dt className="label muted">Protein</dt><dd>{round1(m.protein_g)}g <span className="label muted">/100g</span></dd></div>}
          {m.carbs_g != null && <div><dt className="label muted">Carbs</dt><dd>{round1(m.carbs_g)}g <span className="label muted">/100g</span></dd></div>}
          {m.fat_g != null && <div><dt className="label muted">Fat</dt><dd>{round1(m.fat_g)}g <span className="label muted">/100g</span></dd></div>}
        </dl>
      )}

      {/* The product's own nutrition-label serving — never the package
          weight standing in for it. */}
      {amount?.mode === 'servings' && (
        <p className="label muted card-grams">
          One serving = {roundGrams(amount.grams_each)} g
        </p>
      )}
      {amount?.mode === 'weight' && (
        <p className="label muted card-grams">
          No serving size on file — tracked by weight instead.
        </p>
      )}

      <button className={`card-edit${level === 'low' ? ' primary' : ''}`} onClick={onEdit}>
        {level === 'low' ? 'Find product' : 'Edit / Change item'}
      </button>
    </div>
  );
}

function Badge({ level, row }) {
  if (level === 'working') {
    return <p className="badge badge-working">
      {row.state === 'searching' ? 'Looking it up…' : 'Working out what it is…'}
    </p>;
  }
  if (level === 'high') return <p className="badge badge-high">Very likely match</p>;
  if (level === 'medium') {
    const what = row.review?.quantity && !row.review?.match ? 'Check the quantity' : 'Check product';
    return <p className="badge badge-medium">{what}</p>;
  }
  return <p className="badge badge-low">Couldn't identify this one</p>;
}

/** Only what needs changing, over the card rather than instead of it. */
function EditSheet({ row, location, onLocationChange, onChange, onSearch, onClose }) {
  const food = row.matchedFood;
  const isProduct = isProductFood(food);
  const amount = isProduct ? productAmount(food) : null;
  const units = useMemo(() => [
    ...['item', ...NATURAL_UNITS.filter((u) => u !== 'item' && u !== 'serving')],
    ...WEIGHT_UNIT_NAMES
  ], []);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit item">
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{food?.name || row.name}</h2>
          <button className="link-button" onClick={onClose}>Done</button>
        </div>

        <div className="stack-tight">
          <span className="label muted">Product</span>
          <div className="edit-product">
            <div className="stack-tight">
              <span>{food?.name || row.name}</span>
              {(food?.brand || food?.package_text) && (
                <span className="label muted">
                  {[food.brand, food.package_text].filter(Boolean).join(' · ')}
                </span>
              )}
              {!food && <span className="label muted">No product attached</span>}
            </div>
            <button className="link-button" onClick={onSearch}>Change</button>
          </div>
        </div>

        <label className="stack-tight">
          <span className="label muted">Name</span>
          <input
            value={row.name}
            onChange={(e) => onChange({ name: e.target.value, review: { ...row.review, name: false } })}
          />
        </label>

        {isProduct ? (
          <div className="edit-grid">
            <label className="stack-tight">
              <span className="label muted">
                {amount.mode === 'servings' ? 'Servings' : 'Grams'}
              </span>
              <input
                type="number" inputMode="decimal" min="0" step="any"
                className={row.review?.quantity ? 'needs-review' : ''}
                value={row.quantity}
                onChange={(e) => onChange({
                  quantity: Number(e.target.value),
                  unit: amount.unit,
                  review: { ...row.review, quantity: false }
                })}
              />
            </label>
            <label className="stack-tight">
              <span className="label muted">Where</span>
              <select value={location} onChange={(e) => onLocationChange(e.target.value)}>
                {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            {amount.mode === 'servings' && (
              <p className="label muted">One serving = {amount.grams_each} g.</p>
            )}
          </div>
        ) : (
          <div className="edit-grid">
            <label className="stack-tight">
              <span className="label muted">Quantity</span>
              <input
                type="number" inputMode="decimal" min="0" step="any"
                className={row.review?.quantity ? 'needs-review' : ''}
                value={row.quantity}
                onChange={(e) => onChange({ quantity: Number(e.target.value), review: { ...row.review, quantity: false } })}
              />
            </label>
            <label className="stack-tight">
              <span className="label muted">Unit</span>
              <select
                className={row.review?.quantity ? 'needs-review' : ''}
                value={row.unit}
                onChange={(e) => onChange({ unit: e.target.value, review: { ...row.review, quantity: false } })}
              >
                {units.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
            <label className="stack-tight">
              <span className="label muted">Where</span>
              <select value={location} onChange={(e) => onLocationChange(e.target.value)}>
                {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          </div>
        )}

        {/* Read-only: there is nowhere to store a price yet, so an editable
            box would silently drop the edit. */}
        {row.price != null && (
          <p className="label muted">Price ${row.price.toFixed(2)} · from the receipt</p>
        )}
      </div>
    </div>
  );
}

/** The end of the queue: what's going in, where, and one button. */
function Summary({ rows, keeping, location, onLocationChange, onSave, saving, error, onReview }) {
  const skipped = rows.length - keeping.length;
  return (
    <div className="review-summary">
      <p className="summary-count">{keeping.length}</p>
      <p className="summary-label">
        {keeping.length === 1 ? 'item ready' : 'items ready'}
        {skipped > 0 && <span className="muted"> &middot; {skipped} skipped</span>}
      </p>

      <label className="row summary-where">
        <span className="label muted">Put in</span>
        <select value={location} onChange={(e) => onLocationChange(e.target.value)}>
          {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </label>

      {error && <p className="error label">{error}</p>}

      <button className="primary summary-save" onClick={onSave} disabled={saving || keeping.length === 0}>
        {saving ? 'Adding…' : `Add ${keeping.length} to ${location}`}
      </button>
      <button className="link-button" onClick={onReview}>Go back through them</button>
    </div>
  );
}

/** Weight units ("g", "kg") stay bare; counted nouns pluralise. */
const qtyUnitLabel = (unit, quantity) => {
  if (unit === 'g' || unit === 'kg' || unit === 'oz' || unit === 'lb') return unit;
  const noun = unit === 'count' ? 'item' : unit;
  return quantity === 1 ? noun : `${noun}s`;
};

const round1 = (n) => Math.round(n * 10) / 10;
/* A package weight printed to the centigram reads like a lab result. Nobody
   needs 2267.96 g of rice; they need to know it's about five pounds. */
const roundGrams = (n) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
const formatQty = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
};
