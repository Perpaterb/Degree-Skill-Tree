import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { backgrounds, contrast, readable } from './theme';

// Faculty colours stay readable on the map in both themes and keep their hue (US-039).
const uts = JSON.parse(readFileSync(new URL('../../data/faculty-colours/uts.json', import.meta.url), 'utf8')) as {
  colours: Record<string, { hex: string }>;
};
const hue = (c: number) => {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

describe('readable faculty colours (US-039)', () => {
  for (const theme of ['dark', 'light'] as const) {
    it(`every UTS faculty colour reaches 3:1 on the ${theme} map and keeps its hue`, () => {
      for (const [key, { hex }] of Object.entries(uts.colours)) {
        const raw = parseInt(hex.slice(1), 16);
        const c = readable(raw, backgrounds[theme]);
        expect(contrast(c, backgrounds[theme]), `${key} on ${theme}`).toBeGreaterThanOrEqual(3);
        const drift = Math.abs(hue(c) - hue(raw));
        expect(Math.min(drift, 360 - drift), `${key} hue on ${theme}`).toBeLessThan(8);
      }
    });
  }

  it('leaves a colour that is already readable exactly as it is', () => {
    expect(readable(0x269fdb, backgrounds.dark)).toBe(0x269fdb);
  });

  it('darkens the pale ones on the light map (eau de nil, science yellow)', () => {
    for (const hex of ['#bedbe0', '#edd96c']) {
      const raw = parseInt(hex.slice(1), 16);
      expect(contrast(raw, backgrounds.light)).toBeLessThan(3);
      expect(readable(raw, backgrounds.light)).not.toBe(raw);
    }
  });
});
