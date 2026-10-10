// One persistent game: the world map, the miner, the base, monsters, waves and
// everything bought or found. Saved as a single entry.

import { BASE, MAP_W, START_ORE, SHIELD_BASE, type EnemyKind, type UpgradeId, UPGRADES, VISION, WAVE } from './config';
import { buildWorld, RIFTS, rng, SITES, SPAWN, type World } from './map';
import { RELIC_IDS, type RelicId } from './relics';

export interface Site {
  x: number;
  y: number;
  relic: RelicId;
  activated: boolean;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  stun: number;
  kb: { fx: number; fy: number; tx: number; ty: number; t: number } | null;
  hit: number; // flash timer after taking damage
  chew: number; // > 0 while attacking a tile or the base (for animation)
}

export interface Drone {
  x: number;
  y: number;
  path: number[]; // tile indices still to visit
  dig: number; // target tile index or -1
  hold: boolean; // pointer / key still held on the dig target
  commit: boolean; // short tap: keep digging this one tile until it breaks
  approach: number; // relic / base tile we are walking up to, or -1
  face: number; // index into DIRS
  shield: number;
  recall: number; // seconds into recall, -1 when not recalling
  dead: number; // seconds until respawn, -1 when alive
  pulseCd: number;
  gunCd: number;
  hurt: number;
  swing: number; // dig animation phase
}

export interface Pending {
  at: number;
  tile: number;
  from: number;
  chain: number;
}

export interface Wave {
  n: number; // waves started so far
  timer: number; // seconds until the next wave
  announced: boolean;
  toSpawn: number;
  spawned: number;
  spawnT: number;
  active: boolean;
  hpMult: number;
  armoredEvery: number;
  at: number; // breakout tile chosen when the wave was announced, -1 = choose at spawn time
}

export interface Raid {
  toSpawn: number;
  spawned: number;
  spawnT: number;
  armoredEvery: number;
  at: number; // breakout tile, -1 = choose at spawn time
}

export interface Stats {
  kills: number;
  tilesDug: number;
  oreMined: number;
  built: number;
  coreFalls: number;
  deaths: number;
  bestWave: number; // highest wave fully repelled
  raids: number;
}

export interface GameState {
  version: 2;
  rng: number;
  time: number;
  world: World;
  drone: Drone;
  base: { hp: number };
  sites: Site[];
  rifts: { x: number; y: number }[];
  enemies: Enemy[];
  nextEnemy: number;
  pending: Pending[];
  nextChain: number;
  ore: number;
  threat: { relic: number; chain: number };
  maxDepth: number;
  noise: number[]; // per zone: tiles broken since the last raid from that zone
  raid: Raid;
  wave: Wave;
  upgrades: Record<UpgradeId, number>;
  towers: Record<number, { cd: number; angle: number; onRock?: boolean }>; // onRock: built into a rock wall
  relics: { found: RelicId[]; equipped: RelicId[] };
  cap: { count: number; cd: number };
  repCd: number;
  bio: number;
  firstUse: RelicId[];
  prompt: { kind: 'site'; site: number } | { kind: 'base' } | null;
  stats: Stats;
  settings: { sound: boolean; numbers: boolean };
  seenHelp: boolean;
}

export function newGame(seed = (Math.random() * 2 ** 31) | 0): GameState {
  const world = buildWorld();
  const rand = rng(seed);
  // The nearest site always holds the resonance drill; the rest are shuffled.
  const rest = RELIC_IDS.filter((r) => r !== 'resonance');
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const relics: RelicId[] = ['resonance', ...rest];
  const s: GameState = {
    version: 2,
    rng: seed ^ 0x5bd1e995,
    time: 0,
    world,
    drone: {
      x: SPAWN.x + 0.5, y: SPAWN.y + 0.5, path: [], dig: -1, hold: false, commit: false, approach: -1, face: 2,
      shield: SHIELD_BASE, recall: -1, dead: -1, pulseCd: 0, gunCd: 0, hurt: 0, swing: 0,
    },
    base: { hp: BASE.hp },
    sites: SITES.map((p, i) => ({ ...p, relic: relics[i], activated: false })),
    rifts: RIFTS.map((r) => ({ ...r })),
    enemies: [],
    nextEnemy: 1,
    pending: [],
    nextChain: 1,
    ore: START_ORE,
    threat: { relic: 0, chain: 0 },
    maxDepth: SPAWN.y,
    noise: [0, 0, 0],
    raid: { toSpawn: 0, spawned: 0, spawnT: 0, armoredEvery: 0, at: -1 },
    wave: { n: 0, timer: WAVE.first, announced: false, toSpawn: 0, spawned: 0, spawnT: 0, active: false, hpMult: 1, armoredEvery: 0, at: -1 },
    upgrades: { drill: 0, shield: 0, base: 0, tower: 0 },
    towers: {},
    relics: { found: [], equipped: [] },
    cap: { count: 0, cd: 0 },
    repCd: 0,
    bio: 0,
    firstUse: [],
    prompt: null,
    stats: { kills: 0, tilesDug: 0, oreMined: 0, built: 0, coreFalls: 0, deaths: 0, bestWave: 0, raids: 0 },
    settings: { sound: true, numbers: true },
    seenHelp: false,
  };
  // Initial vision around the spawn (the sim keeps it updated from then on).
  for (let i = 0; i < world.seen.length; i++) {
    if ((i % MAP_W - SPAWN.x) ** 2 + (Math.floor(i / MAP_W) - SPAWN.y) ** 2 <= VISION * VISION) world.seen[i] = 1;
  }
  return s;
}

// ---- Derived values ---------------------------------------------------------------

export const drillMult = (s: GameState) => 1 + UPGRADES.drill.step * s.upgrades.drill;
export const maxShield = (s: GameState) => SHIELD_BASE + UPGRADES.shield.step * s.upgrades.shield;
export const maxBaseHp = (s: GameState) => BASE.hp + UPGRADES.base.step * s.upgrades.base;
export const towerMult = (s: GameState) => 1 + UPGRADES.tower.step * s.upgrades.tower;
/** 地心騷動, 0–100: relics and chains. Bigger waves and raids. */
export const threatOf = (s: GameState) => Math.min(100, s.threat.relic + s.threat.chain);

/** Deterministic random number (state kept in the save). */
export function nextRand(s: GameState): number {
  const r = rng(s.rng)();
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  return r;
}

// ---- Persistence ----------------------------------------------------------------

export const SAVE_KEY = 'deep-shift-vesper/dig-v2';

export function writeSave(s: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: play continues unsaved */
  }
}

export function parseSave(raw: unknown): GameState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as GameState;
  if (s.version !== 2 || !s.world || !s.drone) return null;
  const fresh = newGame(1);
  s.settings = { ...fresh.settings, ...s.settings };
  s.stats = { ...fresh.stats, ...s.stats };
  s.upgrades = { ...fresh.upgrades, ...s.upgrades };
  s.towers ??= {};
  s.noise ??= [0, 0, 0];
  s.raid = { ...fresh.raid, ...s.raid };
  s.wave = { ...fresh.wave, ...s.wave };
  s.world.trap ??= new Array(s.world.kind.length).fill(0);
  return s;
}

export function readSave(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? parseSave(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}
