import { LAYERS } from './config';

export type MinerState = 'toFace' | 'mining' | 'toStash';
export interface Miner {
  x: number;
  state: MinerState;
  t: number;
  carry: number;
  faceX: number;
  phase: number;
}

export interface Layer {
  unlocked: boolean;
  drill: number;
  crew: number;
  stash: number;
  miners: Miner[];
}

export type ElevatorState = 'idle' | 'moving' | 'loading' | 'unloading';
export interface Elevator {
  level: number;
  y: number;
  state: ElevatorState;
  targetLayer: number; // -1 = surface
  load: number;
  loadValue: number;
  t: number;
}

export type HaulerState = 'toStore' | 'waiting' | 'loading' | 'toPort' | 'selling';
export interface Hauler {
  x: number;
  state: HaulerState;
  t: number;
  carry: number;
  carryValue: number;
  phase: number;
}

export interface Ledger {
  gross: number;
  corp: number;
  oxygen: number;
  housing: number;
  equipment: number;
  transport: number;
  net: number; // after Helion's share and fees
  wages: number; // paid to workers at the contract rate
  budget: number; // what the supervisor can spend
}

export interface Report extends Ledger {
  index: number;
  duration: number;
  workers: number;
}

export interface GameState {
  version: 1;
  credits: number;
  layers: Layer[];
  elevator: Elevator;
  cargo: { level: number; storage: number; storageValue: number; haulers: Hauler[] };
  oreValueLevel: number;
  contract: number;
  flags: Record<string, boolean>;
  seenEvents: string[];
  eventQueue: string[];
  wagesOwed: number;
  lifetime: Ledger;
  period: Ledger & { t: number };
  firstReport: Report | null;
  lastReport: Report | null;
  reportCount: number;
  playTime: number;
  savedAt: number;
}

export function emptyLedger(): Ledger {
  return { gross: 0, corp: 0, oxygen: 0, housing: 0, equipment: 0, transport: 0, net: 0, wages: 0, budget: 0 };
}

export function newGame(): GameState {
  return {
    version: 1,
    credits: 20,
    layers: LAYERS.map((_, i) => ({ unlocked: i === 0, drill: 1, crew: 1, stash: 0, miners: [] })),
    elevator: { level: 1, y: 0, state: 'idle', targetLayer: -1, load: 0, loadValue: 0, t: 0 },
    cargo: { level: 1, storage: 0, storageValue: 0, haulers: [] },
    oreValueLevel: 1,
    contract: 0,
    flags: {},
    seenEvents: [],
    eventQueue: [],
    wagesOwed: 0,
    lifetime: emptyLedger(),
    period: { ...emptyLedger(), t: 0 },
    firstReport: null,
    lastReport: null,
    reportCount: 0,
    playTime: 0,
    savedAt: Date.now(),
  };
}

const SAVE_KEY = 'deep-shift-vesper/save';

export function saveGame(s: GameState): void {
  s.savedAt = Date.now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: play continues unsaved */
  }
}

export function parseSave(raw: unknown): GameState | null {
  if (!raw || typeof raw !== 'object' || (raw as GameState).version !== 1) return null;
  const s = raw as GameState;
  // New layers added after a save was written.
  while (s.layers.length < LAYERS.length) s.layers.push({ unlocked: false, drill: 1, crew: 1, stash: 0, miners: [] });
  s.wagesOwed ??= 0;
  return s;
}

export function loadGame(): GameState | null {
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
