// The one hand-made map: 24 × 36, entrance at the top, three depth zones split by
// bedrock shelves. Bedrock is surveyed (visible from the start) so the gaps can be
// planned around; everything else is found by digging.
//
//   #  bedrock (cannot be dug)        .  rock, zone hardness with small seeded variation
//   s / h / d  soft / hard / dense    o  ore (value 1)      O  deep ore (value 3)
//   _  natural cave (empty, unseen)   E  entrance (empty, seen)
//   S  tutorial relic site            R  relic site         C  main core     N  nest

import { DEEP_ROW, MAP_H, MAP_SEED, MAP_W, MID_ROW, ORE_VALUE, ROCK_HP } from './config';

export const TEMPLATE = [
  '##########EEEE##########', // 0
  '....s.....EEEE....h.....',
  '..oo..........s.....oo..',
  '.oooo....h.........ooo..',
  '..oo..........o..h..o...',
  '.......h.....ooo........', // 5
  '...........s..o....h....',
  '...____............oo...',
  '...__S_..h.........ooo..',
  '....___...h.......__o...',
  '..oo..............__....', // 10
  '.ooo.......s.....__.....',
  '##################...###', // shelf: one gap, on the right
  '...h...........s..._....',
  '.__....oo.........___...',
  '_R_....ooo..........__..', // 15
  '___.....ooo.....s.......',
  '..........o.............',
  '....s.....__._......oo..',
  '.........__N__....ooooo.',
  '...oo.....___......oo...', // 20
  '..ooo...............__..',
  '..oo...s..........__R_..',
  '...............h..___...',
  '#...#########d##########', // shelf: gap on the left, dense plug near the centre
  '....hh......h...........', // 25
  '..O.......hhh.......O...',
  '.OO..__.................',
  '.O..__N_...........__...',
  '....____....h.....__R...',
  '.......__...........___.', // 30: the deep nest's cave runs into the core room
  '........_______.........',
  '.OO.....___C___.....OO..',
  '.O......_______......O..',
  '............h...........',
  '########################', // 35
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
  hard: number[]; // 0 soft, 1 hard, 2 dense
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

function zoneHardness(zone: number, r: number): number {
  if (zone === 0) return r < 0.14 ? 1 : 0;
  if (zone === 1) return r < 0.2 ? 0 : r < 0.27 ? 2 : 1;
  return r < 0.25 ? 1 : 2;
}

export function buildWorld(): World {
  if (TEMPLATE.length !== MAP_H || TEMPLATE.some((row) => row.length !== MAP_W)) throw new Error('map template size');
  const rand = rng(MAP_SEED);
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
      const zone = zoneOf(y);
      const hard = zoneHardness(zone, rand());
      w.hard[i] = hard;
      switch (c) {
        case '#': w.kind[i] = T_BEDROCK; break;
        case '_': w.kind[i] = T_EMPTY; break;
        case 'E':
          w.kind[i] = T_EMPTY;
          w.seen[i] = 1;
          if (!entranceSet && y === 1) { w.entrance = { x: x + 1, y }; entranceSet = true; }
          break;
        case 's': w.hard[i] = 0; break;
        case 'h': w.hard[i] = 1; break;
        case 'd': w.hard[i] = 2; break;
        case 'o': w.kind[i] = T_ORE; w.ore[i] = ORE_VALUE.normal; break;
        case 'O': w.kind[i] = T_ORE; w.ore[i] = ORE_VALUE.deep; break;
        case 'S': w.kind[i] = T_RELIC; w.sites.push({ x, y, tutorial: true }); break;
        case 'R': w.kind[i] = T_RELIC; w.sites.push({ x, y, tutorial: false }); break;
        case 'C': w.kind[i] = T_CORE; w.core = { x, y }; break;
        case 'N': w.kind[i] = T_NEST; w.nests.push({ x, y, zone: [] }); break;
        default: break; // '.' keeps the zone hardness
      }
      w.hp[i] = w.kind[i] === T_ROCK || w.kind[i] === T_ORE ? ROCK_HP[w.hard[i]] : 0;
    }
  }
  // A nest's range is the natural cave it sits in.
  for (const nest of w.nests) nest.zone = caveAround(w, nest.x, nest.y, 14);
  return w;
}

function caveAround(w: World, x: number, y: number, limit: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const queue: number[] = [];
  for (const [dx, dy] of DIRS) {
    const nx = x + dx, ny = y + dy;
    if (inBounds(nx, ny) && w.kind[idx(nx, ny)] === T_EMPTY) { queue.push(idx(nx, ny)); seen.add(idx(nx, ny)); }
  }
  while (queue.length && out.length < limit) {
    const i = queue.shift()!;
    out.push(i);
    const cx = i % MAP_W, cy = Math.floor(i / MAP_W);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      const j = idx(nx, ny);
      if (!seen.has(j) && w.kind[j] === T_EMPTY) { seen.add(j); queue.push(j); }
    }
  }
  return out;
}

export const DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
