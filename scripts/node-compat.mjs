/**
 * Two things Node needs before any app module is loaded.
 *
 * Import this FIRST in any harness that imports the app — before Vite, before
 * the component modules — because the fixes have to be in place at the moment
 * those modules evaluate, not after.
 *
 * 1. WebSocket. supabase-js builds a realtime client the instant
 *    `createClient` is called, and that constructor throws outright if the
 *    runtime has no global WebSocket. Node 22 has one; Node 20 does not, so on
 *    Node 20 merely importing supabaseClient.js kills the process — which is
 *    absurd for a harness that renders React and never opens a socket. A stub
 *    satisfies the check. If anything ever actually tries to connect, it says
 *    so loudly rather than pretending to work.
 *
 * 2. The deprecation notice supabase-js prints on Node 20, which is true but
 *    has nothing to do with the test that's running.
 */
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class NoWebSocket {
    constructor() {
      throw new Error(
        'This harness stubbed WebSocket: nothing here should open a realtime ' +
        'connection. Run on Node 22+ if you need a real one.'
      );
    }
  };
}
