import { useEffect, useRef, useState } from 'react';
import './Scanner.css';

/**
 * Point the camera at a barcode.
 *
 * A barcode is the only exact key this app has. A receipt line or a typed
 * name is a guess that has to be ranked and sometimes judged by a model; a
 * GTIN is the manufacturer's own identifier for one specific packet, so
 * matching it is a lookup with a right answer.
 *
 * Detection uses the browser's own BarcodeDetector where it exists — Chrome
 * on Android and desktop — and falls back to a WebAssembly ponyfill with the
 * identical API elsewhere, which is what makes this work on an iPhone, where
 * Safari has no native detector. The calling code cannot tell which ran.
 *
 * Nothing is uploaded. Frames are read in the page and discarded; only the
 * digits leave this component.
 */
export default function Scanner({ onCode, onClose, hint = 'Point at the barcode' }) {
  const videoRef = useRef(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [justScanned, setJustScanned] = useState(false);
  // A single cooldown gate, not a per-code one. A barcode held in frame for
  // more than an instant is read several times a second, and it is not
  // always read identically each time — a slight misread produces a
  // DIFFERENT code string, which the old per-code de-dup let straight
  // through. That's the reported bug: one swipe of one item produced two or
  // three rows. Locking out ALL codes for a beat after any accepted one
  // means exactly one item per swipe, whatever the detector thinks it saw
  // in between.
  const lockUntilRef = useRef(0);

  useEffect(() => {
    let stream = null;
    let detector = null;
    let raf = 0;
    let stopped = false;

    async function start() {
      try {
        // The ponyfill is a third of a megabyte of WebAssembly, so it is only
        // fetched when the browser has no detector of its own.
        if ('BarcodeDetector' in window) {
          detector = new window.BarcodeDetector({ formats: FORMATS });
        } else {
          const [{ BarcodeDetector, setZXingModuleOverrides }, { default: wasmUrl }] =
            await Promise.all([
              import('barcode-detector/ponyfill'),
              import('zxing-wasm/reader/zxing_reader.wasm?url')
            ]);
          // Left alone, the ponyfill fetches its WebAssembly from jsdelivr at
          // the moment you point the camera at something — which is the one
          // moment a local-first app is least likely to have a network, and
          // makes scanning depend on a third party being up. Bundling it
          // means Vite fingerprints the file and the service worker
          // precaches it, so the second scan works on a plane.
          setZXingModuleOverrides({
            locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path)
          });
          detector = new BarcodeDetector({ formats: FORMATS });
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setReady(true);
        tick();
      } catch (e) {
        setError(messageFor(e));
      }
    }

    async function tick() {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        try {
          const found = await detector.detect(video);
          const code = found?.[0]?.rawValue?.replace(/\D/g, '');
          if (code && accept()) {
            lockUntilRef.current = Date.now() + SCAN_COOLDOWN_MS;
            setJustScanned(true);
            setTimeout(() => setJustScanned(false), SCAN_COOLDOWN_MS);
            onCode(code);
          }
        } catch { /* a frame that won't decode is not an error */ }
      }
      raf = requestAnimationFrame(tick);
    }

    /** One accepted code at a time — see the note on `lockUntilRef` above. */
    function accept() {
      return Date.now() >= lockUntilRef.current;
    }

    start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  return (
    <div className="scanner">
      <video ref={videoRef} className="scanner-video" playsInline muted />
      <div className="scanner-frame" aria-hidden="true" />

      <div className={`scanner-bar${justScanned ? ' is-scanned' : ''}`}>
        <button className="link-button" onClick={onClose}>Close</button>
        <span className="label">
          {error || (justScanned ? 'Scanned ✓ — hold for the next item' : ready ? hint : 'Starting the camera…')}
        </span>
      </div>
    </div>
  );
}

/** The formats groceries actually carry. Narrower means faster decoding. */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf'];

/**
 * How long detection is fully paused after one accepted code, before the
 * next one can be. Long enough that the same swipe of the same barcode can't
 * register a second, subtly-misread code; short enough that scanning a
 * whole cart doesn't feel like it's fighting you.
 */
const SCAN_COOLDOWN_MS = 1500;

/**
 * Camera failures are almost always permission or context, and both have a
 * fix the person can act on — so say which it is rather than "failed".
 */
function messageFor(e) {
  const name = e?.name || '';
  if (name === 'NotAllowedError') return 'Camera permission was declined. Type the number instead.';
  if (name === 'NotFoundError') return 'No camera on this device. Type the number instead.';
  if (name === 'NotReadableError') return 'The camera is in use by another app.';
  if (!window.isSecureContext) return 'The camera needs HTTPS. Type the number instead.';
  return 'Could not start the camera. Type the number instead.';
}
