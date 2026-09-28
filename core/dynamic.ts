import type { Lock, Plan } from './engine.js';
import type { Layout } from './layout.js';
import type { MapDoc } from './model.js';
import { chosenDegrees } from './pairs.js';

// Dynamic mode (US-053 to US-056): only what is not locked is shown, pulled around the last chosen
// thing. These are the rules; the canvas does the drawing and the physics.

/**
 * Circles Dynamic mode does not show (US-054): locked degrees, programs and groups, everything inside
 * them, and a program shared by several degrees once no degree offering it is shown.
 */
export function hiddenCircles(layout: Layout, locks: Map<string, Lock>, degreeLocks: Map<string, string>): Set<string> {
  const byId = new Map(layout.circles.map((c) => [c.id, c]));
  const hidden = new Set<string>();
  const memo = new Map<string, boolean>();
  const isHidden = (id: string): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    const c = byId.get(id);
    let h = !c || locks.has(id) || degreeLocks.has(id);
    if (!h && c!.parent) h = isHidden(c!.parent);
    if (!h && !c!.parent && c!.sharedBy?.length) h = c!.sharedBy.every((d) => !byId.has(d) || isHidden(d));
    memo.set(id, h);
    return h;
  };
  for (const c of layout.circles) if (isHidden(c.id)) hidden.add(c.id);
  return hidden;
}

/** The top-level circle a circle sits in (itself, when it is top-level). */
export function topOf(layout: Layout, id: string): string | null {
  const parent = new Map(layout.circles.map((c) => [c.id, c.parent]));
  if (!parent.has(id)) return null;
  let c = id;
  while (parent.get(c)) c = parent.get(c)!;
  return c;
}

/**
 * What sits at the centre (US-055): the last chosen degree, half or program while it is still chosen;
 * otherwise the last program still chosen, else a chosen degree (a double's first half). Null when
 * nothing is chosen, or it has no circle.
 */
export function centreOf(map: MapDoc, layout: Layout, plan: Plan, last: string | null): string | null {
  const degrees = chosenDegrees(map, plan.degree);
  const has = (id: string) => layout.circles.some((c) => c.id === id);
  if (last && (degrees.includes(last) || plan.programs.includes(last)) && has(last)) return last;
  for (const p of [...plan.programs].reverse()) if (has(p)) return p;
  return degrees.find(has) ?? null;
}
