import './onboarding.css';

/** Shown only when an address is listed against more than one household. */
export default function HouseholdPicker({ households, onPick, onSignOut }) {
  return (
    <main className="setup">
      <div className="setup-inner stack">
        <header className="stack-tight">
          <h1>Pantry</h1>
          <p className="muted">Which one?</p>
        </header>
        <section className="card stack-tight">
          {households.map((h) => (
            <button key={h.id} className="primary" onClick={() => onPick(h.id)}>
              {h.name}
            </button>
          ))}
        </section>
        <button className="link-button" onClick={onSignOut}>Sign out</button>
      </div>
    </main>
  );
}
