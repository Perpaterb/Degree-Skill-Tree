// Lays out one circle with some of its programs left out, off the main thread, for Dynamic mode
// (US-056): the biggest degrees take about half a second.
import { layoutMap } from '../../core/layout';
import type { MapDoc } from '../../core/model';

let map: MapDoc | null = null;

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as { type: 'map'; map: MapDoc } | { type: 'layout'; id: string; hide: string[]; seq: number };
  if (msg.type === 'map') {
    map = { ...msg.map, layout: undefined };
    return;
  }
  if (!map) return;
  const layout = layoutMap(map, { only: msg.id, hide: new Set(msg.hide) });
  (self as unknown as Worker).postMessage({ id: msg.id, seq: msg.seq, layout });
};
