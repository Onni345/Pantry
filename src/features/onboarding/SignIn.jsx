import { useState } from 'react';
import { sendSignInLink } from '../../auth/household.js';
import './onboarding.css';

/**
 * The only screen an unauthenticated device sees. One field.
 *
 * "Check your email" is shown for any valid-looking address, whether or not
 * it is on an allowlist — a different message for unknown addresses would let
 * a stranger discover who has access.
 */
export default function SignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState('');
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
              If <span className="mono">{sent}</span> has access, a sign-in link is
              on its way. Open it on this device.
            </p>
            <button onClick={() => { setSent(''); setEmail(''); }}>
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
