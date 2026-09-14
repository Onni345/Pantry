import { perUnit, macroGap, formatCalories } from '../macros/perItem.js';
import { describe } from '../../units.js';

/**
 * One line of food. The whole row is the tap target and it opens the sheet —
 * no +/- buttons out here, because a list of steppers is a list you have to
 * read carefully before touching, and this one should be scannable.
 *
 * It says two things: what it is, and how much is left in the words you'd
 * use out loud. Expiry only appears when it's close enough to act on.
 */
export default function ItemRow({ item, onOpen }) {
  const days = item.expiry_date
    ? Math.round((Date.parse(item.expiry_date) - Date.now()) / 86400000)
    : null;
  const urgent = days !== null && days <= 7;
  const tone = days === null ? '' : days < 0 ? ' danger-text' : days <= 2 ? ' warn-text' : '';

  const out = item.quantity === 0;
  const left = item.added > 0 ? Math.min(1, item.quantity / item.added) : null;
  const low = left !== null && left <= 0.25 && !out;

  // One figure, in this item's own unit — "72 kcal each", "365 kcal / 100g".
  // Enough to compare two things in the list without opening either.
  const per = perUnit(item);
  const gap = macroGap(item);

  return (
    <li>
      <button className={`food-row${out ? ' is-out' : ''}`} onClick={onOpen}>
        <span className="food-row-main">
          <span className="food-name">{item.name}</span>
          {(urgent || out || low) && (
            <span className={`label food-note${tone}`}>
              {out ? 'all gone' : urgent ? expiryWords(days) : 'running low'}
            </span>
          )}
        </span>
        <span className="food-figures">
          <span className="food-amount">{describe(item)}</span>
          {per ? (
            <span className="label muted food-kcal">
              {formatCalories(per.calories)} kcal {per.noun ? 'each' : '/ 100g'}
            </span>
          ) : (
            !out && (
              <span className="label food-kcal is-missing">
                {gap === 'no-food' ? 'no nutrition' : 'no weight set'}
              </span>
            )
          )}
        </span>
      </button>
    </li>
  );
}

function expiryWords(days) {
  if (days < 0) return `${-days}d past date`;
  if (days === 0) return 'use today';
  if (days === 1) return 'use tomorrow';
  return `${days}d left`;
}
