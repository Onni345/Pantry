/**
 * Squarified treemap — the tiling behind the location canvas.
 *
 * Blocks fill the rectangle completely with no gaps and no overlap, and the
 * algorithm prefers near-square tiles over long slivers, which is what makes
 * the result read as a composition rather than a bar chart.
 *
 * Two deliberate departures from a strict treemap, both so the canvas stays
 * legible on weird inventories:
 *  - shares are clamped, so one huge bucket can't swallow the canvas and a
 *    single jar can't vanish to a sliver;
 *  - nothing smaller than a readable tile is emitted at all — the tail is
 *    folded into one "+N more" block by the caller if it wants.
 *
 * Pure — no React, no DOM. Percentages out, so the canvas can be responsive
 * without measuring anything.
 */

const MIN_SHARE = 0.06; // ~6% of the canvas: still tappable and labelled
const MAX_SHARE = 0.45; // one bucket never owns more than this

/**
 * Normalises raw weights into shares that sum to 1, with each share inside
 * [MIN_SHARE, MAX_SHARE]. Runs a couple of passes because clamping one value
 * changes what the others should be.
 */
export function clampShares(values, { min = MIN_SHARE, max = MAX_SHARE } = {}) {
  const n = values.length;
  if (n === 0) return [];

  // With few buckets the ceiling is impossible (two tiles need 50% each), and
  // with many the floor is. Relax whichever one an equal split would violate,
  // so the bounds never contradict each other.
  const lo = Math.min(min, 1 / n);
  const hi = Math.max(max, 1 / n);

  const total = values.reduce((a, b) => a + b, 0) || 1;
  let shares = values.map((v) => Math.min(hi, Math.max(lo, v / total)));

  // Water-filling: hand the leftover to whichever tiles still have room in
  // the direction we need, proportional to how much room each has. Repeats
  // because giving a tile room can push it into a bound.
  for (let pass = 0; pass < 12; pass++) {
    const sum = shares.reduce((a, b) => a + b, 0);
    const gap = 1 - sum;
    if (Math.abs(gap) < 1e-9) break;

    const room = shares.map((s) => (gap > 0 ? hi - s : s - lo));
    const roomTotal = room.reduce((a, b) => a + b, 0);
    if (roomTotal < 1e-12) break; // genuinely nowhere to go

    shares = shares.map((s, i) =>
      Math.min(hi, Math.max(lo, s + gap * (room[i] / roomTotal)))
    );
  }

  return shares;
}

/**
 * Lays `values` (any positive numbers) into a width x height rectangle.
 * Returns [{ x, y, w, h }] in the same order, as percentages of the box.
 */
export function squarify(values, width = 100, height = 100) {
  const shares = clampShares(values);
  if (shares.length === 0) return [];

  const area = width * height;
  const rest = shares.map((s, i) => ({ i, value: s * area }));
  const out = new Array(shares.length);

  let x = 0;
  let y = 0;
  let w = width;
  let h = height;

  while (rest.length > 0) {
    // Rows run along the shorter side; that's what keeps tiles near-square.
    const vertical = w >= h;
    const length = vertical ? h : w;

    // The aspect ratio of the worst tile in a row, if the row held `values`.
    const worst = (vals) => {
      const sum = vals.reduce((a, b) => a + b, 0);
      const thickness = sum / length;
      return Math.max(...vals.map((v) => {
        const side = v / thickness;
        return Math.max(side / thickness, thickness / side);
      }));
    };

    const row = [];
    let best = Infinity;
    while (rest.length > 0) {
      const score = worst([...row.map((r) => r.value), rest[0].value]);
      if (row.length > 0 && score > best) break; // adding it made the row worse
      best = score;
      row.push(rest.shift());
    }

    const thickness = row.reduce((a, r) => a + r.value, 0) / length;
    let offset = 0;
    for (const cell of row) {
      const side = cell.value / thickness;
      out[cell.i] = vertical
        ? { x, y: y + offset, w: thickness, h: side }
        : { x: x + offset, y, w: side, h: thickness };
      offset += side;
    }

    if (vertical) { x += thickness; w -= thickness; }
    else { y += thickness; h -= thickness; }
    if (w < 1e-9 || h < 1e-9) break;
  }

  // Percentages, and a hair of rounding so adjacent edges meet cleanly.
  const pct = (v, total) => Math.round((v / total) * 10000) / 100;
  return out.map((r) =>
    r ? { x: pct(r.x, width), y: pct(r.y, height), w: pct(r.w, width), h: pct(r.h, height) }
      : { x: 0, y: 0, w: 0, h: 0 }
  );
}
