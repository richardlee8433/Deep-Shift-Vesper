// RunState holds one expedition (map, probe, enemies, loadout, threat, unsaved ore).
// MetaState holds what survives between runs. Both live in one save entry so that
// settling a run and clearing it is a single write.

import { DRILL_STEP, type EnemyKind, MAP_W, NEST_HP, SHIELD_BASE, SHIELD_STEP, VISION } from './config';
import { buildWorld, rng, type World } from './map';
import { RELIC_IDS, type RelicId } from './relics';

export type NestState = 'dormant' | 'awake' | 'destroyed';

export interface Site {
  x: number;
  y: number;
  relic: RelicId;
  tutorial: boolean;
  activated: boolean;
}

export interface Nest {
  x: number;
  y: number;
  name: string;
  zone: number[];
  state: NestState;
  hp: number;
  armed: boolean; // first-spawn warning has started (needs awake + connected)
  timer: number; // seconds to the next spawn attempt
  warn: number; // seconds of warning flash left
  spawned: number;
  counted: boolean; // threat refund for destroying it already applied
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  stun: number;
  kb: { fx: number; fy: number; tx: number; ty: number; t: number } | null;
  hit: number; // flash timer after taking damage
}

export interface Drone {
  x: number;
  y: number;
  path: number[]; // tile indices still to visit
  dig: number; // target tile index or -1
  hold: boolean; // pointer still held on the dig target
  commit: boolean; // short tap: keep digging this one tile until it breaks
  approach: number; // relic / core tile we are walking up to, or -1
  face: number; // index into DIRS
  shield: number;
  maxShield: number;
  evac: number; // seconds into evacuation, -1 when not evacuating
  pulseCd: number;
  turretCd: number;
  hurt: number;
}

export interface Pending {
  at: number;
  kind: 'chain' | 'spawn';
  tile: number;
  from: number;
  chain: number;
}

export interface RunStats {
  firstRelicAt: number; // seconds, -1 if none
  digTime: number;
  moveTime: number;
  idleTime: number;
  fightTime: number; // time with an enemy within turret range
  tilesDug: number;
  kills: number;
  nestsDestroyed: number;
  chains: number;
  replaced: RelicId[];
  threatBy: Record<string, number>;
  lastHitBy: EnemyKind | null;
  maxDepth: number;
}

export interface RunState {
  version: 1;
  id: string;
  rng: number;
  time: number;
  world: World;
  drone: Drone;
  drillMult: number;
  startRelic: RelicId | null;
  equipped: RelicId[];
  spent: RelicId[]; // replaced this run; cannot be re-equipped
  found: RelicId[]; // blueprints collected this run (saved on evacuation)
  backedUp: RelicId[]; // saved to base immediately (tutorial)
  sites: Site[];
  nests: Nest[];
  core: { x: number; y: number; taken: boolean };
  enemies: Enemy[];
  nextEnemy: number;
  pending: Pending[];
  nextChain: number;
  threat: number;
  threatLog: { t: number; text: string; amount: number }[];
  ore: number; // unsaved
  cap: { count: number; cd: number };
  repCd: number;
  bio: number;
  firstUse: RelicId[]; // relics whose effect has already fired once (for the first-use callout)
  prompt: { kind: 'site'; site: number } | { kind: 'core' } | null;
  stats: RunStats;
}

export interface RunSummary {
  id: string;
  result: 'success' | 'fail';
  cause: string;
  oreRaw: number;
  ore: number;
  saved: RelicId[]; // blueprints newly saved
  lost: RelicId[]; // blueprints lost on failure
  core: boolean;
  time: number;
  depth: number;
  threat: number;
  loadout: RelicId[];
  startRelic: RelicId | null;
  stats: RunStats;
}

export interface MetaState {
  version: 1;
  ore: number;
  drill: number; // 0..3
  shield: number; // 0..2
  unlocked: RelicId[];
  startRelic: RelicId | null;
  cores: number;
  runs: number;
  settled: string[]; // run ids already paid out
  history: RunSummary[];
  last: RunSummary | null;
  settings: { sound: boolean; numbers: boolean };
  seenHelp: boolean;
}

export interface SaveFile {
  version: 1;
  meta: MetaState;
  run: RunState | null;
}

export function newMeta(): MetaState {
  return {
    version: 1,
    ore: 0,
    drill: 0,
    shield: 0,
    unlocked: [],
    startRelic: null,
    cores: 0,
    runs: 0,
    settled: [],
    history: [],
    last: null,
    settings: { sound: true, numbers: true },
    seenHelp: false,
  };
}

const NEST_NAMES = ['中層巢穴', '深層巢穴'];

export function newRun(meta: MetaState, seed = (Math.random() * 2 ** 31) | 0): RunState {
  const world = buildWorld();
  const rand = rng(seed);
  const start = meta.startRelic && meta.unlocked.includes(meta.startRelic) ? meta.startRelic : null;

  // Relic draw: no duplicates in a run, never the starting relic. The first shallow
  // site is the resonance drill until its blueprint is saved; otherwise prefer
  // relics the player has not unlocked yet.
  const shuffle = <T>(a: T[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const pool = RELIC_IDS.filter((r) => r !== start);
  const fresh = shuffle(pool.filter((r) => !meta.unlocked.includes(r)));
  const known = shuffle(pool.filter((r) => meta.unlocked.includes(r)));
  const order = [...fresh, ...known];
  const take = (r?: RelicId) => {
    const pick = r && order.includes(r) ? r : order[0];
    order.splice(order.indexOf(pick), 1);
    return pick;
  };
  const sites: Site[] = world.sites.map((s) => ({
    ...s,
    relic: s.tutorial && !meta.unlocked.includes('resonance') ? take('resonance') : take(),
    activated: false,
  }));

  const e = world.entrance;
  // Initial vision around the entrance (the sim keeps it updated from then on).
  for (let i = 0; i < world.seen.length; i++) {
    if ((i % MAP_W - e.x) ** 2 + (Math.floor(i / MAP_W) - e.y) ** 2 <= VISION * VISION + 0.5) world.seen[i] = 1;
  }
  const maxShield = SHIELD_BASE + SHIELD_STEP * meta.shield;
  const run: RunState = {
    version: 1,
    id: `${Date.now().toString(36)}-${Math.floor(rand() * 1e9).toString(36)}`,
    rng: seed ^ 0x5bd1e995,
    time: 0,
    world,
    drone: {
      x: e.x + 0.5, y: e.y + 0.5, path: [], dig: -1, hold: false, commit: false, approach: -1, face: 2,
      shield: maxShield, maxShield, evac: -1, pulseCd: 0, turretCd: 0, hurt: 0,
    },
    drillMult: 1 + DRILL_STEP * meta.drill,
    startRelic: start,
    equipped: start ? [start] : [],
    spent: [],
    found: [],
    backedUp: [],
    sites,
    nests: world.nests.map((n, i) => ({
      x: n.x, y: n.y, zone: n.zone, name: NEST_NAMES[i] ?? `巢穴 ${i + 1}`,
      state: 'dormant', hp: NEST_HP, armed: false, timer: 0, warn: 0, spawned: 0, counted: false,
    })),
    core: { ...world.core, taken: false },
    enemies: [],
    nextEnemy: 1,
    pending: [],
    nextChain: 1,
    threat: 0,
    threatLog: [],
    ore: 0,
    cap: { count: 0, cd: 0 },
    repCd: 0,
    bio: 0,
    firstUse: [],
    prompt: null,
    stats: {
      firstRelicAt: -1, digTime: 0, moveTime: 0, idleTime: 0, fightTime: 0, tilesDug: 0, kills: 0,
      nestsDestroyed: 0, chains: 0, replaced: [], threatBy: {}, lastHitBy: null, maxDepth: e.y,
    },
  };
  return run;
}

/** Deterministic per-run random number (state kept in the save). */
export function nextRand(run: RunState): number {
  const r = rng(run.rng)();
  run.rng = (run.rng + 0x6d2b79f5) | 0;
  return r;
}

// ---- Settlement -----------------------------------------------------------

/**
 * Pay out a finished run into meta. Safe to call more than once: the run id is
 * recorded and a second call changes nothing.
 */
export function settle(meta: MetaState, run: RunState, result: 'success' | 'fail', cause: string): RunSummary | null {
  if (meta.settled.includes(run.id)) return null;
  const ok = result === 'success';
  const ore = ok ? run.ore : Math.floor(run.ore / 2);
  const newBlueprints = run.found.filter((r) => !meta.unlocked.includes(r));
  const saved = ok ? newBlueprints : [];
  const lost = ok ? [] : newBlueprints;
  meta.ore += ore;
  for (const r of saved) meta.unlocked.push(r);
  const core = ok && run.core.taken;
  if (core) meta.cores += 1;
  meta.runs += 1;
  meta.settled.push(run.id);
  if (meta.settled.length > 50) meta.settled.splice(0, meta.settled.length - 50);
  const summary: RunSummary = {
    id: run.id,
    result,
    cause,
    oreRaw: run.ore,
    ore,
    saved: [...run.backedUp, ...saved],
    lost,
    core,
    time: run.time,
    depth: run.stats.maxDepth,
    threat: run.threat,
    loadout: [...run.equipped],
    startRelic: run.startRelic,
    stats: run.stats,
  };
  meta.last = summary;
  meta.history.push(summary);
  if (meta.history.length > 30) meta.history.splice(0, meta.history.length - 30);
  return summary;
}

// ---- Persistence ----------------------------------------------------------

export const SAVE_KEY = 'deep-shift-vesper/dig-v1';

export function writeSave(meta: MetaState, run: RunState | null): void {
  try {
    const file: SaveFile = { version: 1, meta, run };
    localStorage.setItem(SAVE_KEY, JSON.stringify(file));
  } catch {
    /* storage unavailable: play continues unsaved */
  }
}

export function parseSave(raw: unknown): SaveFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as SaveFile;
  if (f.version !== 1 || !f.meta || f.meta.version !== 1) return null;
  const meta = { ...newMeta(), ...f.meta };
  meta.settings = { ...newMeta().settings, ...f.meta.settings };
  let run = f.run && f.run.version === 1 ? f.run : null;
  // A run that was already paid out must not come back.
  if (run && meta.settled.includes(run.id)) run = null;
  return { version: 1, meta, run };
}

export function readSave(): SaveFile | null {
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
