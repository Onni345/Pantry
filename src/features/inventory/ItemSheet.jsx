import { useEffect, useState } from 'react';
import { useInventory } from '../../context/InventoryContext.jsx';
import { getCachedFood } from '../../api/foodLookup.js';
import { foodUnitGrams, servingsFor, defaultServing, isProductFood, productAmount } from './amounts.js';
import { loadServings } from '../../api/foodLookup.js';
import ServingPicker from '../../components/ServingPicker.jsx';
import PackSize from '../../components/PackSize.jsx';
import '../../components/PackSize.css';
import FoodSearchSheet from '../../components/FoodSearchSheet.jsx';
import { perUnit, inStock, macroGap, formatCalories } from '../../features/macros/perItem.js';
import { niceNumber, pluralize } from '../../units.js';
import { describe, portionsFor, gramsToDelta, supportsGrams, nounOf } from './amounts.js';
import { formatGrams } from '../../units.js';
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
  const [details, setDetails] = useState(false);
  const [undoable, setUndoable] = useState(false);
  const [error, setError] = useState('');
  const [food, setFood] = useState(null);

  const counted = item.base_unit !== 'g';
  const noun = counted && item.display_unit !== 'count' ? item.display_unit : 'item';

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
  const amount = describe(item);

  async function run(fn, { undo = true } = {}) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
      setUndoable(undo);
    } catch (e) {
      // This used to be try/finally with no catch. Every failure vanished, so
      // a button that threw looked exactly like a button that did nothing —
      // which is how a broken decrement went unnoticed.
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

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
          {amount.main}
          {amount.aside && <span className="label muted"> · {amount.aside}</span>}
          {item.quantity === 0 && <span className="label muted"> · all gone</span>}
        </p>

        <Nutrition item={item} onFix={() => setDetails(true)} />

        {error && <p className="error label">{error}</p>}

        <Take
          item={item}
          food={food}
          busy={busy}
          onTakeGrams={(g) => run(() => logAmount(item.id, { grams: g, direction: 'remove' }))}
          onTakeUnits={(n) => run(() => logAmount(item.id, { units: n, direction: 'remove' }))}
          onAddUnits={(n) => run(() => logAmount(item.id, { units: n, direction: 'add' }))}
          onFinish={() => run(() => markEmpty(item.id))}
        />

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
 * Taking some.
 *
 * Both ways, always, on every item — a row of named portions and a gram
 * field. The app deliberately does not try to guess whether a thing divides:
 * guessing that a potato is whole-only is right until someone grates one, and
 * a wrong guess is a dead end where showing both is one extra chip.
 *
 * The portions are the loud part because they are the common case. Grams sit
 * underneath, quiet, for when the chips don't fit what you did.
 */
function Take({ item, food, busy, onTakeGrams, onTakeUnits, onAddUnits, onFinish }) {
  const [grams, setGrams] = useState('');
  const [units, setUnits] = useState('');
  const portions = portionsFor(item, food);
  const canGrams = supportsGrams(item);
  const noun = nounOf(item) || 'item';
  const empty = item.quantity <= 0;

  return (
    <div className="stack-tight take">
      <div className="row take-step">
        <button
          onClick={() => onTakeUnits(1)}
          disabled={busy || empty}
          aria-label={`Take one ${noun}`}
        >
          &minus;1 {noun}
        </button>
        <button onClick={() => onAddUnits(1)} disabled={busy} aria-label={`Add one ${noun}`}>
          +1 {noun}
        </button>
      </div>

      {/* -1/+1 covers the common nudge; typing covers "I actually bought 6
          more" without six taps. */}
      <form
        className="row take-units"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(units);
          if (n > 0) { onAddUnits(n); setUnits(''); }
        }}
      >
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={units}
          onChange={(e) => setUnits(e.target.value)}
          placeholder={`or type a number of ${pluralize(noun, 2)}`}
          aria-label={`Number of ${noun} to add`}
        />
        <button type="submit" disabled={busy || !(Number(units) > 0)}>Add</button>
      </form>

      {portions.length > 0 && (
        <div className="row wrap take-portions">
          {portions.map((p) => (
            <button
              key={p.label}
              className="chip"
              disabled={busy || empty || !p.grams}
              onClick={() => p.grams && onTakeGrams(p.grams)}
            >
              {p.label}
              {p.grams && <span className="label muted"> {formatGrams(p.grams)}</span>}
            </button>
          ))}
          <button className="chip" onClick={onFinish} disabled={busy || empty}>
            Finished it
          </button>
        </div>
      )}

      {canGrams && (
        <form
          className="row take-grams"
          onSubmit={(e) => {
            e.preventDefault();
            const g = Number(grams);
            if (g > 0 && gramsToDelta(item, g) != null) { onTakeGrams(g); setGrams(''); }
          }}
        >
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={grams}
            onChange={(e) => setGrams(e.target.value)}
            placeholder="or an exact number of grams"
            aria-label="Grams used"
          />
          <button type="submit" disabled={busy || !(Number(grams) > 0)}>Use</button>
        </form>
      )}

      {!canGrams && !empty && (
        <button onClick={onFinish} disabled={busy}>Finished it</button>
      )}
    </div>
  );
}

/**
 * What this food is worth, in the unit it is counted in.
 *
 * Standing at the fridge, "72 kcal per egg" is the useful sentence; "143 kcal
 * per 100 g" is a fact about eggs in general that you then have to do
 * arithmetic on. Weighed food keeps the per-100 g basis, because that is
 * already the unit it is bought and measured in.
 *
 * When it can't be worked out, it says which piece is missing and offers the
 * fix rather than rendering a blank — a silent gap here is exactly why the
 * intake screen reads lower than someone expects.
 */
function Nutrition({ item, onFix }) {
  const per = perUnit(item);
  const all = inStock(item);
  const gap = macroGap(item);

  if (!per) {
    return (
      <div className="sheet-nutrition is-missing">
        <p className="label">
          {gap === 'no-food'
            ? 'No nutrition attached — this food adds nothing to your intake.'
            : `Nobody has said what one ${item.display_unit || 'item'} weighs, so this can't be counted.`}
        </p>
        <button className="link-button" onClick={onFix}>
          {gap === 'no-food' ? 'Find product' : 'Set the weight'}
        </button>
      </div>
    );
  }

  return (
    <div className="sheet-nutrition">
      <div className="nutrition-head">
        <span className="label muted">{per.basis}</span>
        {all && (
          <span className="label muted">
            {formatCalories(all.calories)} kcal in the {item.location}
          </span>
        )}
      </div>
      <dl className="nutrition-grid">
        <Macro label="Calories" value={formatCalories(per.calories)} unit="kcal" />
        <Macro label="Protein" value={per.protein_g} unit="g" />
        <Macro label="Carbs" value={per.carbs_g} unit="g" />
        <Macro label="Fat" value={per.fat_g} unit="g" />
      </dl>
    </div>
  );
}

function Macro({ label, value, unit }) {
  if (value == null) return null;
  return (
    <div>
      <dt className="label muted">{label}</dt>
      <dd>{value}<span className="label muted"> {unit}</span></dd>
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
    category: item.category
  });
  const [food, setFood] = useState(null);
  const [searching, setSearching] = useState(false);
  const [grams, setGrams] = useState(item.grams_each ?? '');
  const [saved, setSaved] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const counted = item.base_unit !== 'g';
  const noun = counted && item.display_unit !== 'count' ? item.display_unit : 'item';
  const isProduct = isProductFood(food);
  // A recognised product never shows the named-portion picker — it goes
  // straight to its own nutrition-label serving, below.
  const sizes = isProduct ? [] : servingsFor(food);

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

  /**
   * Attaching a product also fills in what one unit weighs, when it can.
   *
   * An existing item already has a history of events logged in its own
   * unit, so attaching a product here never changes what the item is
   * counted in — that would silently reinterpret every past log entry. What
   * it DOES do for a recognised product is use the product's actual
   * nutrition-label serving size for that unit's weight, never the whole
   * package standing in for it — the same number the item picker below is
   * hidden in favour of.
   */
  async function attach(raw) {
    const picked = await loadServings(raw);
    setFood(picked);
    setSearching(false);

    if (isProductFood(picked)) {
      const amount = productAmount(picked);
      // The item's own unit is a package noun ("pack", "item") most of the
      // time for a scanned product, in which case one of it really is one
      // serving. If it's some other noun already in use, leave the weight
      // for the plain grams box below rather than guessing.
      const next = amount.mode === 'servings' ? amount.grams_each : (item.grams_each || null);
      setGrams(next ?? '');
      await updateItem(item.id, { food_db_id: picked.food_db_id, grams_each: next });
      flash();
      return;
    }

    const portion = defaultServing(picked, item.display_unit || 'item');
    const per = foodUnitGrams(picked, item.display_unit || 'item');
    const next = portion?.grams ?? per.grams ?? (item.grams_each || null);
    setGrams(next ?? '');
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

      {/* A recognised product already knows its own serving size — nothing
          to ask. Everything below is only for a generic/raw food. */}
      {isProduct && (
        <p className="label muted">
          {Number(grams) > 0
            ? `One serving = ${grams} g.`
            : 'No serving size on file for this product.'}
        </p>
      )}

      {/* Counted items need one number to join the two systems up. Where we
          have portions we trust, that number is chosen by name — "large" —
          rather than typed. Where we don't, it stays a plain grams box, which
          is honest about the fact that nobody knows. */}
      {!isProduct && counted && sizes.length > 0 && (
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

      {!isProduct && counted && sizes.length === 0 && (
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

      {!isProduct && (
        <PackSize
          grams={item.pack_grams}
          onChange={async (g) => { await updateItem(item.id, { pack_grams: g }); flash(); }}
          label="How big is one?"
        />
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

      {/* Expiry dates are hidden for now — the data stays on the item
          (`item.expiry_date`) untouched, there's just nothing here to edit
          it with. */}

      <p className="label muted">
        Bought {item.added > 0 ? describe({ ...item, quantity: item.added }).main : 'an unknown amount'}
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
