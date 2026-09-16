import { useState, useEffect, useMemo } from 'react';
import { useInventory } from '../../context/InventoryContext.jsx';
import { getMacroInputs } from '../../db/queries.js';
import { summarize } from './macros.js';
import './macros.css';

export default function MacrosSummary() {
  const { householdId, items } = useInventory();
  const [inputs, setInputs] = useState(null);

  // `items` changes on every write, which is the cheapest signal that the log
  // moved and these numbers need re-deriving.
  useEffect(() => {
    let live = true;
    getMacroInputs(householdId).then((data) => live && setInputs(data));
    return () => { live = false; };
  }, [householdId, items]);

  const summary = useMemo(() => (inputs ? summarize(inputs) : null), [inputs]);

  if (!summary) return <p className="muted">Loading…</p>;

  const { totals, coverage } = summary;
  const ate = coverage.gramsCounted > 0 || coverage.gramsUnmatched > 0 || coverage.countedUnits > 0;

  return (
    <div className="stack macros">
      {!ate ? (
        <div className="card empty">
          <p className="muted">
            Nothing logged as used in this window. Macros come from what you take
            out, not what you buy.
          </p>
        </div>
      ) : (
        <>
          <div className="macro-grid">
            <Stat label="Calories" value={totals.calories} unit="kcal" />
            <Stat label="Protein" value={totals.protein_g} unit="g" />
            <Stat label="Carbs" value={totals.carbs_g} unit="g" />
            <Stat label="Fat" value={totals.fat_g} unit="g" />
          </div>

          <Coverage coverage={coverage} />

        </>
      )}
    </div>
  );
}

function Stat({ label, value, unit }) {
  return (
    <div className="card macro-stat">
      <p className="label muted">{label}</p>
      <p className="macro-value">
        {value}
        <span className="label muted"> {unit}</span>
      </p>
    </div>
  );
}

/**
 * States plainly how much of what was eaten these numbers actually cover.
 * A calorie total built from a quarter of your intake is not a calorie total,
 * and quietly presenting it as one would be the most damaging thing this
 * screen could do.
 */
function Coverage({ coverage }) {
  const { fraction, gramsUnmatched, countedUnits } = coverage;
  if (fraction === null) return null;

  const pct = Math.round(fraction * 100);
  const gaps = [];
  if (gramsUnmatched > 0) gaps.push(`${gramsUnmatched}g with no food match`);
  if (countedUnits > 0) gaps.push(`${countedUnits} counted items, which have no weight`);

  if (gaps.length === 0) {
    return <p className="label muted">Covers everything logged in this window.</p>;
  }

  return (
    <div className="card stack-tight coverage">
      <p className="label">
        Based on {pct}% of what you logged.
      </p>
      <p className="label muted">Not counted: {gaps.join('; ')}.</p>
      <p className="label muted">
        Attach a food match when adding an item to bring it into these totals.
      </p>
    </div>
  );
}
