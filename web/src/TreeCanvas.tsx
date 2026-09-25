import { Application, Circle, Container, Graphics, Text } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { useEffect, useRef } from 'react';
import { compulsorySubjects, missingFor, subjectsUnder, unlockedBy } from '../../core/engine';
import { circleAt, TITLE_LINE, type Layout, type LayoutCircle, type LayoutNode, type PathCmd } from '../../core/layout';
import type { MapDoc } from '../../core/model';
import { useApp } from './store';
import { canvas, degreeHues, mix, stateLook } from './theme';

const LABEL_MIN_SCALE = 0.42;
/** Copies of the hovered (or selected) subject grow by at least this much, and to at least this
 * radius on screen, so they stand out however far the map is zoomed out. */
const POP = { 2: { grow: 1.4, px: 18 }, 1: { grow: 1.25, px: 14 } } as const;
/** How close to an outline (in screen pixels) a click selects that outline's circle. */
const RIM_PX = 10;

interface NodeView {
  node: LayoutNode;
  root: Container;
  shape: Graphics;
  label: Text;
  /** What the last paint drew, for tests. */
  drawn: CopyLook;
  /** 2: a copy of the hovered subject, 1: of the selected one, 0: neither. */
  pop: 0 | 1 | 2;
}

/** How one copy of a subject was drawn. */
interface CopyLook {
  fill: number;
  ring: number;
  alpha: number;
  scale: number;
  halo: boolean;
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
  /** Subject copies drawn with the hover or selection ring in the last paint. */
  highlighted: string[];
  /** Circles drawn with a finished glow in the last paint (US-026). */
  finished: Record<string, 'complete' | 'planned'>;
  /** Subject codes drawn with the glow ring (search match or a hovered panel row) in the last paint. */
  ringed: Set<string>;
  /** Ask for one redraw on the next frame. */
  invalidate(): void;
}

declare global {
  interface Window {
    /** Read-only helpers for tests: where on screen a node or circle can be clicked. */
    __dst?: {
      pointFor(id: string): { x: number; y: number } | null;
      glowing(): string[];
      highlighted(): string[];
      look(id: string): CopyLook | null;
      copies(code: string): string[];
      zoom(): number;
      finished(): Record<string, 'complete' | 'planned'>;
      ringed(): string[];
    };
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
        // The title sits above the circle, in the box the layout kept free for it (already wrapped).
        const { label } = circle;
        const title = new Text({
          text: label.lines.join('\n'),
          style: {
            fill: degree ? hue.get(circle.id)! : canvas.clusterTitle,
            fontSize: label.size,
            lineHeight: label.size * TITLE_LINE,
            fontFamily: 'Georgia, serif',
            align: 'center',
          },
          resolution: degree ? 1 : 2,
        });
        title.anchor.set(0.5, 1);
        // Never wider or taller than its box, whatever the font's real metrics are.
        title.scale.set(Math.min(1, label.w / title.width, label.h / title.height));
        title.position.set(label.x, label.y + label.h);
        titleLayer.addChild(title);
        return { circle, shape, title };
      });
      viewport.addChild(circleLayer);

      const edges = new Graphics();
      viewport.addChild(edges);
      const nodeLayer = new Container();
      // Copies of the hovered or selected subject are raised above the rest.
      nodeLayer.sortableChildren = true;
      viewport.addChild(nodeLayer);
      viewport.addChild(titleLayer);

      const nodes = new Map<string, NodeView>();
      for (const node of Object.values(layout.nodes)) {
        const root = new Container();
        root.position.set(node.x, node.y);
        root.eventMode = 'static';
        root.cursor = 'pointer';
        // Only the subject's own disc (enlarged with it) counts for the pointer, never its glow or rings,
        // so hover ends as soon as the pointer leaves the circle.
        root.hitArea = new Circle(0, 0, node.r);
        const shape = new Graphics();
        const label = new Text({
          text: node.code,
          style: { fill: canvas.label, fontSize: 13, fontFamily: 'system-ui, sans-serif', fontWeight: '600', align: 'center' },
          resolution: 3,
        });
        label.anchor.set(0.5);
        root.addChild(shape, label);
        root.on('pointerover', (e) => overCanvas(e) && useApp.getState().hover(node.code));
        root.on('pointerout', () => useApp.getState().hover(null));
        // Circles are siblings of subjects, not parents, so a press on a subject never reaches a circle.
        root.on('pointerdown', (e) => (downAt = { x: e.global.x, y: e.global.y }));
        root.on('pointertap', (e) => {
          if (isClick(e)) useApp.getState().select(node.code);
        });
        nodeLayer.addChild(root);
        nodes.set(node.id, { node, root, shape, label, drawn: { fill: 0, ring: 0, alpha: 1, scale: 1, halo: false }, pop: 0 });
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

      scene.current = { app, viewport, edges, nodes, circles, layout, map, hue, glowing: [], highlighted: [], finished: {}, ringed: new Set(), invalidate };
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
          const n = copyFor(s, id);
          if (n) return s.viewport.toScreen(n.x, n.y);
          const c = s.layout.circles.find((k) => k.id === id);
          return c ? clickPointForCircle(s, c) : null;
        },
        glowing: () => scene.current?.glowing ?? [],
        highlighted: () => scene.current?.highlighted ?? [],
        look: (id) => scene.current?.nodes.get(id)?.drawn ?? null,
        zoom: () => scene.current?.viewport.scale.x ?? 1,
        finished: () => scene.current?.finished ?? {},
        ringed: () => [...(scene.current?.ringed ?? [])],
        copies: (code) => [...(scene.current?.nodes.values() ?? [])].filter((v) => v.node.code === code).map((v) => v.node.id),
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
          s.finish !== prev.finish ||
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

/** Which copy of a subject to fly to: one inside the selected degree if possible, preferring listed over entry copies. */
function copyFor(s: Scene, code: string): LayoutNode | null {
  const copies = Object.values(s.layout.nodes).filter((n) => n.code === code);
  if (!copies.length) return null;
  const degree = useApp.getState().plan.degree;
  const inDegree = (n: LayoutNode) => !!degree && within(s.layout, n.circle, degree);
  return [...copies].sort((a, b) => Number(inDegree(b)) - Number(inDegree(a)) || Number(!!a.entry) - Number(!!b.entry))[0];
}

/** Whether circle `id` is `ancestor` or sits (at any depth) inside it. */
function within(layout: Layout, id: string, ancestor: string): boolean {
  for (let c: string | null = id; c; c = layout.circles.find((k) => k.id === c)?.parent ?? null) if (c === ancestor) return true;
  return false;
}

function fit(viewport: Viewport, layout: Layout) {
  const { minX, minY, maxX, maxY } = layout.bounds;
  viewport.fit(true, maxX - minX, maxY - minY);
  viewport.moveCenter((minX + maxX) / 2, (minY + maxY) / 2);
}

function flyTo(s: Scene, id: string) {
  const n = copyFor(s, id);
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
  for (const v of s.nodes.values()) {
    v.label.visible = scale > LABEL_MIN_SCALE || v.pop > 0;
    const grow = v.pop ? Math.max(POP[v.pop].grow, POP[v.pop].px / (v.node.r * scale)) : 1;
    v.root.scale.set(grow);
    v.drawn.scale = grow;
  }
  for (const v of s.circles) {
    // Program titles only once you are close enough to read them; degree titles always.
    v.title.visible = v.circle.kind === 'degree' || scale > 0.12;
  }
}

function tracePath(g: Graphics, path: PathCmd[]) {
  for (const c of path) {
    if (c[0] === 'M') g.moveTo(c[1], c[2]);
    else if (c[0] === 'L') g.lineTo(c[1], c[2]);
    else if (c[0] === 'Q') g.quadraticCurveTo(c[1], c[2], c[3], c[4]);
    else g.arc(c[1], c[2], c[3], c[4], c[5], c[6]);
  }
}

/** Everything that depends on plan, hover, selection, glow or search. */
function paint(s: Scene) {
  s.invalidate();
  const { states, hovered, hoveredCircle, glow, selected, matches, plan, fits, finish } = useApp.getState();
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
  s.finished = {};
  for (const v of s.circles) {
    const { circle, shape, title } = v;
    const g = shape.clear();
    // Finished circles glow outside their outline: green when completed, blue when the plan finishes them (US-026).
    const done = finish.get(circle.id);
    const halo = done === 'complete' ? canvas.complete : done === 'planned' ? canvas.plannedGlow : null;
    if (halo !== null) {
      const band = circle.kind === 'degree' ? 26 : 12;
      for (let i = 3; i >= 1; i--) g.circle(circle.x, circle.y, circle.r + (band * i) / 2).stroke({ color: halo, width: band, alpha: 0.18 + 0.16 * (3 - i) });
      s.finished[circle.id] = done as 'complete' | 'planned';
    }
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

  // Copies inside the selected degree's circle (at any depth) stay bright; the rest fade.
  const inside = new Map<string, boolean>();
  const insideSel = (circleId: string) => {
    if (!degree) return true;
    if (!inside.has(circleId)) inside.set(circleId, within(layout, circleId, degree.code));
    return inside.get(circleId)!;
  };

  s.highlighted = [];
  s.ringed = new Set();
  for (const v of s.nodes.values()) {
    const { node, shape, root } = v;
    const code = node.code;
    const g = shape.clear();
    const state = states.get(code) ?? 'locked';
    const look = stateLook[state];
    // Every copy of a subject the student has marked looks the same, entry copies included.
    const marked = state === 'completed' || state === 'planned';
    const hollow = node.entry && !marked;
    // Every copy of the hovered (or selected) subject pops out, so it is obvious they are one subject.
    const twin = code === hovered || code === selected;
    if (twin) {
      g.circle(0, 0, node.r + 30).fill({ color: canvas.glow, alpha: 0.1 });
      g.circle(0, 0, node.r + 22).fill({ color: canvas.glow, alpha: 0.16 });
      g.circle(0, 0, node.r + 15).fill({ color: canvas.glow, alpha: 0.28 });
    } else if (look.glow && !hollow) g.circle(0, 0, node.r + 7).fill({ color: look.glow, alpha: 0.16 });
    if (matchSet.has(code) || glowSet.has(code)) {
      g.circle(0, 0, node.r + 10).stroke({ color: canvas.glow, width: 3, alpha: 0.9 });
      s.ringed.add(code);
    }
    if (path.has(code)) g.circle(0, 0, node.r + 6).stroke({ color: canvas.edgePath, width: 3 });
    if (unlocks.has(code)) g.circle(0, 0, node.r + 6).stroke({ color: canvas.edgeUnlock, width: 3 });
    if (needed.has(code) && insideSel(node.circle)) g.circle(0, 0, node.r + 5).stroke({ color: canvas.needed, width: 2, alpha: 0.85 });
    if (wasted.has(code)) g.circle(0, 0, node.r + 8).stroke({ color: canvas.wasted, width: 4 });
    if (hollow) {
      // An entry copy: a prerequisite from outside this circle. Hollow, so it reads as a doorway.
      g.circle(0, 0, node.r - 2).fill({ color: canvas.background, alpha: 0.9 }).stroke({ color: look.ring, width: 2, alpha: 0.8 });
    } else {
      g.circle(0, 0, node.r).fill(look.fill).stroke({ color: look.ring, width: look.ringWidth });
      // A marked entry copy keeps a thin outer line, so it still reads as a doorway.
      if (node.entry) g.circle(0, 0, node.r + 4).stroke({ color: look.ring, width: 1, alpha: 0.6 });
    }
    if (state === 'excluded') {
      const k = node.r * 0.45;
      g.moveTo(-k, -k).lineTo(k, k).moveTo(k, -k).lineTo(-k, k).stroke({ color: look.ring, width: 2, alpha: 0.7 });
    }
    if (twin) {
      g.circle(0, 0, node.r + 11).stroke({ color: canvas.glow, width: 4, alpha: 1 });
      if (code === selected) g.circle(0, 0, node.r + 17).stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
      s.highlighted.push(node.id);
    }
    v.pop = code === hovered ? 2 : twin ? 1 : 0;
    root.zIndex = v.pop;
    root.alpha = twin
      ? 1
      : look.alpha * (lit(code) ? 1 : 0.22) * (marked || insideSel(node.circle) || wasted.has(code) ? 1 : 0.35) * (hollow ? 0.8 : 1);
    v.label.style.fill = state === 'locked' || state === 'legacy' || hollow ? canvas.labelDim : canvas.label;
    v.drawn = { fill: hollow ? canvas.background : look.fill, ring: look.ring, alpha: root.alpha, scale: 1, halo: twin };
  }

  const e = s.edges.clear();
  for (const edge of layout.edges) {
    const from = edge.fromCode;
    const to = edge.toCode;
    let color: number;
    let width: number;
    let alpha = 1;
    const bothDone = completed.has(from) && completed.has(to);
    const onPath = focus && (path.has(from) || from === focus) && (path.has(to) || to === focus);
    const unlocking = focus && from === focus && unlocks.has(to);
    if (onPath) (color = canvas.edgePath), (width = 5);
    else if (unlocking) (color = canvas.edgeUnlock), (width = 4);
    else if (bothDone) (color = canvas.edgeDone), (width = 5);
    else if (completed.has(from) && states.get(to) === 'available') (color = canvas.edgeOpen), (width = 3);
    else {
      color = edge.kind === 'alt' ? canvas.edgeAlt : canvas.edgeBase;
      width = edge.kind === 'alt' ? 1.5 : 2.5;
      alpha = 0.75;
    }
    if (dimming && !(onPath || unlocking || (lit(from) && lit(to)))) alpha *= 0.15;
    if (!insideSel(layout.nodes[edge.from].circle) && !onPath && !unlocking) alpha *= 0.3;
    tracePath(e, edge.path);
    e.stroke({ color, width, alpha, cap: 'round', join: 'round' });
  }
  applyLod(s);
}
