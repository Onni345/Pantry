import { useState } from 'react';
import { useInventory } from '../../context/InventoryContext.jsx';
import { CATEGORIES, LOCATIONS } from '../../db/schema.js';
import { UNITS_BY_DIMENSION, DIMENSIONS, unitLabel } from '../../units.js';
import FoodSearchInput from '../../components/FoodSearchInput.jsx';
import { guessCategory } from './categoryGuess.js';

const blank = {
  name: '',
  quantity: '1',
  unit: 'count',
  category: 'other',
  location: 'fridge',
  expiry_date: ''
};

// `defaultOpen` exists so the expanded form can be rendered in tests. The
// collapsed state hides most of this component from any render-based check.
export default function AddItemForm({ defaultOpen = false }) {
  const { addItem } = useInventory();
  const [open, setOpen] = useState(defaultOpen);
  const [form, setForm] = useState(blank);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  function reset() {
    setForm(blank);
    setSelected(null);
    setError('');
  }

  function handleSelect(food) {
    setSelected(food);
    setForm((f) => ({
      ...f,
      name: food.name,
      // Macros are per 100g, so grams is the unit that keeps them meaningful.
      unit: f.unit === 'count' ? 'g' : f.unit,
      category: guessCategory(food.name) || f.category
    }));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await addItem({
        ...form,
        quantity: Number(form.quantity) || 0,
        expiry_date: form.expiry_date || null,
        food_db_id: selected?.food_db_id || null
      });
      reset();
      setOpen(false);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="primary add-toggle" onClick={() => setOpen(true)}>
        Add an item
      </button>
    );
  }

  return (
    <form className="card stack add-form" onSubmit={submit}>
      <FoodSearchInput
        value={form.name}
        selected={selected}
        onChange={(name) => setForm((f) => ({ ...f, name }))}
        onSelect={handleSelect}
        onClear={() => setSelected(null)}
      />

      <div className="field-grid">
        <label className="stack-tight">
          <span className="label">Quantity</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={form.quantity}
            onChange={set('quantity')}
          />
        </label>
        <label className="stack-tight">
          <span className="label">Unit</span>
          <select value={form.unit} onChange={set('unit')}>
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

      <div className="field-grid">
        <label className="stack-tight">
          <span className="label">Where</span>
          <select value={form.location} onChange={set('location')}>
            {LOCATIONS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="stack-tight">
          <span className="label">Category</span>
          <select value={form.category} onChange={set('category')}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="stack-tight">
        <span className="label">
          Use by <span className="muted">— leave blank to estimate it</span>
        </span>
        <input type="date" value={form.expiry_date} onChange={set('expiry_date')} />
      </label>

      {error && <p className="error label">{error}</p>}

      <div className="row">
        <button type="button" onClick={() => { reset(); setOpen(false); }}>
          Cancel
        </button>
        <button className="primary" type="submit" disabled={busy || !form.name.trim()}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
    </form>
  );
}
