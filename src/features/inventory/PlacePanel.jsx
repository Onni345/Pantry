import { useMemo, useRef } from 'react';
import ItemRow from './ItemRow.jsx';
import CategoryRows from './CategoryRows.jsx';
import { bucketize } from './lenses.js';

/**
 * One place's worth of food -- everything that used to be the whole page
 * body, now just one face of the wheel. Three of these exist at once (see
 * InventoryList), each computing its own buckets, so the side panels you
 * glimpse mid-spin are real content, not a placeholder.
 */
export default function PlacePanel({ location, items, active, onOpen }) {
  const here = useMemo(
    () => items.filter((i) => i.location === location),
    [items, location]
  );
  const buckets = useMemo(() => bucketize(here), [here]);
  const sections = useRef({});

  function jumpTo(bucketName) {
    sections.current[bucketName]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (here.length === 0) {
    return (
      <div className="card empty">
        <p className="muted">Nothing in the {location} yet.</p>
        <p className="label muted">Scan a receipt to fill it in one go.</p>
      </div>
    );
  }

  return (
    <div className="stack" inert={active ? undefined : ''}>
      <CategoryRows buckets={buckets} onPick={jumpTo} />

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
                <ItemRow key={item.id} item={item} onOpen={() => onOpen(item.id)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
