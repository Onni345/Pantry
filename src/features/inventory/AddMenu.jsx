import { useEffect, useState } from 'react';
import { useInventory } from '../../context/InventoryContext.jsx';
import { lookupFood } from '../../api/foodLookup.js';
import { gramsPerUnit, defaultServing, hasConfidentServings } from '../../api/portion.js';
import { loadServings } from '../../api/foodLookup.js';
import FoodSearchSheet from '../../components/FoodSearchSheet.jsx';
import ServingPicker from '../../components/ServingPicker.jsx';
import PackSize from '../../components/PackSize.jsx';
import '../../components/PackSize.css';
import { isPluCode, pluQuery } from '../../api/plu.js';
import { recentNames } from '../../db/queries.js';
import { NATURAL_UNITS, WEIGHT_UNIT_NAMES } from '../../units.js';
import { LOCATIONS } from '../../db/schema.js';
import { guessCategory } from './categoryGuess.js';
import './addmenu.css';

/**
 * The one persistent way in. Scanning a receipt is first because it's the
 * only route that fills a whole shop in one go; the others are for the
 * single thing you picked up on the way home.
 *
 * Every option here does something real. There is no barcode camera yet, so
 * that route asks for the number rather than pretending to scan — typing
 * thirteen digits genuinely works today, and a fake camera button would not.
 */
export default function AddMenu({ onScanReceipt, onScanCode, onClose }) {
  const [route, setRoute] = useState(null); // null | 'manual' | 'barcode' | 'recent'

  if (route === 'manual') return <ManualAdd onDone={onClose} onBack={() => setRoute(null)} />;
  if (route === 'barcode') return <BarcodeAdd onDone={onClose} onBack={() => setRoute(null)} />;
  if (route === 'recent') return <RecentAdd onDone={onClose} onBack={() => setRoute(null)} />;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add food">
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2>Add food</h2>
          <button className="link-button" onClick={onClose}>Close</button>
        </div>

        <button className="primary route-button" onClick={onScanCode}>
          <span className="route-title">Scan barcodes</span>
          <span className="route-note">
            Exact products, one after another — produce stickers too
          </span>
        </button>

        <button className="route-button" onClick={onScanReceipt}>
          <span className="route-title">Scan a receipt</span>
          <span className="route-note">A whole shop at once, from the paper</span>
        </button>

        <button className="route-button" onClick={() => setRoute('recent')}>
          <span className="route-title">Add from recent</span>
          <span className="route-note">Something you buy often</span>
        </button>

        <button className="route-button" onClick={() => setRoute('manual')}>
          <span className="route-title">Add by hand</span>
          <span className="route-note">Name and how many</span>
        </button>

        <button className="route-button" onClick={() => setRoute('barcode')}>
          <span className="route-title">Type a code</span>
          <span className="route-note">A barcode number, or a produce sticker</span>
        </button>
      </div>
    </div>
  );
}

/** Name, how many, what they're called, where it goes. Nothing else. */
function ManualAdd({ onDone, onBack, initial = {} }) {
  const { addItem } = useInventory();
  const [name, setName] = useState(initial.name || '');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState(initial.unit || 'item');
  const [location, setLocation] = useState(initial.location || 'fridge');
  const [food, setFood] = useState(initial.food || null);
  const [serving, setServing] = useState(null);
  const [packGrams, setPackGrams] = useState(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  // A picked portion wins outright — it is what the person chose. Otherwise
  // fall back to working out what one of `unit` weighs.
  const per = gramsPerUnit(food, unit);
  const usePicker = hasConfidentServings(food);
  const gramsEach = serving?.grams ?? per.grams;

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await addItem({
        name: name.trim(),
        quantity: Number(quantity) || 1,
        location,
        category: guessCategory(name) || 'other',
        // "3 large eggs" stores unit 'egg' and 50 g each, so the list says
        // "3 eggs" and the macros still work out.
        unit: usePicker && serving ? servingUnit(serving, unit) : unit,
        food_db_id: food?.food_db_id || initial.food_db_id || null,
        grams_each: gramsEach,
        pack_grams: packGrams
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  if (searching) {
    return (
      <FoodSearchSheet
        initialQuery={name}
        title="Find product"
        onPick={async (picked) => {
          setFood(picked);
          if (!name.trim()) setName(picked.name);
          setSearching(false);
          // The full portion list needs one more call, so it happens after
          // the pick rather than for every row of the search.
          const full = await loadServings(picked);
          setFood(full);
          setServing(defaultServing(full, unit));
        }}
        onClose={() => setSearching(false)}
      />
    );
  }

  return (
    <Panel title="Add by hand" onBack={onBack} onClose={onDone}>
      <form className="stack-tight" onSubmit={submit}>
        <label className="stack-tight">
          <span className="label muted">What is it</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Eggs" autoFocus />
        </label>

        {/* Attaching a product is optional and always has been — but until
            now there was no way to do it at all from here, which meant a
            hand-added item could never have macros. */}
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
              <span className="label muted">No nutrition attached</span>
            )}
          </div>
          <button type="button" className="link-button" onClick={() => setSearching(true)}>
            {food ? 'Change' : 'Find product'}
          </button>
        </div>

        {usePicker ? (
          <div className="add-qty is-picker">
            <ServingPicker
              food={food}
              quantity={quantity}
              serving={serving}
              onQuantity={setQuantity}
              onServing={setServing}
            />
            <label className="stack-tight">
              <span className="label muted">Where</span>
              <select value={location} onChange={(e) => setLocation(e.target.value)}>
                {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          </div>
        ) : (
        <div className="add-qty">
          <label className="stack-tight">
            <span className="label muted">How many</span>
            <input
              type="number" inputMode="decimal" min="0" step="any"
              value={quantity} onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label className="stack-tight">
            <span className="label muted">Of what</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              <optgroup label="Things you count">
                {['item', ...NATURAL_UNITS.filter((u) => u !== 'item')].map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </optgroup>
              <optgroup label="By weight">
                {WEIGHT_UNIT_NAMES.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="stack-tight">
            <span className="label muted">Where</span>
            <select value={location} onChange={(e) => setLocation(e.target.value)}>
              {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        </div>
        )}

        {/* Optional on every product, and the thing that lets per-100 g
            macros scale to the jar or bag actually in the cupboard. */}
        <PackSize grams={packGrams} onChange={setPackGrams} label="How big is one?" />

        <button className="primary" type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Adding…' : 'Add it'}
        </button>
        {!usePicker && (
          <p className="label muted">
            {per.grams != null
              ? `${per.exact ? 'One' : 'About one'} ${unit} = ${per.grams} g${per.basis === 'table' ? ' (estimated)' : ''}.`
              : 'No weight needed. Nutrition can come later, or never.'}
          </p>
        )}
      </form>
    </Panel>
  );
}

/** Barcodes already work — lookupFood routes 8-14 digits to Open Food Facts. */
function BarcodeAdd({ onDone, onBack }) {
  const [code, setCode] = useState('');
  const [state, setState] = useState('idle'); // idle | looking | found | none
  const [food, setFood] = useState(null);

  const trimmed = code.trim();
  const valid = /^\d{8,14}$/.test(trimmed) || isPluCode(trimmed);

  async function look(e) {
    e.preventDefault();
    if (!valid) return;
    setState('looking');
    try {
      // Four or five digits is a produce sticker, which resolves through a
      // table shipped in the app rather than a lookup; anything longer is a
      // barcode and goes to the databases.
      const query = isPluCode(trimmed) ? pluQuery(trimmed) : trimmed;
      if (!query) { setState('none'); return; }
      const { results } = await lookupFood(query, { limit: 1 });
      if (results[0]) { setFood(results[0]); setState('found'); }
      else setState('none');
    } catch {
      setState('none');
    }
  }

  if (state === 'found') {
    return <ManualAdd onDone={onDone} onBack={() => setState('idle')}
      initial={{ name: food.name, unit: 'item', food }} />;
  }

  return (
    <Panel title="Add by barcode" onBack={onBack} onClose={onDone}>
      <form className="stack-tight" onSubmit={look}>
        <label className="stack-tight">
          <span className="label muted">Barcode number, or a 4–5 digit produce sticker</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            placeholder="5000112637922 or 4011"
            autoFocus
          />
        </label>
        <button className="primary" type="submit" disabled={state === 'looking' || !valid}>
          {state === 'looking' ? 'Looking…' : 'Look it up'}
        </button>
        {state === 'none' && (
          <p className="label muted">
            Not found. Add it by hand instead — the name is enough.
          </p>
        )}
      </form>
    </Panel>
  );
}

/** Things this household has bought before, newest first. */
function RecentAdd({ onDone, onBack }) {
  const { householdId } = useInventory();
  const [names, setNames] = useState(null);
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    recentNames(householdId).then(setNames).catch(() => setNames([]));
  }, [householdId]);

  if (picked) {
    return <ManualAdd onDone={onDone} onBack={() => setPicked(null)} initial={picked} />;
  }

  return (
    <Panel title="Add from recent" onBack={onBack} onClose={onDone}>
      {names === null && <p className="muted">Looking…</p>}
      {names?.length === 0 && (
        <p className="muted">Nothing bought yet — add something by hand first.</p>
      )}
      <div className="recent-list">
        {names?.map((r) => (
          <button key={r.name} className="recent-item" onClick={() => setPicked(r)}>
            <span>{r.name}</span>
            <span className="label muted">{r.unit === 'count' ? 'item' : r.unit} · {r.location}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

/**
 * The noun a portion implies. Picking "large" for eggs should leave the item
 * counted in eggs, not in "larges" — the size qualifies the noun, it isn't
 * the noun itself.
 */
function servingUnit(serving, fallback) {
  const label = String(serving?.label || '').toLowerCase();
  const known = NATURAL_UNITS.find((u) => label.includes(u));
  if (known) return known;
  if (/package|packet/.test(label)) return 'pack';
  return fallback;
}

function Panel({ title, onBack, onClose, children }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <div className="row">
            <button className="link-button" onClick={onBack}>Back</button>
            <h2>{title}</h2>
          </div>
          <button className="link-button" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
