import { useState } from 'react';
import { sendSignInLink, verifySignInCode } from '../../auth/household.js';
import './onboarding.css';

/**
 * The only screen an unauthenticated device sees. One field.
 *
 * "Check your email" is shown for any valid-looking address, whether or not
 * it is on an allowlist — a different message for unknown addresses would let
 * a stranger discover who has access.
 *
 * The emailed code matters as much as the link: tapping the link on an iOS
 * home-screen install opens Safari, a different storage context from the
 * installed PWA, so the session it creates never reaches the app you're
 * actually using — it just asks you to sign in again next time. Typing the
 * code instead never leaves the current tab, so this is the reliable way to
 * stay signed in on a phone.
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
      setSent(await sendSignInLink(email));
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
              If <span className="mono">{sent}</span> has access, a code and a link are
              on their way.
            </p>

            {/* On a phone, this is the one that actually keeps you signed
                in — the link opens Safari instead of this app. */}
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

            <p className="label muted">
              Or open the link in the email — on a phone, do that only if you're
              not using the installed app icon, or you'll be signed in on Safari
              instead of here.
            </p>

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
              {busy ? 'Sending…' : 'Email me a link'}
            </button>
            <p className="label muted">
              No password. We email you a link that signs this device in.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
