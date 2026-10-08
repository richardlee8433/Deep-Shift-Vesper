// The one persistent world: 30 × 48, base chamber at the top, three depth zones of
// solid rock, and three rifts in the bottom row where monsters come up from the core.
// Ore veins are scattered with a fixed seed so every save starts from the same map.

import { DEEP_ROW, MAP_H, MAP_SEED, MAP_W, MID_ROW, ORE_VALUE, ROCK_HP } from './config';

export const T_EMPTY = 0;
export const T_ROCK = 1;
export const T_ORE = 2;
export const T_WALL = 3; // built by the player
export const T_TURRET = 4; // built by the player
export const T_RELIC = 5;
export const T_BASE = 6;
export const T_RIFT = 7; // open floor where monsters emerge

export interface World {
  kind: number[];
  hard: number[]; // zone index: 0 shallow, 1 mid, 2 deep (indexes ROCK_HP)
  hp: number[]; // rock or structure HP
  ore: number[]; // ore value carried by the tile
  seen: number[]; // 1 = explored
  scan: number[]; // 1 = outlined by the echo lens
  trap: number[]; // 1 = spike trap on this open tile
}

/** Top-left tile of the 2 × 2 base core. */
export const BASE_POS = { x: 14, y: 1 };
export const SPAWN = { x: 13, y: 2 };
/** The open chamber around the base (inclusive). */
export const CHAMBER = { x0: 11, y0: 0, x1: 18, y1: 3 };
export const SITES = [
  { x: 6, y: 8 }, // nearest: the first relic is always the resonance drill
  { x: 24, y: 11 },
  { x: 4, y: 22 },
  { x: 25, y: 26 },
  { x: 8, y: 38 },
  { x: 22, y: 41 },
];
export const RIFTS = [
  { x: 5, y: MAP_H - 1 },
  { x: 15, y: MAP_H - 1 },
  { x: 24, y: MAP_H - 1 },
];

export const idx = (x: number, y: number) => y * MAP_W + x;
export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
export const zoneOf = (y: number) => (y < MID_ROW ? 0 : y < DEEP_ROW ? 1 : 2);
export const ZONE_NAME = ['淺層', '中層', '深層'];
export const DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export const isWalkable = (k: number) => k === T_EMPTY || k === T_RIFT;
export const isRock = (k: number) => k === T_ROCK || k === T_ORE;
export const isStructure = (k: number) => k === T_WALL || k === T_TURRET;

export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VEINS = [10, 9, 8]; // per zone

export function buildWorld(): World {
  const rand = rng(MAP_SEED);
  const n = MAP_W * MAP_H;
  const w: World = {
    kind: new Array(n).fill(T_ROCK),
    hard: new Array(n).fill(0),
    hp: new Array(n).fill(0),
    ore: new Array(n).fill(0),
    seen: new Array(n).fill(0),
    scan: new Array(n).fill(0),
    trap: new Array(n).fill(0),
  };
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) w.hard[idx(x, y)] = zoneOf(y);

  const reserved = (x: number, y: number) =>
    (x >= CHAMBER.x0 - 2 && x <= CHAMBER.x1 + 2 && y <= CHAMBER.y1 + 2) ||
    SITES.some((s) => Math.abs(s.x - x) + Math.abs(s.y - y) <= 1) ||
    RIFTS.some((r) => Math.abs(r.x - x) + Math.abs(r.y - y) <= 1);

  // Ore veins: short random walks inside each zone.
  const zoneRows = [[0, MID_ROW - 1], [MID_ROW, DEEP_ROW - 1], [DEEP_ROW, MAP_H - 2]];
  for (let zone = 0; zone < 3; zone++) {
    for (let v = 0; v < VEINS[zone]; v++) {
      let x = 1 + Math.floor(rand() * (MAP_W - 2));
      let y = zoneRows[zone][0] + Math.floor(rand() * (zoneRows[zone][1] - zoneRows[zone][0] + 1));
      const size = 4 + Math.floor(rand() * 6);
      for (let k = 0; k < size; k++) {
        if (inBounds(x, y) && zoneOf(y) === zone && !reserved(x, y)) {
          w.kind[idx(x, y)] = T_ORE;
          w.ore[idx(x, y)] = ORE_VALUE[zone];
        }
        const [dx, dy] = DIRS[Math.floor(rand() * 4)];
        x = Math.max(0, Math.min(MAP_W - 1, x + dx));
        y = Math.max(zoneRows[zone][0], Math.min(zoneRows[zone][1], y + dy));
      }
    }
  }

  for (let y = CHAMBER.y0; y <= CHAMBER.y1; y++) {
    for (let x = CHAMBER.x0; x <= CHAMBER.x1; x++) {
      w.kind[idx(x, y)] = T_EMPTY;
      w.seen[idx(x, y)] = 1;
    }
  }
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) w.kind[idx(BASE_POS.x + dx, BASE_POS.y + dy)] = T_BASE;
  for (const s of SITES) w.kind[idx(s.x, s.y)] = T_RELIC;
  for (const r of RIFTS) w.kind[idx(r.x, r.y)] = T_RIFT;

  for (let i = 0; i < n; i++) w.hp[i] = isRock(w.kind[i]) ? ROCK_HP[w.hard[i]] : 0;
  return w;
}

export const isBaseTile = (x: number, y: number) =>
  x >= BASE_POS.x && x < BASE_POS.x + 2 && y >= BASE_POS.y && y < BASE_POS.y + 2;
