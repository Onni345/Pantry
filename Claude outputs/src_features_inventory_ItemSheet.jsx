import { useEffect, useState } from 'react';
import { useInventory } from '../../context/InventoryContext.jsx';
import { getCachedFood } from '../../api/foodLookup.js';
import { gramsPerUnit, servingsFor, defaultServing } from '../../api/portion.js';
import { loadServings } from '../../api/foodLookup.js';
import ServingPicker from '../../components/ServingPicker.jsx';
import FoodSearchSheet from '../../components/FoodSearchSheet.jsx';
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
  const [food, setFood] = useState(null);
  const [serving, setServing] = useState(null);

  const counted = item.base_unit !== 'g';
  const noun = counted && item.display_unit !== 'count' ? item.display_unit : 'item';
  const step = counted ? 1 : 50;

  // A weighed item with known portions can be logged by the portion instead
  // of by the gram — "1 slice", not "−50 g". Counted items already read in
  // their own noun, so they need nothing here.
  useEffect(() => {
    let live = true;
    if (counted || !item.food_db_id) return undefined;
    getCachedFood(item.food_db_id)
      .then((f) => (f ? loadServings(f) : null))
      .then((f) => {
        if (!live || !f) return;
        setFood(f);
        setServing(defaultServing(f, item.display_unit));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [counted, item.food_db_id, item.display_unit]);

  const portions = servingsFor(food);

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

        {portions.length > 0 ? (
          <form
            className="stack-tight sheet-portion"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(custom);
              const grams = (serving?.grams || 0) * n;
              if (grams > 0) { consume(grams); setCustom(''); }
            }}
          >
            <ServingPicker
              food={food}
              quantity={custom}
              serving={serving}
              onQuantity={setCustom}
              onServing={setServing}
              label="Used"
            />
            <button type="submit" disabled={busy || !(Number(custom) > 0)}>Log it</button>
          </form>
        ) : (
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
        )}

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
  const [food, setFood] = useState(null);
  const [searching, setSearching] = useState(false);
  const [grams, setGrams] = useState(item.grams_each ?? '');
  const [saved, setSaved] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const counted = item.base_unit !== 'g';
  const noun = counted && item.display_unit !== 'count' ? item.display_unit : 'item';
  const sizes = servingsFor(food);

  useEffect(() => {
    let live = true;
    if (!item.food_db_id) { setFood(null); return undefined; }
    getCachedFood(item.food_db_id)
      .then((f) => (f ? loadServings(f) : null))
      .then((f) => { if (live) setFood(f || null); })
      .catch(() => {});
    return () => { live = false; };
  }, [item.food_db_id]);

  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 1500); };

  const set = (k) => async (e) => {
    const next = { ...form, [k]: e.target.value };
    setForm(next);
    await updateItem(item.id, { [k]: e.target.value || null });
    flash();
  };

  /** Attaching a product also fills in what one unit weighs, when it can. */
  async function attach(raw) {
    const picked = await loadServings(raw);
    const portion = defaultServing(picked, item.display_unit || 'item');
    const per = gramsPerUnit(picked, item.display_unit || 'item');
    const next = portion?.grams ?? per.grams ?? (item.grams_each || null);
    setFood(picked);
    setGrams(next ?? '');
    setSearching(false);
    await updateItem(item.id, { food_db_id: picked.food_db_id, grams_each: next });
    flash();
  }

  async function saveGrams(value) {
    const n = Number(value);
    await updateItem(item.id, { grams_each: Number.isFinite(n) && n > 0 ? n : null });
    flash();
  }

  if (searching) {
    return (
      <FoodSearchSheet
        initialQuery={item.name}
        title="Find product"
        onPick={attach}
        onClose={() => setSearching(false)}
      />
    );
  }

  return (
    <div className="stack-tight sheet-details">
      {/* The repair path. Before this existed, an item added without a
          product match could never get one, and so could never contribute a
          single calorie no matter how carefully it was logged. */}
      <div className="stack-tight">
        <span className="label muted">Nutrition</span>
        <div className="add-product">
          <div className="stack-tight">
            {food ? (
              <>
                <span>{food.name}</span>
                <span className="label muted">
                  {[food.brand, food.package_text].filter(Boolean).join(' \u00b7 ') || food.detail}
                </span>
              </>
            ) : (
              <span className="label muted">Nothing attached — no macros from this item</span>
            )}
          </div>
          <button type="button" className="link-button" onClick={() => setSearching(true)}>
            {food ? 'Change' : 'Find product'}
          </button>
        </div>
      </div>

      {/* Counted items need one number to join the two systems up. Where we
          have portions we trust, that number is chosen by name — "large" —
          rather than typed. Where we don't, it stays a plain grams box, which
          is honest about the fact that nobody knows. */}
      {counted && sizes.length > 0 && (
        <label className="stack-tight">
          <span className="label muted">One {noun} is</span>
          <select
            value={sizes.find((z) => Number(grams) === z.grams)?.label || ''}
            onChange={(e) => {
              const picked = sizes.find((z) => z.label === e.target.value);
              if (!picked) return;
              setGrams(picked.grams);
              saveGrams(picked.grams);
            }}
          >
            <option value="" disabled>Pick a size</option>
            {sizes.map((z) => (
              <option key={z.label} value={z.label}>{z.label} — {z.grams} g</option>
            ))}
          </select>
        </label>
      )}

      {counted && sizes.length === 0 && (
        <label className="stack-tight">
          <span className="label muted">One {noun} weighs</span>
          <div className="row">
            <input
              type="number" inputMode="decimal" min="0" step="any"
              value={grams}
              onChange={(e) => setGrams(e.target.value)}
              onBlur={(e) => saveGrams(e.target.value)}
              placeholder="grams — optional"
            />
            <span className="label muted">g</span>
          </div>
        </label>
      )}

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
