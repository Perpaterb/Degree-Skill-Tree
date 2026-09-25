import { useEffect } from 'react';
import { decodePlan } from '../../core/engine';
import { DegreeChip, DetailPanel, Legend, TopBar } from './Panels';
import { DEFAULT_MAP, useApp } from './store';
import { TreeCanvas } from './TreeCanvas';

function fromHash() {
  const hash = location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  return { treeId: params.get('t') ?? DEFAULT_MAP, hasPlan: /(^|&)(c|p|m|d)=/.test(hash), hash };
}

export function App() {
  const map = useApp((s) => s.map);
  const loadError = useApp((s) => s.loadError);

  useEffect(() => {
    const { loadIndex, loadMap } = useApp.getState();
    loadIndex();
    // Our own URL updates use replaceState, which never fires hashchange, so a hashchange
    // always means a new link was opened: load it, and let a plan in the link win.
    const open = () => {
      const { treeId, hasPlan, hash } = fromHash();
      loadMap(treeId, hasPlan ? decodePlan(hash) : undefined);
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <main className="stage">
        {loadError ? <div className="error">{loadError}</div> : null}
        {!map && !loadError ? <div className="loading">Loading the map…</div> : null}
        <TreeCanvas />
        <DegreeChip />
        <DetailPanel />
        <Legend />
      </main>
    </div>
  );
}
