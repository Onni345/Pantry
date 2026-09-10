import { useState, useMemo } from 'react';
import { useInventory } from '../../context/InventoryContext.jsx';
import AddItemForm from './AddItemForm.jsx';
import ItemCard from './ItemCard.jsx';
import InventoryControls from './InventoryControls.jsx';
import { applyView, defaultView } from './sortFilter.js';
import './inventory.css';

export default function InventoryList() {
  const { items, loading, error } = useInventory();
  const [view, setView] = useState(defaultView);

  const shown = useMemo(() => applyView(items, view), [items, view]);
  const hiddenCount = items.length - shown.length;

  return (
    <div className="stack inventory">
      <AddItemForm />

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="card empty">
          <p className="muted">Nothing logged yet. Add the first thing you bought.</p>
        </div>
      ) : (
        <>
          <InventoryControls items={items} view={view} onChange={setView} />

          {shown.length === 0 ? (
            <div className="card empty">
              <p className="muted">Nothing matches those filters.</p>
            </div>
          ) : (
            <ul className="item-list stack-tight">
              {shown.map((item) => (
                <ItemCard key={item.id} item={item} sort={view.sort} />
              ))}
            </ul>
          )}

          {hiddenCount > 0 && shown.length > 0 && (
            <p className="label muted">{hiddenCount} hidden by filters</p>
          )}
        </>
      )}
    </div>
  );
}
