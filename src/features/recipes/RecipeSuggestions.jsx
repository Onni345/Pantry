import { useState } from 'react';
import { useInventory } from '../../context/InventoryContext.jsx';
import { hasApiKey, suggestRecipes } from '../../api/llm.js';
import './recipes.css';

/**
 * Deliberately manual. Unlike expiry estimation, there is no good moment to
 * fire this automatically — the sensible input (everything currently in
 * stock) changes on every add and every use, so a suggestion made an hour
 * ago is already stale. One button, one real request, fresh each time.
 */
export default function RecipeSuggestions() {
  const { items } = useInventory();
  const [state, setState] = useState('idle'); // idle | loading | done | error | no-key
  const [recipes, setRecipes] = useState([]);
  const [error, setError] = useState('');

  async function run() {
    if (!hasApiKey()) { setState('no-key'); return; }
    setState('loading');
    setError('');
    try {
      const result = await suggestRecipes(items);
      setRecipes(result);
      setState('done');
    } catch (e) {
      setError(e.message || String(e));
      setState('error');
    }
  }

  if (state === 'no-key') {
    return (
      <div className="card stack">
        <p className="muted">
          Recipe suggestions need a Gemini API key. Add one in Settings, then come
          back here.
        </p>
      </div>
    );
  }

  return (
    <div className="stack recipes">
      <button className="primary" onClick={run} disabled={state === 'loading'}>
        {state === 'loading'
          ? 'Thinking…'
          : state === 'done'
            ? 'Suggest again'
            : 'Suggest recipes from what I have'}
      </button>

      {state === 'error' && <p className="error label">{error}</p>}

      {state === 'done' && recipes.length === 0 && (
        <div className="card empty">
          <p className="muted">No recipe came back grounded in what's actually in stock.</p>
        </div>
      )}

      {recipes.map((r) => (
        <RecipeCard key={r.name} recipe={r} />
      ))}
    </div>
  );
}

function RecipeCard({ recipe }) {
  return (
    <div className="card stack-tight recipe-card">
      <p className="item-name">{recipe.name}</p>

      <ul className="recipe-uses">
        {recipe.uses.map((u) => (
          <li key={u.item} className="label muted">
            {Math.round(u.grams)}g {u.item}
            {u.grams >= u.stocked && ' (all you have)'}
          </li>
        ))}
      </ul>

      {recipe.extra.length > 0 && (
        <p className="label muted">Also needs: {recipe.extra.join(', ')}</p>
      )}

      <p className="recipe-instructions">{recipe.instructions}</p>
    </div>
  );
}
