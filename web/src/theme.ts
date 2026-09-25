import type { NodeState } from '../../core/engine';
import type { ThemeName } from './view';

// Canvas colours, one set per theme (US-030). Dark is the Path of Exile look; light is parchment.
const darkCanvas = {
  background: 0x0b0d12,
  clusterHalo: 0x161b26,
  clusterHaloStroke: 0x232a38,
  clusterTitle: 0x8f9bb3,
  edgeBase: 0x39404f,
  edgeAlt: 0x2d3340,
  edgeMember: 0x3a3226,
  edgeTrunk: 0x5a4a2c,
  edgeDone: 0xe2b857,
  edgeOpen: 0x86b6ff,
  edgePath: 0x57e0ff,
  edgeUnlock: 0xdc143c, // crimson
  label: 0xd7dde8,
  labelDim: 0x6b7385,
  chosen: 0xe2b857,
  programRing: 0x6a7590,
  programFill: 0x8f9bb3,
  glow: 0x57e0ff,
  needed: 0xf2c75c,
  wasted: 0xe0555a,
  grey: 0x3a3d44,
  /** Circle glows (US-026): finished by completed subjects, or by the plan. */
  complete: 0x45d16b,
  plannedGlow: 0xb36bff,
  /** The ring around the selected circle or subject. */
  selectRing: 0xffffff,
};

const lightCanvas: typeof darkCanvas = {
  background: 0xf4f1ea,
  clusterHalo: 0xe9e4d8,
  clusterHaloStroke: 0xd6d0c2,
  clusterTitle: 0x4d566a,
  edgeBase: 0xa3a9b6,
  edgeAlt: 0xc3c7cf,
  edgeMember: 0xc9b99a,
  edgeTrunk: 0xa88a4e,
  edgeDone: 0xb07d0a,
  edgeOpen: 0x2f6fd6,
  edgePath: 0x0090b0,
  edgeUnlock: 0xc8102e,
  label: 0x1d2330,
  labelDim: 0x666d7a,
  chosen: 0xb07d0a,
  programRing: 0x8a93a8,
  programFill: 0x5a6478,
  glow: 0x0090b0,
  needed: 0xc99700,
  wasted: 0xd0343a,
  grey: 0xb9bcc2,
  complete: 0x1f9d48,
  plannedGlow: 0x8a3ffc,
  selectRing: 0x1d2330,
};

/** The current theme's canvas colours. Reassigned by setThemeColours; ES module bindings stay live. */
export let canvas = darkCanvas;

/** Map backgrounds per theme, for making faculty colours readable on them (US-039). */
export const backgrounds: Record<ThemeName, number> = { dark: darkCanvas.background, light: lightCanvas.background };

/** A degree with no faculty colour. */
export const neutralDegree = 0x9aa3b5;

/** WCAG contrast ratio between two colours (1 to 21). */
export function contrast(a: number, b: number): number {
  const lum = (c: number) => {
    const ch = (s: number) => {
      const v = ((c >> s) & 255) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function toHsl(c: number): [number, number, number] {
  const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): number {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/**
 * The colour, lightened or darkened only as far as needed to reach `min` contrast on `background`,
 * keeping its hue and saturation (US-039). Faculty colours are fabric colours; some (eau de nil,
 * science yellow) would vanish on the light map as they are.
 */
export function readable(colour: number, background: number, min = 3): number {
  if (contrast(colour, background) >= min) return colour;
  const [h, s, l0] = toHsl(colour);
  const darker = toHsl(background)[2] > 0.5;
  for (let step = 1; step <= 100; step++) {
    const l = darker ? l0 - (l0 * step) / 100 : l0 + ((1 - l0) * step) / 100;
    const c = fromHsl(h, s, l);
    if (contrast(c, background) >= min) return c;
  }
  return darker ? 0x000000 : 0xffffff;
}

/** A degree title part's colour for the current theme. */
export const facultyColour = (hex: string | null | undefined) => readable(hex ? parseInt(hex.slice(1), 16) : neutralDegree, canvas.background);

/** Blend two colours; t = 0 gives a, 1 gives b. */
export function mix(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 255;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return m(16) | m(8) | m(0);
}

export interface NodeLook {
  fill: number;
  ring: number;
  ringWidth: number;
  alpha: number;
  glow?: number;
}

const darkLook: Record<NodeState, NodeLook> = {
  completed: { fill: 0x5c4414, ring: 0xf2c75c, ringWidth: 5, alpha: 1, glow: 0xf2c75c },
  planned: { fill: 0x33175c, ring: 0xb36bff, ringWidth: 4, alpha: 1 },
  available: { fill: 0x14233d, ring: 0x86b6ff, ringWidth: 4, alpha: 1, glow: 0x86b6ff },
  reachable: { fill: 0x121a2a, ring: 0x4d6a99, ringWidth: 3, alpha: 1 },
  locked: { fill: 0x15181f, ring: 0x3d4452, ringWidth: 2, alpha: 1 },
  excluded: { fill: 0x2a1214, ring: 0xc0504d, ringWidth: 3, alpha: 0.9 },
  legacy: { fill: 0x111317, ring: 0x2c3038, ringWidth: 2, alpha: 0.55 },
};

const lightLook: Record<NodeState, NodeLook> = {
  completed: { fill: 0xf6d98a, ring: 0xb07d0a, ringWidth: 5, alpha: 1, glow: 0xe0a820 },
  planned: { fill: 0xe4d2ff, ring: 0x8a3ffc, ringWidth: 4, alpha: 1 },
  available: { fill: 0xd8e6ff, ring: 0x2f6fd6, ringWidth: 4, alpha: 1, glow: 0x2f6fd6 },
  reachable: { fill: 0xedf1f8, ring: 0x7d97c4, ringWidth: 3, alpha: 1 },
  locked: { fill: 0xe3e2dd, ring: 0x8b929f, ringWidth: 2, alpha: 1 },
  excluded: { fill: 0xf6d6d6, ring: 0xc0504d, ringWidth: 3, alpha: 0.9 },
  legacy: { fill: 0xeceae4, ring: 0xc8c8c8, ringWidth: 2, alpha: 0.6 },
};

export let stateLook = darkLook;

/** Switch the canvas and legend colours to a theme. */
export function setThemeColours(t: ThemeName) {
  canvas = t === 'light' ? lightCanvas : darkCanvas;
  stateLook = t === 'light' ? lightLook : darkLook;
}

export const stateLabel: Record<NodeState, string> = {
  completed: 'Completed',
  planned: 'Planned',
  available: 'Available now',
  reachable: 'Unlocked by your plan',
  locked: 'Locked',
  excluded: 'Clashes with a subject you have',
  legacy: 'Not in this year’s handbook',
};

export const cssColor = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
