// Fixed-step simulation for one run. Rendering, audio and UI only listen to signals;
// nothing here touches the DOM, so the same code runs in the tests.
//
// Gameplay rules route through five events (tileDestroyed, relicActivated,
// enemyKilled, nestDestroyed, runEnded). Effects never re-trigger themselves:
// chain-broken ore starts no chain, capacitor pulses break no rock, a kill buff
// creates no kill.

import {
  BIO, CAPACITOR, CHAIN, CONTACT, DIG_DPS, ENEMY, type EnemyKind, EVAC_TIME, LENS_RANGE, MAP_H, MAP_W, MAX_ENEMIES,
  MOVE_SPEED, PULSE, REPULSOR, ROCK_HP, spawnInterval, THREAT, THREAT_STEPS, TURRET, VISION, WARN_TIME,
} from './config';
import { DIRS, idx, inBounds, T_BEDROCK, T_CORE, T_EMPTY, T_NEST, T_ORE, T_RELIC, T_ROCK } from './map';
import { RELICS, type RelicId } from './relics';
import type { Enemy, MetaState, Nest, RunState } from './state';

export type Source = 'drill' | 'resonance' | 'chain';

export type GameEvent =
  | { type: 'tileDestroyed'; tile: number; source: Source; chain: number; ore: number; wasOre: boolean; hard: number; dir: number }
  | { type: 'relicActivated'; relic: RelicId; site: number }
  | { type: 'enemyKilled'; kind: EnemyKind; x: number; y: number }
  | { type: 'nestDestroyed'; nest: number; wasAwake: boolean }
  | { type: 'runEnded'; result: 'success' | 'fail'; cause: string };

/** Presentation signals for the renderer, audio and HUD. */
export type Signal =
  | { t: 'toast'; text: string; tone: 'info' | 'good' | 'warn' | 'threat' }
  | { t: 'threat'; amount: number; text: string }
  | { t: 'break'; tile: number; source: Source; ore: number }
  | { t: 'dig'; tile: number }
  | { t: 'link'; from: number; to: number; kind: 'resonance' | 'chain' }
  | { t: 'shot'; x1: number; y1: number; x2: number; y2: number }
  | { t: 'ring'; x: number; y: number; r: number; kind: 'pulse' | 'cap' | 'rep' }
  | { t: 'kill'; x: number; y: number; kind: EnemyKind }
  | { t: 'hurt' }
  | { t: 'spawn'; x: number; y: number }
  | { t: 'warn'; x: number; y: number }
  | { t: 'nest'; tile: number; down: boolean }
  | { t: 'relic'; relic: RelicId | null; x: number; y: number }
  | { t: 'first'; relic: RelicId }
  | { t: 'unreachable'; tile: number }
  | { t: 'evac'; on: boolean }
  | { t: 'end'; result: 'success' | 'fail' };

let sink: (s: Signal) => void = () => {};
export function setSink(fn: (s: Signal) => void): void {
  sink = fn;
}

// ---- Distance field (runtime cache, rebuilt on demand) ----------------------

interface Cache {
  dist: Int32Array; // steps from the probe's tile over open tiles, -1 = unreachable
  from: number;
  dirty: boolean;
}
const caches = new WeakMap<RunState, Cache>();

function cacheOf(run: RunState): Cache {
  let c = caches.get(run);
  if (!c) {
    c = { dist: new Int32Array(MAP_W * MAP_H), from: -1, dirty: true };
    caches.set(run, c);
  }
  return c;
}

export function markDirty(run: RunState): void {
  cacheOf(run).dirty = true;
}

export const droneTile = (run: RunState) => idx(Math.floor(run.drone.x), Math.floor(run.drone.y));
export const tileX = (t: number) => t % MAP_W;
export const tileY = (t: number) => Math.floor(t / MAP_W);

/** BFS from the probe across open tiles. Also the enemies' flow field. */
export function distMap(run: RunState): Int32Array {
  const c = cacheOf(run);
  const from = droneTile(run);
  if (!c.dirty && c.from === from) return c.dist;
  const { kind } = run.world;
  c.dist.fill(-1);
  c.dist[from] = 0;
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = tileX(i), y = tileY(i);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const j = idx(nx, ny);
      if (c.dist[j] < 0 && kind[j] === T_EMPTY) {
        c.dist[j] = c.dist[i] + 1;
        queue.push(j);
      }
    }
  }
  c.dirty = false;
  c.from = from;
  return c.dist;
}

export function neighbors(t: number): number[] {
  const x = tileX(t), y = tileY(t);
  const out: number[] = [];
  for (const [dx, dy] of DIRS) if (inBounds(x + dx, y + dy)) out.push(idx(x + dx, y + dy));
  return out;
}

/** Direction index from tile a to a 4-adjacent tile b, or -1. */
export function dirBetween(a: number, b: number): number {
  const dx = tileX(b) - tileX(a), dy = tileY(b) - tileY(a);
  return DIRS.findIndex(([x, y]) => x === dx && y === dy);
}

export const isDiggable = (k: number) => k === T_ROCK || k === T_ORE || k === T_NEST;

/** The reachable open tile next to `target` that is closest to the probe, or -1. */
export function standTile(run: RunState, target: number): number {
  const dist = distMap(run);
  let best = -1;
  for (const n of neighbors(target)) {
    if (run.world.kind[n] === T_EMPTY && dist[n] >= 0 && (best < 0 || dist[n] < dist[best])) best = n;
  }
  return best;
}

export const canDig = (run: RunState, t: number) => isDiggable(run.world.kind[t]) && standTile(run, t) >= 0;

/** Tiles to walk through to reach `target` (an open tile), or null if unreachable. */
export function pathTo(run: RunState, target: number): number[] | null {
  const dist = distMap(run);
  if (dist[target] < 0) return null;
  const path: number[] = [];
  let cur = target;
  while (dist[cur] > 0) {
    path.push(cur);
    const next = neighbors(cur).find((n) => dist[n] === dist[cur] - 1);
    if (next === undefined) return null;
    cur = next;
  }
  path.reverse();
  const d = run.drone;
  const here = droneTile(run);
  if (Math.abs(d.x - (tileX(here) + 0.5)) > 1e-6 || Math.abs(d.y - (tileY(here) + 0.5)) > 1e-6) path.unshift(here);
  return path;
}

/** Tiles from `from` back to the probe along the flow field (for warning lines). */
export function pathFromTo(run: RunState, from: number): number[] {
  const dist = distMap(run);
  let cur = from;
  if (dist[cur] < 0) {
    const start = neighbors(cur).filter((n) => dist[n] >= 0).sort((a, b) => dist[a] - dist[b])[0];
    if (start === undefined) return [];
    cur = start;
  }
  const out = [from, cur];
  while (dist[cur] > 0) {
    const next = neighbors(cur).find((n) => dist[n] === dist[cur] - 1);
    if (next === undefined) break;
    cur = next;
    out.push(cur);
  }
  return out;
}

export const has = (run: RunState, r: RelicId) => run.equipped.includes(r);

// ---- Commands ---------------------------------------------------------------

export interface CommandResult {
  ok: boolean;
  msg?: string;
}

const fail = (msg: string): CommandResult => ({ ok: false, msg });

/** Press on a tile: move, start digging, or walk up to a relic. */
export function press(run: RunState, tile: number): CommandResult {
  const d = run.drone;
  const w = run.world;
  if (d.evac >= 0) return fail('撤離中（按 R 取消）');
  const k = w.kind[tile];
  if (k === T_BEDROCK) return fail('岩盤無法鑽穿');
  if (!w.seen[tile]) return fail('不可達：未探索區域');
  if (k === T_EMPTY) {
    const path = pathTo(run, tile);
    if (!path) return fail('不可達：沒有已挖通的路');
    d.path = path;
    d.dig = -1;
    d.approach = -1;
    return { ok: true };
  }
  const stand = standTile(run, tile);
  if (stand < 0) return fail('不可達：先挖出相鄰的通道');
  if (k === T_RELIC || k === T_CORE) {
    const site = run.sites.findIndex((s) => idx(s.x, s.y) === tile);
    if (site >= 0 && run.sites[site].activated) return fail('裝置已啟動，無法再次收取');
    d.approach = tile;
    d.dig = -1;
  } else {
    d.dig = tile;
    d.hold = true;
    d.commit = false;
    d.approach = -1;
  }
  d.path = pathTo(run, stand) ?? [];
  return { ok: true };
}

/** While the pointer is held, dragging onto another diggable tile switches target. */
export function retarget(run: RunState, tile: number): void {
  const d = run.drone;
  if (!d.hold || d.evac >= 0 || tile === d.dig || !canDig(run, tile)) return;
  d.dig = tile;
  d.approach = -1;
  const stand = standTile(run, tile);
  if (dirBetween(droneTile(run), tile) < 0 || d.path.length) d.path = pathTo(run, stand) ?? [];
}

/** Pointer released. A short tap keeps digging the tapped tile until it breaks. */
export function release(run: RunState, short: boolean): void {
  const d = run.drone;
  if (!d.hold) return;
  d.hold = false;
  if (d.dig >= 0 && short) d.commit = true;
  else d.dig = -1;
}

export function usePulse(run: RunState): boolean {
  const d = run.drone;
  if (d.pulseCd > 0) return false;
  d.pulseCd = PULSE.cooldown;
  for (const e of run.enemies) {
    if (Math.hypot(e.x - d.x, e.y - d.y) <= PULSE.radius) knock(run, e, PULSE.push, PULSE.stun);
  }
  sink({ t: 'ring', x: d.x, y: d.y, r: PULSE.radius, kind: 'pulse' });
  return true;
}

export function toggleEvac(run: RunState): void {
  const d = run.drone;
  if (d.evac >= 0) {
    d.evac = -1;
    sink({ t: 'evac', on: false });
    sink({ t: 'toast', text: '撤離已取消', tone: 'info' });
    return;
  }
  d.evac = 0;
  d.path = [];
  d.dig = -1;
  d.hold = false;
  d.commit = false;
  d.approach = -1;
  sink({ t: 'evac', on: true });
}

// ---- Relics and the core -----------------------------------------------------

export interface SitePreview {
  relic: RelicId;
  tutorial: boolean;
  threat: number;
  nest: Nest | null;
  backup: boolean; // blueprint is saved to base at once
  owned: boolean; // blueprint already unlocked
}

function nearestDormant(run: RunState, x: number, y: number): Nest | null {
  let best: Nest | null = null;
  let bd = Infinity;
  for (const n of run.nests) {
    if (n.state !== 'dormant') continue;
    const dd = Math.hypot(n.x - x, n.y - y);
    if (dd < bd) { bd = dd; best = n; }
  }
  return best;
}

export function previewSite(run: RunState, meta: MetaState, site: number): SitePreview {
  const s = run.sites[site];
  return {
    relic: s.relic,
    tutorial: s.tutorial,
    threat: s.tutorial ? THREAT.tutorial : THREAT.relic,
    nest: s.tutorial ? null : nearestDormant(run, s.x, s.y),
    backup: s.tutorial && s.relic === 'resonance' && !meta.unlocked.includes('resonance'),
    owned: meta.unlocked.includes(s.relic),
  };
}

/**
 * Activate a relic site. `equip` is 'add' (free slot), 'none' (blueprint only) or
 * the relic to replace.
 */
export function activateSite(run: RunState, meta: MetaState, site: number, equip: 'add' | 'none' | RelicId): void {
  const s = run.sites[site];
  if (s.activated) return;
  const p = previewSite(run, meta, site);
  s.activated = true;
  if (run.stats.firstRelicAt < 0) run.stats.firstRelicAt = run.time;
  if (!run.found.includes(s.relic)) run.found.push(s.relic);
  if (p.backup) {
    meta.unlocked.push(s.relic);
    run.backedUp.push(s.relic);
  }

  if (equip === 'add' && run.equipped.length < 3) run.equipped.push(s.relic);
  else if (equip !== 'add' && equip !== 'none') {
    const i = run.equipped.indexOf(equip);
    if (i >= 0) {
      run.equipped[i] = s.relic;
      run.spent.push(equip);
      run.stats.replaced.push(equip);
      unequipped(run, equip);
    }
  }
  sink({ t: 'relic', relic: s.relic, x: s.x + 0.5, y: s.y + 0.5 });
  emit(run, { type: 'relicActivated', relic: s.relic, site });

  if (s.tutorial) {
    addThreat(run, THREAT.tutorial, '遺跡啟動', 'relic');
    spawnWarningEnemy(run);
  } else {
    addThreat(run, THREAT.relic, '遺跡啟動', 'relic');
    if (p.nest) wakeNest(run, p.nest);
  }
}

/** Removing a relic cancels everything it was doing. */
function unequipped(run: RunState, r: RelicId): void {
  if (r === 'capacitor') run.cap = { count: 0, cd: 0 };
  if (r === 'repulsor') run.repCd = 0;
  if (r === 'bio') run.bio = 0;
}

export function takeCore(run: RunState): void {
  if (run.core.taken) return;
  run.core.taken = true;
  const t = idx(run.core.x, run.core.y);
  run.world.kind[t] = T_EMPTY;
  markDirty(run);
  sink({ t: 'relic', relic: null, x: run.core.x + 0.5, y: run.core.y + 0.5 });
  addThreat(run, THREAT.core, '取出主核心', 'core');
  for (const n of run.nests) if (n.state === 'dormant') wakeNest(run, n);
  sink({ t: 'toast', text: '主核心到手 — 安全撤離才算完成', tone: 'good' });
}

function wakeNest(run: RunState, n: Nest): void {
  n.state = 'awake';
  const linked = nestOpening(run, n) >= 0;
  sink({ t: 'toast', text: `${n.name}甦醒${linked ? '' : '（通道尚未連通）'}`, tone: 'warn' });
}

function spawnWarningEnemy(run: RunState): void {
  // A tunnel tile about 8 steps away, so the warning has time to be read.
  const dist = distMap(run);
  let best = -1;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] < 3) continue;
    if (best < 0 || Math.abs(dist[i] - 8) < Math.abs(dist[best] - 8)) best = i;
  }
  if (best < 0) best = run.world.entrance.y * MAP_W + run.world.entrance.x;
  run.pending.push({ at: run.time + WARN_TIME, kind: 'spawn', tile: best, from: -1, chain: 0 });
  sink({ t: 'warn', x: tileX(best) + 0.5, y: tileY(best) + 0.5 });
  sink({ t: 'toast', text: '遺跡的震動驚動了附近的東西', tone: 'warn' });
}

// ---- Threat -----------------------------------------------------------------

export function addThreat(run: RunState, amount: number, text: string, key: string): void {
  const before = run.threat;
  run.threat = Math.max(0, Math.min(100, run.threat + amount));
  const real = run.threat - before;
  if (real === 0 && amount > 0) return;
  run.threatLog.push({ t: run.time, text, amount });
  run.stats.threatBy[key] = (run.stats.threatBy[key] ?? 0) + amount;
  sink({ t: 'threat', amount, text });
  for (const step of THREAT_STEPS) {
    if (before < step && run.threat >= step) {
      sink({ t: 'toast', text: `威脅達 ${step}：巢穴每 ${spawnInterval(run.threat)} 秒生成${step >= 70 ? '，並出現裝甲蟲' : ''}`, tone: 'threat' });
    }
  }
  const iv = spawnInterval(run.threat);
  for (const n of run.nests) if (n.armed && n.warn <= 0) n.timer = Math.min(n.timer, iv);
}

export function nextThreshold(t: number): number | null {
  return THREAT_STEPS.find((s) => t < s) ?? null;
}

// ---- Events -----------------------------------------------------------------

function emit(run: RunState, ev: GameEvent): void {
  switch (ev.type) {
    case 'tileDestroyed': {
      if (has(run, 'capacitor')) run.cap.count = Math.min(CAPACITOR.tiles, run.cap.count + 1);
      if (ev.source === 'drill' && ev.dir >= 0 && has(run, 'resonance')) resonate(run, ev.tile, ev.dir, ev.hard);
      if (ev.wasOre && ev.source !== 'chain' && has(run, 'detonator')) startChain(run, ev.tile);
      break;
    }
    case 'enemyKilled':
      if (has(run, 'bio')) {
        run.bio = BIO.duration;
        first(run, 'bio');
      }
      break;
    case 'relicActivated':
    case 'nestDestroyed':
    case 'runEnded':
      break;
  }
}

function first(run: RunState, r: RelicId): void {
  if (run.firstUse.includes(r)) return;
  run.firstUse.push(r);
  sink({ t: 'first', relic: r });
  sink({ t: 'toast', text: `${RELICS[r].name}生效`, tone: 'good' });
}

function resonate(run: RunState, tile: number, dir: number, hard: number): void {
  const [dx, dy] = DIRS[dir];
  const x = tileX(tile) + dx, y = tileY(tile) + dy;
  if (!inBounds(x, y)) return;
  const behind = idx(x, y);
  const k = run.world.kind[behind];
  if (k !== T_ROCK && k !== T_ORE) return;
  first(run, 'resonance');
  sink({ t: 'link', from: tile, to: behind, kind: 'resonance' });
  run.world.hp[behind] -= ROCK_HP[hard];
  if (run.world.hp[behind] <= 1e-9) destroyTile(run, behind, 'resonance', 0, -1);
}

function startChain(run: RunState, origin: number): void {
  const { kind } = run.world;
  const chain = run.nextChain++;
  const seen = new Set([origin]);
  const queue: { tile: number; from: number; depth: number }[] = [{ tile: origin, from: -1, depth: 0 }];
  const hits: typeof queue = [];
  for (let q = 0; q < queue.length && hits.length < CHAIN.max; q++) {
    const cur = queue[q];
    if (cur.tile !== origin) hits.push(cur);
    for (const n of neighbors(cur.tile)) {
      if (!seen.has(n) && kind[n] === T_ORE) {
        seen.add(n);
        queue.push({ tile: n, from: cur.tile, depth: cur.depth + 1 });
      }
    }
  }
  if (!hits.length) return;
  hits.forEach((h, i) => run.pending.push({ at: run.time + (i + 1) * CHAIN.delay, kind: 'chain', tile: h.tile, from: h.from, chain }));
  run.stats.chains += 1;
  first(run, 'detonator');
  addThreat(run, THREAT.chain, '礦脈連鎖', 'chain');
}

export function destroyTile(run: RunState, tile: number, source: Source, chain: number, dir: number): void {
  const w = run.world;
  const k = w.kind[tile];
  if (k !== T_ROCK && k !== T_ORE) return;
  const ore = w.ore[tile];
  const hard = w.hard[tile];
  w.kind[tile] = T_EMPTY;
  w.hp[tile] = 0;
  w.ore[tile] = 0;
  markDirty(run);
  run.ore += ore;
  run.stats.tilesDug += 1;
  sink({ t: 'break', tile, source, ore });
  emit(run, { type: 'tileDestroyed', tile, source, chain, ore, wasOre: k === T_ORE, hard, dir });
}

function damageNest(run: RunState, tile: number, dmg: number): void {
  const i = run.nests.findIndex((n) => idx(n.x, n.y) === tile);
  if (i < 0) return;
  const n = run.nests[i];
  n.hp -= dmg;
  if (n.hp > 0) return;
  const wasAwake = n.state === 'awake';
  n.state = 'destroyed';
  run.world.kind[tile] = T_EMPTY;
  markDirty(run);
  run.stats.nestsDestroyed += 1;
  sink({ t: 'nest', tile, down: true });
  if (wasAwake && !n.counted) {
    n.counted = true;
    addThreat(run, THREAT.nestKill, `摧毀${n.name}`, 'nest');
  } else {
    sink({ t: 'toast', text: `${n.name}已拆除`, tone: 'good' });
  }
  emit(run, { type: 'nestDestroyed', nest: i, wasAwake });
}

function damageEnemy(run: RunState, e: Enemy, dmg: number): void {
  e.hp -= dmg;
  e.hit = 0.15;
  if (e.hp > 0) return;
  run.enemies.splice(run.enemies.indexOf(e), 1);
  run.stats.kills += 1;
  sink({ t: 'kill', x: e.x, y: e.y, kind: e.kind });
  emit(run, { type: 'enemyKilled', kind: e.kind, x: e.x, y: e.y });
}

/** Push an enemy up to `push` tiles away from the probe along open tiles; walls stop it. */
function knock(run: RunState, e: Enemy, push: number, stun: number): void {
  const d = run.drone;
  const ax = e.x - d.x, ay = e.y - d.y;
  const start = idx(Math.floor(e.x), Math.floor(e.y));
  const order = DIRS.map((v, i) => ({ i, dot: v[0] * ax + v[1] * ay }))
    .filter((o) => o.dot > 0 || (ax === 0 && ay === 0))
    .sort((a, b) => b.dot - a.dot);
  let end = start;
  for (const o of order) {
    let cur = start;
    for (let s = 0; s < push; s++) {
      const x = tileX(cur) + DIRS[o.i][0], y = tileY(cur) + DIRS[o.i][1];
      if (!inBounds(x, y) || run.world.kind[idx(x, y)] !== T_EMPTY) break;
      cur = idx(x, y);
    }
    if (cur !== start) { end = cur; break; }
  }
  e.kb = { fx: e.x, fy: e.y, tx: tileX(end) + 0.5, ty: tileY(end) + 0.5, t: 0 };
  e.stun = Math.max(e.stun, stun);
}

// ---- Step -------------------------------------------------------------------

export interface StepResult {
  result: 'success' | 'fail';
  cause: string;
}

/** Open tile next to a nest that the probe can reach, or -1. */
export function nestOpening(run: RunState, n: Nest): number {
  const dist = distMap(run);
  let best = -1;
  for (const t of neighbors(idx(n.x, n.y))) {
    if (run.world.kind[t] === T_EMPTY && dist[t] >= 0 && (best < 0 || dist[t] < dist[best])) best = t;
  }
  return best;
}

function spawn(run: RunState, tile: number, kind: EnemyKind): void {
  const def = ENEMY[kind];
  run.enemies.push({
    id: run.nextEnemy++, kind, x: tileX(tile) + 0.5, y: tileY(tile) + 0.5, hp: def.hp, stun: 0, kb: null, hit: 0,
  });
  sink({ t: 'spawn', x: tileX(tile) + 0.5, y: tileY(tile) + 0.5 });
}

function lineOfSight(run: RunState, x1: number, y1: number, x2: number, y2: number): boolean {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(len * 4);
  for (let s = 1; s < steps; s++) {
    const x = x1 + ((x2 - x1) * s) / steps, y = y1 + ((y2 - y1) * s) / steps;
    if (run.world.kind[idx(Math.floor(x), Math.floor(y))] !== T_EMPTY) return false;
  }
  return true;
}

function reveal(run: RunState): void {
  const w = run.world;
  const d = run.drone;
  const cx = Math.floor(d.x), cy = Math.floor(d.y);
  const lens = has(run, 'lens');
  const r = lens ? LENS_RANGE : VISION;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (!inBounds(x, y)) continue;
      const dd = (x - cx) ** 2 + (y - cy) ** 2;
      const i = idx(x, y);
      if (dd <= VISION * VISION + 0.5) w.seen[i] = 1;
      if (lens && dd <= LENS_RANGE * LENS_RANGE + 0.5 && !w.scan[i]) {
        const k = w.kind[i];
        if (k === T_ORE || k === T_RELIC || k === T_CORE || k === T_NEST) {
          w.scan[i] = 1;
          if (!w.seen[i]) first(run, 'lens');
        }
      }
    }
  }
  if (lens) {
    for (const n of run.nests) {
      if (!w.scan[idx(n.x, n.y)]) continue;
      for (const z of n.zone) w.scan[z] = 1;
    }
  }
}

export function step(run: RunState, dt: number): StepResult | null {
  const d = run.drone;
  const w = run.world;
  run.time += dt;
  d.pulseCd = Math.max(0, d.pulseCd - dt);
  d.turretCd = Math.max(0, d.turretCd - dt);
  d.hurt = Math.max(0, d.hurt - dt);
  run.cap.cd = Math.max(0, run.cap.cd - dt);
  run.repCd = Math.max(0, run.repCd - dt);
  run.bio = Math.max(0, run.bio - dt);

  // Scheduled chain hits and warning spawns.
  if (run.pending.length) {
    const due = run.pending.filter((p) => p.at <= run.time);
    if (due.length) {
      run.pending = run.pending.filter((p) => p.at > run.time);
      for (const p of due) {
        if (p.kind === 'spawn') {
          spawn(run, p.tile, 'crawler');
          continue;
        }
        if (w.kind[p.tile] !== T_ORE) continue;
        if (p.from >= 0) sink({ t: 'link', from: p.from, to: p.tile, kind: 'chain' });
        w.hp[p.tile] -= CHAIN.damage;
        if (w.hp[p.tile] <= 1e-9) destroyTile(run, p.tile, 'chain', p.chain, -1);
      }
    }
  }

  // Probe: evacuate, move, dig.
  let action: 'move' | 'dig' | 'idle' | 'evac' = 'idle';
  if (d.evac >= 0) {
    d.evac += dt;
    action = 'evac';
  } else if (d.path.length) {
    action = 'move';
    let budget = MOVE_SPEED * dt;
    while (budget > 0 && d.path.length) {
      const n = d.path[0];
      const cx = tileX(n) + 0.5, cy = tileY(n) + 0.5;
      const dx = cx - d.x, dy = cy - d.y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-6) d.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
      if (len <= budget) {
        d.x = cx;
        d.y = cy;
        budget -= len;
        d.path.shift();
      } else {
        d.x += (dx / len) * budget;
        d.y += (dy / len) * budget;
        budget = 0;
      }
    }
  } else {
    const here = droneTile(run);
    if (d.approach >= 0) {
      const t = d.approach;
      d.approach = -1;
      const k = w.kind[t];
      if (dirBetween(here, t) >= 0) {
        d.face = dirBetween(here, t);
        if (k === T_CORE && !run.core.taken) run.prompt = { kind: 'core' };
        else if (k === T_RELIC) {
          const site = run.sites.findIndex((s) => idx(s.x, s.y) === t);
          if (site >= 0 && !run.sites[site].activated) run.prompt = { kind: 'site', site };
        }
      }
    }
    if (d.dig >= 0) {
      const t = d.dig;
      const k = w.kind[t];
      if (!isDiggable(k)) {
        d.dig = -1;
        d.commit = false;
      } else if (!d.hold && !d.commit) {
        d.dig = -1;
      } else {
        const dir = dirBetween(here, t);
        if (dir < 0) {
          const stand = standTile(run, t);
          const path = stand >= 0 ? pathTo(run, stand) : null;
          if (!path) {
            d.dig = -1;
            d.commit = false;
            sink({ t: 'unreachable', tile: t });
          } else d.path = path;
        } else {
          action = 'dig';
          d.face = dir;
          const dmg = DIG_DPS * run.drillMult * (run.bio > 0 ? BIO.mult : 1) * dt;
          sink({ t: 'dig', tile: t });
          if (k === T_NEST) damageNest(run, t, dmg);
          else {
            w.hp[t] -= dmg;
            if (w.hp[t] <= 1e-9) {
              destroyTile(run, t, 'drill', 0, dir);
              d.commit = false;
              if (!d.hold) d.dig = -1;
            }
          }
        }
      }
    }
  }
  if (action === 'dig') run.stats.digTime += dt;
  else if (action === 'move') run.stats.moveTime += dt;
  else if (action === 'idle') run.stats.idleTime += dt;
  run.stats.maxDepth = Math.max(run.stats.maxDepth, Math.floor(d.y));

  reveal(run);
  const dist = distMap(run);

  // Nests: awake + connected → warn once, then spawn on the threat-based interval.
  for (const n of run.nests) {
    if (n.state !== 'awake') continue;
    n.warn = Math.max(0, n.warn - dt);
    const open = nestOpening(run, n);
    if (open < 0) continue;
    if (!n.armed) {
      n.armed = true;
      n.warn = WARN_TIME;
      n.timer = WARN_TIME;
      sink({ t: 'warn', x: n.x + 0.5, y: n.y + 0.5 });
      sink({ t: 'toast', text: `${n.name}已和你的通道連通`, tone: 'warn' });
      continue;
    }
    n.timer -= dt;
    if (n.timer > 0) continue;
    n.timer = spawnInterval(run.threat);
    if (run.enemies.length >= MAX_ENEMIES) continue; // skipped, not queued
    const armored = run.threat >= 70 && n.spawned % 3 === 2;
    n.spawned += 1;
    spawn(run, open, armored ? 'armored' : 'crawler');
  }

  // Enemies follow the flow field over open tiles only.
  const here = droneTile(run);
  const hx = tileX(here), hy = tileY(here);
  for (const e of run.enemies) {
    e.hit = Math.max(0, e.hit - dt);
    if (e.kb) {
      e.kb.t = Math.min(1, e.kb.t + dt / 0.18);
      const k = 1 - (1 - e.kb.t) ** 2;
      e.x = e.kb.fx + (e.kb.tx - e.kb.fx) * k;
      e.y = e.kb.fy + (e.kb.ty - e.kb.fy) * k;
      if (e.kb.t >= 1) e.kb = null;
      continue;
    }
    if (e.stun > 0) { e.stun -= dt; continue; }
    const speed = ENEMY[e.kind].speed * dt;
    const et = idx(Math.floor(e.x), Math.floor(e.y));
    const ex = tileX(et), ey = tileY(et);
    let tx: number, ty: number, stop = 0;
    if (Math.abs(ex - hx) + Math.abs(ey - hy) <= 1) {
      tx = d.x; ty = d.y; stop = 0.55;
    } else {
      if (dist[et] < 0) continue; // cut off from the probe: wait
      let next = -1;
      for (const nb of neighbors(et)) if (dist[nb] >= 0 && dist[nb] < dist[et] && (next < 0 || dist[nb] < dist[next])) next = nb;
      if (next < 0) continue;
      tx = tileX(next) + 0.5; ty = tileY(next) + 0.5;
    }
    const dx = tx - e.x, dy = ty - e.y;
    const len = Math.hypot(dx, dy);
    if (len <= stop) continue;
    const mv = Math.min(speed, len - stop);
    e.x += (dx / len) * mv;
    e.y += (dy / len) * mv;
  }

  // Turret: nearest enemy in range with a clear line.
  let near: Enemy | null = null;
  let nd = Infinity;
  for (const e of run.enemies) {
    const dd = Math.hypot(e.x - d.x, e.y - d.y);
    if (dd <= TURRET.range && dd < nd && lineOfSight(run, d.x, d.y, e.x, e.y)) { near = e; nd = dd; }
  }
  if (near) run.stats.fightTime += dt;
  if (near && d.turretCd <= 0) {
    d.turretCd = TURRET.interval;
    sink({ t: 'shot', x1: d.x, y1: d.y, x2: near.x, y2: near.y });
    damageEnemy(run, near, TURRET.damage);
  }

  if (has(run, 'capacitor') && run.cap.count >= CAPACITOR.tiles && run.cap.cd <= 0) {
    run.cap.count -= CAPACITOR.tiles;
    run.cap.cd = CAPACITOR.cooldown;
    first(run, 'capacitor');
    sink({ t: 'ring', x: d.x, y: d.y, r: CAPACITOR.radius, kind: 'cap' });
    for (const e of [...run.enemies]) if (Math.hypot(e.x - d.x, e.y - d.y) <= CAPACITOR.radius + 0.3) damageEnemy(run, e, CAPACITOR.damage);
  }

  if (has(run, 'repulsor') && run.repCd <= 0) {
    const inRange = run.enemies.filter((e) => Math.hypot(e.x - d.x, e.y - d.y) <= REPULSOR.radius);
    if (inRange.length) {
      run.repCd = REPULSOR.interval;
      first(run, 'repulsor');
      for (const e of inRange) knock(run, e, REPULSOR.push, 0.3);
      sink({ t: 'ring', x: d.x, y: d.y, r: REPULSOR.radius, kind: 'rep' });
    }
  }

  // Contact damage. Hitting zero ends the run before an evacuation can complete.
  for (const e of run.enemies) {
    if (Math.hypot(e.x - d.x, e.y - d.y) < CONTACT && !e.kb) {
      d.shield -= ENEMY[e.kind].dps * dt;
      if (d.hurt <= 0) sink({ t: 'hurt' });
      d.hurt = 0.25;
      run.stats.lastHitBy = e.kind;
    }
  }
  if (d.shield <= 0) {
    d.shield = 0;
    return end(run, 'fail', run.stats.lastHitBy ? `護盾被${ENEMY[run.stats.lastHitBy].name}擊穿` : '護盾歸零');
  }
  if (d.evac >= EVAC_TIME) return end(run, 'success', '安全撤離');
  return null;
}

function end(run: RunState, result: 'success' | 'fail', cause: string): StepResult {
  emit(run, { type: 'runEnded', result, cause });
  sink({ t: 'end', result });
  return { result, cause };
}

/** Abandon from the menu: settles like a failure. */
export function abandon(run: RunState): StepResult {
  return end(run, 'fail', '放棄本趟');
}
