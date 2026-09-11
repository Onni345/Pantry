import { useState, useEffect, useCallback } from 'react';
import {
  getSession, onAuthChange, myHouseholds, signOut,
  getStoredHouseholdId, storeHouseholdId, clearStoredHousehold
} from './auth/household.js';
import { isConfigured } from './db/supabaseClient.js';
import { InventoryProvider } from './context/InventoryContext.jsx';
import SignIn from './features/onboarding/SignIn.jsx';
import HouseholdPicker from './features/onboarding/HouseholdPicker.jsx';
import NoAccess from './features/onboarding/NoAccess.jsx';
import InventoryList from './features/inventory/InventoryList.jsx';
import MacrosSummary from './features/macros/MacrosSummary.jsx';
import RecipeSuggestions from './features/recipes/RecipeSuggestions.jsx';
import SyncStatus from './components/SyncStatus.jsx';
import Settings from './components/Settings.jsx';
import './app.css';

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [households, setHouseholds] = useState(null);
  const [householdId, setHouseholdId] = useState(() => getStoredHouseholdId());
  const [error, setError] = useState('');
  const [tab, setTab] = useState('inventory');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (!isConfigured) return;
    getSession().then(setSession);
    const { data } = onAuthChange(setSession);
    return () => data?.subscription?.unsubscribe();
  }, []);

  // Which households this address may reach is asked of the server on every
  // sign-in, never remembered as a permission. Removing someone from the
  // allowlist takes effect the next time their app loads.
  useEffect(() => {
    if (!session) { setHouseholds(null); return; }
    let live = true;
    myHouseholds()
      .then((list) => {
        if (!live) return;
        setHouseholds(list);
        const stored = getStoredHouseholdId();
        if (stored && !list.some((h) => h.id === stored)) clearStoredHousehold();
        if (list.length === 1) {
          storeHouseholdId(list[0].id);
          setHouseholdId(list[0].id);
        } else if (stored && list.some((h) => h.id === stored)) {
          setHouseholdId(stored);
        } else {
          setHouseholdId(null);
        }
      })
      .catch((e) => live && setError(e.message || String(e)));
    return () => { live = false; };
  }, [session]);

  const pick = useCallback((id) => {
    storeHouseholdId(id);
    setHouseholdId(id);
  }, []);

  const leave = useCallback(async () => {
    await signOut();
    setHouseholdId(null);
    setHouseholds(null);
  }, []);

  if (!isConfigured) {
    return (
      <main className="shell">
        <div className="card stack">
          <h2>Supabase not configured</h2>
          <p className="muted">
            Copy <code>.env.example</code> to <code>.env</code>, fill in your project
            URL and key, then restart the dev server.
          </p>
        </div>
      </main>
    );
  }

  if (session === undefined) return <main className="shell"><p className="muted">Loading…</p></main>;
  if (!session) return <SignIn />;

  if (error) {
    return (
      <main className="shell">
        <div className="card stack">
          <h2>Could not check access</h2>
          <p className="mono">{error}</p>
          <button onClick={leave}>Sign out</button>
        </div>
      </main>
    );
  }

  if (households === null) return <main className="shell"><p className="muted">Checking access…</p></main>;
  if (households.length === 0) return <NoAccess email={session.user?.email} onSignOut={leave} />;
  if (!householdId) {
    return <HouseholdPicker households={households} onPick={pick} onSignOut={leave} />;
  }

  const current = households.find((h) => h.id === householdId);

  return (
    <InventoryProvider householdId={householdId}>
      <div className="shell stack">
        <header className="app-header">
          <div>
            <span className="wordmark">Pantry</span>
            <h1>{current?.name || 'Your kitchen'}</h1>
          </div>
          <div className="row">
            <SyncStatus />
            <button className="link-button" onClick={() => setShowSettings((v) => !v)}>
              {showSettings ? 'Close' : 'Settings'}
            </button>
          </div>
        </header>

        {showSettings && (
          <Settings
            email={session.user?.email}
            households={households}
            householdId={householdId}
            onSwitch={pick}
            onSignOut={leave}
            onClose={() => setShowSettings(false)}
          />
        )}

        <nav className="tabs row">
          {[['inventory', 'Kitchen'], ['macros', 'Intake'], ['recipes', 'Recipes']].map(
            ([key, label]) => (
              <button
                key={key}
                className={tab === key ? 'is-current' : ''}
                aria-current={tab === key ? 'page' : undefined}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            )
          )}
        </nav>

        {tab === 'inventory' && <InventoryList />}
        {tab === 'macros' && <MacrosSummary />}
        {tab === 'recipes' && <RecipeSuggestions />}
      </div>
    </InventoryProvider>
  );
}
