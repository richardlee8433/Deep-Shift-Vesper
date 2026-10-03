// Steady-state throughput of each station in ₵ per second (before the ore-grade bonus).
// Used for the upgrade panels and the bottleneck warning, not by the simulation itself.
import {
  DEPOSIT_X, ELEVATOR_LOAD_TIME, FACE_X, GROUND_Y, HAULER_LOAD_TIME, MINE_TIME, MINER_WALK, PORT_X, STORE_X,
} from './config';
import { layerFloor } from './sim';
import type { GameState } from './state';
import {
  cargoCapacity, cargoSpeed, elevatorCapacity, elevatorSpeed, haulerCount, minerCarry,
} from './upgrades';

const AVG_FACE_X = FACE_X - 5; // miners pick a spot up to 10 units short of the face
const MINER_CYCLE = (2 * (AVG_FACE_X - DEPOSIT_X)) / MINER_WALK + MINE_TIME;

export function layerFlow(s: GameState, i: number, crew = s.layers[i].crew): number {
  return (crew * minerCarry(s, i)) / MINER_CYCLE;
}

export function mineFlow(s: GameState): number {
  let total = 0;
  s.layers.forEach((l, i) => { if (l.unlocked) total += layerFlow(s, i); });
  return total;
}

/** Full loads from the deepest layer: one stop, one unload. */
export function elevatorFlow(s: GameState, level = s.elevator.level): number {
  let deepest = 0;
  s.layers.forEach((l, i) => { if (l.unlocked) deepest = i; });
  const trip = (2 * (layerFloor(deepest) - GROUND_Y)) / elevatorSpeed(level) + 2 * ELEVATOR_LOAD_TIME;
  return elevatorCapacity(level) / trip;
}

export function cargoFlow(s: GameState, level = s.cargo.level): number {
  const trip = (2 * (PORT_X - STORE_X)) / cargoSpeed(level) + 2 * HAULER_LOAD_TIME;
  return (haulerCount(level) * cargoCapacity(level)) / trip;
}

export type Station = 'mine' | 'elevator' | 'cargo';

const BACKLOG_SECONDS = 20; // a pile bigger than this many seconds of transport is a backlog

export interface Flows {
  mine: number;
  elevator: number;
  cargo: number;
  /** The transport station holding output back, if any. */
  bottleneck: Station | null;
}

export function flows(s: GameState): Flows {
  const mine = mineFlow(s);
  const elevator = elevatorFlow(s);
  const cargo = cargoFlow(s);
  // A backlog counts too: ore piling up at the tunnels or the surface means the next station can't keep up.
  const tunnelBacklog = s.layers.reduce((sum, l) => sum + (l.unlocked ? l.stash : 0), 0);
  const elevatorBehind = elevator < mine * 0.98 || tunnelBacklog > elevator * BACKLOG_SECONDS;
  const cargoBehind = cargo < Math.min(mine, elevator) * 0.98 || s.cargo.storage > cargo * BACKLOG_SECONDS;
  let bottleneck: Station | null = null;
  if (elevatorBehind && (elevator <= cargo || !cargoBehind)) bottleneck = 'elevator';
  else if (cargoBehind) bottleneck = 'cargo';
  return { mine, elevator, cargo, bottleneck };
}
