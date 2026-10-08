// The one hand-made map: 24 × 36, entrance at the top, three depth zones. Every tile
// is rock (no bedrock, no open caves); all rock in a zone has that zone's hardness.
//
//   .  rock                 o  ore (value 1)      O  deep ore (value 3)
//   E  entrance (open)      S  tutorial relic site      R  relic site
//   C  main core            N  nest

import { DEEP_ROW, MAP_H, MAP_W, MID_ROW, ORE_VALUE, ROCK_HP } from './config';

export const TEMPLATE = [
  '..........EEEE..........', // 0
  '..........EEEE..........',
  '..oo................oo..',
  '.oooo..............ooo..',
  '..oo..........o.....o...',
  '.............ooo........', // 5
  '..............o.........',
  '...................oo...',
  '.....S.............ooo..',
  '....................o...',
  '..oo....................', // 10
  '.ooo....................',
  '........................',
  '........................',
  '.......oo...............',
  '.R.....ooo..............', // 15
  '........ooo.............',
  '..........o.............',
  '....................oo..',
  '...........N......ooooo.',
  '...oo..............oo...', // 20
  '..ooo...................',
  '..oo................R...',
  '........................',
  '........................',
  '........................', // 25
  '..O.................O...',
  '.OO.....................',
  '.O....N.................',
  '....................R...',
  '........................', // 30
  '........................',
  '.OO........C........OO..',
  '.O...................O..',
  '........................',
  '........................', // 35
];

export const T_EMPTY = 0;
export const T_ROCK = 1;
export const T_ORE = 2;
export const T_BEDROCK = 3;
export const T_RELIC = 4;
export const T_CORE = 5;
export const T_NEST = 6;

export interface World {
  kind: number[];
  hard: number[]; // zone index: 0 shallow, 1 mid, 2 deep (indexes ROCK_HP)
  hp: number[];
  ore: number[]; // ore value carried by the tile
  seen: number[]; // 1 = explored
  scan: number[]; // 1 = outlined by the echo lens
  sites: { x: number; y: number; tutorial: boolean }[];
  nests: { x: number; y: number; zone: number[] }[];
  core: { x: number; y: number };
  entrance: { x: number; y: number };
}

export const idx = (x: number, y: number) => y * MAP_W + x;
export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
export const zoneOf = (y: number) => (y < MID_ROW ? 0 : y < DEEP_ROW ? 1 : 2);
export const ZONE_NAME = ['淺層', '中層', '深層'];

export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildWorld(): World {
  if (TEMPLATE.length !== MAP_H || TEMPLATE.some((row) => row.length !== MAP_W)) throw new Error('map template size');
  const n = MAP_W * MAP_H;
  const w: World = {
    kind: new Array(n).fill(T_ROCK),
    hard: new Array(n).fill(0),
    hp: new Array(n).fill(0),
    ore: new Array(n).fill(0),
    seen: new Array(n).fill(0),
    scan: new Array(n).fill(0),
    sites: [],
    nests: [],
    core: { x: 0, y: 0 },
    entrance: { x: 0, y: 0 },
  };
  let entranceSet = false;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = idx(x, y);
      const c = TEMPLATE[y][x];
      w.hard[i] = zoneOf(y);
      switch (c) {
        case 'E':
          w.kind[i] = T_EMPTY;
          w.seen[i] = 1;
          if (!entranceSet && y === 1) { w.entrance = { x: x + 1, y }; entranceSet = true; }
          break;
        case 'o': w.kind[i] = T_ORE; w.ore[i] = ORE_VALUE.normal; break;
        case 'O': w.kind[i] = T_ORE; w.ore[i] = ORE_VALUE.deep; break;
        case 'S': w.kind[i] = T_RELIC; w.sites.push({ x, y, tutorial: true }); break;
        case 'R': w.kind[i] = T_RELIC; w.sites.push({ x, y, tutorial: false }); break;
        case 'C': w.kind[i] = T_CORE; w.core = { x, y }; break;
        case 'N': w.kind[i] = T_NEST; w.nests.push({ x, y, zone: [] }); break;
        default: break; // '.' plain rock
      }
      w.hp[i] = w.kind[i] === T_ROCK || w.kind[i] === T_ORE ? ROCK_HP[w.hard[i]] : 0;
    }
  }
  // A nest's range (shown by the echo lens): tiles within two steps of it.
  for (const nest of w.nests) nest.zone = nestRange(nest.x, nest.y);
  return w;
}

function nestRange(x: number, y: number): number[] {
  const out: number[] = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d > 0 && d <= 2 && inBounds(x + dx, y + dy)) out.push(idx(x + dx, y + dy));
    }
  }
  return out;
}

export const DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
