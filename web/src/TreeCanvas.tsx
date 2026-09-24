import { Application, Container, Graphics, Text } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { useEffect, useRef } from 'react';
import { compulsorySubjects, missingFor, subjectsUnder, unlockedBy } from '../../core/engine';
import { circleAt, type Layout, type LayoutCircle, type LayoutNode } from '../../core/layout';
import type { MapDoc } from '../../core/model';
import { useApp } from './store';
import { canvas, degreeHues, mix, stateLook } from './theme';

const LABEL_MIN_SCALE = 0.42;
/** How close to an outline (in screen pixels) a click selects that outline's circle. */
const RIM_PX = 10;

interface NodeView {
  node: LayoutNode;
  root: Container;
  shape: Graphics;
  label: Text;
}

interface CircleView {
  circle: LayoutCircle;
  shape: Graphics;
  title: Text;
}

interface Scene {
  app: Application;
  viewport: Viewport;
  edges: Graphics;
  nodes: Map<string, NodeView>;
  circles: CircleView[];
  layout: Layout;
  map: MapDoc;
  hue: Map<string, number>;
  /** Circles drawn glowing in the last paint. */
  glowing: string[];
  /** Ask for one redraw on the next frame. */
  invalidate(): void;
}

declare global {
  interface Window {
    /** Read-only helpers for tests: where on screen a node or circle can be clicked. */
    __dst?: { pointFor(id: string): { x: number; y: number } | null; glowing(): string[] };
  }
}

export function TreeCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const map = useApp((s) => s.map);
  const layout = useApp((s) => s.layout);

  // Build the scene whenever a new map is loaded.
  useEffect(() => {
    if (!host.current || !map || !layout) return;
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

      // Render on demand. By default Pixi redraws every frame even when nothing changes, which
      // keeps the main thread busy (slow reloads, laggy UI on software GL, battery drain).
      let dirty = true;
      const invalidate = () => (dirty = true);
      app.ticker.remove(app.render, app);
      app.ticker.add(() => {
        if (!dirty) return;
        dirty = false;
        app.render();
      });

      const { bounds } = layout;
      const viewport = new Viewport({
        screenWidth: el.clientWidth,
        screenHeight: el.clientHeight,
        worldWidth: bounds.maxX - bounds.minX,
        worldHeight: bounds.maxY - bounds.minY,
        events: app.renderer.events,
      });
      viewport.drag().pinch().wheel({ smooth: 4 }).decelerate({ friction: 0.92 }).clampZoom({ minScale: 0.03, maxScale: 3 });
      app.stage.addChild(viewport);

      let downAt: { x: number; y: number } | null = null;
      // Pixi listens for pointer moves on the whole document, so a pointer over a panel still
      // "hovers" whatever canvas content is underneath it. Only count it when it is over the canvas.
      const overCanvas = (e: { nativeEvent?: { target?: unknown } }) => e.nativeEvent?.target === app.canvas;
      const isClick = (e: { global: { x: number; y: number } }) => !!downAt && Math.hypot(e.global.x - downAt.x, e.global.y - downAt.y) <= 6;

      // Circles, largest first so a smaller circle sits on top and wins the click.
      const hue = new Map(Object.keys(map.degrees).sort().map((d, i) => [d, degreeHues[i % degreeHues.length]]));
      const circleLayer = new Container();
      const titleLayer = new Container();
      // Circles are picked by circleAt (smallest containing the point), not by Pixi's
      // draw-order hit test: with equal radii, draw order can hide a circle completely.
      const circles: CircleView[] = layout.circles.map((circle) => {
        const shape = new Graphics();
        circleLayer.addChild(shape);
        const degree = circle.kind === 'degree';
        const title = new Text({
          text: circle.title,
          style: {
            fill: degree ? hue.get(circle.id)! : canvas.clusterTitle,
            fontSize: degree ? 64 : 28,
            fontFamily: 'Georgia, serif',
            align: 'center',
            wordWrap: true,
            wordWrapWidth: Math.max(240, circle.r * 1.4),
          },
          resolution: 2,
        });
        title.anchor.set(0.5, 0);
        title.position.set(circle.x, circle.y - circle.r + (degree ? 30 : 12));
        titleLayer.addChild(title);
        return { circle, shape, title };
      });
      viewport.addChild(circleLayer);

      const edges = new Graphics();
      viewport.addChild(edges);
      const nodeLayer = new Container();
      viewport.addChild(nodeLayer);
      viewport.addChild(titleLayer);

      const nodes = new Map<string, NodeView>();
      for (const node of Object.values(layout.nodes)) {
        const root = new Container();
        root.position.set(node.x, node.y);
        root.eventMode = 'static';
        root.cursor = 'pointer';
        const shape = new Graphics();
        const label = new Text({
          text: node.id,
          style: { fill: canvas.label, fontSize: 13, fontFamily: 'system-ui, sans-serif', fontWeight: '600', align: 'center' },
          resolution: 3,
        });
        label.anchor.set(0.5);
        root.addChild(shape, label);
        root.on('pointerover', (e) => overCanvas(e) && useApp.getState().hover(node.id));
        root.on('pointerout', () => useApp.getState().hover(null));
        // Circles are siblings of subjects, not parents, so a press on a subject never reaches a circle.
        root.on('pointerdown', (e) => (downAt = { x: e.global.x, y: e.global.y }));
        root.on('pointertap', (e) => {
          if (isClick(e)) useApp.getState().select(node.id);
        });
        nodeLayer.addChild(root);
        nodes.set(node.id, { node, root, shape, label });
      }
      viewport.on('pointerdown', (e) => (downAt = { x: e.global.x, y: e.global.y }));
      viewport.on('pointertap', (e) => {
        if (e.target !== viewport || !isClick(e)) return;
        const w = viewport.toWorld(e.global.x, e.global.y);
        const circle = circleAt(layout, w.x, w.y, RIM_PX / viewport.scale.x);
        const s = useApp.getState();
        // Empty space outside every circle closes the detail panel; the selected degree stays.
        if (!circle) return s.select(null);
        if (circle.kind === 'degree') s.selectDegree(circle.id);
        s.select(circle.id);
      });
      viewport.on('pointermove', (e) => {
        if (!overCanvas(e)) return useApp.getState().hoverCircle(null);
        const over = e.target === viewport ? circleAt(layout, ...xy(viewport.toWorld(e.global.x, e.global.y)), RIM_PX / viewport.scale.x) : null;
        useApp.getState().hoverCircle(over?.id ?? null);
        viewport.cursor = over ? 'pointer' : 'grab';
      });

      scene.current = { app, viewport, edges, nodes, circles, layout, map, hue, glowing: [], invalidate };
      // The camera moves on its own during inertia and fly-to animations, so each of these redraws.
      for (const ev of ['moved', 'zoomed', 'moved-end', 'zoomed-end'] as const) viewport.on(ev, invalidate);
      fit(viewport, layout);
      paint(scene.current);

      viewport.on('zoomed', () => scene.current && applyLod(scene.current));
      // Pixi sends no pointer-out when the pointer leaves the canvas for a panel on top of it,
      // which would leave a circle or subject "hovered" (and glowing) indefinitely.
      app.canvas.addEventListener('pointerleave', () => {
        useApp.getState().hover(null);
        useApp.getState().hoverCircle(null);
      });
      app.renderer.on('resize', (w: number, h: number) => {
        viewport.resize(w, h);
        invalidate();
      });

      window.__dst = {
        pointFor(id) {
          const s = scene.current;
          if (!s) return null;
          const n = s.layout.nodes[id];
          if (n) return s.viewport.toScreen(n.x, n.y);
          const c = s.layout.circles.find((k) => k.id === id);
          return c ? clickPointForCircle(s, c) : null;
        },
        glowing: () => scene.current?.glowing ?? [],
      };

      // In-app frame counter (US-004): ticks per second, published every half second. With
      // on-demand rendering this is the frame budget available, not the number of redraws.
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
      delete window.__dst;
      try {
        app.destroy(true, { children: true });
      } catch {
        // init may not have finished
      }
      el.replaceChildren();
    };
  }, [map, layout]);

  // Repaint on any change that affects how things look.
  useEffect(
    () =>
      useApp.subscribe((s, prev) => {
        if (!scene.current) return;
        if (
          s.states !== prev.states ||
          s.hovered !== prev.hovered ||
          s.hoveredCircle !== prev.hoveredCircle ||
          s.glow !== prev.glow ||
          s.selected !== prev.selected ||
          s.matches !== prev.matches ||
          s.plan !== prev.plan
        )
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

function flyTo(s: Scene, id: string) {
  const n = s.layout.nodes[id];
  if (n) {
    s.viewport.animate({ position: { x: n.x, y: n.y }, scale: Math.max(s.viewport.scale.x, 0.9), time: 650, ease: 'easeInOutSine' });
    return;
  }
  const c = s.layout.circles.find((k) => k.id === id);
  if (!c) return;
  const scale = Math.min(s.viewport.screenWidth, s.viewport.screenHeight) / (c.r * 2.4);
  s.viewport.animate({ position: { x: c.x, y: c.y }, scale: Math.min(Math.max(scale, 0.03), 1.2), time: 650, ease: 'easeInOutSine' });
}

const xy = (p: { x: number; y: number }): [number, number] => [p.x, p.y];

/** A screen point that circleAt resolves to `c` and that is not over a subject, or null if none is visible. */
function clickPointForCircle(s: Scene, c: LayoutCircle) {
  const nodes = Object.values(s.layout.nodes);
  for (const f of [0.995, 0.99, 0.97, 0.93, 0.88, 0.8, 0.7, 0.6, 0.5, 0.35, 0.2, 0.1, 0]) {
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const x = c.x + c.r * f * Math.cos(a);
      const y = c.y + c.r * f * Math.sin(a);
      if (circleAt(s.layout, x, y, RIM_PX / s.viewport.scale.x) !== c) continue;
      if (nodes.some((n) => Math.hypot(x - n.x, y - n.y) <= n.r + 6)) continue;
      const p = s.viewport.toScreen(x, y);
      if (p.x > 20 && p.y > 20 && p.x < s.viewport.screenWidth - 20 && p.y < s.viewport.screenHeight - 20) return { x: p.x, y: p.y };
    }
  }
  return null;
}

function applyLod(s: Scene) {
  s.invalidate();
  const scale = s.viewport.scale.x;
  for (const v of s.nodes.values()) v.label.visible = scale > LABEL_MIN_SCALE;
  for (const v of s.circles) {
    // Program titles only once you are close enough to read them; degree titles always.
    v.title.visible = v.circle.kind === 'degree' || scale > 0.12;
    v.title.scale.set(v.circle.kind === 'degree' ? Math.max(1, 0.12 / scale) : 1);
  }
}

/** Everything that depends on plan, hover, selection, glow or search. */
function paint(s: Scene) {
  s.invalidate();
  const { states, hovered, hoveredCircle, glow, selected, matches, plan, fits } = useApp.getState();
  const { map, layout } = s;
  const completed = new Set(plan.completed);
  const chosen = new Set(plan.programs);
  const degree = plan.degree ? map.degrees[plan.degree] : null;
  const glowSet = new Set(glow);

  // The selected degree: which subjects belong to it, which it still needs, which will not count.
  const inDegree = degree ? subjectsUnder(map, degree.structure) : null;
  const needed = new Set<string>();
  if (degree) {
    for (const c of compulsorySubjects(map, degree.structure)) if (!completed.has(c)) needed.add(c);
    for (const p of chosen) {
      if (!map.programs[p]) continue;
      for (const c of compulsorySubjects(map, map.programs[p].structure)) if (!completed.has(c) && inDegree!.has(c)) needed.add(c);
    }
  }
  const wasted = new Set(degree ? (fits.get(degree.code)?.wasted ?? []).map((w) => w.code) : []);

  // Focus: the hovered (else selected) subject's missing chain and what it unlocks.
  const focus = hovered ?? (selected && map.subjects[selected] ? selected : null);
  const path = new Set<string>();
  const unlocks = new Set<string>();
  if (focus && map.subjects[focus]) {
    missingFor(map, focus, completed, plan.degree).subjects.forEach((c) => path.add(c));
    unlockedBy(map, focus).forEach((c) => unlocks.add(c));
  }
  const matchSet = new Set(matches);
  const dimming = !!(hovered && map.subjects[hovered]) || matchSet.size > 0;
  const lit = (id: string) =>
    !dimming || id === focus || path.has(id) || unlocks.has(id) || matchSet.has(id) || (hovered && !matchSet.size && completed.has(id));

  s.glowing = [];
  for (const v of s.circles) {
    const { circle, shape, title } = v;
    const g = shape.clear();
    const glowing = glowSet.has(circle.id) || hoveredCircle === circle.id || matchSet.has(circle.id);
    if (glowing) s.glowing.push(circle.id);
    if (circle.kind === 'degree') {
      const hue = s.hue.get(circle.id)!;
      const fit = fits.get(circle.id);
      const grey = fit?.grey ?? 0;
      const isSel = plan.degree === circle.id;
      const fill = mix(hue, canvas.grey, grey);
      const other = !!plan.degree && !isSel;
      g.circle(circle.x, circle.y, circle.r)
        .fill({ color: fill, alpha: isSel ? 0.09 : 0.05 })
        .stroke({ color: glowing ? canvas.glow : mix(hue, canvas.grey, grey * 0.8), width: isSel ? 16 : glowing ? 14 : 8, alpha: other && !glowing ? 0.3 : 1 });
      title.alpha = other ? 0.45 : 1 - grey * 0.5;
    } else {
      const isChosen = chosen.has(circle.id);
      const inSel = !degree || (inDegree && circle.members.some((m) => inDegree.has(m)));
      g.circle(circle.x, circle.y, circle.r)
        .fill({ color: isChosen ? canvas.chosen : canvas.programFill, alpha: glowing ? 0.12 : isChosen ? 0.08 : 0.035 })
        .stroke({
          color: glowing ? canvas.glow : isChosen ? canvas.chosen : canvas.programRing,
          width: glowing ? 8 : isChosen ? 6 : 3,
          alpha: inSel || glowing ? 1 : 0.3,
        });
      title.alpha = inSel || glowing ? 1 : 0.35;
    }
    if (circle.id === selected) g.circle(circle.x, circle.y, circle.r + 10).stroke({ color: 0xffffff, width: 3, alpha: 0.8 });
  }

  for (const v of s.nodes.values()) {
    const { node, shape, root } = v;
    const g = shape.clear();
    const state = states.get(node.id) ?? 'locked';
    const look = stateLook[state];
    if (look.glow) g.circle(0, 0, node.r + 7).fill({ color: look.glow, alpha: 0.16 });
    if (matchSet.has(node.id) || glowSet.has(node.id)) g.circle(0, 0, node.r + 10).stroke({ color: canvas.glow, width: 3, alpha: 0.9 });
    if (path.has(node.id)) g.circle(0, 0, node.r + 6).stroke({ color: canvas.edgePath, width: 3 });
    if (unlocks.has(node.id)) g.circle(0, 0, node.r + 6).stroke({ color: canvas.edgeUnlock, width: 3 });
    if (needed.has(node.id)) g.circle(0, 0, node.r + 5).stroke({ color: canvas.needed, width: 2, alpha: 0.85 });
    if (wasted.has(node.id)) g.circle(0, 0, node.r + 8).stroke({ color: canvas.wasted, width: 4 });
    g.circle(0, 0, node.r).fill(look.fill).stroke({ color: look.ring, width: look.ringWidth });
    if (state === 'excluded') {
      const k = node.r * 0.45;
      g.moveTo(-k, -k).lineTo(k, k).moveTo(k, -k).lineTo(-k, k).stroke({ color: look.ring, width: 2, alpha: 0.7 });
    }
    if (node.id === selected) g.circle(0, 0, node.r + 14).stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
    const outside = !!inDegree && !inDegree.has(node.id) && !wasted.has(node.id) && !completed.has(node.id);
    root.alpha = look.alpha * (lit(node.id) ? 1 : 0.22) * (outside ? 0.35 : 1);
    v.label.style.fill = state === 'locked' || state === 'legacy' ? canvas.labelDim : canvas.label;
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
    if (onPath) (color = canvas.edgePath), (width = 5);
    else if (unlocking) (color = canvas.edgeUnlock), (width = 4);
    else if (bothDone) (color = canvas.edgeDone), (width = 5);
    else if (completed.has(edge.from) && states.get(edge.to) === 'available') (color = canvas.edgeOpen), (width = 3);
    else {
      color = edge.kind === 'alt' ? canvas.edgeAlt : canvas.edgeBase;
      width = edge.kind === 'alt' ? 1.5 : 2.5;
      alpha = 0.6;
    }
    if (dimming && !(onPath || unlocking || (lit(edge.from) && lit(edge.to)))) alpha *= 0.15;
    if (inDegree && !(inDegree.has(edge.from) && inDegree.has(edge.to)) && !onPath && !unlocking) alpha *= 0.3;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    e.moveTo(a.x + (dx / len) * a.r, a.y + (dy / len) * a.r)
      .lineTo(b.x - (dx / len) * b.r, b.y - (dy / len) * b.r)
      .stroke({ color, width, alpha });
  }
  applyLod(s);
}
