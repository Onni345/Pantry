import { useState, useMemo, useRef } from 'react';
import { useInventory } from '../../context/InventoryContext.jsx';
import ItemRow from './ItemRow.jsx';
import ItemSheet from './ItemSheet.jsx';
import AddMenu from './AddMenu.jsx';
import CategoryRows from './CategoryRows.jsx';
import { bucketize } from './lenses.js';
import { usePager } from './usePager.js';
import ReceiptScan from '../receipts/ReceiptScan.jsx';
import ScanSession from '../scan/ScanSession.jsx';
import { LOCATIONS } from '../../db/schema.js';
import './inventory.css';

const LOC_VAR = { fridge: '--loc-fridge', freezer: '--loc-freezer', pantry: '--loc-pantry' };

/**
 * The kitchen screen: a place, a picture of what's in it, then the food.
 *
 * Each place is a page you travel between — swipe, arrows, or the left and
 * right keys — rather than a second row of tabs under the first. Location is
 * where you start from (you go to the fridge, not to "dairy"), so it reads
 * as somewhere you are instead of a filter you set.
 *
 * The group rows summarise what's in there in a form you can read without
 * touching anything, and tapping one jumps to that part of the list, so the
 * summary and the list are one thing rather than two views to reconcile.
 */
export default function InventoryList() {
  const { items, loading, error } = useInventory();
  const { index, dir, drag, dragging, go, jump, handlers } = usePager(LOCATIONS.length);
  const location = LOCATIONS[index];
  const [open, setOpen] = useState(null);      // item being viewed in the sheet
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [codeScan, setCodeScan] = useState(false);
  const sections = useRef({});

  const here = useMemo(
    () => items.filter((i) => i.location === location),
    [items, location]
  );
  const buckets = useMemo(() => bucketize(here), [here]);

  const counts = useMemo(() => {
    const c = {};
    for (const i of items) c[i.location] = (c[i.location] || 0) + 1;
    return c;
  }, [items]);

  function jumpTo(bucketName) {
    sections.current[bucketName]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // The sheet reads from the live list, so quantities update under it as you
  // tap rather than showing the item as it was when you opened it.
  const openItem = open ? items.find((i) => i.id === open) : null;

  return (
    <div className="stack kitchen">
      <header className="place-head">
        <button
          className="place-arrow"
          onClick={() => go(-1)}
          aria-label={`Go to ${LOCATIONS[(index - 1 + LOCATIONS.length) % LOCATIONS.length]}`}
        >
          ‹
        </button>

        <h2 className="place-name">
          {location}
          <span className="place-count">{counts[location] || 0}</span>
        </h2>

        <button
          className="place-arrow"
          onClick={() => go(1)}
          aria-label={`Go to ${LOCATIONS[(index + 1) % LOCATIONS.length]}`}
        >
          ›
        </button>
      </header>

      <div className="place-dots" role="tablist" aria-label="Where to look">
        {LOCATIONS.map((l, i) => (
          <button
            key={l}
            role="tab"
            className={`place-dot${i === index ? ' is-current' : ''}`}
            aria-selected={i === index}
            aria-label={l}
            style={{ '--dot-color': `var(${LOC_VAR[l] || '--accent'})` }}
            onClick={() => jump(i)}
          />
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div
          {...handlers}
          key={location}
          className={`place-page ${dir > 0 ? 'from-right' : 'from-left'}${dragging ? ' is-dragging' : ''}`}
          style={dragging ? { transform: `translateX(${drag}px)` } : undefined}
        >
        {here.length === 0 ? (
          <div className="card empty">
            <p className="muted">Nothing in the {location} yet.</p>
            <p className="label muted">Scan a receipt to fill it in one go.</p>
          </div>
        ) : (
          <>
          <CategoryRows
            buckets={buckets}
            onPick={jumpTo}
          />

          <div className="stack food-list">
            <h2 className="food-list-head">Your food</h2>
            {buckets.map((bucket, i) => (
              <section
                key={bucket.name}
                ref={(el) => { sections.current[bucket.name] = el; }}
                className="bucket"
                style={{ '--i': i }}
              >
                <h3 className="bucket-head">
                  <span
                    className="bucket-dot"
                    style={{ background: `var(${bucket.tone}, var(--tone-other))` }}
                    aria-hidden="true"
                  />
                  {bucket.name}
                  <span className="bucket-count label">{bucket.items.length}</span>
                </h3>
                <ul className="item-list">
                  {bucket.items.map((item) => (
                    <ItemRow key={item.id} item={item} onOpen={() => setOpen(item.id)} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          </>
        )}
        </div>
      )}

      <button className="primary add-fab" onClick={() => setAdding(true)} aria-label="Add food">
        <span className="add-fab-plus" aria-hidden="true">+</span> Add
      </button>

      {openItem && <ItemSheet item={openItem} onClose={() => setOpen(null)} />}
      {adding && (
        <AddMenu
          onClose={() => setAdding(false)}
          onScanReceipt={() => { setAdding(false); setScanning(true); }}
          onScanCode={() => { setAdding(false); setCodeScan(true); }}
        />
      )}
      {scanning && <ReceiptScan onClose={() => setScanning(false)} />}
      {codeScan && <ScanSession onClose={() => setCodeScan(false)} />}
    </div>
  );
}
