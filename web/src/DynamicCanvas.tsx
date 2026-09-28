import { forceCollide, forceSimulation, forceX, forceY, type ForceX, type Simulation, type SimulationNodeDatum } from 'd3-force';
import { Application, BitmapText, Container, Graphics, Text } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { useEffect, useRef } from 'react';
import { centreOf, hiddenCircles } from '../../core/dynamic';
import { awayArea, circleAt, TITLE_LINE, type Layout, type LayoutCircle, type PathCmd } from '../../core/layout';
import type { MapDoc } from '../../core/model';
import { chosenDegrees } from '../../core/pairs';
import { useApp } from './store';
import { canvas, facultyColour, stateLook } from './theme';
import { textPx } from './view';

// Dynamic mode (US-053 to US-056): only what is not locked, each top-level circle a body pulled by
// gravity towards the last chosen thing. The static map (TreeCanvas) is untouched.

/** Bodies keep this much space between them, in world units, beyond their circle and title. */
const BODY_GAP = 120;
/** Gravity: weaker sideways than up and down, so the map spreads sideways (US-055). */
const PULL = { x: 0.03, y: 0.1 };
/** Damping: high, so bodies come to rest rather than being thrown across (US-055). */
const DECAY = 0.55;
/** Fade in and out, in ms. */
const FADE = 300;
/** Subject codes show only when zoomed in this far, as on the static map. */
const LABEL_MIN_SCALE = 0.42;
const TITLE_LIFT = { degree: 40, program: 8 } as const;

interface Body extends SimulationNodeDatum {
  id: string;
  /** Its circles, subjects and links, the top circle at (0, 0). */
  lay: Layout;
  /** Its top circle's radius. */
  cr: number;
  /** Collision radius: the circle and its title, plus a gap. */
  r: number;
  root: Container;
  shapes: Graphics;
  links: Graphics;
  discs: Graphics;
  labels: Container | null;
  titles: { text: Text; circle: LayoutCircle; base: number }[];
  /** The programs inside it that are hidden, as a key: a change means a new layout. */
  hideKey: string;
  /** The layout requested for this key. */
  seq: number;
  tx: number;
  ty: number;
  area: string | null;
  born: number;
  leaving: number | null;
}

declare global {
  interface Window {
    /** Read-only helpers for tests of Dynamic mode. */
    __dyn?: {
      settled(): boolean;
      bodies(): { id: string; x: number; y: number; r: number; circleR: number }[];
      centre(): string | null;
      zoom(): number;
      screen(): { x: number; y: number; scale: number };
      /** Simulation ticks so far, its alpha, and new layouts still awaited. */
      stats(): { ticks: number; alpha: number; pending: number; tickMs: number; placeMs: number; renderMs: number; relayouts: number[] };
    };
  }
}

/** A top-level circle's part of the static layout, moved so the circle is at (0, 0). */
function partOf(layout: Layout, top: string, topOfCircle: Map<string, string>): Layout {
  const c0 = layout.circles.find((c) => c.id === top)!;
  const dx = -c0.x;
  const dy = -c0.y;
  const circles = layout.circles
    .filter((c) => topOfCircle.get(c.id) === top)
    .map((c) => ({ ...c, x: c.x + dx, y: c.y + dy, label: { ...c.label, x: c.label.x + dx, y: c.label.y + dy } }));
  const ids = new Set(circles.map((c) => c.id));
  const nodes = Object.fromEntries(Object.values(layout.nodes).filter((n) => ids.has(n.circle)).map((n) => [n.id, { ...n, x: n.x + dx, y: n.y + dy }]));
  const edges = layout.edges.filter((e) => nodes[e.from]).map((e) => ({ ...e, path: e.path.map((p) => shift(p, dx, dy)) }));
  return { nodes, circles, edges, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
}

/** The same, less the hidden circles and everything in them (shown until the new layout arrives). */
function without(lay: Layout, hidden: Set<string>): Layout {
  const circles = lay.circles.filter((c) => !hidden.has(c.id));
  const ids = new Set(circles.map((c) => c.id));
  const nodes = Object.fromEntries(Object.entries(lay.nodes).filter(([, n]) => ids.has(n.circle)));
  return { ...lay, circles, nodes, edges: lay.edges.filter((e) => nodes[e.from]) };
}

function shift(c: PathCmd, dx: number, dy: number): PathCmd {
  if (c[0] === 'M' || c[0] === 'L') return [c[0], c[1] + dx, c[2] + dy];
  if (c[0] === 'Q') return ['Q', c[1] + dx, c[2] + dy, c[3] + dx, c[4] + dy];
  return ['A', c[1] + dx, c[2] + dy, c[3], c[4], c[5], c[6]];
}

function tracePath(g: Graphics, path: PathCmd[]) {
  for (const c of path) {
    if (c[0] === 'M') g.moveTo(c[1], c[2]);
    else if (c[0] === 'L') g.lineTo(c[1], c[2]);
    else if (c[0] === 'Q') g.quadraticCurveTo(c[1], c[2], c[3], c[4]);
    else g.arc(c[1], c[2], c[3], c[4], c[5], c[6]);
  }
}

/** Collision radius: the top circle, or its title if that reaches further, plus the gap. */
function reach(lay: Layout, id: string): { cr: number; r: number } {
  const c = lay.circles.find((k) => k.id === id)!;
  const title = Math.hypot(c.label.w / 2, c.y - c.label.y);
  return { cr: c.r, r: Math.max(c.r, title) + BODY_GAP };
}


export function DynamicCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const map = useApp((s) => s.map);
  const layout = useApp((s) => s.layout);

  useEffect(() => {
    if (!host.current || !map || !layout) return;
    let cancelled = false;
    const app = new Application();
    const el = host.current;
    const cleanups: (() => void)[] = [];

    (async () => {
      await app.init({ resizeTo: el, background: canvas.background, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2) });
      if (cancelled) return app.destroy(true, { children: true });
      el.appendChild(app.canvas);

      let dirty = true;
      const invalidate = () => (dirty = true);
      app.ticker.remove(app.render, app);

      const viewport = new Viewport({ screenWidth: el.clientWidth, screenHeight: el.clientHeight, events: app.renderer.events });
      viewport.drag().pinch().wheel({ smooth: 4 }).decelerate({ friction: 0.92 }).clampZoom({ minScale: 0.01, maxScale: 3 });
      viewport.isRenderGroup = true;
      viewport.interactiveChildren = false;
      app.stage.addChild(viewport);
      const areaLayer = new Container();
      const bodyLayer = new Container();
      viewport.addChild(areaLayer, bodyLayer);
      for (const ev of ['moved', 'zoomed'] as const) viewport.on(ev, () => (lod(), invalidate()));
      app.renderer.on('resize', (w: number, h: number) => (viewport.resize(w, h), invalidate()));

      // Each top-level circle, and the static layout's part for it.
      const parent = new Map(layout.circles.map((c) => [c.id, c.parent]));
      const topOfCircle = new Map<string, string>();
      for (const c of layout.circles) {
        let t = c.id;
        while (parent.get(t)) t = parent.get(t)!;
        topOfCircle.set(c.id, t);
      }
      const tops = layout.circles.filter((c) => !c.parent);
      const staticAt = new Map(tops.map((c) => [c.id, c]));
      const parts = new Map<string, Layout>();
      const part = (id: string) => parts.get(id) ?? parts.set(id, partOf(layout, id, topOfCircle)).get(id)!;
      const areaOf = (c: LayoutCircle): string | null => {
        const by = c.kind === 'degree' ? [c.id] : (c.sharedBy ?? []);
        const at = new Set(by.map((d) => awayArea(map, d)));
        return by.length && at.size === 1 ? [...at][0] : null;
      };

      // New layouts for circles that lost some of what is in them, laid out off the main thread (US-056).
      const worker = new Worker(new URL('./layoutWorker.ts', import.meta.url), { type: 'module' });
      worker.postMessage({ type: 'map', map });
      cleanups.push(() => worker.terminate());
      let seq = 0;
      worker.onmessage = (e: MessageEvent<{ id: string; seq: number; layout: Layout }>) => {
        // How long a new layout took, asked to arrived (US-057).
        if (asked.has(e.data.seq)) timing.relayouts.push(performance.now() - asked.get(e.data.seq)!), asked.delete(e.data.seq);
        const b = bodies.get(e.data.id);
        if (!b || b.seq !== e.data.seq || b.leaving) return;
        b.seq = 0;
        setLayout(b, e.data.layout);
        sim.alpha(Math.max(sim.alpha(), 0.3));
        settled = false;
      };

      const bodies = new Map<string, Body>();
      let settled = false;
      let centre: string | null = null;
      /** The top-level circle holding the centre: it stays where it is and the rest gather round it. */
      let centreBody: string | null = null;
      /** Offshore circles wait until the rest have settled, then come in last. */
      const waiting = new Map<string, () => void>();

      const makeBody = (id: string, lay: Layout, hideKey: string, x: number, y: number): Body => {
        const root = new Container();
        const shapes = new Graphics();
        const links = new Graphics();
        const discs = new Graphics();
        root.addChild(shapes, links, discs);
        bodyLayer.addChild(root);
        const b: Body = { id, lay, cr: 0, r: 0, root, shapes, links, discs, labels: null, titles: [], hideKey, seq: 0, tx: 0, ty: 0, area: areaOf(staticAt.get(id)!), born: performance.now(), leaving: null, x, y };
        setLayout(b, lay);
        return b;
      };

      const setLayout = (b: Body, lay: Layout) => {
        b.lay = lay;
        Object.assign(b, reach(lay, b.id));
        for (const t of b.titles) t.text.destroy();
        b.titles = lay.circles.map((circle) => {
          const degree = map.degrees[circle.id];
          const fill = degree ? facultyColour(degree.titleParts?.[0]?.colour) : canvas.clusterTitle;
          const text = new Text({
            text: circle.label.lines.join('\n'),
            style: { fill, fontSize: circle.label.size, lineHeight: circle.label.size * TITLE_LINE, fontFamily: 'Georgia, serif', align: 'center' },
            resolution: degree ? 1 : 2,
          });
          text.anchor.set(0.5, 1);
          const base = Math.min(1, circle.label.w / text.width, circle.label.h / text.height);
          text.position.set(circle.label.x, circle.label.y + circle.label.h - TITLE_LIFT[degree ? 'degree' : 'program']);
          b.root.addChild(text);
          return { text, circle, base };
        });
        if (b.labels) (b.labels.destroy({ children: true }), (b.labels = null));
        draw(b);
      };

      /** A body's circles, links and subjects in the current plan's colours. */
      const draw = (b: Body) => {
        const { plan, states, locks, selected } = useApp.getState();
        const chosen = chosenDegrees(map, plan.degree);
        const completed = new Set(plan.completed);
        const g = b.shapes.clear();
        for (const c of b.lay.circles) {
          const d = map.degrees[c.id];
          if (d) {
            const hue = facultyColour(d.titleParts?.[0]?.colour);
            const sel = chosen.includes(c.id);
            g.circle(c.x, c.y, c.r).fill({ color: hue, alpha: sel ? 0.09 : 0.05 }).stroke({ color: hue, width: sel ? 16 : 8 });
          } else {
            const on = plan.programs.includes(c.id);
            g.circle(c.x, c.y, c.r)
              .fill({ color: on ? canvas.chosen : canvas.programFill, alpha: on ? 0.08 : 0.035 })
              .stroke({ color: locks.has(c.id) ? canvas.wasted : on ? canvas.chosen : canvas.programRing, width: on ? 6 : 3 });
          }
          // The open circle stands out at any zoom, as on the static map.
          if (c.id === selected) g.circle(c.x, c.y, c.r).fill({ color: canvas.glow, alpha: 0.16 }).circle(c.x, c.y, c.r + 10).stroke({ color: canvas.selectRing, width: Math.max(6, c.r * 0.035), alpha: 0.9 });
        }
        const e = b.links.clear();
        for (const edge of b.lay.edges) {
          tracePath(e, edge.path);
          const done = completed.has(edge.fromCode) && completed.has(edge.toCode);
          const open = completed.has(edge.fromCode) && states.get(edge.toCode) === 'available';
          e.stroke(
            done
              ? { color: canvas.edgeDone, width: 5 }
              : open
                ? { color: canvas.edgeOpen, width: 3 }
                : { color: edge.kind === 'alt' ? canvas.edgeAlt : canvas.edgeBase, width: edge.kind === 'alt' ? 1.5 : 2.5, alpha: 0.75 },
          );
        }
        const n = b.discs.clear();
        for (const node of Object.values(b.lay.nodes)) {
          const state = states.get(node.code) ?? 'locked';
          const look = stateLook[state];
          const marked = state === 'completed' || state === 'planned';
          if (node.entry && !marked) n.circle(node.x, node.y, node.r - 2).fill({ color: canvas.background, alpha: 0.9 }).stroke({ color: look.ring, width: 2, alpha: 0.8 });
          else n.circle(node.x, node.y, node.r).fill({ color: look.fill, alpha: look.alpha }).stroke({ color: look.ring, width: look.ringWidth, alpha: look.alpha });
          if (node.code === selected) n.circle(node.x, node.y, node.r + 11).stroke({ color: canvas.glow, width: 4 });
        }
        invalidate();
      };

      /** Title sizes and subject labels for the zoom, and whether each body is on screen. */
      const lod = () => {
        const scale = viewport.scale.x;
        const { view } = useApp.getState();
        const m = 0.15 * Math.max(viewport.worldScreenWidth, viewport.worldScreenHeight);
        for (const b of bodies.values()) {
          const on = b.x! + b.r > viewport.left - m && b.x! - b.r < viewport.right + m && b.y! + b.r > viewport.top - m && b.y! - b.r < viewport.bottom + m;
          b.root.visible = on;
          if (!on) continue;
          for (const t of b.titles) {
            const kind = map.degrees[t.circle.id] ? 'degree' : 'program';
            const natural = t.circle.label.size * t.base * scale;
            t.text.scale.set((t.base * textPx(kind, natural, view)) / natural);
            // Inner program titles only once close enough to read, as on the static map.
            t.text.visible = t.circle.id === b.id || scale > 0.12;
          }
          const wantLabels = scale > LABEL_MIN_SCALE;
          if (wantLabels && !b.labels) {
            b.labels = new Container();
            for (const node of Object.values(b.lay.nodes)) {
              const label = new BitmapText({ text: node.code, style: { fontFamily: 'subject-code', fontSize: 13 } });
              label.anchor.set(0.5);
              label.position.set(node.x, node.y);
              label.tint = canvas.label;
              b.labels.addChild(label);
            }
            b.root.addChild(b.labels);
          }
          if (b.labels) b.labels.visible = wantLabels;
        }
        declutter();
      };

      /**
       * No two titles overlap (US-044's rule): the chosen things' first, then degrees before programs,
       * bigger circles first; a title that would overlap one already placed is hidden. Cheap enough at
       * this size to run as the bodies move.
       */
      const declutter = () => {
        const { plan } = useApp.getState();
        const chosen = new Set([...chosenDegrees(map, plan.degree), ...plan.programs]);
        const scale = viewport.scale.x;
        const gap = 4 / scale;
        const cell = 300 / scale;
        type Cand = { t: Body['titles'][number]; box: { x0: number; y0: number; x1: number; y1: number }; rank: number };
        const cands: Cand[] = [];
        for (const b of bodies.values()) {
          if (b.leaving || !b.root.visible) continue;
          for (const t of b.titles) {
            if (!(t.circle.id === b.id || scale > 0.12)) continue;
            const w = t.text.width / 2;
            const x = b.x! + t.text.x;
            const y = b.y! + t.text.y;
            const rank = chosen.has(t.circle.id) ? 0 : t.circle.kind === 'degree' ? 1 : 2;
            cands.push({ t, box: { x0: x - w - gap, y0: y - t.text.height - gap, x1: x + w + gap, y1: y + gap }, rank });
          }
        }
        cands.sort((a, b) => a.rank - b.rank || b.t.circle.r - a.t.circle.r);
        const placed = new Map<string, Cand['box'][]>();
        const hits = (a: Cand['box'], b: Cand['box']) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
        for (const c of cands) {
          const keys: string[] = [];
          for (let i = Math.floor(c.box.x0 / cell); i <= Math.floor(c.box.x1 / cell); i++)
            for (let j = Math.floor(c.box.y0 / cell); j <= Math.floor(c.box.y1 / cell); j++) keys.push(`${i},${j}`);
          const free = c.rank === 0 || !keys.some((k) => (placed.get(k) ?? []).some((p) => hits(p, c.box)));
          c.t.text.visible = free;
          if (free) for (const k of keys) placed.set(k, [...(placed.get(k) ?? []), c.box]);
        }
      };

      // Gravity (US-055).
      // Offshore bodies hold their own cluster: pulled to their spots hard, both ways.
      const pullX = forceX<Body>((b) => b.tx).strength((b) => (b.fx != null ? 0 : b.area ? 0.2 : PULL.x));
      const sim: Simulation<Body, undefined> = forceSimulation<Body>([])
        .velocityDecay(DECAY)
        .alphaDecay(0.03)
        .alphaMin(0.003)
        .force('x', pullX)
        .force('y', forceY<Body>((b) => b.ty).strength((b) => (b.fy != null ? 0 : b.area ? 0.2 : PULL.y)))
        .force('collide', forceCollide<Body>((b) => b.r).strength(1).iterations(3))
        .stop();
      let ticks = 0;
      const timing = { tickMs: 0, placeMs: 0, renderMs: 0, relayouts: [] as number[] };
      const asked = new Map<number, number>();
      // Physics runs on its own timer, as many steps as fit in a few milliseconds each time, so how fast
      // the map settles does not depend on how fast frames are drawn (slow ones stall the frame loop).
      const STEP_BUDGET_MS = 6;
      const step = () => {
        if (settled) return;
        const t0 = performance.now();
        const before = ticks;
        do {
          sim.tick();
          ticks++;
          if (ticks % 30 === 0) retarget();
        } while (sim.alpha() > sim.alphaMin() && performance.now() - t0 < STEP_BUDGET_MS);
        timing.tickMs = (performance.now() - t0) / (ticks - before);
        if (sim.alpha() <= sim.alphaMin()) (settled = true), bringOffshore();
        const t1 = performance.now();
        place();
        timing.placeMs = performance.now() - t1;
      };

      /** Where each body is pulled: its faculty's place (nothing chosen) or the centre; offshore to its own area. */
      const retarget = () => {
        const live = [...bodies.values()].filter((b) => !b.leaving);
        const pinned = centreBody ? bodies.get(centreBody) : undefined;
        for (const b of live) {
          const home = staticAt.get(b.id)!;
          // Offshore: always their own spot far to the right, as on the static map, never the centre.
          if (b.area) (b.tx = home.x), (b.ty = home.y);
          // Something chosen: towards where it rests.
          else if (pinned) (b.tx = pinned.fx ?? pinned.x!), (b.ty = pinned.fy ?? pinned.y!);
          // Nothing chosen: back towards their faculty's place, as on the static map.
          else (b.tx = home.x), (b.ty = 0);
        }
        pullX.x((b) => b.tx);
      };

      /** Move each body to where the simulation has it, fading bodies in and out. */
      const areaFrames = new Map<string, { frame: Graphics; title: Text }>();
      const place = () => {
        const now = performance.now();
        for (const b of [...bodies.values()]) {
          b.root.position.set(b.x!, b.y!);
          const t = b.leaving ? 1 - (now - b.leaving) / FADE : (now - b.born) / FADE;
          b.root.alpha = Math.max(0, Math.min(1, t));
          if (b.leaving && t <= 0) {
            b.root.destroy({ children: true });
            bodies.delete(b.id);
          }
        }
        // Offshore areas: a frame round their bodies, titled (US-050, US-054).
        const byArea = new Map<string, Body[]>();
        for (const b of bodies.values()) if (b.area && !b.leaving) byArea.set(b.area, [...(byArea.get(b.area) ?? []), b]);
        for (const [a, v] of areaFrames) if (!byArea.has(a)) (v.frame.destroy(), v.title.destroy(), areaFrames.delete(a));
        for (const [a, members] of byArea) {
          let v = areaFrames.get(a);
          if (!v) {
            v = { frame: new Graphics(), title: new Text({ text: map.locations?.away[a]?.title ?? a, style: { fill: canvas.clusterTitle, fontSize: 420, fontFamily: 'Georgia, serif' } }) };
            v.title.anchor.set(0.5, 1);
            areaLayer.addChild(v.frame, v.title);
            areaFrames.set(a, v);
          }
          const pad = 600;
          const x0 = Math.min(...members.map((b) => b.x! - b.r)) - pad;
          const x1 = Math.max(...members.map((b) => b.x! + b.r)) + pad;
          const y0 = Math.min(...members.map((b) => b.y! - b.r)) - pad;
          const y1 = Math.max(...members.map((b) => b.y! + b.r)) + pad;
          v.frame.clear().roundRect(x0, y0, x1 - x0, y1 - y0, 600).fill({ color: canvas.clusterHalo, alpha: 0.6 }).stroke({ color: canvas.clusterTitle, width: 60, alpha: 0.5 });
          v.title.position.set((x0 + x1) / 2, y0 - 120);
        }
        lod();
        invalidate();
      };

      /** Bring the bodies in line with what is locked now (US-054, US-056). */
      const sync = (first: boolean) => {
        const s = useApp.getState();
        const hidden = hiddenCircles(layout, s.locks, s.degreeLocks);
        const nextCentre = centreOf(map, layout, s.plan, s.last);
        const centreTop = nextCentre ? topOfCircle.get(nextCentre)! : null;
        const shown = tops.filter((c) => !hidden.has(c.id));
        const shownIds = new Set(shown.map((c) => c.id));
        for (const c of shown) {
          const inside = part(c.id).circles.filter((k) => hidden.has(k.id)).map((k) => k.id);
          const hideKey = inside.sort().join(',');
          let b = bodies.get(c.id);
          if (!b || b.leaving) {
            // A new circle pops in where it sits on the static map, in its faculty's place, and falls in.
            const add = () => {
              const old = bodies.get(c.id);
              if (old) old.root.destroy({ children: true });
              const nb = makeBody(c.id, hideKey ? without(part(c.id), new Set(inside)) : part(c.id), hideKey, c.x, c.y);
              bodies.set(c.id, nb);
              if (hideKey) request(nb, inside);
            };
            if (areaOf(c)) {
              waiting.set(c.id, add);
              continue;
            }
            add();
          } else if (b.hideKey !== hideKey) {
            b.hideKey = hideKey;
            setLayout(b, hideKey ? without(part(c.id), new Set(inside)) : part(c.id));
            if (hideKey) request(b, inside);
          } else draw(b);
        }
        for (const id of [...waiting.keys()]) if (!shownIds.has(id)) waiting.delete(id);
        for (const b of bodies.values()) if (!shownIds.has(b.id) && !b.leaving) (b.leaving = performance.now()), (b.fx = null), (b.fy = null);
        // The centre's circle stays exactly where it is; the camera does not move (US-055).
        for (const b of bodies.values()) if (b.id !== centreTop) (b.fx = null), (b.fy = null);
        const pinned = centreTop ? bodies.get(centreTop) : undefined;
        if (pinned && pinned.fx == null) (pinned.fx = pinned.x), (pinned.fy = pinned.y);
        centreBody = pinned ? centreTop : null;
        centre = nextCentre;
        restart(first ? 0.6 : 0.8);
        if (first) aim();
      };

      const restart = (alpha: number) => {
        sim.nodes([...bodies.values()].filter((b) => !b.leaving));
        retarget();
        sim.force('collide', forceCollide<Body>((b) => b.r).strength(1).iterations(3));
        sim.alpha(alpha);
        settled = false;
      };

      /** Once the rest have settled, the offshore circles come in (US-054). */
      const bringOffshore = () => {
        if (!waiting.size) return;
        for (const add of waiting.values()) add();
        waiting.clear();
        restart(0.5);
      };

      const request = (b: Body, hide: string[]) => {
        b.seq = ++seq;
        asked.set(b.seq, performance.now());
        worker.postMessage({ type: 'layout', id: b.id, hide, seq: b.seq });
      };

      /** The camera goes to the chosen thing, or takes in the whole map when nothing is chosen. */
      const aim = () => {
        if (centre) {
          const top = topOfCircle.get(centre)!;
          const b = bodies.get(top);
          const c = b?.lay.circles.find((k) => k.id === centre);
          if (b && c) {
            const scale = Math.min(viewport.screenWidth, viewport.screenHeight) / (c.r * 3);
            viewport.animate({ position: { x: c.x, y: c.y }, scale: Math.min(Math.max(scale, 0.01), 1.2), time: 800, ease: 'easeInOutSine' });
            return;
          }
        }
        const { minX, minY, maxX, maxY } = layout.bounds;
        viewport.fit(true, maxX - minX, maxY - minY);
        viewport.moveCenter((minX + maxX) / 2, (minY + maxY) / 2);
      };

      /** Fly to a subject copy or a circle that is shown. */
      const flyTo = (id: string) => {
        const { copy } = useApp.getState();
        for (const b of bodies.values()) {
          if (b.leaving) continue;
          const node = map.subjects[id] ? (copy && b.lay.nodes[copy]?.code === id ? b.lay.nodes[copy] : Object.values(b.lay.nodes).find((n) => n.code === id && !n.entry)) : null;
          const circle = node ? null : b.lay.circles.find((c) => c.id === id);
          const at = node ?? circle;
          if (!at) continue;
          if (node) useApp.setState({ copy: node.id });
          const scale = node ? Math.max(viewport.scale.x, 0.9) : Math.min(viewport.screenWidth, viewport.screenHeight) / ((circle!.r || 1) * 2.4);
          viewport.animate({ position: { x: b.x! + at.x, y: b.y! + at.y }, scale: Math.min(Math.max(scale, 0.01), 1.2), time: 650, ease: 'easeInOutSine' });
          return;
        }
      };

      // Clicks: a subject, else the smallest circle under the pointer, in whichever body is there.
      let downAt: { x: number; y: number } | null = null;
      viewport.on('pointerdown', (e) => (downAt = { x: e.global.x, y: e.global.y }));
      viewport.on('pointertap', (e) => {
        if (!downAt || Math.hypot(e.global.x - downAt.x, e.global.y - downAt.y) > 6) return;
        const w = viewport.toWorld(e.global.x, e.global.y);
        const s = useApp.getState();
        for (const b of bodies.values()) {
          if (b.leaving || Math.hypot(w.x - b.x!, w.y - b.y!) > b.cr) continue;
          const lx = w.x - b.x!;
          const ly = w.y - b.y!;
          const node = Object.values(b.lay.nodes).find((n) => Math.hypot(lx - n.x, ly - n.y) <= n.r);
          if (node) return useApp.setState({ copy: node.id }), s.select(node.code);
          const circle = circleAt(b.lay, lx, ly, 10 / viewport.scale.x);
          if (circle) return s.select(circle.id);
        }
        s.select(null);
      });

      window.__dyn = {
        settled: () => settled,
        bodies: () => [...bodies.values()].filter((b) => !b.leaving).map((b) => ({ id: b.id, x: b.x!, y: b.y!, r: b.r, circleR: b.cr })),
        centre: () => centre,
        zoom: () => viewport.scale.x,
        screen: () => ({ x: viewport.center.x, y: viewport.center.y, scale: viewport.scale.x }),
        stats: () => ({ ticks, alpha: sim.alpha(), pending: [...bodies.values()].filter((b) => b.seq && !b.leaving).length, ...timing }),
      };
      cleanups.push(() => delete window.__dyn);

      const unsub = useApp.subscribe((s, prev) => {
        if (s.locks !== prev.locks || s.degreeLocks !== prev.degreeLocks || s.plan !== prev.plan || s.last !== prev.last) sync(false);
        else if (s.states !== prev.states || s.selected !== prev.selected || s.theme !== prev.theme) {
          if (s.theme !== prev.theme) app.renderer.background.color = canvas.background;
          for (const b of bodies.values()) if (!b.leaving) draw(b);
        }
        if (s.view !== prev.view) lod();
        if (s.flyTo !== prev.flyTo && s.selected) flyTo(s.selected);
      });
      cleanups.push(unsub);

      const physics = setInterval(() => {
        step();
        // Fading bodies keep moving through their fade after the physics has settled.
        if (settled && [...bodies.values()].some((b) => b.leaving || performance.now() - b.born < FADE)) place();
      }, 16);
      cleanups.push(() => clearInterval(physics));
      app.ticker.add(() => {
        if (!dirty) return;
        dirty = false;
        const t2 = performance.now();
        app.render();
        timing.renderMs = performance.now() - t2;
      });
      sync(true);
    })();

    return () => {
      cancelled = true;
      for (const c of cleanups) c();
      try {
        app.destroy(true, { children: true });
      } catch {
        // init may not have finished
      }
      el.replaceChildren();
    };
  }, [map, layout]);

  return <div ref={host} className="tree-canvas" data-testid="dynamic-canvas" />;
}
