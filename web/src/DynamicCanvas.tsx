import { forceCollide, forceSimulation, forceX, forceY, type ForceX, type Simulation, type SimulationNodeDatum } from 'd3-force';
import { Application, BitmapText, Container, Graphics, Text } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { useEffect, useRef } from 'react';
import { centreOf, hiddenCircles } from '../../core/dynamic';
import { awayArea, circleAt, facultiesOf, TITLE_LINE, type Layout, type LayoutCircle, type PathCmd } from '../../core/layout';
import type { MapDoc } from '../../core/model';
import { chosenDegrees } from '../../core/pairs';
import { useApp } from './store';
import { canvas, facultyColour, stateLook } from './theme';
import { textPx } from './view';

// Dynamic mode (US-053 to US-056): only what is not locked, each top-level circle a body pulled by
// gravity towards the last chosen thing. The static map (TreeCanvas) is untouched.

/** Bodies keep this much space between them, in world units, beyond their circle and title. */
const BODY_GAP = 120;
/** A circle's pull to its spawn point (or its degrees): the same every way, so each faculty gathers
 * into a round cluster rather than being squashed flat, jostling (US-055). */
const PULL = { x: 0.05, y: 0.05 };
/** Offshore courses are held to their own places hard, both ways (US-054). */
const AREA_PULL = { x: 0.2, y: 0.2 };
/** Faculty spawn points: a gentle pull to the centre, just enough to close the gaps between faculties. */
const ANCHOR_PULL = { x: 0.01, y: 0.3 };
/** The static map's zoom limit: "all the way out" in both modes (US-053). */
const MIN_ZOOM = 0.03;
/** World units a step: however strong the pull, nothing moves faster (US-055, "not thrown across"). */
const MAX_SPEED = 300;
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
      /** Faculty spawn points (US-055). */
      anchors(): { faculty: string; x: number; y: number; r: number }[];
      /** Each shown degree's faculties, for checking the grouping (US-055). */
      faculties(): Record<string, string[]>;
      /** The radius the collision force is using for each circle, and the one it should (US-056). */
      collision(): { id: string; using: number; should: number }[];
      /** How many times a moving circle was found colliding at the wrong size. */
      staleCollisions(): number;
      /** Circles resized while the map was already moving (US-056: should stay 0). */
      lateResizes(): number;
      /** Circles still queued to come in, and the most that ever came in at one step. */
      arriving(): number;
      biggestArrival(): number;
      /** For tests and screenshots: point the camera at a world point and zoom. */
      look(x: number, y: number, scale: number): void;
      movers(): { id: string; v: number; x: number; y: number; tx: number; ty: number; r: number }[];
      stats(): { ticks: number; fastest: number; anchorMove: number; cooling: boolean; alpha: number; pending: number; tickMs: number; placeMs: number; renderMs: number; relayouts: number[] };
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

/**
 * Collision radius: the top circle plus the gap. Titles are left to decluttering: a radius stretched to
 * reach the title's far corner made circles bigger than their static spacing, so they shoved each
 * other forever and never came to rest.
 */
function reach(lay: Layout, id: string): { cr: number; r: number } {
  const c = lay.circles.find((k) => k.id === id)!;
  return { cr: c.r, r: c.r + BODY_GAP };
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
      viewport.drag().pinch().wheel({ smooth: 4 }).decelerate({ friction: 0.92 }).clampZoom({ minScale: MIN_ZOOM, maxScale: 3 });
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

      // New layouts for circles that lost some of what is in them, laid out off the main thread by a few
      // workers, and kept: the same circle with the same parts hidden is laid out once (US-056).
      const workers = Array.from({ length: 3 }, () => new Worker(new URL('./layoutWorker.ts', import.meta.url), { type: 'module' }));
      for (const w of workers) w.postMessage({ type: 'map', map });
      cleanups.push(() => workers.forEach((w) => w.terminate()));
      let seq = 0;
      let nextWorker = 0;
      const laidOut = new Map<string, Layout>();
      /** Layouts asked for and not yet back, by key "<circle>|<hidden programs>", with who is waiting. */
      const pending = new Map<string, ((lay: Layout) => void)[]>();
      const keyOf = new Map<number, string>();
      /** Resizes that landed while the map was moving: sizes should all be known first (US-056). */
      let lateResizes = 0;
      /** When the physics began holding for sizes, or null when it is not holding. */
      let holdingSince: number | null = null;
      /** Sizes first (US-056): hold for layouts up to this long, a safety net rather than a timetable. */
      const HOLD_MAX_MS = 20000;
      const onLayout = (e: MessageEvent<{ id: string; seq: number; layout: Layout }>) => {
        // How long a new layout took, asked to arrived (US-057).
        if (asked.has(e.data.seq)) timing.relayouts.push(performance.now() - asked.get(e.data.seq)!), asked.delete(e.data.seq);
        const key = keyOf.get(e.data.seq)!;
        keyOf.delete(e.data.seq);
        laidOut.set(key, e.data.layout);
        const waiters = pending.get(key) ?? [];
        pending.delete(key);
        for (const w of waiters) w(e.data.layout);
      };
      for (const w of workers) w.onmessage = onLayout;
      /** A circle laid out with these programs hidden: now if known, else when a worker has done it. */
      const layoutFor = (id: string, hide: string[], then: (lay: Layout) => void) => {
        const key = `${id}|${hide.join(',')}`;
        const known = laidOut.get(key);
        if (known) return then(known);
        const waiters = pending.get(key);
        if (waiters) return void waiters.push(then);
        pending.set(key, [then]);
        const n = ++seq;
        keyOf.set(n, key);
        asked.set(n, performance.now());
        workers[nextWorker++ % workers.length].postMessage({ type: 'layout', id, hide, seq: n });
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

      // A hierarchy of pulls (US-055). Faculty spawn points are pulled gently towards the centre of the
      // galaxy and kept apart by their faculty's size; degrees are pulled to their faculty's point;
      // majors outside degrees to the shown degrees offering them; offshore courses to their own places.
      interface Anchor extends SimulationNodeDatum {
        faculty: string;
        r: number;
      }
      const galaxy = { x: 0, y: 0 }; // set by refreshAnchors
      const anchors = new Map<string, Anchor>();
      const anchorSim: Simulation<Anchor, undefined> = forceSimulation<Anchor>([])
        .velocityDecay(0.6)
        .alpha(0.5)
        .alphaDecay(0)
        .force('x', forceX<Anchor>(() => galaxy.x).strength(ANCHOR_PULL.x))
        .force('y', forceY<Anchor>(() => galaxy.y).strength(ANCHOR_PULL.y))
        .force('collide', forceCollide<Anchor>((a) => a.r).strength(0.7).iterations(2))
        .stop();
      /** The middle of the static map (offshore areas aside): the galaxy's centre while nothing is chosen. */
      const mapMiddle = (() => {
        const main = tops.filter((c) => !areaOf(c));
        const x0 = Math.min(...main.map((c) => c.x - c.r));
        const x1 = Math.max(...main.map((c) => c.x + c.r));
        const y0 = Math.min(...main.map((c) => c.y - c.r));
        const y1 = Math.max(...main.map((c) => c.y + c.r));
        return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
      })();
      /**
       * The galaxy's centre while nothing is chosen: halfway between the leftmost and rightmost faculty
       * spawn points, as they are now.
       */
      const spawnMiddle = () => {
        const xs = [...anchors.values()].map((a) => a.x!);
        if (!xs.length) xs.push(...staticAnchor.values());
        return xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : mapMiddle.x;
      };
      /** Where each faculty sits on the static map: the middle of its degrees, on the centre line. */
      const staticAnchor = new Map<string, number>();
      {
        const xs = new Map<string, number[]>();
        for (const c of tops) if (c.kind === 'degree' && !areaOf(c)) for (const f of facultiesOf(map, c.id)) xs.set(f, [...(xs.get(f) ?? []), c.x]);
        for (const [f, v] of xs) staticAnchor.set(f, v.reduce((t, x) => t + x, 0) / v.length);
      }
      /** The point a body is pulled to. */
      const targetOf = (b: Body): { x: number; y: number } | null => {
        const home = staticAt.get(b.id)!;
        if (b.area) return home;
        if (home.kind === 'degree') {
          const as = facultiesOf(map, b.id).map((f) => anchors.get(f)).filter((a): a is Anchor => !!a);
          if (!as.length) return home;
          return { x: as.reduce((t, a) => t + a.x!, 0) / as.length, y: as.reduce((t, a) => t + a.y!, 0) / as.length };
        }
        const by = (home.sharedBy ?? []).map((d) => bodies.get(d)).filter((d): d is Body => !!d && !d.leaving);
        if (!by.length) return home;
        return { x: by.reduce((t, d) => t + d.x!, 0) / by.length, y: by.reduce((t, d) => t + d.y!, 0) / by.length };
      };
      let staleCollisions = 0;
      /** The radius the collision force last read for each circle (it reads them only when given nodes). */
      const collisionR = new Map<string, number>();
      const bodyCollide = () =>
        forceCollide<Body>((b) => {
          collisionR.set(b.id, b.r);
          return b.r;
        })
          .strength(1)
          .iterations(3);
      const sim: Simulation<Body, undefined> = forceSimulation<Body>([])
        .velocityDecay(DECAY)
        // Energy is held constant: the map stops only once everything has come to rest (see `step`), not
        // when a cooling timer runs out, which left far-off circles stranded half way in.
        .alphaDecay(0)
        .force('pull', (alpha) => {
          for (const b of sim.nodes()) {
            if (b.fx != null) continue;
            const t = targetOf(b);
            if (!t) continue;
            const k = b.area ? AREA_PULL : PULL;
            b.vx! += (t.x - b.x!) * k.x * alpha;
            b.vy! += (t.y - b.y!) * k.y * alpha;
          }
        })
        .force('collide', bodyCollide())
        // A speed limit, applied last: nothing is flung into the pack hard enough to bounce back out
        // (circles pressed against it vibrated in and out by ~400 units a step, forever).
        .force('limit', () => {
          for (const b of sim.nodes()) {
            const v = Math.hypot(b.vx ?? 0, b.vy ?? 0);
            if (v > MAX_SPEED) (b.vx = (b.vx! * MAX_SPEED) / v), (b.vy = (b.vy! * MAX_SPEED) / v);
          }
        })
        .stop();
      let ticks = 0;
      /** Steps in a row with nothing moving faster than REST_SPEED, and the step the current settling began. */
      let still = 0;
      let since = 0;
      let cooling = false;
      /** How far the fastest circle, and the fastest spawn point, moved in the last step. */
      let lastMove = 0;
      let lastAnchorMove = 0;
      const timing = { tickMs: 0, placeMs: 0, renderMs: 0, relayouts: [] as number[] };
      const asked = new Map<number, number>();
      // Physics runs on its own timer, as many steps as fit in a few milliseconds each time, so how fast
      // the map settles does not depend on how fast frames are drawn (slow ones stall the frame loop).
      const STEP_BUDGET_MS = 8;
      /** World units per step: slower than this everywhere, for REST_STEPS steps, is at rest. */
      const REST_SPEED = 2;
      const REST_STEPS = 20;
      /** Nineteen in twenty circles slower than this have arrived; then the energy starts to fall by COOL a step. */
      const ARRIVED_SPEED = 20;
      const COOL = 0.005;
      /** Start cooling after this many steps anyway, so a vibration cannot keep the map warm for ever. */
      const COOL_AFTER = 3000;
      /** However long, stop after this many steps (a jitter that never quite stops). */
      const MAX_STEPS = 5000;
      /** New circles come in a few at a time, not all at once (US-055). */
      const SPAWN_PER_STEP = 4;
      /** Circles waiting to come in, with their layout once it is known. */
      const arrivals: { id: string; hideKey: string; lay: Layout | null }[] = [];
      /** The most circles that came in at one step (US-055: a few at a time). */
      let biggestArrival = 0;
      /** How far above and below the centre line the circles already here reach. */
      let spawnBand = 0;
      /** Existing circles waiting for their new size: the physics holds until they have it (US-056). */
      const resizing = new Set<string>();

      const step = () => {
        // Sizes first: nothing moves while a shown circle waits for its new size (or for a while at most).
        if (resizing.size && holdingSince !== null && performance.now() - holdingSince < HOLD_MAX_MS) return place();
        holdingSince = null;
        // A few arrivals at a time, once their size is known.
        let added = 0;
        while (arrivals.length && arrivals[0].lay && added < SPAWN_PER_STEP) arrive(arrivals.shift()!), added++;
        if (added) warm(0.8);
        biggestArrival = Math.max(biggestArrival, added);
        if (settled) return;
        const t0 = performance.now();
        const before = ticks;
        do {
          const nodes = sim.nodes();
          const was = nodes.map((b) => [b.x!, b.y!]);
          const anchorWas = anchorSim.nodes().map((a) => [a.x!, a.y!]);
          anchorSim.tick();
          const anchorMove = anchorSim.nodes().reduce((m, a, i) => Math.max(m, Math.hypot(a.x! - anchorWas[i][0], a.y! - anchorWas[i][1])), 0);
          lastAnchorMove = anchorMove;
          sim.tick();
          ticks++;
          // Full energy while circles are still falling in; once they have arrived, cool gradually so the
          // pack stops jostling. At rest: nothing moving more than a whisker for a run of steps (or a cap).
          // Measured as how far circles actually moved: a circle pressed against the pack keeps a high
          // velocity that the collisions cancel, so its velocity says nothing about whether it moves.
          const moves = nodes.map((b, i) => Math.hypot(b.x! - was[i][0], b.y! - was[i][1])).sort((a, b) => a - b);
          const fastest = moves[moves.length - 1] ?? 0;
          lastMove = fastest;
          // Arrived: nearly all have stopped travelling (a few pressed against the pack may still vibrate).
          const most = moves[Math.floor(moves.length * 0.95)] ?? 0;
          // The spawn points must have arrived too: circles trail slowly behind a moving point.
          if (!cooling && !arrivals.length && ((most < ARRIVED_SPEED && anchorMove < ARRIVED_SPEED / 4) || ticks - since > COOL_AFTER)) (cooling = true), sim.alphaDecay(COOL), anchorSim.alphaDecay(COOL);
          still = fastest < REST_SPEED ? still + 1 : 0;
        } while (still < REST_STEPS && ticks - since < MAX_STEPS && performance.now() - t0 < STEP_BUDGET_MS);
        timing.tickMs = (performance.now() - t0) / (ticks - before);
        // Circles colliding at a size other than their own, while moving (US-056: should never happen).
        for (const b of sim.nodes()) if (Math.abs((collisionR.get(b.id) ?? b.r) - b.r) > 0.5) staleCollisions++;
        if (!arrivals.length && (still >= REST_STEPS || ticks - since >= MAX_STEPS)) (settled = true), bringOffshore();
        const t1 = performance.now();
        place();
        timing.placeMs = performance.now() - t1;
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

      /** Faculty spawn points for the shown degrees, sized by what they hold. */
      const refreshAnchors = () => {
        const room = new Map<string, number>();
        for (const b of bodies.values()) {
          if (b.leaving || b.area || staticAt.get(b.id)!.kind !== 'degree') continue;
          const fs = facultiesOf(map, b.id);
          for (const f of fs) room.set(f, (room.get(f) ?? 0) + (b.r * b.r) / fs.length);
        }
        for (const [f, r2] of room) {
          let a = anchors.get(f);
          if (!a) {
            a = { faculty: f, r: 0, x: staticAnchor.get(f) ?? mapMiddle.x, y: mapMiddle.y };
            anchors.set(f, a);
          }
          a.r = Math.sqrt(r2 / 0.6);
        }
        for (const f of [...anchors.keys()]) if (!room.has(f)) anchors.delete(f);
        // The galaxy's centre now: the chosen circle where it rests, else the static map's centre. Forces
        // read their targets when given their nodes, so this comes first.
        // (The static map's origin is the biggest faculty, well left of the map's middle: pulling to it
        // sent everything drifting left when Dynamic was switched on.)
        const c = centreBody ? bodies.get(centreBody) : undefined;
        galaxy.x = c ? (c.fx ?? c.x!) : spawnMiddle();
        galaxy.y = c ? (c.fy ?? c.y!) : mapMiddle.y;
        anchorSim.nodes([...anchors.values()]);
        anchorSim.force('x', forceX<Anchor>(galaxy.x).strength(ANCHOR_PULL.x));
        anchorSim.force('y', forceY<Anchor>(galaxy.y).strength(ANCHOR_PULL.y));
        anchorSim.force('collide', forceCollide<Anchor>((a) => a.r).strength(0.7).iterations(2));
      };

      /** Bring the bodies in line with what is locked now (US-054, US-056). */
      const sync = (first: boolean) => {
        const s = useApp.getState();
        const hidden = hiddenCircles(layout, s.locks, s.degreeLocks);
        const nextCentre = centreOf(map, layout, s.plan, s.last);
        const centreTop = nextCentre ? topOfCircle.get(nextCentre)! : null;
        const shown = tops.filter((c) => !hidden.has(c.id));
        const shownIds = new Set(shown.map((c) => c.id));
        for (let i = arrivals.length - 1; i >= 0; i--) if (!shownIds.has(arrivals[i].id)) arrivals.splice(i, 1);
        for (const c of shown) {
          const inside = part(c.id).circles.filter((k) => hidden.has(k.id)).map((k) => k.id).sort();
          const hideKey = inside.join(',');
          const b = bodies.get(c.id);
          if (!b || b.leaving) {
            if (arrivals.some((a) => a.id === c.id)) continue;
            // Offshore circles come in last, at their own places (US-054).
            if (areaOf(c)) {
              waiting.set(c.id, () => layoutFor(c.id, inside, (lay) => arrive({ id: c.id, hideKey, lay }, c.x, c.y)));
              continue;
            }
            // On switching on, everything starts at its static place; later arrivals queue and come in a few
            // at a time, each once its size is known.
            const entry = { id: c.id, hideKey, lay: hideKey ? null : part(c.id) };
            if (hideKey) layoutFor(c.id, inside, (lay) => (entry.lay = lay));
            if (first) {
              if (!entry.lay) {
                arrive({ ...entry, lay: without(part(c.id), new Set(inside)) }, c.x, c.y);
                resizing.add(c.id);
                layoutFor(c.id, inside, (lay) => resized(c.id, hideKey, lay));
              } else arrive(entry, c.x, c.y);
            } else arrivals.push(entry);
          } else if (b.hideKey !== hideKey) {
            b.hideKey = hideKey;
            if (!hideKey) setLayout(b, part(c.id));
            else {
              // Sizes first: hold the physics until this circle has its new size.
              resizing.add(c.id);
              layoutFor(c.id, inside, (lay) => resized(c.id, hideKey, lay));
            }
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
        if (resizing.size && holdingSince === null) holdingSince = performance.now();
        // How far the band reaches, measured now from the circles already here: arrivals appear just
        // beyond it. (Measured at each arrival, it included earlier arrivals and ran away outwards.)
        const here = [...bodies.values()].filter((b) => !b.leaving);
        spawnBand = here.length ? Math.max(...here.map((b) => Math.abs(b.y! - galaxy.y) + b.r)) : 0;
        warm(first ? 0.6 : 0.8);
        if (first) aim();
      };

      /** A circle that has waited for its size now has it. */
      const resized = (id: string, hideKey: string, lay: Layout) => {
        const b = bodies.get(id);
        resizing.delete(id);
        if (!b || b.leaving || b.hideKey !== hideKey) return;
        if (holdingSince === null && !settled) lateResizes++;
        setLayout(b, lay);
        // The collision force reads radii only when given its nodes: give it the new one now (it kept the
        // old, bigger size, so circles collided well outside what was drawn).
        sim.force('collide', bodyCollide());
        if (settled) warm(0.3);
      };

      /** A circle comes in: at its static place (switching on, offshore) or above or below the band. */
      const arrive = (a: { id: string; hideKey: string; lay: Layout | null }, x?: number, y?: number) => {
        const old = bodies.get(a.id);
        if (old) old.root.destroy({ children: true });
        const home = staticAt.get(a.id)!;
        let px = x;
        let py = y;
        if (px === undefined || py === undefined) {
          // Above or below everything shown, over the place it is pulled to, and it falls in from there.
          const b0 = makeBody(a.id, a.lay!, a.hideKey, 0, 0);
          const t = targetOf(b0) ?? home;
          const band = spawnBand;
          const side = [...a.id].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 2 ? 1 : -1;
          b0.x = t.x + (Math.random() - 0.5) * 2 * b0.r;
          b0.y = galaxy.y + side * (band + b0.r + 1500);
          bodies.set(a.id, b0);
          return;
        }
        bodies.set(a.id, makeBody(a.id, a.lay!, a.hideKey, px, py));
      };

      /** Wake the map: take in who is there now and let it come to rest again. */
      const warm = (alpha: number) => {
        sim.nodes([...bodies.values()].filter((b) => !b.leaving));
        refreshAnchors();
        sim.force('collide', bodyCollide());
        sim.alpha(alpha).alphaDecay(0);
        anchorSim.alpha(0.5).alphaDecay(0);
        cooling = false;
        settled = false;
        still = 0;
        since = ticks;
      };

      /** Once the rest have settled, the offshore circles come in (US-054). */
      const bringOffshore = () => {
        if (!waiting.size) return;
        for (const add of waiting.values()) add();
        waiting.clear();
        // They appear at their own places, already at rest: join the simulation without waking the
        // rest (restarting it here set everything moving a second time).
        sim.nodes([...bodies.values()].filter((b) => !b.leaving));
        place();
      };

      /** Zoomed all the way out and centred, as the static map opens (US-053). */
      const aim = () => {
        const { minX, minY, maxX, maxY } = layout.bounds;
        viewport.fit(true, maxX - minX, maxY - minY);
        if (viewport.scale.x < MIN_ZOOM) viewport.setZoom(MIN_ZOOM, true);
        // Centred on the galaxy's centre, so the map gathers evenly about the middle of the screen (centred
        // on the whole map, offshore areas and all, it slid left as it gathered).
        viewport.moveCenter(galaxy.x, galaxy.y);
        lod();
        invalidate();
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
        anchors: () => [...anchors.values()].map((a) => ({ faculty: a.faculty, x: a.x!, y: a.y!, r: a.r })),
        lateResizes: () => lateResizes,
        staleCollisions: () => staleCollisions,
        collision: () => sim.nodes().map((b) => ({ id: b.id, using: collisionR.get(b.id) ?? -1, should: b.r })),
        faculties: () => Object.fromEntries([...bodies.values()].filter((b) => !b.leaving && !b.area && staticAt.get(b.id)!.kind === 'degree').map((b) => [b.id, facultiesOf(map, b.id)])),
        arriving: () => arrivals.length,
        biggestArrival: () => biggestArrival,
        look: (x, y, scale) => {
          viewport.setZoom(scale, true);
          viewport.moveCenter(x, y);
          lod();
          invalidate();
        },
        movers: () =>
          sim
            .nodes()
            .map((b) => ({ id: b.id, v: Math.hypot(b.vx ?? 0, b.vy ?? 0), x: b.x!, y: b.y!, tx: b.tx, ty: b.ty, r: b.r }))
            .sort((a, b) => b.v - a.v)
            .slice(0, 5),
        stats: () => ({ ticks, fastest: lastMove, anchorMove: lastAnchorMove, cooling, alpha: sim.alpha(), pending: [...bodies.values()].filter((b) => b.seq && !b.leaving).length, ...timing }),
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
