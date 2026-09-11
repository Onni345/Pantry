import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Cycling pager: arrows, swipe, and arrow keys, wrapping in both directions.
 *
 * The gesture locks to an axis on the first few pixels of movement. Without
 * that, flicking down through a long list drags the page sideways at the same
 * time, which is the thing that makes hand-rolled swipe feel broken.
 */
export function usePager(length, { threshold = 56, resistance = 0.55 } = {}) {
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [drag, setDrag] = useState(0);
  const gesture = useRef(null);
  const dragRef = useRef(0);
  // Mirrors `index` so callbacks can read the current page without going
  // stale, and without computing direction inside a state updater — updaters
  // must stay pure, and React calls them twice in development.
  const indexRef = useRef(0);
  indexRef.current = index;

  const go = useCallback((delta) => {
    if (!delta) return;
    setDir(delta > 0 ? 1 : -1);
    setIndex((i) => (i + delta + length) % length);
    dragRef.current = 0;
    setDrag(0);
  }, [length]);

  const jump = useCallback((next) => {
    const cur = indexRef.current;
    if (next === cur) return;
    // Shortest way round, so the slide travels the way you'd expect.
    const forward = (next - cur + length) % length;
    setDir(forward <= length - forward ? 1 : -1);
    setIndex(next);
    dragRef.current = 0;
    setDrag(0);
  }, [length]);

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t?.closest?.('input, select, textarea, [role="dialog"]')) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const setDragTo = (v) => { dragRef.current = v; setDrag(v); };

  const handlers = {
    onTouchStart: (e) => {
      const t = e.touches[0];
      gesture.current = { x: t.clientX, y: t.clientY, axis: null };
    },
    onTouchMove: (e) => {
      const g = gesture.current;
      if (!g) return;
      const dx = e.touches[0].clientX - g.x;
      const dy = e.touches[0].clientY - g.y;

      if (g.axis === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (g.axis !== 'x') return;
      setDragTo(dx * resistance);
    },
    onTouchEnd: () => {
      const g = gesture.current;
      gesture.current = null;
      if (g?.axis !== 'x') return;
      if (Math.abs(dragRef.current) > threshold) go(dragRef.current < 0 ? 1 : -1);
      else setDragTo(0);
    },
    onTouchCancel: () => { gesture.current = null; setDragTo(0); }
  };

  return { index, dir, drag, dragging: drag !== 0, go, jump, handlers };
}
