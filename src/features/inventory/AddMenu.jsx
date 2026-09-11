import { useEffect, useState } from 'react';
import { useInventory } from '../../context/InventoryContext.jsx';
import { lookupFood } from '../../api/foodLookup.js';
import { recentNames } from '../../db/queries.js';
import { NATURAL_UNITS, UNITS_BY_DIMENSION, DIMENSIONS } from '../../units.js';
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
export default function AddMenu({ onScanReceipt, onClose }) {
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

        <button className="primary route-button" onClick={onScanReceipt}>
          <span className="route-title">Scan a receipt</span>
          <span className="route-note">A whole shop at once</span>
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
          <span className="route-title">Add by barcode</span>
          <span className="route-note">Type the number under the bars</span>
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
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await addItem({
        name: name.trim(),
        quantity: Number(quantity) || 1,
        unit,
        location,
        category: guessCategory(name) || 'other',
        food_db_id: initial.food_db_id || null
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Add by hand" onBack={onBack} onClose={onDone}>
      <form className="stack-tight" onSubmit={submit}>
        <label className="stack-tight">
          <span className="label muted">What is it</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Eggs" autoFocus />
        </label>

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
                {UNITS_BY_DIMENSION[DIMENSIONS.WEIGHT].map((u) => (
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

        <button className="primary" type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Adding…' : 'Add it'}
        </button>
        <p className="label muted">
          No weight needed. Nutrition can come later, or never.
        </p>
      </form>
    </Panel>
  );
}

/** Barcodes already work — lookupFood routes 8-14 digits to Open Food Facts. */
function BarcodeAdd({ onDone, onBack }) {
  const [code, setCode] = useState('');
  const [state, setState] = useState('idle'); // idle | looking | found | none
  const [food, setFood] = useState(null);

  async function look(e) {
    e.preventDefault();
    if (!/^\d{8,14}$/.test(code.trim())) return;
    setState('looking');
    try {
      const { results } = await lookupFood(code.trim(), { limit: 1 });
      if (results[0]) { setFood(results[0]); setState('found'); }
      else setState('none');
    } catch {
      setState('none');
    }
  }

  if (state === 'found') {
    return <ManualAdd onDone={onDone} onBack={() => setState('idle')}
      initial={{ name: food.name, unit: 'item', food_db_id: food.food_db_id }} />;
  }

  return (
    <Panel title="Add by barcode" onBack={onBack} onClose={onDone}>
      <form className="stack-tight" onSubmit={look}>
        <label className="stack-tight">
          <span className="label muted">The number under the bars</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            placeholder="5000112637922"
            autoFocus
          />
        </label>
        <button className="primary" type="submit" disabled={state === 'looking' || !/^\d{8,14}$/.test(code.trim())}>
          {state === 'looking' ? 'Looking…' : 'Look it up'}
        </button>
        {state === 'none' && (
          <p className="label muted">
            Not in the database. Add it by hand instead — the name is enough.
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
