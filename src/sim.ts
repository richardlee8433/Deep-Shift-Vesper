import {
  DEPOSIT_X, ELEVATOR_LOAD_TIME, FACE_X, GROUND_Y, HAULER_LOAD_TIME, LAYER_H, LAYERS,
  MINE_TIME, MINE_TOP, MINER_WALK, PORT_X, STORE_X,
} from './config';
import { sell, tickBuckets, tickReports, tickWages } from './economy';
import type { GameState, Hauler, Miner } from './state';
import { cargoCapacity, cargoSpeed, elevatorCapacity, elevatorSpeed, haulerCount, minerCarry } from './upgrades';
import { checkEvents } from './data/events';

export const SURFACE_DOCK_Y = GROUND_Y;
export const layerTop = (i: number) => MINE_TOP + i * LAYER_H;
export const layerFloor = (i: number) => layerTop(i) + LAYER_H - 16;

const EPS = 1e-6;

function newMiner(): Miner {
  const faceX = FACE_X - 8 - Math.random() * 26;
  // Stagger new miners along the tunnel so they don't walk in lockstep.
  return {
    x: DEPOSIT_X + Math.random() * (faceX - DEPOSIT_X),
    state: 'toFace',
    t: 0,
    carry: 0,
    faceX,
    phase: Math.random() * 10,
  };
}

function stepLayer(s: GameState, i: number, dt: number): void {
  const layer = s.layers[i];
  while (layer.miners.length < layer.crew) layer.miners.push(newMiner());
  if (layer.miners.length > layer.crew) layer.miners.length = layer.crew;
  for (const m of layer.miners) {
    m.phase += dt;
    switch (m.state) {
      case 'toFace':
        m.x += MINER_WALK * dt;
        if (m.x >= m.faceX) { m.x = m.faceX; m.state = 'mining'; m.t = 0; }
        break;
      case 'mining':
        m.t += dt;
        if (m.t >= MINE_TIME) { m.carry = minerCarry(s, i); m.state = 'toStash'; }
        break;
      case 'toStash':
        m.x -= MINER_WALK * dt;
        if (m.x <= DEPOSIT_X) { m.x = DEPOSIT_X; layer.stash += m.carry; m.carry = 0; m.state = 'toFace'; }
        break;
    }
  }
}

// The elevator runs to the deepest layer with ore first and loads on the way up,
// so cheap shallow ore never crowds out the valuable deep ore.
function deepestWithOre(s: GameState, below: number): number {
  for (let i = Math.min(below, s.layers.length) - 1; i >= 0; i--) {
    if (s.layers[i].unlocked && s.layers[i].stash > EPS) return i;
  }
  return -1;
}

function stepElevator(s: GameState, dt: number): void {
  const e = s.elevator;
  const cap = elevatorCapacity(e.level);
  switch (e.state) {
    case 'idle': {
      e.y = SURFACE_DOCK_Y;
      const i = deepestWithOre(s, s.layers.length);
      if (i >= 0) { e.targetLayer = i; e.state = 'moving'; }
      break;
    }
    case 'moving': {
      const ty = e.targetLayer < 0 ? SURFACE_DOCK_Y : layerFloor(e.targetLayer);
      const step = elevatorSpeed(e.level) * dt;
      if (Math.abs(ty - e.y) <= step) {
        e.y = ty;
        e.t = 0;
        e.state = e.targetLayer < 0 ? 'unloading' : 'loading';
      } else {
        e.y += Math.sign(ty - e.y) * step;
      }
      break;
    }
    case 'loading': {
      e.t += dt;
      if (e.t < ELEVATOR_LOAD_TIME) break;
      const layer = s.layers[e.targetLayer];
      const take = Math.min(layer.stash, cap - e.load);
      layer.stash -= take;
      if (layer.stash < EPS) layer.stash = 0;
      e.load += take;
      e.loadValue += take * LAYERS[e.targetLayer].value;
      const next = e.load >= cap - EPS ? -1 : deepestWithOre(s, e.targetLayer);
      e.targetLayer = next;
      e.state = 'moving';
      break;
    }
    case 'unloading': {
      e.t += dt;
      if (e.t < ELEVATOR_LOAD_TIME) break;
      s.cargo.storage += e.load;
      s.cargo.storageValue += e.loadValue;
      e.load = 0;
      e.loadValue = 0;
      e.state = 'idle';
      break;
    }
  }
}

function newHauler(): Hauler {
  return { x: STORE_X, state: 'waiting', t: 0, carry: 0, carryValue: 0, phase: Math.random() * 10 };
}

function stepCargo(s: GameState, dt: number): void {
  const c = s.cargo;
  const want = haulerCount(c.level);
  while (c.haulers.length < want) c.haulers.push(newHauler());
  const speed = cargoSpeed(c.level);
  const cap = cargoCapacity(c.level);
  for (const h of c.haulers) {
    switch (h.state) {
      case 'toStore':
        h.phase += dt;
        h.x -= speed * dt;
        if (h.x <= STORE_X) { h.x = STORE_X; h.state = 'waiting'; }
        break;
      case 'waiting':
        if (c.storage > EPS) { h.state = 'loading'; h.t = 0; }
        break;
      case 'loading': {
        h.t += dt;
        if (h.t < HAULER_LOAD_TIME) break;
        if (c.storage <= EPS) { h.state = 'waiting'; break; }
        const take = Math.min(c.storage, cap);
        const value = c.storageValue * (take / c.storage);
        c.storage -= take;
        c.storageValue -= value;
        if (c.storage < EPS) { c.storage = 0; c.storageValue = 0; }
        h.carry = take;
        h.carryValue = value;
        h.state = 'toPort';
        break;
      }
      case 'toPort':
        h.phase += dt;
        h.x += speed * dt;
        if (h.x >= PORT_X) { h.x = PORT_X; h.state = 'selling'; h.t = 0; }
        break;
      case 'selling':
        h.t += dt;
        if (h.t < HAULER_LOAD_TIME) break;
        sell(s, h.carryValue);
        h.carry = 0;
        h.carryValue = 0;
        h.state = 'toStore';
        break;
    }
  }
}

/** Advance the whole sector by dt seconds. */
export function step(s: GameState, dt: number): void {
  s.playTime += dt;
  s.layers.forEach((l, i) => { if (l.unlocked) stepLayer(s, i, dt); });
  stepElevator(s, dt);
  stepCargo(s, dt);
  tickBuckets(dt);
  tickWages(s, dt);
  tickReports(s, dt);
  checkEvents(s);
}

/** Run the sector forward quickly (offline progress). Returns budget earned. */
export function fastForward(s: GameState, seconds: number): number {
  const before = s.lifetime.budget;
  const dt = 0.25;
  for (let t = 0; t < seconds; t += dt) step(s, dt);
  return s.lifetime.budget - before;
}
