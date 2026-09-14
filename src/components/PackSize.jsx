import { useState } from 'react';
import { WEIGHT_UNITS, WEIGHT_UNIT_NAMES, formatGrams } from '../units.js';

/**
 * "How big is the one you bought?"
 *
 * A 454 g jar, a 5 lb bag, a 2 kg sack. Optional on every product and
 * meaningful on all of them: nutrition is published per 100 g, so knowing
 * what you actually own is what turns a reference figure into your figure.
 * Without it the app is stuck with whatever serving size the database
 * happened to pick.
 *
 * Deliberately a number and a unit rather than a dropdown of guesses — the
 * answer is printed on the packet in front of you.
 */
export default function PackSize({ grams, onChange, label = 'Package size' }) {
  const [value, setValue] = useState(() => (grams ? String(grams) : ''));
  const [unit, setUnit] = useState('g');

  function commit(nextValue, nextUnit) {
    const n = Number(nextValue);
    onChange(Number.isFinite(n) && n > 0 ? n * WEIGHT_UNITS[nextUnit] : null);
  }

  const asGrams = Number(value) > 0 ? Number(value) * WEIGHT_UNITS[unit] : null;

  return (
    <div className="stack-tight pack-size">
      <span className="label muted">{label}</span>
      <div className="pack-row">
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={value}
          onChange={(e) => { setValue(e.target.value); commit(e.target.value, unit); }}
          placeholder="optional"
          aria-label={label}
        />
        <select
          value={unit}
          onChange={(e) => { setUnit(e.target.value); commit(value, e.target.value); }}
          aria-label="Package size unit"
        >
          {WEIGHT_UNIT_NAMES.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      {asGrams != null && unit !== 'g' && (
        <span className="label muted">{formatGrams(asGrams)}</span>
      )}
    </div>
  );
}
