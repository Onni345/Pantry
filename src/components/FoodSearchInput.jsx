import { useState, useEffect, useRef, useId } from 'react';
import { lookupFood } from '../api/foodLookup.js';
import './FoodSearchInput.css';

const DEBOUNCE_MS = 300;

/**
 * Name field with search-as-you-type against the food databases.
 *
 * Typing freely is always allowed — a match is an enrichment, not a
 * requirement. Picking one attaches a food_db_id so macros can be derived
 * later; typing "leftover curry" and moving on is equally valid.
 */
export default function FoodSearchInput({ value, onChange, onSelect, selected, onClear }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [active, setActive] = useState(-1);
  const abortRef = useRef(null);
  const boxRef = useRef(null);
  const listId = useId();

  useEffect(() => {
    if (selected) return; // already resolved; stop searching
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      setNotice('');
      return;
    }

    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const { results, error } = await lookupFood(q, { signal: ctrl.signal });
        setResults(results);
        setNotice(error);
        setActive(-1);
        setOpen(true);
      } catch (e) {
        if (e.name !== 'AbortError') setNotice('Lookup failed.');
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(t);
  }, [value, selected]);

  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function choose(food) {
    onSelect(food);
    setOpen(false);
    setResults([]);
  }

  function onKeyDown(e) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  if (selected) {
    return (
      <div className="stack-tight">
        <span className="label">Name</span>
        <div className="food-chosen">
          <div className="food-chosen-text">
            <p className="food-chosen-name">{selected.name}</p>
            <p className="label muted">{macroLine(selected)}</p>
          </div>
          <button type="button" className="link-button" onClick={onClear}>
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-tight food-search" ref={boxRef}>
      <span className="label">Name</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Whole milk, or a barcode"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
      />

      {loading && <p className="label muted">Searching…</p>}
      {notice && !loading && <p className="label muted">{notice}</p>}

      {open && results.length > 0 && (
        <ul className="food-results" id={listId} role="listbox">
          {results.map((food, i) => (
            <li key={food.food_db_id} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`food-result${i === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(food)}
              >
                <span className="food-result-name">{food.name}</span>
                <span className="label muted">{macroLine(food)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function macroLine(food) {
  const m = food.macros_per_unit || {};
  const parts = [];
  if (m.calories != null) parts.push(`${Math.round(m.calories)} kcal`);
  if (m.protein_g != null) parts.push(`${round1(m.protein_g)}g protein`);
  if (m.carbs_g != null) parts.push(`${round1(m.carbs_g)}g carbs`);
  if (m.fat_g != null) parts.push(`${round1(m.fat_g)}g fat`);
  if (!parts.length) return food.detail || '';
  return `${parts.join(' · ')} per 100g`;
}

const round1 = (n) => Math.round(n * 10) / 10;
