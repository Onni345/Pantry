import { servingsFor } from '../features/inventory/amounts.js';
import './ServingPicker.css';

/**
 * "2 × large — 50g".
 *
 * A count and a named portion, which is how people actually hold food in
 * their heads. Grams are shown beside the name so the number is never a
 * secret, but nobody has to type one.
 *
 * It renders nothing when we don't have portions we trust for this food. A
 * dropdown of guesses would be worse than no dropdown: it looks like the app
 * knows something, and it doesn't.
 */
export default function ServingPicker({
  food, quantity, serving, onQuantity, onServing, label = 'How many'
}) {
  const options = servingsFor(food);
  if (!options.length) return null;

  const current = options.find((o) => o.label === serving?.label) || serving || options[0];

  return (
    <div className="stack-tight serving-picker">
      <span className="label muted">{label}</span>
      <div className="serving-row">
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={quantity}
          onChange={(e) => onQuantity(e.target.value)}
          aria-label="How many"
        />
        <select
          value={current.label}
          onChange={(e) => onServing(options.find((o) => o.label === e.target.value))}
          aria-label="Portion"
        >
          {options.map((o) => (
            <option key={o.label} value={o.label}>
              {o.label} — {fmt(o.grams)}g
            </option>
          ))}
        </select>
      </div>
      <span className="label muted">
        {fmt((Number(quantity) || 0) * current.grams)} g total
      </span>
    </div>
  );
}

const fmt = (n) => {
  const v = Number(n) || 0;
  return v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
};
