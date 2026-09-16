import { useState } from 'react';
import { sendSignInCode, verifySignInCode } from '../../auth/household.js';
import './onboarding.css';

/**
 * The only screen an unauthenticated device sees. One field.
 *
 * "Check your email" is shown for any valid-looking address, whether or not
 * it is on an allowlist — a different message for unknown addresses would let
 * a stranger discover who has access.
 *
 * Sign-in is code-only, on purpose. The email Supabase sends also contains a
 * clickable link, but this screen never mentions it: tapping that link on an
 * iOS home-screen install opens Safari, a different storage context from the
 * installed PWA, so the session it creates never reaches the app you're
 * actually using — it just asks you to sign in again next time. Typing the
 * code instead never leaves the current tab, so it's the only path that
 * reliably keeps a phone signed in, and there's no reason to offer the other
 * one and let someone tap the wrong thing.
 */
export default function SignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setSent(await sendSignInCode(email));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await verifySignInCode(sent, code);
      // No further navigation needed — App.jsx's onAuthChange listener picks
      // up the new session as soon as it lands.
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="setup">
      <div className="setup-inner stack">
        <header className="stack-tight">
          <h1>Pantry</h1>
          <p className="muted">Track what's in the fridge, freezer, and shelf.</p>
        </header>

        {sent ? (
          <section className="card stack">
            <h2>Check your email</h2>
            <p className="muted">
              If <span className="mono">{sent}</span> has access, a code is on
              its way.
            </p>

            <form className="stack-tight" onSubmit={submitCode}>
              <label className="stack-tight">
                <span className="label muted">6-digit code from the email</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  autoFocus
                />
              </label>
              {error && <p className="error label">{error}</p>}
              <button className="primary" type="submit" disabled={busy || !code.trim()}>
                {busy ? 'Checking…' : 'Sign in with code'}
              </button>
            </form>

            <button onClick={() => { setSent(''); setEmail(''); setCode(''); setError(''); }}>
              Use a different address
            </button>
          </section>
        ) : (
          <form className="card stack" onSubmit={submit}>
            <h2>Sign in</h2>
            <label className="stack-tight">
              <span className="label muted">Email address</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck="false"
                autoComplete="email"
              />
            </label>
            {error && <p className="error label">{error}</p>}
            <button className="primary" type="submit" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Email me a code'}
            </button>
            <p className="label muted">
              No password. We email you a 6-digit code that signs this device in.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
