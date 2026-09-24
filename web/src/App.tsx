import { useEffect } from 'react';
import { decodePlan } from '../../core/engine';
import { DetailPanel, Legend, ProgressPanel, TopBar } from './Panels';
import { useApp } from './store';
import { TreeCanvas } from './TreeCanvas';

const DEFAULT_TREE = 'uts-2027-C10148';

function fromHash() {
  const hash = location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  return { treeId: params.get('t') ?? DEFAULT_TREE, hasPlan: /(^|&)(c|p|m)=/.test(hash), hash };
}

export function App() {
  const tree = useApp((s) => s.tree);
  const loadError = useApp((s) => s.loadError);

  useEffect(() => {
    const { loadIndex, loadTree } = useApp.getState();
    loadIndex();
    // Our own URL updates use replaceState, which never fires hashchange, so a hashchange
    // always means a new link was opened: load it, and let a plan in the link win.
    const open = () => {
      const { treeId, hasPlan, hash } = fromHash();
      loadTree(treeId, hasPlan ? decodePlan(hash) : undefined);
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
        {!tree && !loadError ? <div className="loading">Loading the tree…</div> : null}
        <TreeCanvas />
        <ProgressPanel />
        <DetailPanel />
        <Legend />
      </main>
    </div>
  );
}
