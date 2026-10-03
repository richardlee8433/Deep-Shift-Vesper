import {
  BASE_DRILL_RATE, CARGO_BASE_CAP, ELEVATOR_BASE_CAP, LAYERS, MAX_CREW, MAX_HAULERS, MINE_TIME,
  TRANSPORT_CAP_GROWTH, TRANSPORT_COST_BASE, TRANSPORT_COST_GROWTH,
} from './config';
import type { GameState } from './state';
import { credits } from './format';

// ---- Derived stats -------------------------------------------------------

export const drillMult = (lvl: number) => 1 + 0.2 * (lvl - 1);
/** ₵ worth of ore one miner brings back per trip. */
export const minerCarry = (s: GameState, i: number) => BASE_DRILL_RATE * MINE_TIME * drillMult(s.layers[i].drill) * LAYERS[i].value;

// Elevator and haulers carry ₵ value, so deeper (richer) layers fill them faster.
// Capacity and cost grow at nearly the same rate, which keeps transport in step with output.
export const elevatorCapacity = (lvl: number) => ELEVATOR_BASE_CAP * Math.pow(TRANSPORT_CAP_GROWTH, lvl - 1);
export const elevatorSpeed = (lvl: number) => Math.min(400, 90 * (1 + 0.04 * (lvl - 1)));

export const cargoCapacity = (lvl: number) => CARGO_BASE_CAP * Math.pow(TRANSPORT_CAP_GROWTH, lvl - 1);
export const cargoSpeed = (lvl: number) => Math.min(220, 90 * (1 + 0.03 * (lvl - 1)));
export const haulerCount = (lvl: number) => Math.min(MAX_HAULERS, 1 + Math.floor(lvl / 6));

export const oreValueMult = (lvl: number) => 1 + 0.1 * (lvl - 1);

// ---- Upgrade definitions -------------------------------------------------

export interface Upgrade {
  id: string;
  label: string;
  level: number;
  maxLevel: number;
  cost: (lvl: number) => number; // cost to go from lvl to lvl + 1
  apply: (n: number) => void;
  effect: (lvl: number) => string; // what the stat reads at a given level
}

export function getUpgrade(s: GameState, id: string): Upgrade | null {
  const [kind, idx] = id.split(':');
  const i = Number(idx);
  switch (kind) {
    case 'drill': {
      const layer = s.layers[i];
      const scale = LAYERS[i].costScale;
      return {
        id, label: '鑽頭速度', level: layer.drill, maxLevel: 400,
        cost: (l) => 6 * scale * Math.pow(1.15, l - 1),
        apply: (n) => { layer.drill += n; },
        effect: (l) => `每趟 ${credits(BASE_DRILL_RATE * MINE_TIME * drillMult(l) * LAYERS[i].value)}`,
      };
    }
    case 'crew': {
      const layer = s.layers[i];
      const scale = LAYERS[i].costScale;
      return {
        id, label: '礦工人數', level: layer.crew, maxLevel: MAX_CREW,
        cost: (l) => 25 * scale * Math.pow(2, l - 1),
        apply: (n) => { layer.crew += n; },
        effect: (l) => `${l} 名礦工`,
      };
    }
    case 'elevator':
      return {
        id, label: '升降梯', level: s.elevator.level, maxLevel: 400,
        cost: (l) => TRANSPORT_COST_BASE * Math.pow(TRANSPORT_COST_GROWTH, l - 1),
        apply: (n) => { s.elevator.level += n; },
        effect: (l) => `每趟 ${credits(elevatorCapacity(l))}`,
      };
    case 'cargo':
      return {
        id, label: '搬運隊', level: s.cargo.level, maxLevel: 400,
        cost: (l) => TRANSPORT_COST_BASE * Math.pow(TRANSPORT_COST_GROWTH, l - 1),
        apply: (n) => { s.cargo.level += n; },
        effect: (l) => `${haulerCount(l)} 人・每趟 ${credits(cargoCapacity(l))}`,
      };
    case 'orevalue':
      return {
        id, label: '礦石品位', level: s.oreValueLevel, maxLevel: 200,
        cost: (l) => 250 * Math.pow(1.55, l - 1),
        apply: (n) => { s.oreValueLevel += n; },
        effect: (l) => `售價 ×${oreValueMult(l).toFixed(1)}`,
      };
  }
  return null;
}

export type BuyMode = 1 | 10 | 'max';

/** How many levels a purchase buys, and what it costs. */
export function quote(s: GameState, u: Upgrade, mode: BuyMode): { n: number; cost: number } {
  const room = u.maxLevel - u.level;
  if (room <= 0) return { n: 0, cost: 0 };
  if (mode === 'max') {
    let n = 0;
    let cost = 0;
    while (n < room) {
      const c = u.cost(u.level + n);
      if (cost + c > s.credits) break;
      cost += c;
      n++;
    }
    return n === 0 ? { n: 1, cost: u.cost(u.level) } : { n, cost };
  }
  const n = Math.min(mode, room);
  let cost = 0;
  for (let k = 0; k < n; k++) cost += u.cost(u.level + k);
  return { n, cost };
}

export function buy(s: GameState, id: string, mode: BuyMode): boolean {
  const u = getUpgrade(s, id);
  if (!u) return false;
  const q = quote(s, u, mode);
  if (q.n === 0 || q.cost > s.credits) return false;
  s.credits -= q.cost;
  u.apply(q.n);
  return true;
}

export function canUnlock(s: GameState, i: number): boolean {
  const def = LAYERS[i];
  return !!def && !def.restricted && !s.layers[i].unlocked && s.layers[i - 1]?.unlocked === true;
}

export function unlockLayer(s: GameState, i: number): boolean {
  if (!canUnlock(s, i) || s.credits < LAYERS[i].unlockCost) return false;
  s.credits -= LAYERS[i].unlockCost;
  s.layers[i].unlocked = true;
  return true;
}

/** Whether anything in this upgrade group is affordable right now. */
export function anyAffordable(s: GameState, ids: string[]): boolean {
  return ids.some((id) => {
    const u = getUpgrade(s, id);
    return !!u && u.level < u.maxLevel && u.cost(u.level) <= s.credits;
  });
}
