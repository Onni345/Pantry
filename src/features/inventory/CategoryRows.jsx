import { LENSES } from './lenses.js';
import './groups.css';

/**
 * The top of the kitchen screen: one wide row per group.
 *
 * The whole point is that it reads without being touched. A row says what the
 * group is, how much is in it, what's actually in there by name, and whether
 * anything in it needs using — four facts, no interaction, no legend to
 * learn. Tapping jumps to that part of the list below.
 */
export default function CategoryRows({ buckets, lens, onLensChange, onPick }) {
  if (buckets.length === 0) return null;

  return (
    <div className="groups-wrap">
      <div className="groups">
        {buckets.map((bucket, i) => (
          <GroupRow key={bucket.name} bucket={bucket} index={i} onPick={() => onPick(bucket.name)} />
        ))}
      </div>

      <div className="row groups-lens">
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

function GroupRow({ bucket, index, onPick }) {
  const n = bucket.items.length;

  // Every name, in the order the list shows them. CSS truncates to whatever
  // fits, so a wide window simply shows more of them — no magic number to
  // pick, and no "+3 more" that's wrong at half the widths.
  const preview = bucket.items.map((i) => i.name).join(' · ');

  const needsUsing = bucket.items.filter((i) => {
    if (!i.expiry_date || i.quantity === 0) return false;
    return Date.parse(i.expiry_date) - Date.now() <= 2 * 86400000;
  }).length;
  const gone = bucket.items.filter((i) => i.quantity === 0).length;

  return (
    <button
      className="group-row"
      style={{ background: `var(${bucket.tone}, var(--tone-other))`, '--i': index }}
      onClick={onPick}
      aria-label={`${bucket.name}, ${n} items — jump to section`}
    >
      <span className="group-top">
        <span className="group-name">{bucket.name}</span>
        <span className="group-count">{n} {n === 1 ? 'item' : 'items'}</span>
      </span>

      <span className="group-preview">{preview}</span>

      {(needsUsing > 0 || gone > 0) && (
        <span className="group-flag">
          {needsUsing > 0 && `${needsUsing} to use soon`}
          {needsUsing > 0 && gone > 0 && ' · '}
          {gone > 0 && `${gone} finished`}
        </span>
      )}
    </button>
  );
}
