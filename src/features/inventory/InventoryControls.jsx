import { SORTS, presentValues } from './sortFilter.js';

export default function InventoryControls({ items, view, onChange }) {
  const set = (k) => (e) =>
    onChange({ ...view, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const locations = presentValues(items, 'location');
  const categories = presentValues(items, 'category');

  return (
    <div className="controls stack-tight">
      <input
        type="search"
        value={view.search}
        onChange={set('search')}
        placeholder="Search items"
        aria-label="Search items"
      />

      <div className="controls-row">
        <label className="control">
          <span className="label muted">Sort</span>
          <select value={view.sort} onChange={set('sort')}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </label>

        {locations.length > 1 && (
          <label className="control">
            <span className="label muted">Where</span>
            <select value={view.location} onChange={set('location')}>
              <option value="all">All</option>
              {locations.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
        )}

        {categories.length > 1 && (
          <label className="control">
            <span className="label muted">Category</span>
            <select value={view.category} onChange={set('category')}>
              <option value="all">All</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <label className="row hide-empty">
        <input
          type="checkbox"
          checked={view.hideEmpty}
          onChange={set('hideEmpty')}
          style={{ width: 'auto' }}
        />
        <span className="label">Hide finished items</span>
      </label>
    </div>
  );
}
