import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Three places, mounted on an invisible cylinder 120° apart, that you spin
 * with your finger (or a mouse — pointer events, not touch, so this works on
 * a laptop trackpad too). The wheel tracks the drag 1:1 while it's moving,
 * then settles on the nearest place with a spring, the way an iOS page snap
 * does — not a linear ease.
 *
 * `rotation` is the wheel's current angle. `panelAngle(i)` gives panel i's
 * own angle *within that rotation* — 0 means dead centre facing the viewer,
 * ±angleStep means it's one place over, peeking from the side. The caller
 * turns that into opacity/scale/z-index; this hook only owns the physics.
 */
export function useCarousel(length, { degPerPx = 0.42, flickVelocity = 0.5 } = {}) {
  const [index, setIndex] = useState(0);
  const [dragDeg, setDragDeg] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef(null);
  const indexRef = useRef(0);
  indexRef.current = index;

  const angleStep = 360 / length;

  const jump = useCallback((next) => {
    setIndex(((next % length) + length) % length);
    setDragDeg(0);
  }, [length]);

  const go = useCallback((delta) => {
    if (!delta) return;
    jump(indexRef.current + delta);
  }, [jump]);

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

  // Pointer events, not touch: the same code drags with a finger or a mouse.
  // Listeners live on `window` for the duration of a drag rather than using
  // setPointerCapture, which would swallow clicks on the buttons and rows
  // inside the front panel.
  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return; // left click / primary touch only
    gesture.current = {
      x: e.clientX, y: e.clientY, axis: null,
      lastX: e.clientX, lastT: performance.now(), v: 0
    };
  };

  useEffect(() => {
    function onMove(e) {
      const g = gesture.current;
      if (!g) return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;

      if (g.axis === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (g.axis === 'x') setDragging(true);
      }
      if (g.axis !== 'x') return;

      e.preventDefault();
      const now = performance.now();
      const dt = now - g.lastT || 16;
      g.v = (e.clientX - g.lastX) / dt; // px/ms, for a fast short flick
      g.lastX = e.clientX;
      g.lastT = now;
      setDragDeg(dx * degPerPx);
    }

    function onUp() {
      const g = gesture.current;
      gesture.current = null;
      setDragging(false);
      if (!g || g.axis !== 'x') { setDragDeg(0); return; }

      let steps = Math.round(dragDeg / angleStep);
      // A fast flick that didn't travel a full step should still count as
      // one — distance isn't the only thing that means "I meant to swipe."
      if (steps === 0 && Math.abs(g.v) > flickVelocity) steps = g.v > 0 ? 1 : -1;

      setDragDeg(0);
      if (steps) setIndex((i) => ((i - steps) % length + length) % length);
    }

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragDeg, angleStep, length, flickVelocity]);

  const rotation = -index * angleStep + dragDeg;

  /** Panel i's angle within the current rotation, normalised to (-180, 180]. */
  const panelAngle = (i) => {
    let a = (rotation + i * angleStep) % 360;
    if (a > 180) a -= 360;
    if (a <= -180) a += 360;
    return a;
  };

  return { index, jump, go, dragging, angleStep, panelAngle, handlers: { onPointerDown } };
}
