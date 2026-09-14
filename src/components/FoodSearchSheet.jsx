import { useEffect, useRef, useState } from 'react';
import { lookupFood, PREFER } from '../api/foodLookup.js';
import './FoodSearchSheet.css';

const DEBOUNCE_MS = 250;

/**
 * Find a product. One component, used everywhere a food gets chosen — the
 * receipt card's "Change item", the item sheet's repair path, manual add.
 *
 * Results are grouped the way a person thinks about them rather than the way
 * the databases are organised: things this household has actually used, then
 * named products, then the plain ingredient. A brand and a per-100 g macro
 * line sit under each, because "which of these four cheddars is mine" is
 * answered by the brand and the calories, not by the row's position.
 */
export default function FoodSearchSheet({
  initialQuery = '', brand = null, onPick, onClose, title = 'Find product'
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [active, setActive] = useState(0);
  const abortRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setNotice(''); return; }

    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const { results, error } = await lookupFood(q, {
          signal: ctrl.signal, limit: 24, prefer: PREFER.AUTO, brand
        });
        setResults(results);
        setNotice(error);
        setActive(0);
      } catch (e) {
        if (e.name !== 'AbortError') setNotice('Lookup failed.');
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(t);
  }, [query, brand]);

  const sections = groupResults(results);
  const flat = sections.flatMap((s) => s.items);

  function onKeyDown(e) {
    if (e.key === 'Escape') { onClose(); return; }
    if (!flat.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % flat.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? flat.length - 1 : i - 1)); }
    else if (e.key === 'Enter' && flat[active]) { e.preventDefault(); onPick(flat[active]); }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet search-sheet"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-label={title}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="link-button" onClick={onClose}>Close</button>
        </div>

        <input
          ref={inputRef}
          className="search-field"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Jasmine rice, or a barcode"
          autoComplete="off"
          aria-label="Search foods"
        />

        {loading && <p className="label muted">Searching…</p>}
        {notice && !loading && <p className="label muted">{notice}</p>}
        {!loading && !notice && query.trim().length >= 2 && flat.length === 0 && (
          <p className="label muted">Nothing found. A different word often helps — try the plain name.</p>
        )}

        <SearchResults
          sections={sections}
          flat={flat}
          active={active}
          onHover={setActive}
          onPick={onPick}
        />
      </div>
    </div>
  );
}

/**
 * The list itself, kept free of fetching and state so it can be rendered from
 * fixture data — which is how the screenshot harness checks that a long brand
 * name or a missing photo doesn't break the row.
 */
export function SearchResults({ sections, flat, active, onHover, onPick }) {
  return (
    <div className="search-results">
      {sections.map((section) => (
        <section key={section.key}>
          <h3 className="search-section">{section.label}</h3>
          <ul className="search-list">
            {section.items.map((food) => {
              const i = flat.indexOf(food);
              return (
                <li key={food.food_db_id}>
                  <button
                    className={`search-row${i === active ? ' is-active' : ''}`}
                    onMouseEnter={() => onHover(i)}
                    onClick={() => onPick(food)}
                  >
                    {food.image
                      ? <img className="search-thumb" src={food.image} alt="" loading="lazy" />
                      : <span className="search-thumb is-empty" aria-hidden="true" />}
                    <span className="search-text">
                      <span className="search-name">{food.name}</span>
                      {(food.brand || food.brand_owner) && (
                        <span className="label muted">{food.brand || food.brand_owner}</span>
                      )}
                      <span className="label muted">{macroLine(food)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Recent / Branded / Generic. Recent means this household has used it before —
 * cached foods come out of the local database and are almost always the right
 * answer for a repeat purchase.
 */
export function groupResults(results) {
  const recent = [];
  const branded = [];
  const generic = [];

  for (const r of results) {
    if (r.cached_at) recent.push(r);
    else if (r.detail === 'Branded' || r.source === 'off' || r.brand) branded.push(r);
    else generic.push(r);
  }

  return [
    { key: 'recent', label: 'Used before', items: recent },
    { key: 'branded', label: 'Products', items: branded },
    { key: 'generic', label: 'Generic', items: generic }
  ].filter((s) => s.items.length);
}

export function macroLine(food) {
  const m = food.macros_per_unit || {};
  const parts = [];
  if (m.calories != null) parts.push(`${Math.round(m.calories)} kcal`);
  if (m.protein_g != null) parts.push(`${round1(m.protein_g)}g P`);
  if (m.carbs_g != null) parts.push(`${round1(m.carbs_g)}g C`);
  if (m.fat_g != null) parts.push(`${round1(m.fat_g)}g F`);
  if (!parts.length) return food.detail || '';
  return `${parts.join(' · ')} / 100g`;
}

const round1 = (n) => Math.round(n * 10) / 10;
