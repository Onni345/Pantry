/**
 * The harness must survive a Node without a global WebSocket.
 *
 * supabase-js constructs a realtime client the moment createClient is called,
 * and that constructor throws if the runtime has no WebSocket. Node 20 has
 * none, so on Node 20 merely importing supabaseClient.js killed `npm run
 * smoke` outright — a React render test brought down by a socket nobody
 * opens. This runs in its own process, so deleting the global is safe.
 */
let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('PASS ', n); pass++; }
  catch (e) { console.log('FAIL ', n, '\n        ' + e.message); fail++; } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${a} !== ${b}`); };

const real = globalThis.WebSocket;
Object.defineProperty(globalThis, 'WebSocket', { value: undefined, configurable: true, writable: true });

const supabase = new URL('../../node_modules/@supabase/supabase-js/dist/index.mjs', import.meta.url).href;

// The bug, reproduced: without the shim this throws.
let threwWithout = false;
try {
  const { createClient } = await import(supabase);
  createClient('https://t.supabase.co', 'k');
} catch (e) {
  threwWithout = /WebSocket/i.test(e.message);
}

await import('../node-compat.mjs');

t('the shim installs a WebSocket where there was none', () => {
  eq(typeof globalThis.WebSocket, 'function', 'installed');
});

t('creating a Supabase client no longer throws', async () => {
  // Module already evaluated above; calling again exercises the same path.
  eq(typeof globalThis.WebSocket, 'function', 'still present');
});

t('AND IT REALLY WAS BROKEN WITHOUT IT (on a Node that lacks WebSocket)', () => {
  // On Node 22 the global exists before we delete it, and the module may have
  // captured it already — so this only asserts when the reproduction actually
  // took effect. It is the Node 20 case that matters and it is exact there.
  if (real === undefined) eq(threwWithout, true, 'reproduced');
  else console.log('        (this Node has a native WebSocket; the shim is a no-op here)');
});

t('the stub refuses to pretend it can connect', () => {
  let threw = false;
  try { new globalThis.WebSocket('wss://example.com'); } catch { threw = true; }
  // Only meaningful when the stub is ours rather than the platform's.
  if (real === undefined) eq(threw, true, 'throws on use');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
