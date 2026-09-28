import { Application, BitmapFont, BitmapText, CanvasTextMetrics, Container, Graphics, Text } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { useEffect, useRef } from 'react';
import { compulsorySubjects, missingFor, ruleSubjects, subjectsUnder, unlockedBy } from '../../core/engine';
import { chosenDegrees } from '../../core/pairs';
import { circleAt, SUBJECT_R, TITLE_LINE, type Layout, type LayoutArea, type LayoutCircle, type LayoutNode, type PathCmd } from '../../core/layout';
import type { MapDoc } from '../../core/model';
import { useApp } from './store';
import { canvas, facultyColour, mix, stateLook } from './theme';
import { textPx, type ViewSettings } from './view';

const LABEL_MIN_SCALE = 0.42;
/** Copies of the hovered (or selected) subject grow by at least this much, and to at least this
 * radius on screen, so they stand out however far the map is zoomed out. */
const POP = { 2: { grow: 1.4, px: 18 }, 1: { grow: 1.25, px: 14 } } as const;
/** How close to an outline (in screen pixels) a click selects that outline's circle. */
const RIM_PX = 10;
/** Subject code labels are drawn at this world size, then sized on screen by the view settings (US-029). */
const LABEL_WORLD = 13;
/** Subject codes use one bitmap font (drawn large, so it stays crisp when a subject is enlarged). */
const SUBJECT_FONT = 'subject-code';
/**
 * Below this many pixels across, subjects are drawn as dots in one shape instead of as separate
 * interactive objects (US-043): 15,682 objects cost the whole frame budget on the whole-handbook map.
 */
const DOT_PX = 6;
/**
 * The map is cut into square tiles this many world units across. Only tiles that overlap the screen
 * are drawn, and only tiles whose links changed are rebuilt (US-043).
 */
const TILE = 2500;
/** Cell size of the grid that finds the subject under the pointer. */
const HIT_CELL = 200;
BitmapFont.install({
  name: SUBJECT_FONT,
  style: { fontFamily: 'system-ui, sans-serif', fontSize: LABEL_WORLD * 3, fontWeight: '600', fill: 0xffffff },
  chars: [['0', '9'], ['A', 'Z'], ['a', 'z'], '-'],
  resolution: 1,
});
/** A subject label shows only while it is no wider than this many times its disc. */
const LABEL_FIT = 1.3;
/** How far titles sit above the gap the layout left under them, in world units (US-028). */
const TITLE_LIFT = { degree: 40, program: 8 } as const;

interface NodeView {
  node: LayoutNode;
  root: Container;
  shape: Graphics;
  label: BitmapText;
  /** The label's width at world size, for deciding whether it fits its disc. */
  labelW: number;
  /** What the last paint drew, for tests. */
  drawn: CopyLook;
  /** 2: a copy of the hovered subject, 1: of the selected one, 0: neither. */
  pop: 0 | 1 | 2;
  /** What the shape was last drawn for; it is redrawn only when this changes (US-043). */
  key?: string;
  /** The tile it belongs to (it sits in the pop layer instead while popped). */
  tile: Tile;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** One square of the map: its subjects and the links drawn in it, shown only while on screen (US-043). */
interface Tile {
  /** What it draws, padded for glows and line widths. */
  box: Box;
  nodes: Container;
  views: NodeView[];
  edges: Graphics;
  links: Layout['edges'];
  /** The link styles it was last drawn with. */
  edgeKey?: string;
  /** The zoom and view its subjects' sizes were last set for. */
  lod?: string;
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
  /** Scale that fits the title in the box the layout kept for it. */
  base: number;
  /** What its shape was last drawn for. */
  key?: string;
  /** Where its title and credit points are drawn at the current zoom, for culling and decluttering. */
  titleBox?: Box;
  /** Close enough to read (program titles hide when zoomed out). */
  readable?: boolean;
  /** Credit points are drawn after the title. */
  cp?: boolean;
  /** Not covered by a more important title (US-044). */
  shown?: boolean;
  /** Width of the title's last line at font size, so the credit points can follow it. */
  lastW: number;
  /** Credit points and tick after the title (US-028). */
  progress: Text;
  progressColour: number;
  /** A degree title's parts, each drawn in its faculty's colour (US-039, US-040). */
  parts?: { text: string; fill: number }[];
}

/** Each degree's colour: its (first) faculty's, made readable on the current map background (US-039). */
function degreeHue(map: MapDoc) {
  return new Map(Object.values(map.degrees).map((d) => [d.code, facultyColour(d.titleParts?.[0]?.colour)]));
}

/** Colour-tag a wrapped title so each part keeps its own faculty's colour across line breaks (US-040). */
function taggedTitle(lines: string[], parts: string[]): string {
  const partOfWord = parts.flatMap((p, i) => p.split(/\s+/).map(() => i));
  let w = 0;
  return lines
    .map((line) => {
      let out = '';
      let cur = -1;
      line.split(/\s+/).filter(Boolean).forEach((word, k) => {
        const part = partOfWord[w++] ?? parts.length - 1;
        if (part !== cur) {
          if (cur >= 0) out += `</p${cur}>`;
          out += `${k ? ' ' : ''}<p${part}>`;
          cur = part;
        } else out += ' ';
        out += word.replace(/</g, '&lt;');
      });
      return cur >= 0 ? out + `</p${cur}>` : out;
    })
    .join('\n');
}

/** Fill and part colours for a circle's title in the current theme. */
function titleColours(map: MapDoc, circle: LayoutCircle) {
  const parts = map.degrees[circle.id]?.titleParts;
  if (circle.kind !== 'degree' || !parts?.length) return { fill: canvas.clusterTitle, parts: undefined, tags: undefined };
  const coloured = parts.map((p) => ({ text: p.text, fill: facultyColour(p.colour) }));
  const tags = coloured.length > 1 ? Object.fromEntries(coloured.map((p, i) => [`p${i}`, { fill: p.fill }])) : undefined;
  return { fill: coloured[0].fill, parts: coloured, tags };
}

/** An area for courses offered only somewhere else, with its frame and title (US-050). */
interface AreaView {
  area: LayoutArea;
  frame: Graphics;
  title: Text;
  /** Scale that fits the title in the box the layout kept for it. */
  base: number;
}

interface Scene {
  app: Application;
  areas: AreaView[];
  viewport: Viewport;
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
  /** Program circles drawn locked out (grey, red, crossed) in the last paint (US-037). */
  locked: string[];
  /** Links lit as a requisite chain or an unlock in the last paint, as "from>to" codes (US-045). */
  litEdges: string[];
  /** The subject copy the camera last flew to. */
  flewTo?: string | null;
  /** Subject codes drawn with the glow ring (search match or a hovered panel row) in the last paint. */
  ringed: Set<string>;
  /** Ask for one redraw on the next frame. */
  invalidate(): void;
  /** The separate subject objects, shown when zoomed in. */
  nodeLayer: Container;
  /** Every subject as a dot in one shape, shown when zoomed out (US-043). */
  dots: Graphics;
  /** Zoomed out far enough that subjects are dots. */
  far: boolean;
  /** The dots need redrawing before they are next shown. */
  dotsStale: boolean;
  /** Links highlighted over the (faded) base links while a subject is hovered or matched. */
  edgesLit: Graphics;
  /** What the base links were last drawn for; rebuilt only when the plan, degree or theme changes. */
  edgesKey?: unknown[];
  /** Base links, one shape per tile; faded as a whole while something is hovered. */
  edgeLayer: Container;
  tiles: Tile[];
  /** Copies of the hovered or selected subject, raised above every tile. */
  popLayer: Container;
  /** Subjects by grid cell, for finding the one under the pointer. */
  hitGrid: Map<string, NodeView[]>;
  /** Changes whenever subject sizes need setting again (zoom, view settings, popping). */
  lodStamp: number;
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
      locked(): string[];
      /** Links lit as a requisite chain or an unlock, as "from>to" subject codes (US-045). */
      litEdges(): string[];
      /** The subject copy id ("<circle>/<code>") the camera last flew to. */
      flewTo(): string | null;
      /** Why each locked program is locked: 'room', 'overlap', 'clash' (US-037) or 'pairing' (US-048). */
      lockReasons(): Record<string, string>;
      ringed(): string[];
      title(id: string): {
        text: string;
        progress: string;
        progressColour: number;
        visible: boolean;
        progressVisible: boolean;
        px: number;
        bottom: number;
        circleTop: number;
        /** The title's fill, and for a degree each part of it with its faculty colour as drawn (US-039, US-040). */
        fill: number;
        parts: { text: string; fill: number }[] | null;
        tags: Record<string, number> | null;
      } | null;
      subjectLabel(id: string): { visible: boolean; px: number } | null;
      background(): number;
      /** Each offshore area's title and frame in screen pixels, and whether the title is drawn (US-050). */
      areas(): { id: string; title: string; shown: boolean; titleBox: Box; frame: Box }[];
      /** Every circle's title: whether it is drawn, its box and its circle's centre in screen pixels (US-044). */
      titles(): { id: string; kind: string; shown: boolean; box: Box; centre: { x: number; y: number } }[];
      layer?(name: string, visible: boolean): void;
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
      // A render group: moving the camera changes one transform on the GPU instead of every object's
      // on the CPU (US-043).
      viewport.isRenderGroup = true;
      // Pixi's own hit testing walks every object on each pointer move; subjects and circles are
      // found with a grid and circleAt instead.
      viewport.interactiveChildren = false;
      app.stage.addChild(viewport);

      let downAt: { x: number; y: number } | null = null;
      // Pixi listens for pointer moves on the whole document, so a pointer over a panel still
      // "hovers" whatever canvas content is underneath it. Only count it when it is over the canvas.
      const overCanvas = (e: { nativeEvent?: { target?: unknown } }) => e.nativeEvent?.target === app.canvas;
      const isClick = (e: { global: { x: number; y: number } }) => !!downAt && Math.hypot(e.global.x - downAt.x, e.global.y - downAt.y) <= 6;

      // Circles, largest first so a smaller circle sits on top and wins the click.
      const hue = degreeHue(map);
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
        const colours = titleColours(map, circle);
        const title = new Text({
          text: colours.tags ? taggedTitle(label.lines, colours.parts!.map((p) => p.text)) : label.lines.join('\n'),
          style: {
            fill: colours.fill,
            tagStyles: colours.tags,
            fontSize: label.size,
            lineHeight: label.size * TITLE_LINE,
            fontFamily: 'Georgia, serif',
            align: 'center',
          },
          resolution: degree ? 1 : 2,
        });
        title.anchor.set(0.5, 1);
        // Never wider or taller than its box, whatever the font's real metrics are.
        const base = Math.min(1, label.w / title.width, label.h / title.height);
        title.scale.set(base);
        title.position.set(label.x, label.y + label.h - TITLE_LIFT[degree ? 'degree' : 'program']);
        const lastW = CanvasTextMetrics.measureText(label.lines[label.lines.length - 1], title.style).width;
        const progress = new Text({
          text: '',
          style: { fill: canvas.clusterTitle, fontSize: label.size * 0.62, fontFamily: 'system-ui, sans-serif', fontWeight: '600' },
          resolution: degree ? 1 : 2,
        });
        progress.anchor.set(0, 1);
        titleLayer.addChild(title, progress);
        return { circle, shape, title, base, lastW, progress, progressColour: -1, parts: colours.parts };
      });
      // Offshore areas (US-050): a frame behind everything, and a title that always shows.
      const areas: AreaView[] = (layout.areas ?? []).map((area) => {
        const frame = new Graphics();
        const { label } = area;
        const title = new Text({
          text: label.lines.join('\n'),
          style: { fill: canvas.clusterTitle, fontSize: label.size, lineHeight: label.size * TITLE_LINE, fontFamily: 'Georgia, serif', align: 'center' },
          resolution: 1,
        });
        title.anchor.set(0.5, 1);
        const base = Math.min(1, label.w / title.width, label.h / title.height);
        title.scale.set(base);
        title.position.set(label.x, label.y + label.h);
        titleLayer.addChild(title);
        return { area, frame, title, base };
      });
      for (const a of areas) viewport.addChild(a.frame);
      viewport.addChild(circleLayer);

      const edgeLayer = new Container();
      viewport.addChild(edgeLayer);
      const edgesLit = new Graphics();
      viewport.addChild(edgesLit);
      const nodeLayer = new Container();
      viewport.addChild(nodeLayer);
      const popLayer = new Container();
      // The hovered subject's copies above the selected one's.
      popLayer.sortableChildren = true;
      viewport.addChild(popLayer);
      const dots = new Graphics();
      dots.visible = false;
      viewport.addChild(dots);
      viewport.addChild(titleLayer);

      const tileMap = new Map<string, Tile>();
      const tileAt = (x: number, y: number) => {
        const k = `${Math.floor(x / TILE)},${Math.floor(y / TILE)}`;
        let t = tileMap.get(k);
        if (!t) {
          t = { box: emptyBox(), nodes: new Container(), views: [], edges: new Graphics(), links: [] };
          tileMap.set(k, t);
        }
        return t;
      };
      for (const edge of layout.edges) {
        const b = pathBox(edge.path);
        const t = tileAt((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
        t.links.push(edge);
        growBox(t.box, b.minX - 5, b.minY - 5, b.maxX + 5, b.maxY + 5);
      }

      const nodes = new Map<string, NodeView>();
      const hitGrid = new Map<string, NodeView[]>();
      for (const node of Object.values(layout.nodes)) {
        const root = new Container();
        // Its id, so a popped copy can be found from the pop layer.
        root.label = node.id;
        root.position.set(node.x, node.y);
        const shape = new Graphics();
        // One shared glyph atlas for every subject code, tinted per state: a texture per label cost
        // gigabytes on the whole-handbook map (US-043).
        const label = new BitmapText({ text: node.code, style: { fontFamily: SUBJECT_FONT, fontSize: LABEL_WORLD } });
        label.anchor.set(0.5);
        const labelW = label.width;
        root.addChild(shape, label);
        const tile = tileAt(node.x, node.y);
        // Room for the glows and rings round the disc, and a label a little wider than it.
        const pad = node.r + 32;
        growBox(tile.box, node.x - pad, node.y - pad, node.x + pad, node.y + pad);
        tile.nodes.addChild(root);
        const v: NodeView = { node, root, shape, label, labelW, drawn: { fill: 0, ring: 0, alpha: 1, scale: 1, halo: false }, pop: 0, tile };
        tile.views.push(v);
        nodes.set(node.id, v);
        const cell = `${Math.floor(node.x / HIT_CELL)},${Math.floor(node.y / HIT_CELL)}`;
        hitGrid.set(cell, [...(hitGrid.get(cell) ?? []), v]);
      }
      const tiles = [...tileMap.values()];
      for (const t of tiles) {
        edgeLayer.addChild(t.edges);
        nodeLayer.addChild(t.nodes);
      }
      /** The subject under a screen point: only its own disc (enlarged with it) counts, never its glow or rings. */
      const nodeUnder = (e: { global: { x: number; y: number } }) => {
        const s = scene.current;
        return s ? nodeAt(s, viewport.toWorld(e.global.x, e.global.y)) : null;
      };
      viewport.on('pointerdown', (e) => (downAt = { x: e.global.x, y: e.global.y }));
      viewport.on('pointertap', (e) => {
        if (!isClick(e)) return;
        const hit = nodeUnder(e);
        // A press on a subject never reaches the circle round it.
        if (hit) return useApp.getState().select(hit.node.code);
        const w = viewport.toWorld(e.global.x, e.global.y);
        const circle = circleAt(layout, w.x, w.y, RIM_PX / viewport.scale.x);
        const s = useApp.getState();
        // Empty space outside every circle closes the detail panel; the selected degree stays.
        if (!circle) return s.select(null);
        // A degree is chosen from its panel, not by clicking it (US-046).
        s.select(circle.id);
      });
      viewport.on('pointermove', (e) => {
        const s = useApp.getState();
        if (!overCanvas(e)) return s.hoverCircle(null);
        // Nothing lights up under a pointer that is dragging the map.
        if (e.buttons) return;
        const hit = nodeUnder(e);
        s.hover(hit?.node.code ?? null);
        const over = hit ? null : circleAt(layout, ...xy(viewport.toWorld(e.global.x, e.global.y)), RIM_PX / viewport.scale.x);
        s.hoverCircle(over?.id ?? null);
        viewport.cursor = hit || over ? 'pointer' : 'grab';
      });

      scene.current = {
        app, viewport, areas, nodes, circles, layout, map, hue, glowing: [], highlighted: [], finished: {}, locked: [], ringed: new Set(), invalidate, litEdges: [],
        nodeLayer, dots, far: false, dotsStale: true, edgesLit, edgeLayer, tiles, popLayer, hitGrid, lodStamp: 0,
      };
      // The camera moves on its own during inertia and fly-to animations, so each of these redraws.
      for (const ev of ['moved', 'zoomed', 'moved-end', 'zoomed-end'] as const) viewport.on(ev, invalidate);
      fit(viewport, layout);
      areas.forEach(drawArea);
      paint(scene.current);

      viewport.on('zoomed', () => scene.current && applyLod(scene.current));
      viewport.on('moved', () => scene.current && cull(scene.current));
      // Pixi sends no pointer-out when the pointer leaves the canvas for a panel on top of it,
      // which would leave a circle or subject "hovered" (and glowing) indefinitely.
      app.canvas.addEventListener('pointerleave', () => {
        useApp.getState().hover(null);
        useApp.getState().hoverCircle(null);
      });
      app.renderer.on('resize', (w: number, h: number) => {
        viewport.resize(w, h);
        if (scene.current) cull(scene.current);
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
        locked: () => scene.current?.locked ?? [],
        litEdges: () => scene.current?.litEdges ?? [],
        flewTo: () => scene.current?.flewTo ?? null,
        lockReasons: () => Object.fromEntries([...useApp.getState().locks].map(([code, l]) => [code, l.why])),
        ringed: () => [...(scene.current?.ringed ?? [])],
        title(id) {
          const s = scene.current;
          const v = s?.circles.find((c) => c.circle.id === id);
          if (!s || !v) return null;
          const bottom = s.viewport.toScreen(v.title.x, v.title.y).y;
          const circleTop = s.viewport.toScreen(v.circle.x, v.circle.y - v.circle.r).y;
          const px = v.circle.label.size * v.title.scale.y * s.viewport.scale.y;
          const tagStyles = v.title.style.tagStyles;
          const tags = tagStyles ? Object.fromEntries(Object.entries(tagStyles).map(([k, t]) => [k, Number(t.fill)])) : null;
          return {
            text: v.title.text,
            progress: v.progress.text,
            progressColour: v.progressColour,
            visible: v.title.visible,
            progressVisible: v.progress.visible,
            px,
            bottom,
            circleTop,
            fill: Number(v.title.style.fill),
            parts: v.parts ?? null,
            tags,
          };
        },
        subjectLabel(id) {
          const s = scene.current;
          const v = s?.nodes.get(id);
          if (!s || !v) return null;
          return { visible: v.label.visible, px: LABEL_WORLD * v.label.scale.y * v.root.scale.y * s.viewport.scale.y };
        },
        background: () => app.renderer.background.color.toNumber(),
        areas() {
          const s = scene.current;
          if (!s) return [];
          const box = (x0: number, y0: number, x1: number, y1: number) => {
            const a = s.viewport.toScreen(x0, y0);
            const b = s.viewport.toScreen(x1, y1);
            return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
          };
          return s.areas.map(({ area, title }) => ({
            id: area.id,
            title: title.text,
            shown: title.visible && title.renderable && title.alpha > 0,
            titleBox: box(title.x - title.width / 2, title.y - title.height, title.x + title.width / 2, title.y),
            frame: box(area.x, area.y, area.x + area.w, area.y + area.h),
          }));
        },
        titles() {
          const s = scene.current;
          if (!s) return [];
          return s.circles
            .filter((v) => v.titleBox)
            .map((v) => {
              const a = s.viewport.toScreen(v.titleBox!.minX, v.titleBox!.minY);
              const b = s.viewport.toScreen(v.titleBox!.maxX, v.titleBox!.maxY);
              const centre = s.viewport.toScreen(v.circle.x, v.circle.y);
              return { id: v.circle.id, kind: v.circle.kind, shown: v.title.visible, box: { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y }, centre: { x: centre.x, y: centre.y } };
            });
        },
        // TEMP (US-043 measurement): hide one layer to see what the frame time goes on.
        layer: (name: string, visible: boolean) => {
          const l = { circles: circleLayer, edges: edgeLayer, nodes: nodeLayer, titles: titleLayer }[name];
          if (l) (l.visible = visible), invalidate();
        },
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
          s.locks !== prev.locks ||
          s.hovered !== prev.hovered ||
          s.hoveredCircle !== prev.hoveredCircle ||
          s.glow !== prev.glow ||
          s.selected !== prev.selected ||
          s.matches !== prev.matches ||
          s.plan !== prev.plan
        )
          paint(scene.current);
        if (s.theme !== prev.theme) restyle(scene.current);
        if (s.view !== prev.view) paint(scene.current);
        if (s.flyTo !== prev.flyTo && s.selected) flyTo(scene.current, s.selected);
      }),
    [],
  );

  return <div ref={host} className="tree-canvas" data-testid="tree-canvas" />;
}

/** Which copy of a subject to fly to: one inside the selected degree if possible, preferring listed over entry copies. */
/**
 * Which copy of a subject to fly to, the one most likely to matter to this student: inside the chosen
 * degree (either half of a double) and not in a locked circle; else any copy not in a locked circle;
 * else inside the chosen degree; preferring listed copies over entry copies throughout.
 */
function copyFor(s: Scene, code: string): LayoutNode | null {
  const copies = Object.values(s.layout.nodes).filter((n) => n.code === code);
  if (!copies.length) return null;
  const { plan, locks, degreeLocks } = useApp.getState();
  const chosen = chosenDegrees(s.map, plan.degree);
  const parent = new Map(s.layout.circles.map((c) => [c.id, c.parent]));
  const chain = (id: string) => {
    const out: string[] = [];
    for (let c: string | null = id; c; c = parent.get(c) ?? null) out.push(c);
    return out;
  };
  const rank = (n: LayoutNode) => {
    const up = chain(n.circle);
    const inside = up.some((c) => chosen.includes(c));
    const open = !up.some((c) => locks.has(c) || degreeLocks.has(c));
    return [inside && open, open, inside, !n.entry].reduce((t, b) => t * 2 + Number(b), 0);
  };
  return copies.reduce((best, n) => (rank(n) > rank(best) ? n : best));
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
  s.flewTo = n?.id ?? null;
  if (n) {
    s.viewport.animate({ position: { x: n.x, y: n.y }, scale: Math.max(s.viewport.scale.x, 0.9), time: 650, ease: 'easeInOutSine' });
    return;
  }
  // A double built from halves has no circle: fly to its first half (US-048).
  const target = s.map.degrees[id]?.halves?.[0] ?? id;
  const c = s.layout.circles.find((k) => k.id === target);
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

/** An area's frame in the current theme's colours (US-050). */
function drawArea(a: AreaView) {
  const { x, y, w, h } = a.area;
  a.frame
    .clear()
    .roundRect(x, y, w, h, 600)
    .fill({ color: canvas.clusterHalo, alpha: 0.6 })
    .stroke({ color: canvas.clusterTitle, width: 60, alpha: 0.5 });
  a.title.style.fill = canvas.clusterTitle;
}

/** Colours set when things are created, redone when the theme changes (US-030). */
function restyle(s: Scene) {
  s.app.renderer.background.color = canvas.background;
  s.areas.forEach(drawArea);
  s.hue = degreeHue(s.map);
  for (const v of s.circles) {
    const colours = titleColours(s.map, v.circle);
    v.title.style.fill = colours.fill;
    if (colours.tags) v.title.style.tagStyles = colours.tags;
    v.parts = colours.parts;
    v.progressColour = -1;
  }
  paint(s);
}

/** Sizes and visibility that depend on the zoom and the view settings (US-029). */
function applyLod(s: Scene) {
  s.invalidate();
  const scale = s.viewport.scale.x;
  const { view } = useApp.getState();
  // Zoomed out: one shape of dots instead of every subject object (US-043).
  s.far = SUBJECT_R * 2 * scale < DOT_PX;
  s.nodeLayer.visible = !s.far;
  s.dots.visible = s.far;
  if (s.far && s.dotsStale) drawDots(s);
  // Subjects are sized tile by tile as their tiles come on screen (see cull); popped ones now.
  s.lodStamp++;
  for (const c of s.popLayer.children) {
    const v = s.nodes.get(c.label)!;
    sizeNode(v, scale, view);
  }
  for (const a of s.areas) {
    const natural = a.area.label.size * a.base * scale;
    a.title.scale.set((a.base * textPx('area', natural, view)) / natural);
  }
  for (const v of s.circles) {
    const kind = v.circle.kind === 'degree' ? 'degree' : 'program';
    const natural = v.circle.label.size * v.base * scale;
    const f = textPx(kind, natural, view) / natural;
    v.title.scale.set(v.base * f);
    // Program titles only once you are close enough to read them; which of the rest show is up to declutter.
    v.readable = kind === 'degree' || scale > 0.12;
    v.progress.scale.set(v.base * f);
    v.progress.position.set(v.circle.label.x + (v.lastW / 2) * v.base * f + v.circle.label.size * 0.3 * v.base * f, v.title.y);
    const cp = view.showCp && v.progress.text !== '';
    // Measured here, once per zoom, rather than on every camera move. The credit points count as part of the title.
    v.titleBox = {
      minX: v.title.x - v.title.width / 2,
      minY: v.title.y - Math.max(v.title.height, cp ? v.progress.height : 0),
      maxX: Math.max(v.title.x + v.title.width / 2, cp ? v.progress.x + v.progress.width : -Infinity),
      maxY: v.title.y,
    };
    v.cp = cp;
  }
  declutter(s);
  cull(s);
}

/**
 * Which titles show at this zoom, so none overlap (US-044). Placed greedily in order of importance,
 * across the whole map rather than just the screen, so panning never changes which titles show.
 */
function declutter(s: Scene) {
  const { plan } = useApp.getState();
  const glowing = new Set(s.glowing);
  const scale = s.viewport.scale.x;
  const rank = (v: CircleView) =>
    v.circle.id === plan.degree ? 0 : glowing.has(v.circle.id) ? 1 : v.circle.kind === 'degree' ? 2 : 3;
  const order = s.circles.filter((v) => v.readable).sort((a, b) => rank(a) - rank(b) || b.circle.r - a.circle.r);
  // A little air between titles, in screen pixels.
  const gap = 4 / scale;
  // Placed titles by grid cell; cells a few hundred pixels across keep each check to a handful of boxes.
  const cell = 300 / scale;
  const placed = new Map<string, Box[]>();
  const cells = (b: Box, f: (k: string) => void) => {
    for (let i = Math.floor(b.minX / cell); i <= Math.floor(b.maxX / cell); i++)
      for (let j = Math.floor(b.minY / cell); j <= Math.floor(b.maxY / cell); j++) f(`${i},${j}`);
  };
  // Area titles always show (US-050), so they are placed first and other titles make way for them.
  for (const a of s.areas) {
    const t = a.title;
    const box = { minX: t.x - t.width / 2 - gap, minY: t.y - t.height - gap, maxX: t.x + t.width / 2 + gap, maxY: t.y + gap };
    cells(box, (k) => placed.set(k, [...(placed.get(k) ?? []), box]));
  }
  for (const v of s.circles) v.shown = false;
  for (const v of order) {
    const b = v.titleBox!;
    const box = { minX: b.minX - gap, minY: b.minY - gap, maxX: b.maxX + gap, maxY: b.maxY + gap };
    let free = true;
    // The selected degree and glowing circles always show, whatever they cover.
    if (rank(v) > 1) cells(box, (k) => (free &&= !(placed.get(k) ?? []).some((p) => overlaps(p, box))));
    if (!free) continue;
    v.shown = true;
    cells(box, (k) => placed.set(k, [...(placed.get(k) ?? []), box]));
  }
  for (const v of s.circles) {
    v.title.visible = !!v.shown;
    v.progress.visible = !!(v.shown && v.cp);
  }
}

/** A subject's size and label for the zoom (US-029). */
function sizeNode(v: NodeView, scale: number, view: ViewSettings) {
  const grow = v.pop ? Math.max(POP[v.pop].grow, POP[v.pop].px / (v.node.r * scale)) : 1;
  v.root.scale.set(grow);
  v.drawn.scale = grow;
  const natural = LABEL_WORLD * scale * grow;
  const px = textPx('subject', natural, view);
  v.label.scale.set(px / natural);
  // Only while the code fits its disc (roughly), unless it is the hovered or selected subject.
  const fits = (v.labelW / LABEL_WORLD) * px <= LABEL_FIT * 2 * v.node.r * scale * grow;
  v.label.visible = v.pop > 0 || (scale > LABEL_MIN_SCALE && fits);
}

/**
 * Show only what overlaps the screen (US-043), like a game engine: whole tiles of subjects and
 * links, and each circle and title, are switched on or off with one box test each.
 */
function cull(s: Scene) {
  const vp = s.viewport;
  // A margin, so things are already drawn as they slide in.
  const m = 0.15 * Math.max(vp.worldScreenWidth, vp.worldScreenHeight);
  const view: Box = { minX: vp.left - m, minY: vp.top - m, maxX: vp.right + m, maxY: vp.bottom + m };
  const scale = vp.scale.x;
  const settings = useApp.getState().view;
  const stamp = String(s.lodStamp);
  for (const t of s.tiles) {
    const on = overlaps(t.box, view);
    if (t.edges.visible !== on) t.edges.visible = on;
    const showNodes = on && !s.far;
    if (t.nodes.visible !== showNodes) t.nodes.visible = showNodes;
    if (showNodes && t.lod !== stamp) {
      t.lod = stamp;
      for (const v of t.views) if (!v.pop) sizeNode(v, scale, settings);
    }
  }
  for (const v of s.circles) {
    const c = v.circle;
    // Halos and the selection ring reach this far outside the outline.
    const r = c.r + 50;
    const on = overlaps({ minX: c.x - r, minY: c.y - r, maxX: c.x + r, maxY: c.y + r }, view);
    if (v.shape.visible !== on) v.shape.visible = on;
    // Titles sit above their circle and can be wider than it when zoomed out.
    const tOn = on || (!!v.titleBox && overlaps(v.titleBox, view));
    if (v.title.renderable !== tOn) (v.title.renderable = tOn), (v.progress.renderable = tOn);
  }
}

function emptyBox(): Box {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function growBox(b: Box, minX: number, minY: number, maxX: number, maxY: number) {
  b.minX = Math.min(b.minX, minX);
  b.minY = Math.min(b.minY, minY);
  b.maxX = Math.max(b.maxX, maxX);
  b.maxY = Math.max(b.maxY, maxY);
}

const overlaps = (a: Box, b: Box) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** The box a link's path stays inside (arcs by their whole circle, which is enough for culling). */
function pathBox(path: PathCmd[]): Box {
  const b = emptyBox();
  for (const c of path) {
    if (c[0] === 'A') growBox(b, c[1] - c[3], c[2] - c[3], c[1] + c[3], c[2] + c[3]);
    else for (let i = 1; i + 1 < c.length; i += 2) growBox(b, c[i] as number, c[i + 1] as number, c[i] as number, c[i + 1] as number);
  }
  return b;
}

/** The subject whose disc (enlarged while popped) holds a world point, or null. */
function nodeAt(s: Scene, p: { x: number; y: number }): NodeView | null {
  // At dot zoom subjects are too small to point at, as before (US-043).
  if (s.far) return null;
  // Popped copies are drawn on top, the hovered one highest.
  let best: NodeView | null = null;
  for (const c of s.popLayer.children) {
    const v = s.nodes.get(c.label)!;
    if (Math.hypot(p.x - v.node.x, p.y - v.node.y) <= v.node.r * v.root.scale.x && (!best || v.pop > best.pop)) best = v;
  }
  if (best) return best;
  const cx = Math.floor(p.x / HIT_CELL);
  const cy = Math.floor(p.y / HIT_CELL);
  for (let i = cx - 1; i <= cx + 1; i++)
    for (let j = cy - 1; j <= cy + 1; j++)
      for (const v of s.hitGrid.get(`${i},${j}`) ?? []) if (Math.hypot(p.x - v.node.x, p.y - v.node.y) <= v.node.r) return v;
  return null;
}

/** Every subject copy as a dot in its state's colour, in one shape (US-043). */
function drawDots(s: Scene) {
  const g = s.dots.clear();
  for (const v of s.nodes.values()) g.rect(v.node.x - v.node.r, v.node.y - v.node.r, v.node.r * 2, v.node.r * 2).fill({ color: v.drawn.ring, alpha: v.drawn.alpha });
  s.dotsStale = false;
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
  const { states, hovered, hoveredCircle, glow, selected, matches, plan, fits, finish, titles, view, locks, degreeLocks } = useApp.getState();
  const { map, layout } = s;
  const completed = new Set(plan.completed);
  const chosen = new Set(plan.programs);
  const degree = plan.degree ? map.degrees[plan.degree] : null;
  const chosenDegs = chosenDegrees(map, plan.degree);
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
  // Every subject the focus's rule names, whichever alternative it is in: its lines always light
  // (US-045). The chain below them follows the cheapest route to it.
  const requires = new Set<string>();
  if (focus && map.subjects[focus]) {
    missingFor(map, focus, completed, plan.degree).subjects.forEach((c) => path.add(c));
    ruleSubjects(map.subjects[focus].requisite).forEach((c) => {
      requires.add(c);
      if (!completed.has(c)) path.add(c);
    });
    unlockedBy(map, focus).forEach((c) => unlocks.add(c));
  }
  const matchSet = new Set(matches);
  const dimming = !!(hovered && map.subjects[hovered]) || matchSet.size > 0;
  const litNode = (id: string) =>
    !dimming || id === focus || path.has(id) || unlocks.has(id) || matchSet.has(id) || (hovered && !matchSet.size && completed.has(id));

  s.glowing = [];
  s.finished = {};
  s.locked = [];
  for (const v of s.circles) {
    const { circle, shape, title } = v;
    // Only redrawn when its look changes: hovering a subject used to redraw all 1,086 circles (US-043).
    const key = [
      finish.get(circle.id),
      glowSet.has(circle.id) || hoveredCircle === circle.id || matchSet.has(circle.id),
      circle.kind === 'degree' ? [s.hue.get(circle.id), fits.get(circle.id)?.grey, chosenDegs.includes(circle.id), chosenDegs.length] : '',
      locks.has(circle.id) || degreeLocks.has(circle.id),
      chosen.has(circle.id),
      !degree || (inDegree && circle.members.some((m) => inDegree.has(m))),
      circle.id === selected,
      canvas.background,
    ].join('|');
    const g = key === v.key ? null : shape.clear();
    v.key = key;
    // Finished circles glow outside their outline: green when completed, blue when the plan finishes them (US-026).
    const done = finish.get(circle.id);
    const halo = done === 'complete' ? canvas.complete : done === 'planned' ? canvas.plannedGlow : null;
    if (halo !== null) {
      const band = circle.kind === 'degree' ? 26 : 12;
      for (let i = 3; i >= 1; i--) g?.circle(circle.x, circle.y, circle.r + (band * i) / 2).stroke({ color: halo, width: band, alpha: 0.18 + 0.16 * (3 - i) });
      s.finished[circle.id] = done as 'complete' | 'planned';
    }
    const glowing = glowSet.has(circle.id) || hoveredCircle === circle.id || matchSet.has(circle.id);
    if (glowing) s.glowing.push(circle.id);
    // A degree that cannot go with the current choice is drawn locked, like a program (US-047).
    const lockedOut = locks.has(circle.id) || degreeLocks.has(circle.id);
    if (circle.kind === 'degree' && !lockedOut) {
      const hue = s.hue.get(circle.id)!;
      const fit = fits.get(circle.id);
      const grey = fit?.grey ?? 0;
      // Both halves of a chosen double degree look chosen (US-048).
      const isSel = chosenDegs.includes(circle.id);
      const fill = mix(hue, canvas.grey, grey);
      const other = chosenDegs.length > 0 && !isSel;
      g?.circle(circle.x, circle.y, circle.r)
        .fill({ color: fill, alpha: isSel ? 0.09 : 0.05 })
        .stroke({ color: glowing ? canvas.glow : mix(hue, canvas.grey, grey * 0.8), width: isSel ? 16 : glowing ? 14 : 8, alpha: other && !glowing ? 0.3 : 1 });
      title.alpha = other ? 0.45 : 1 - grey * 0.5;
    } else if (lockedOut) {
      // Locked out of the selected degree: drawn like a clashing subject, grey, red and crossed (US-037).
      s.locked.push(circle.id);
      const k = circle.r * 0.5;
      g?.circle(circle.x, circle.y, circle.r)
        .fill({ color: canvas.grey, alpha: 0.35 })
        .stroke({ color: glowing ? canvas.glow : canvas.wasted, width: glowing ? 8 : 4, alpha: 0.9 });
      g?.moveTo(circle.x - k, circle.y - k)
        .lineTo(circle.x + k, circle.y + k)
        .moveTo(circle.x + k, circle.y - k)
        .lineTo(circle.x - k, circle.y + k)
        .stroke({ color: canvas.wasted, width: 6, alpha: 0.45 });
      title.alpha = glowing ? 1 : 0.6;
    } else {
      const isChosen = chosen.has(circle.id);
      const inSel = !degree || (inDegree && circle.members.some((m) => inDegree.has(m)));
      g?.circle(circle.x, circle.y, circle.r)
        .fill({ color: isChosen ? canvas.chosen : canvas.programFill, alpha: glowing ? 0.12 : isChosen ? 0.08 : 0.035 })
        .stroke({
          color: glowing ? canvas.glow : isChosen ? canvas.chosen : canvas.programRing,
          width: glowing ? 8 : isChosen ? 6 : 3,
          alpha: inSel || glowing ? 1 : 0.3,
        });
      title.alpha = inSel || glowing ? 1 : 0.35;
    }
    if (circle.id === selected) g?.circle(circle.x, circle.y, circle.r + 10).stroke({ color: canvas.selectRing, width: 3, alpha: 0.8 });
    // Credit points after the title, with a tick coloured like the glow (US-028).
    const t = titles.get(circle.id);
    const mark = lockedOut ? ' ✗' : halo !== null ? ' ✓' : '';
    const text = t && view.showCp ? `${t.done}${t.planned ? `+${t.planned}` : ''}/${t.required}cp${mark}` : lockedOut ? '✗' : '';
    if (v.progress.text !== text) v.progress.text = text;
    const colour = lockedOut ? canvas.wasted : (halo ?? (circle.kind === 'degree' ? s.hue.get(circle.id)! : canvas.clusterTitle));
    if (v.progressColour !== colour) (v.progress.style.fill = colour), (v.progressColour = colour);
    v.progress.alpha = title.alpha;
  }

  // Copies inside the selected degree's circle (at any depth) stay bright; the rest fade.
  const inside = new Map<string, boolean>();
  const insideSel = (circleId: string) => {
    if (!degree) return true;
    // A chosen double has no circle: inside either of its halves (US-048).
    if (!inside.has(circleId)) inside.set(circleId, chosenDegs.some((h) => within(layout, circleId, h)));
    return inside.get(circleId)!;
  };

  s.highlighted = [];
  s.ringed = new Set();
  for (const v of s.nodes.values()) {
    const { node, shape, root } = v;
    const code = node.code;
    const state = states.get(code) ?? 'locked';
    const look = stateLook[state];
    // Every copy of a subject the student has marked looks the same, entry copies included.
    const marked = state === 'completed' || state === 'planned';
    const hollow = node.entry && !marked;
    // Every copy of the hovered (or selected) subject pops out, so it is obvious they are one subject.
    const twin = code === hovered || code === selected;
    const ring = matchSet.has(code) || glowSet.has(code);
    if (ring) s.ringed.add(code);
    if (twin) s.highlighted.push(node.id);
    // Redraw the shape only when something it draws has changed: with 15,682 copies on the
    // whole-handbook map, redrawing them all on every hover took a second (US-043).
    const key = [
      state,
      twin ? (code === selected ? 2 : 1) : 0,
      ring,
      path.has(code),
      unlocks.has(code),
      needed.has(code) && insideSel(node.circle),
      wasted.has(code),
      canvas.background,
    ].join('|');
    const redraw = key !== v.key;
    v.key = key;
    if (redraw) {
      const g = shape.clear();
      if (twin) {
        g.circle(0, 0, node.r + 30).fill({ color: canvas.glow, alpha: 0.1 });
        g.circle(0, 0, node.r + 22).fill({ color: canvas.glow, alpha: 0.16 });
        g.circle(0, 0, node.r + 15).fill({ color: canvas.glow, alpha: 0.28 });
      } else if (look.glow && !hollow) g.circle(0, 0, node.r + 7).fill({ color: look.glow, alpha: 0.16 });
      if (ring) g.circle(0, 0, node.r + 10).stroke({ color: canvas.glow, width: 3, alpha: 0.9 });
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
        if (code === selected) g.circle(0, 0, node.r + 17).stroke({ color: canvas.selectRing, width: 2, alpha: 0.9 });
      }
    }
    const pop = code === hovered ? 2 : twin ? 1 : 0;
    // Popped copies move above every tile, so no neighbouring tile draws over them.
    if (pop && !v.pop) s.popLayer.addChild(root);
    else if (!pop && v.pop) (v.tile.nodes.addChild(root), (v.tile.lod = undefined));
    v.pop = pop;
    root.zIndex = pop;
    root.alpha = twin
      ? 1
      : look.alpha * (litNode(code) ? 1 : 0.22) * (marked || insideSel(node.circle) || wasted.has(code) ? 1 : 0.35) * (hollow ? 0.8 : 1);
    v.label.tint = state === 'locked' || state === 'legacy' || hollow ? canvas.labelDim : canvas.label;
    v.drawn = { fill: hollow ? canvas.background : look.fill, ring: look.ring, alpha: root.alpha, scale: 1, halo: twin };
  }

  // The dots show the same states; redraw them now if they are showing, else when they next are.
  if (s.far) drawDots(s);
  else s.dotsStale = true;

  // Links in two layers (US-043): the base, which depends only on the plan, degree and theme and is
  // rebuilt only when they change; and on top, the links a hover or search lights up. While
  // something is hovered or matched, the base fades as a whole.
  const style = (edge: Layout['edges'][number], focused: boolean) => {
    const from = edge.fromCode;
    const to = edge.toCode;
    const onPath = focused && focus && (((path.has(from) || from === focus) && (path.has(to) || to === focus)) || (to === focus && requires.has(from)));
    const unlocking = focused && focus && from === focus && unlocks.has(to);
    let alpha = 1;
    let color: number;
    let width: number;
    // A requisite already done lights in the done colour, not as something still needed.
    if (onPath) (color = completed.has(from) ? canvas.edgeDone : canvas.edgePath), (width = 5);
    else if (unlocking) (color = canvas.edgeUnlock), (width = 4);
    else if (completed.has(from) && completed.has(to)) (color = canvas.edgeDone), (width = 5);
    else if (completed.has(from) && states.get(to) === 'available') (color = canvas.edgeOpen), (width = 3);
    else {
      color = edge.kind === 'alt' ? canvas.edgeAlt : canvas.edgeBase;
      width = edge.kind === 'alt' ? 1.5 : 2.5;
      alpha = 0.75;
    }
    if (!insideSel(layout.nodes[edge.from].circle) && !onPath && !unlocking) alpha *= 0.3;
    return { color, width, alpha, cap: 'round' as const, join: 'round' as const, lit: !!(onPath || unlocking) };
  };
  const edgesKey = [states, plan.degree, canvas.background];
  if (!s.edgesKey || edgesKey.some((k, i) => k !== s.edgesKey![i])) {
    s.edgesKey = edgesKey;
    // Only tiles with a link whose style changed are rebuilt: marking a subject used to rebuild all
    // 14,897 links (US-043).
    for (const t of s.tiles) {
      if (!t.links.length) continue;
      const styles = t.links.map((edge) => style(edge, false));
      const key = styles.map((st) => `${st.color},${st.width},${st.alpha}`).join(';');
      if (key === t.edgeKey) continue;
      t.edgeKey = key;
      const e = t.edges.clear();
      t.links.forEach((edge, i) => {
        tracePath(e, edge.path);
        e.stroke(styles[i]);
      });
    }
  }
  s.edgeLayer.alpha = dimming ? 0.15 : 1;
  const lit = s.edgesLit.clear();
  s.litEdges = [];
  if (focus || dimming)
    for (const edge of layout.edges) {
      const st = style(edge, true);
      if (st.lit) s.litEdges.push(`${edge.fromCode}>${edge.toCode}`);
      if (!(st.lit || (dimming && litNode(edge.fromCode) && litNode(edge.toCode)))) continue;
      tracePath(lit, edge.path);
      lit.stroke(st);
    }
  applyLod(s);
}
