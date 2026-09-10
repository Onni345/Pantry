import { useState } from 'react';
import { useInventory } from '../../context/InventoryContext.jsx';
import AmountEntry from '../../components/AmountEntry.jsx';
import { formatBase, humanize } from '../../units.js';

/**
 * The subtitle shows location and nothing else by default.
 *
 * A number you did not ask for is noise: protein per 100 g is irrelevant while
 * you are looking for the milk. But if you sorted BY protein, that number is
 * the reason the row is where it is, so it earns its place. The extra field
 * follows the sort.
 */
function detailFor(item, sort) {
  if (sort === 'protein') {
    return item.macros?.protein_g != null
      ? `${Math.round(item.macros.protein_g * 10) / 10}g protein/100g`
      : 'no macro data';
  }
  if (sort === 'category') return item.category;
  if (sort === 'expiry') return expiryLabel(item) || 'no date set';
  return null;
}

/** Only mentions expiry when it is close enough to act on. */
function expiryLabel(item) {
  if (!item.expiry_date) return null;
  const days = Math.round((Date.parse(item.expiry_date) - Date.now()) / 86400000);
  const est = item.expiry_estimated ? ' (est.)' : '';
  if (days < 0) return `expired ${-days}d ago${est}`;
  if (days === 0) return `use today${est}`;
  return `${days}d left${est}`;
}

export default function ItemCard({ item, sort }) {
  const { logAmount, markEmpty, undoLast, removeItem } = useInventory();
  const [panel, setPanel] = useState(null); // null | 'use' | 'add' | 'more' | 'delete'
  const [busy, setBusy] = useState(false);

  const out = item.quantity === 0;
  const shown = humanize(item.quantity, item.base_unit);
  const detail = detailFor(item, sort);

  // Expiry is surfaced unprompted only inside a week — beyond that it is not
  // yet information, just clutter.
  const expiry = expiryLabel(item);
  const days = item.expiry_date
    ? Math.round((Date.parse(item.expiry_date) - Date.now()) / 86400000)
    : null;
  const urgent = days !== null && days <= 7 && sort !== 'expiry';

  async function run(fn) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setPanel(null);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (name) => setPanel((p) => (p === name ? null : name));

  return (
    <li className={`card item${out ? ' item-out' : ''}`}>
      <div className="item-main">
        <p className="item-name">{item.name}</p>
        <p className="label muted">
          {item.location}
          {detail && ` · ${detail}`}
          {urgent && <span className={days < 0 ? ' danger-text' : ''}> · {expiry}</span>}
        </p>
      </div>

      <div className="item-qty">
        <span className="qty-value">{shown.value}</span>
        <span className="label muted">{shown.unit === 'count' ? '' : shown.unit}</span>
      </div>

      <div className="item-actions row">
        <button onClick={() => toggle('use')} disabled={busy || out}>Use</button>
        <button onClick={() => toggle('add')} disabled={busy}>Add</button>
        <button
          className="item-more"
          onClick={() => toggle('more')}
          disabled={busy}
          aria-label={`More actions for ${item.name}`}
          aria-expanded={panel === 'more'}
        >
          ⋯
        </button>
      </div>

      {(panel === 'use' || panel === 'add') && (
        <div className="item-panel">
          <AmountEntry
            item={item}
            direction={panel === 'use' ? 'remove' : 'add'}
            onCancel={() => setPanel(null)}
            onSubmit={({ value, unit }) =>
              run(() =>
                logAmount(item.id, {
                  value,
                  unit,
                  direction: panel === 'use' ? 'remove' : 'add'
                })
              )
            }
          />
        </div>
      )}

      {panel === 'more' && (
        <div className="item-panel row wrap">
          {!out && (
            <button onClick={() => run(() => markEmpty(item.id))} disabled={busy}>
              Finished it
            </button>
          )}
          <button onClick={() => run(() => undoLast(item.id))} disabled={busy}>
            Undo last
          </button>
          <button className="danger-text" onClick={() => setPanel('delete')} disabled={busy}>
            Delete
          </button>
        </div>
      )}

      {panel === 'delete' && (
        <div className="item-panel stack-tight">
          <p className="label">
            Delete {item.name}? Its {formatBase(item.quantity, item.base_unit)} and history go too.
          </p>
          <div className="row">
            <button onClick={() => setPanel('more')} disabled={busy}>Keep</button>
            <button
              className="danger-text"
              onClick={() => run(() => removeItem(item.id))}
              disabled={busy}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
