import { Component } from 'react';

/**
 * Keeps a render error from blanking the whole page.
 *
 * Without this, one bad property access unmounts the tree and the user sees
 * white — no message, no clue. This shows what broke and offers a reload.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Pantry crashed while rendering:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="shell">
        <div className="card stack">
          <h2>Something broke</h2>
          <p className="muted">
            The screen failed to render. Your data is safe — it's stored on this
            device and nothing was lost.
          </p>
          <p className="mono">{String(this.state.error?.message || this.state.error)}</p>
          <div className="row">
            <button className="primary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      </main>
    );
  }
}
