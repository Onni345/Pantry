import './onboarding.css';

/**
 * Signing in succeeded; this address simply is not on any household's list.
 * Says so plainly and names the only way in, since there is no self-service
 * path by design.
 */
export default function NoAccess({ email, onSignOut }) {
  return (
    <main className="setup">
      <div className="setup-inner stack">
        <header className="stack-tight">
          <h1>Pantry</h1>
        </header>
        <section className="card stack">
          <h2>No household for this address</h2>
          <p className="muted">
            <span className="mono">{email}</span> isn't on any household's list.
            Ask whoever set this up to add it.
          </p>
          <button onClick={onSignOut}>Sign in with a different address</button>
        </section>
      </div>
    </main>
  );
}
