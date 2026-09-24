import type { NodeState } from '../../core/engine';

// Canvas colours. The tree is always dark, like the Path of Exile tree; panels follow it.
export const canvas = {
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
  edgeUnlock: 0xb68cff,
  label: 0xd7dde8,
  labelDim: 0x6b7385,
  chosen: 0xe2b857,
};

export interface NodeLook {
  fill: number;
  ring: number;
  ringWidth: number;
  alpha: number;
  glow?: number;
}

export const stateLook: Record<NodeState, NodeLook> = {
  completed: { fill: 0x5c4414, ring: 0xf2c75c, ringWidth: 5, alpha: 1, glow: 0xf2c75c },
  planned: { fill: 0x12382f, ring: 0x4fd1a5, ringWidth: 4, alpha: 1 },
  available: { fill: 0x14233d, ring: 0x86b6ff, ringWidth: 4, alpha: 1, glow: 0x86b6ff },
  reachable: { fill: 0x121a2a, ring: 0x4d6a99, ringWidth: 3, alpha: 1 },
  locked: { fill: 0x15181f, ring: 0x3d4452, ringWidth: 2, alpha: 1 },
  excluded: { fill: 0x2a1214, ring: 0xc0504d, ringWidth: 3, alpha: 0.9 },
  legacy: { fill: 0x111317, ring: 0x2c3038, ringWidth: 2, alpha: 0.55 },
};

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
