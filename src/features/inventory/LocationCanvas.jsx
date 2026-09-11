import { useMemo } from 'react';
import { squarify } from './treemap.js';
import { LENSES } from './lenses.js';

/**
 * The composition at the top of the kitchen screen: one rectangle for the
 * selected location, tiled into blocks for whatever the lens is grouping by.
 *
 * It answers "what kind of stuff is in here" at a glance, and it is
 * navigation — tapping a block scrolls to that section of the list. Block
 * size is inventory presence (how many different things), deliberately not
 * grams or calories, so two gallons of milk don't dwarf eight eggs.
 */
export default function LocationCanvas({ buckets, lens, onLensChange, onPick }) {
  const rects = useMemo(() => squarify(buckets.map((b) => b.presence)), [buckets]);

  if (buckets.length === 0) return null;

  return (
    <div className="canvas-wrap">
      <div className="canvas" role="list">
        {buckets.map((bucket, i) => {
          const r = rects[i];
          // Below a certain tile size the count won't fit next to the name.
          const roomy = r.w > 22 && r.h > 18;
          return (
            <button
              key={bucket.name}
              role="listitem"
              className="block"
              style={{
                left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`,
                background: `var(${bucket.tone}, var(--tone-other))`
              }}
              onClick={() => onPick(bucket.name)}
              aria-label={`${bucket.name}, ${bucket.items.length} items — jump to section`}
            >
              <span className="block-name">{bucket.name}</span>
              {roomy && <span className="block-count">{bucket.items.length}</span>}
            </button>
          );
        })}
      </div>

      <div className="row canvas-lens">
        <span className="label muted">Grouped by</span>
        <select value={lens} onChange={(e) => onLensChange(e.target.value)} aria-label="Group by">
          {LENSES.map((l) => (
            <option key={l.key} value={l.key}>{l.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
