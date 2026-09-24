import { Application, Container, Graphics, Text } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { useEffect, useRef } from 'react';
import { missingFor, unlockedBy } from '../../core/engine';
import type { Layout, LayoutNode } from '../../core/layout';
import type { TreeDoc } from '../../core/model';
import { useApp } from './store';
import { canvas, stateLook } from './theme';

const LABEL_MIN_SCALE = 0.42;

interface NodeView {
  node: LayoutNode;
  root: Container;
  shape: Graphics;
  label: Text;
}

interface Scene {
  app: Application;
  viewport: Viewport;
  edges: Graphics;
  nodes: Map<string, NodeView>;
  clusterLabels: Text[];
  layout: Layout;
  tree: TreeDoc;
}

export function TreeCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const tree = useApp((s) => s.tree);
  const layout = useApp((s) => s.layout);

  // Build the scene whenever a new tree is loaded.
  useEffect(() => {
    if (!host.current || !tree || !layout) return;
    let cancelled = false;
    const app = new Application();
    const el = host.current;

    (async () => {
      await app.init({
        resizeTo: el,
        background: canvas.background,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      });
      if (cancelled) return app.destroy(true, { children: true });
      el.appendChild(app.canvas);

      const { bounds } = layout;
      const viewport = new Viewport({
        screenWidth: el.clientWidth,
        screenHeight: el.clientHeight,
        worldWidth: bounds.maxX - bounds.minX,
        worldHeight: bounds.maxY - bounds.minY,
        events: app.renderer.events,
      });
      viewport.drag().pinch().wheel({ smooth: 4 }).decelerate({ friction: 0.92 }).clampZoom({ minScale: 0.04, maxScale: 3 });
      app.stage.addChild(viewport);

      // Cluster halos and titles sit underneath everything.
      const halos = new Graphics();
      const clusterLabels: Text[] = [];
      for (const c of layout.clusters) {
        halos.circle(c.x, c.y, c.radius + 30).fill({ color: canvas.clusterHalo, alpha: 0.55 }).stroke({ color: canvas.clusterHaloStroke, width: 3 });
        if (c.ring === 0) continue;
        const t = new Text({
          text: c.title,
          style: { fill: canvas.clusterTitle, fontSize: 34, fontFamily: 'Georgia, serif', align: 'center', wordWrap: true, wordWrapWidth: c.radius * 1.8 },
          resolution: 2,
        });
        t.anchor.set(0.5, 1);
        t.position.set(c.x, c.y - c.radius - 36);
        clusterLabels.push(t);
      }
      viewport.addChild(halos);

      const edges = new Graphics();
      viewport.addChild(edges);
      const nodeLayer = new Container();
      viewport.addChild(nodeLayer);
      clusterLabels.forEach((t) => viewport.addChild(t));

      const nodes = new Map<string, NodeView>();
      let downAt: { x: number; y: number } | null = null;
      for (const node of Object.values(layout.nodes)) {
        const root = new Container();
        root.position.set(node.x, node.y);
        root.eventMode = 'static';
        root.cursor = 'pointer';
        const shape = new Graphics();
        // Programs are named by their cluster title, so their node carries no label of its own.
        const text = node.kind === 'subject' ? node.id : node.kind === 'program' ? '' : tree.degree.title;
        const label = new Text({
          text,
          style: {
            fill: canvas.label,
            fontSize: node.kind === 'subject' ? 13 : node.kind === 'program' ? 15 : 18,
            fontFamily: 'system-ui, sans-serif',
            fontWeight: node.kind === 'subject' ? '600' : '700',
            align: 'center',
            wordWrap: node.kind !== 'subject',
            wordWrapWidth: node.r * 2.6,
          },
          resolution: 3,
        });
        label.anchor.set(0.5, node.kind === 'subject' ? 0.5 : 0);
        if (node.kind !== 'subject') label.position.set(0, node.r + 6);
        root.addChild(shape, label);
        root.on('pointerover', () => useApp.getState().hover(node.id));
        root.on('pointerout', () => useApp.getState().hover(null));
        root.on('pointerdown', (e) => (downAt = { x: e.global.x, y: e.global.y }));
        root.on('pointertap', (e) => {
          // A drag that ends on a node is a pan, not a click.
          if (downAt && Math.hypot(e.global.x - downAt.x, e.global.y - downAt.y) > 6) return;
          useApp.getState().select(node.id);
        });
        nodeLayer.addChild(root);
        nodes.set(node.id, { node, root, shape, label });
      }
      viewport.on('pointertap', (e) => {
        if (e.target === viewport && downAt && Math.hypot(e.global.x - downAt.x, e.global.y - downAt.y) <= 6) useApp.getState().select(null);
      });
      viewport.on('pointerdown', (e) => (downAt = { x: e.global.x, y: e.global.y }));

      scene.current = { app, viewport, edges, nodes, clusterLabels, layout, tree };
      fit(viewport, layout);
      paint(scene.current);

      viewport.on('zoomed', () => scene.current && applyLod(scene.current));
      app.renderer.on('resize', (w: number, h: number) => viewport.resize(w, h));

      // In-app frame counter, read by the performance check (US-004).
      const fps: number[] = [];
      let last = performance.now();
      app.ticker.add(() => {
        fps.push(app.ticker.FPS);
        if (performance.now() - last > 500) {
          document.body.dataset.fps = String(Math.round(fps.reduce((a, b) => a + b, 0) / fps.length));
          fps.length = 0;
          last = performance.now();
        }
      });
    })();

    return () => {
      cancelled = true;
      scene.current = null;
      try {
        app.destroy(true, { children: true });
      } catch {
        // init may not have finished
      }
      el.replaceChildren();
    };
  }, [tree, layout]);

  // Repaint on any change that affects how nodes look.
  useEffect(
    () =>
      useApp.subscribe((s, prev) => {
        if (!scene.current) return;
        if (s.states !== prev.states || s.hovered !== prev.hovered || s.selected !== prev.selected || s.matches !== prev.matches || s.plan !== prev.plan)
          paint(scene.current);
        if (s.flyTo !== prev.flyTo && s.selected) flyTo(scene.current, s.selected);
      }),
    [],
  );

  return <div ref={host} className="tree-canvas" data-testid="tree-canvas" />;
}

function fit(viewport: Viewport, layout: Layout) {
  const { minX, minY, maxX, maxY } = layout.bounds;
  viewport.fit(true, maxX - minX, maxY - minY);
  viewport.moveCenter((minX + maxX) / 2, (minY + maxY) / 2);
}

function flyTo(s: Scene, code: string) {
  const n = s.layout.nodes[code];
  if (!n) return;
  s.viewport.animate({ position: { x: n.x, y: n.y }, scale: Math.max(s.viewport.scale.x, 0.9), time: 650, ease: 'easeInOutSine' });
}

function applyLod(s: Scene) {
  const scale = s.viewport.scale.x;
  for (const v of s.nodes.values()) v.label.visible = v.node.kind !== 'subject' || scale > LABEL_MIN_SCALE;
  for (const t of s.clusterLabels) t.scale.set(Math.max(1, 0.35 / scale));
}

/** Everything that depends on plan, hover, selection or search. */
function paint(s: Scene) {
  const { states, hovered, selected, matches, plan } = useApp.getState();
  const { tree, layout } = s;
  const completed = new Set(plan.completed);
  const chosen = new Set(plan.programs);

  // Focus: the hovered (else selected) subject's missing chain and what it unlocks.
  const focus = hovered ?? selected;
  const path = new Set<string>();
  const unlocks = new Set<string>();
  if (focus && tree.subjects[focus]) {
    missingFor(tree, focus, completed).subjects.forEach((c) => path.add(c));
    unlockedBy(tree, focus).forEach((c) => unlocks.add(c));
  }
  const matchSet = new Set(matches);
  const dimming = (hovered && tree.subjects[hovered]) || matchSet.size > 0;
  const lit = (id: string) =>
    !dimming || id === focus || path.has(id) || unlocks.has(id) || matchSet.has(id) || (hovered && !matchSet.size && completed.has(id));

  for (const v of s.nodes.values()) {
    const { node, shape, root } = v;
    const g = shape.clear();
    if (node.kind === 'subject') {
      const state = states.get(node.id) ?? 'locked';
      const look = stateLook[state];
      if (look.glow) g.circle(0, 0, node.r + 7).fill({ color: look.glow, alpha: 0.16 });
      if (matchSet.has(node.id)) g.circle(0, 0, node.r + 10).stroke({ color: canvas.edgePath, width: 3, alpha: 0.9 });
      if (path.has(node.id)) g.circle(0, 0, node.r + 6).stroke({ color: canvas.edgePath, width: 3 });
      if (unlocks.has(node.id)) g.circle(0, 0, node.r + 6).stroke({ color: canvas.edgeUnlock, width: 3 });
      g.circle(0, 0, node.r).fill(look.fill).stroke({ color: look.ring, width: look.ringWidth });
      if (state === 'excluded') {
        const k = node.r * 0.45;
        g.moveTo(-k, -k).lineTo(k, k).moveTo(k, -k).lineTo(-k, k).stroke({ color: look.ring, width: 2, alpha: 0.7 });
      }
      root.alpha = look.alpha * (lit(node.id) ? 1 : 0.22);
      v.label.style.fill = state === 'locked' || state === 'legacy' ? canvas.labelDim : canvas.label;
    } else {
      const isChosen = node.kind === 'degree' || chosen.has(node.id);
      const legacy = node.kind === 'program' && tree.programs[node.id]?.legacy;
      g.circle(0, 0, node.r + 8).fill({ color: isChosen ? canvas.chosen : 0x2a3140, alpha: isChosen ? 0.2 : 0.4 });
      g.circle(0, 0, node.r)
        .fill(isChosen ? 0x3a2c10 : 0x191e29)
        .stroke({ color: isChosen ? canvas.chosen : 0x59627a, width: isChosen ? 5 : 3 });
      g.circle(0, 0, node.r * 0.45).fill({ color: isChosen ? canvas.chosen : 0x59627a, alpha: 0.8 });
      root.alpha = (legacy ? 0.5 : 1) * (lit(node.id) ? 1 : 0.35);
    }
    if (node.id === selected) g.circle(0, 0, node.r + 14).stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
  }

  const e = s.edges.clear();
  for (const edge of layout.edges) {
    const a = layout.nodes[edge.from];
    const b = layout.nodes[edge.to];
    let color: number;
    let width: number;
    let alpha = 1;
    const bothDone = completed.has(edge.from) && completed.has(edge.to);
    const onPath = focus && (path.has(edge.from) || edge.from === focus) && (path.has(edge.to) || edge.to === focus);
    const unlocking = focus && edge.from === focus && unlocks.has(edge.to);
    if (edge.kind === 'trunk' || edge.kind === 'member') {
      color = edge.kind === 'trunk' ? canvas.edgeTrunk : canvas.edgeMember;
      width = edge.kind === 'trunk' ? 8 : 4;
      alpha = chosen.has(edge.to) || chosen.has(edge.from) ? 1 : 0.55;
      if (chosen.has(edge.to) || (edge.kind === 'member' && chosen.has(edge.from))) color = canvas.chosen;
    } else if (onPath) {
      color = canvas.edgePath;
      width = 5;
    } else if (unlocking) {
      color = canvas.edgeUnlock;
      width = 4;
    } else if (bothDone) {
      color = canvas.edgeDone;
      width = 5;
    } else if (completed.has(edge.from) && states.get(edge.to) === 'available') {
      color = canvas.edgeOpen;
      width = 3;
    } else {
      color = edge.kind === 'alt' ? canvas.edgeAlt : canvas.edgeBase;
      width = edge.kind === 'alt' ? 1.5 : 2.5;
    }
    if (dimming && !(onPath || unlocking || (lit(edge.from) && lit(edge.to)))) alpha *= 0.15;
    // Links between clusters span the map; keep them quiet unless they matter right now.
    const crossCluster = (edge.kind === 'req' || edge.kind === 'alt') && a.cluster !== b.cluster;
    if (crossCluster && !onPath && !unlocking && !bothDone) alpha *= 0.35;
    // Start and end on the rims, not the centres.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    e.moveTo(a.x + (dx / len) * a.r, a.y + (dy / len) * a.r)
      .lineTo(b.x - (dx / len) * b.r, b.y - (dy / len) * b.r)
      .stroke({ color, width, alpha });
  }
  applyLod(s);
}
