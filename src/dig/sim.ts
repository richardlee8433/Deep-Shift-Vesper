// Fixed-step simulation of the persistent world. Rendering, audio and UI only listen
// to signals; nothing here touches the DOM, so the same code runs in the tests.
//
// Monsters walk a cost field toward the base: open tunnels are cheap, rock is slow to
// chew through, walls cost more still. Every tile the miner digs is a cheaper road
// for them, which is the core trade-off.

import {
  AGGRO, armoredEvery, BASE, BIO, BUILD, type BuildKind, CAPACITOR, CHAIN, CONTACT, DEMOLISH_REFUND, DIG_DPS, ENEMY,
  type EnemyKind, GUN, LENS_RANGE, MAP_H, MAP_W, MAX_ENEMIES, MOVE_SPEED, PATH_COST, PULSE, RECALL_TIME, REPULSOR,
  RESPAWN_TIME, ROCK_HP, THREAT, TOWER, TRAP_DPS, UPGRADES, type UpgradeId, VISION, WAVE, waveBonus, waveSize, BUILD_RANGE,
} from './config';
import {
  BASE_POS, DIRS, idx, inBounds, isRock, isStructure, isWalkable, SPAWN, T_BASE, T_EMPTY, T_ORE, T_RELIC, T_RIFT, T_ROCK,
  T_TURRET, T_WALL,
} from './map';
import { RELICS, type RelicId } from './relics';
import { drillMult, type Enemy, type GameState, maxBaseHp, maxShield, threatOf, towerMult } from './state';

export type Source = 'drill' | 'resonance' | 'chain' | 'monster';

export type GameEvent =
  | { type: 'tileDestroyed'; tile: number; source: Source; ore: number; wasOre: boolean; hard: number; dir: number }
  | { type: 'relicActivated'; relic: RelicId; site: number }
  | { type: 'enemyKilled'; kind: EnemyKind; x: number; y: number }
  | { type: 'waveCleared'; n: number }
  | { type: 'coreFell' };

/** Presentation signals for the renderer, audio and HUD. */
export type Signal =
  | { t: 'toast'; text: string; tone: 'info' | 'good' | 'warn' | 'threat' }
  | { t: 'threat'; amount: number; text: string }
  | { t: 'break'; tile: number; source: Source; ore: number }
  | { t: 'dig'; tile: number }
  | { t: 'link'; from: number; to: number; kind: 'resonance' | 'chain' }
  | { t: 'shot'; x1: number; y1: number; x2: number; y2: number; tower: boolean }
  | { t: 'ring'; x: number; y: number; r: number; kind: 'pulse' | 'cap' | 'rep' }
  | { t: 'kill'; x: number; y: number; kind: EnemyKind }
  | { t: 'hurt' }
  | { t: 'spawn'; x: number; y: number }
  | { t: 'quake' }
  | { t: 'wave'; n: number }
  | { t: 'baseHit' }
  | { t: 'fall' }
  | { t: 'built'; tile: number; kind: BuildKind }
  | { t: 'smashed'; tile: number }
  | { t: 'relic'; relic: RelicId; x: number; y: number }
  | { t: 'first'; relic: RelicId }
  | { t: 'unreachable'; tile: number }
  | { t: 'recall'; on: boolean }
  | { t: 'death' }
  | { t: 'respawn' };

let sink: (s: Signal) => void = () => {};
export function setSink(fn: (s: Signal) => void): void {
  sink = fn;
}

// ---- Fields (runtime cache, rebuilt on demand) ------------------------------------

interface Cache {
  ver: number; // bumps whenever a tile changes kind
  pd: Int32Array; // BFS steps from the miner over open tiles, -1 = unreachable
  pFrom: number;
  pVer: number;
  field: Float64Array; // monster cost-to-base
  fVer: number;
}
const caches = new WeakMap<GameState, Cache>();

function cacheOf(s: GameState): Cache {
  let c = caches.get(s);
  if (!c) {
    const n = MAP_W * MAP_H;
    c = { ver: 1, pd: new Int32Array(n), pFrom: -1, pVer: 0, field: new Float64Array(n), fVer: 0 };
    caches.set(s, c);
  }
  return c;
}

export function markDirty(s: GameState): void {
  cacheOf(s).ver += 1;
}

export const tileX = (t: number) => t % MAP_W;
export const tileY = (t: number) => Math.floor(t / MAP_W);
export const droneTile = (s: GameState) => idx(Math.floor(s.drone.x), Math.floor(s.drone.y));
const tileOf = (x: number, y: number) => idx(Math.floor(x), Math.floor(y));

export function neighbors(t: number): number[] {
  const x = tileX(t), y = tileY(t);
  const out: number[] = [];
  for (const [dx, dy] of DIRS) if (inBounds(x + dx, y + dy)) out.push(idx(x + dx, y + dy));
  return out;
}

export function dirBetween(a: number, b: number): number {
  const dx = tileX(b) - tileX(a), dy = tileY(b) - tileY(a);
  return DIRS.findIndex(([x, y]) => x === dx && y === dy);
}

/** BFS from the miner across open tiles. */
export function distMap(s: GameState): Int32Array {
  const c = cacheOf(s);
  const from = droneTile(s);
  if (c.pVer === c.ver && c.pFrom === from) return c.pd;
  const { kind } = s.world;
  c.pd.fill(-1);
  c.pd[from] = 0;
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    for (const j of neighbors(i)) {
      if (c.pd[j] < 0 && isWalkable(kind[j])) {
        c.pd[j] = c.pd[i] + 1;
        queue.push(j);
      }
    }
  }
  c.pVer = c.ver;
  c.pFrom = from;
  return c.pd;
}

/** Cost for a monster to step into tile t (Infinity = never). */
export function tileCost(s: GameState, t: number): number {
  const w = s.world;
  const k = w.kind[t];
  if (k === T_EMPTY || k === T_RIFT) return PATH_COST.open;
  if (k === T_ROCK || k === T_ORE) return PATH_COST.open + ROCK_HP[w.hard[t]] * PATH_COST.rockPerHp;
  if (k === T_WALL) return PATH_COST.open + BUILD.wall.hp * PATH_COST.structPerHp;
  if (k === T_TURRET) return PATH_COST.open + BUILD.turret.hp * PATH_COST.structPerHp;
  if (k === T_BASE) return 0;
  return Infinity;
}

/** Dijkstra from the base core: cost for a monster on each tile to reach it. */
export function monsterField(s: GameState): Float64Array {
  const c = cacheOf(s);
  if (c.fVer === c.ver) return c.field;
  const f = c.field;
  f.fill(Infinity);
  const heap: number[] = []; // packed as [cost, tile] pairs in parallel arrays below
  const hc: number[] = [];
  const push = (cost: number, t: number) => {
    heap.push(t);
    hc.push(cost);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hc[p] <= hc[i]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      [hc[p], hc[i]] = [hc[i], hc[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [hc[0], heap[0]];
    const lt = heap.pop()!, lc = hc.pop()!;
    if (heap.length) {
      heap[0] = lt;
      hc[0] = lc;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && hc[l] < hc[m]) m = l;
        if (r < heap.length && hc[r] < hc[m]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        [hc[m], hc[i]] = [hc[i], hc[m]];
        i = m;
      }
    }
    return top;
  };
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const t = idx(BASE_POS.x + dx, BASE_POS.y + dy);
    f[t] = 0;
    push(0, t);
  }
  while (heap.length) {
    const [d, u] = pop();
    if (d > f[u]) continue;
    const cu = tileCost(s, u);
    for (const t of neighbors(u)) {
      if (s.world.kind[t] === T_RELIC || s.world.kind[t] === T_BASE) continue;
      const nd = d + cu;
      if (nd < f[t]) {
        f[t] = nd;
        push(nd, t);
      }
    }
  }
  c.fVer = c.ver;
  return f;
}

/** The tile a monster on tile t heads for next (may be solid: then it chews it). */
export function nextStep(s: GameState, t: number): number {
  const f = monsterField(s);
  let best = -1, bc = Infinity;
  for (const u of neighbors(t)) {
    const c = tileCost(s, u) + f[u];
    if (c < bc) { bc = c; best = u; }
  }
  return best;
}

/** Route a monster from tile `from` would take to the base (for warning lines and the lens). */
export function routeFrom(s: GameState, from: number, limit = 400): number[] {
  const out = [from];
  let cur = from;
  for (let i = 0; i < limit; i++) {
    if (s.world.kind[cur] === T_BASE) break;
    const n = nextStep(s, cur);
    if (n < 0 || out.includes(n)) break;
    out.push(n);
    cur = n;
  }
  return out;
}

export const isDiggable = (k: number) => k === T_ROCK || k === T_ORE;

/** The reachable open tile next to `target` that is closest to the miner, or -1. */
export function standTile(s: GameState, target: number): number {
  const dist = distMap(s);
  let best = -1;
  for (const n of neighbors(target)) {
    if (isWalkable(s.world.kind[n]) && dist[n] >= 0 && (best < 0 || dist[n] < dist[best])) best = n;
  }
  return best;
}

export const canDig = (s: GameState, t: number) => isDiggable(s.world.kind[t]) && standTile(s, t) >= 0;

/** Tiles to walk through to reach `target` (an open tile), or null if unreachable. */
export function pathTo(s: GameState, target: number): number[] | null {
  const dist = distMap(s);
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
  const d = s.drone;
  const here = droneTile(s);
  if (Math.abs(d.x - (tileX(here) + 0.5)) > 1e-6 || Math.abs(d.y - (tileY(here) + 0.5)) > 1e-6) path.unshift(here);
  return path;
}

export const has = (s: GameState, r: RelicId) => s.relics.equipped.includes(r);

export function nearBase(s: GameState): boolean {
  const d = s.drone;
  return d.dead < 0 && Math.hypot(d.x - (BASE_POS.x + 1), d.y - (BASE_POS.y + 1)) <= BASE.menuRange;
}

// ---- Commands -------------------------------------------------------------------

export interface CommandResult {
  ok: boolean;
  msg?: string;
}

const fail = (msg: string): CommandResult => ({ ok: false, msg });

function busy(s: GameState): string | null {
  if (s.drone.dead >= 0) return '探機重建中…';
  if (s.drone.recall >= 0) return '返回基地中（按 R 取消）';
  return null;
}

/** Press on a tile: move, start digging, or walk up to a relic / the base. */
export function press(s: GameState, tile: number): CommandResult {
  const d = s.drone;
  const w = s.world;
  const b = busy(s);
  if (b) return fail(b);
  const k = w.kind[tile];
  if (!w.seen[tile]) return fail('不可達：未探索區域');
  if (isWalkable(k)) {
    const path = pathTo(s, tile);
    if (!path) return fail('不可達：沒有已挖通的路');
    d.path = path;
    d.dig = -1;
    d.approach = -1;
    return { ok: true };
  }
  if (isStructure(k)) return fail('這是你的建築（右鍵或 X 拆除）');
  const stand = standTile(s, tile);
  if (stand < 0) return fail('不可達：先挖出相鄰的通道');
  if (k === T_RELIC || k === T_BASE) {
    const site = s.sites.findIndex((p) => idx(p.x, p.y) === tile);
    if (site >= 0 && s.sites[site].activated) return fail('裝置已啟動');
    d.approach = tile;
    d.dig = -1;
  } else {
    d.dig = tile;
    d.hold = true;
    d.commit = false;
    d.approach = -1;
  }
  d.path = pathTo(s, stand) ?? [];
  return { ok: true };
}

/** While the pointer is held, dragging onto another diggable tile switches target. */
export function retarget(s: GameState, tile: number): void {
  const d = s.drone;
  if (!d.hold || busy(s) || tile === d.dig || !canDig(s, tile)) return;
  d.dig = tile;
  d.approach = -1;
  if (dirBetween(droneTile(s), tile) < 0 || d.path.length) d.path = pathTo(s, standTile(s, tile)) ?? [];
}

/** Keyboard steering (WASD / arrows), called every frame while a direction is held. */
export function steer(s: GameState, dir: number, tap: boolean): CommandResult {
  const d = s.drone;
  const b = busy(s);
  if (b) return tap ? fail(b) : { ok: false };
  if (d.path.length > 1) d.path.length = 1;
  if (d.path.length) return { ok: true };
  d.face = dir;
  const x = tileX(droneTile(s)) + DIRS[dir][0], y = tileY(droneTile(s)) + DIRS[dir][1];
  if (!inBounds(x, y)) return tap ? fail('已到地圖邊界') : { ok: false };
  const t = idx(x, y);
  const k = s.world.kind[t];
  if (isWalkable(k)) {
    d.dig = -1;
    d.approach = -1;
    d.path = [t];
    return { ok: true };
  }
  if (isDiggable(k)) {
    d.dig = t;
    d.approach = -1;
    d.hold = true;
    d.commit = false;
    return { ok: true };
  }
  if (tap && (k === T_RELIC || k === T_BASE)) return press(s, t);
  return { ok: false };
}

export function release(s: GameState, short: boolean): void {
  const d = s.drone;
  if (!d.hold) return;
  d.hold = false;
  if (d.dig >= 0 && short) d.commit = true;
  else d.dig = -1;
}

/** The tile in front of the miner. */
export function frontTile(s: GameState): number {
  const x = tileX(droneTile(s)) + DIRS[s.drone.face][0], y = tileY(droneTile(s)) + DIRS[s.drone.face][1];
  return inBounds(x, y) ? idx(x, y) : -1;
}

export function usePulse(s: GameState): boolean {
  const d = s.drone;
  if (d.pulseCd > 0 || d.dead >= 0) return false;
  d.pulseCd = PULSE.cooldown;
  for (const e of s.enemies) if (Math.hypot(e.x - d.x, e.y - d.y) <= PULSE.radius) knock(s, e, PULSE.push, PULSE.stun);
  sink({ t: 'ring', x: d.x, y: d.y, r: PULSE.radius, kind: 'pulse' });
  return true;
}

export function toggleRecall(s: GameState): void {
  const d = s.drone;
  if (d.dead >= 0) return;
  if (d.recall >= 0) {
    d.recall = -1;
    sink({ t: 'recall', on: false });
    return;
  }
  d.recall = 0;
  d.path = [];
  d.dig = -1;
  d.hold = false;
  d.commit = false;
  d.approach = -1;
  sink({ t: 'recall', on: true });
}

// ---- Building -------------------------------------------------------------------

export function buildError(s: GameState, tile: number, kind: BuildKind): string | null {
  const b = busy(s);
  if (b) return b;
  const w = s.world;
  if (tile < 0) return '這裡不能蓋';
  if (!w.seen[tile]) return '未探索區域';
  if (w.kind[tile] !== T_EMPTY) return kind === 'trap' ? '陷阱只能鋪在已挖通的通道上' : '只能蓋在已挖通的通道上';
  const d = s.drone;
  if (Math.hypot(tileX(tile) + 0.5 - d.x, tileY(tile) + 0.5 - d.y) > BUILD_RANGE) return `太遠了（${BUILD_RANGE} 格內）`;
  if (s.ore < BUILD[kind].cost) return `礦石不足（需要 ${BUILD[kind].cost}）`;
  if (kind === 'trap') return w.trap[tile] ? '這裡已有陷阱' : null;
  if (tile === droneTile(s)) return '不能蓋在探機腳下';
  if (s.enemies.some((e) => tileOf(e.x, e.y) === tile)) return '有怪物擋住';
  return null;
}

export function build(s: GameState, tile: number, kind: BuildKind): CommandResult {
  const err = buildError(s, tile, kind);
  if (err) return fail(err);
  const w = s.world;
  s.ore -= BUILD[kind].cost;
  if (kind === 'trap') w.trap[tile] = 1;
  else {
    w.kind[tile] = kind === 'wall' ? T_WALL : T_TURRET;
    w.hp[tile] = BUILD[kind].hp;
    w.trap[tile] = 0;
    if (kind === 'turret') s.towers[tile] = { cd: 0, angle: Math.PI / 2 };
    markDirty(s);
    if (s.drone.path.includes(tile)) s.drone.path = [];
  }
  s.stats.built += 1;
  sink({ t: 'built', tile, kind });
  return { ok: true };
}

export function demolish(s: GameState, tile: number): CommandResult {
  const b = busy(s);
  if (b) return fail(b);
  const w = s.world;
  if (tile < 0) return fail('這裡沒有可拆的建築');
  const d = s.drone;
  if (Math.hypot(tileX(tile) + 0.5 - d.x, tileY(tile) + 0.5 - d.y) > BUILD_RANGE) return fail(`太遠了（${BUILD_RANGE} 格內）`);
  const k = w.kind[tile];
  let refund = 0;
  if (isStructure(k)) {
    refund = Math.floor(BUILD[k === T_WALL ? 'wall' : 'turret'].cost * DEMOLISH_REFUND);
    w.kind[tile] = T_EMPTY;
    w.hp[tile] = 0;
    delete s.towers[tile];
    markDirty(s);
  } else if (w.trap[tile]) {
    refund = Math.floor(BUILD.trap.cost * DEMOLISH_REFUND);
    w.trap[tile] = 0;
  } else return fail('這裡沒有可拆的建築');
  s.ore += refund;
  sink({ t: 'toast', text: `已拆除，退回 ${refund} 礦石`, tone: 'info' });
  return { ok: true };
}

// ---- Base: upgrades, relic loadout ---------------------------------------------------

export function buyUpgrade(s: GameState, id: UpgradeId): CommandResult {
  const lv = s.upgrades[id];
  const cost = UPGRADES[id].costs[lv];
  if (cost === undefined) return fail('已滿級');
  if (s.ore < cost) return fail(`礦石不足（需要 ${cost}）`);
  s.ore -= cost;
  s.upgrades[id] += 1;
  if (id === 'shield') s.drone.shield += UPGRADES.shield.step;
  if (id === 'base') s.base.hp += UPGRADES.base.step;
  return { ok: true };
}

export const repairCost = (s: GameState) => Math.ceil((maxBaseHp(s) - s.base.hp) / 10);

export function repairBase(s: GameState): CommandResult {
  const cost = repairCost(s);
  if (cost <= 0) return fail('核心沒有損傷');
  const pay = Math.min(cost, s.ore);
  if (pay <= 0) return fail('礦石不足');
  s.ore -= pay;
  s.base.hp = Math.min(maxBaseHp(s), s.base.hp + pay * 10);
  return { ok: true };
}

export function equipRelic(s: GameState, r: RelicId): CommandResult {
  if (!s.relics.found.includes(r) || s.relics.equipped.includes(r)) return fail('無法裝備');
  if (s.relics.equipped.length >= 3) return fail('欄位已滿，先卸下一件');
  s.relics.equipped.push(r);
  return { ok: true };
}

export function unequipRelic(s: GameState, r: RelicId): void {
  const i = s.relics.equipped.indexOf(r);
  if (i < 0) return;
  s.relics.equipped.splice(i, 1);
  unequipped(s, r);
}

/** Removing a relic cancels everything it was doing. */
function unequipped(s: GameState, r: RelicId): void {
  if (r === 'capacitor') s.cap = { count: 0, cd: 0 };
  if (r === 'repulsor') s.repCd = 0;
  if (r === 'bio') s.bio = 0;
}

/** Activate a relic site. `equip` is 'add' (free slot), 'keep' (collection only) or the relic to swap out. */
export function activateSite(s: GameState, site: number, equip: 'add' | 'keep' | RelicId): void {
  const p = s.sites[site];
  if (p.activated) return;
  p.activated = true;
  if (!s.relics.found.includes(p.relic)) s.relics.found.push(p.relic);
  if (equip === 'add' && s.relics.equipped.length < 3) s.relics.equipped.push(p.relic);
  else if (equip !== 'add' && equip !== 'keep') {
    const i = s.relics.equipped.indexOf(equip);
    if (i >= 0) {
      s.relics.equipped[i] = p.relic;
      unequipped(s, equip);
    }
  }
  sink({ t: 'relic', relic: p.relic, x: p.x + 0.5, y: p.y + 0.5 });
  emit(s, { type: 'relicActivated', relic: p.relic, site });
  addThreat(s, THREAT.relic, '遺跡啟動', 'relic');
}

export function addThreat(s: GameState, amount: number, text: string, key: 'relic' | 'chain'): void {
  s.threat[key] += amount;
  sink({ t: 'threat', amount, text });
}

// ---- Events and relic effects ---------------------------------------------------------

function emit(s: GameState, ev: GameEvent): void {
  if (ev.type === 'tileDestroyed') {
    if (ev.source === 'monster') return;
    if (has(s, 'capacitor')) s.cap.count = Math.min(CAPACITOR.tiles, s.cap.count + 1);
    if (ev.source === 'drill' && ev.dir >= 0 && has(s, 'resonance')) resonate(s, ev.tile, ev.dir, ev.hard);
    if (ev.wasOre && ev.source !== 'chain' && has(s, 'detonator')) startChain(s, ev.tile);
  } else if (ev.type === 'enemyKilled') {
    if (has(s, 'bio')) {
      s.bio = BIO.duration;
      first(s, 'bio');
    }
  }
}

function first(s: GameState, r: RelicId): void {
  if (s.firstUse.includes(r)) return;
  s.firstUse.push(r);
  sink({ t: 'first', relic: r });
  sink({ t: 'toast', text: `${RELICS[r].name}生效`, tone: 'good' });
}

function resonate(s: GameState, tile: number, dir: number, hard: number): void {
  const x = tileX(tile) + DIRS[dir][0], y = tileY(tile) + DIRS[dir][1];
  if (!inBounds(x, y)) return;
  const behind = idx(x, y);
  if (!isRock(s.world.kind[behind])) return;
  first(s, 'resonance');
  sink({ t: 'link', from: tile, to: behind, kind: 'resonance' });
  s.world.hp[behind] -= ROCK_HP[hard];
  if (s.world.hp[behind] <= 1e-9) destroyTile(s, behind, 'resonance', -1);
}

function startChain(s: GameState, origin: number): void {
  const { kind } = s.world;
  const chain = s.nextChain++;
  const seen = new Set([origin]);
  const queue: { tile: number; from: number }[] = [{ tile: origin, from: -1 }];
  const hits: typeof queue = [];
  for (let q = 0; q < queue.length && hits.length < CHAIN.max; q++) {
    const cur = queue[q];
    if (cur.tile !== origin) hits.push(cur);
    for (const n of neighbors(cur.tile)) {
      if (!seen.has(n) && kind[n] === T_ORE) {
        seen.add(n);
        queue.push({ tile: n, from: cur.tile });
      }
    }
  }
  if (!hits.length) return;
  hits.forEach((h, i) => s.pending.push({ at: s.time + (i + 1) * CHAIN.delay, tile: h.tile, from: h.from, chain }));
  first(s, 'detonator');
  addThreat(s, THREAT.chain, '礦脈連鎖', 'chain');
}

export function destroyTile(s: GameState, tile: number, source: Source, dir: number): void {
  const w = s.world;
  const k = w.kind[tile];
  if (!isRock(k)) return;
  const ore = source === 'monster' ? 0 : w.ore[tile];
  const hard = w.hard[tile];
  w.kind[tile] = T_EMPTY;
  w.hp[tile] = 0;
  w.ore[tile] = 0;
  markDirty(s);
  if (source !== 'monster') {
    s.ore += ore;
    s.stats.oreMined += ore;
    s.stats.tilesDug += 1;
  }
  sink({ t: 'break', tile, source, ore });
  emit(s, { type: 'tileDestroyed', tile, source, ore, wasOre: k === T_ORE, hard, dir });
}

function damageEnemy(s: GameState, e: Enemy, dmg: number): void {
  e.hp -= dmg;
  e.hit = 0.15;
  if (e.hp > 0) return;
  const i = s.enemies.indexOf(e);
  if (i < 0) return;
  s.enemies.splice(i, 1);
  s.stats.kills += 1;
  sink({ t: 'kill', x: e.x, y: e.y, kind: e.kind });
  emit(s, { type: 'enemyKilled', kind: e.kind, x: e.x, y: e.y });
}

/** Push a monster up to `push` tiles away from the miner along open tiles; walls stop it. */
function knock(s: GameState, e: Enemy, push: number, stun: number): void {
  const d = s.drone;
  const ax = e.x - d.x, ay = e.y - d.y;
  const start = tileOf(e.x, e.y);
  const order = DIRS.map((v, i) => ({ i, dot: v[0] * ax + v[1] * ay }))
    .filter((o) => o.dot > 0 || (ax === 0 && ay === 0))
    .sort((a, b) => b.dot - a.dot);
  let end = start;
  for (const o of order) {
    let cur = start;
    for (let k = 0; k < push; k++) {
      const x = tileX(cur) + DIRS[o.i][0], y = tileY(cur) + DIRS[o.i][1];
      if (!inBounds(x, y) || !isWalkable(s.world.kind[idx(x, y)])) break;
      cur = idx(x, y);
    }
    if (cur !== start) { end = cur; break; }
  }
  e.kb = { fx: e.x, fy: e.y, tx: tileX(end) + 0.5, ty: tileY(end) + 0.5, t: 0 };
  e.stun = Math.max(e.stun, stun);
}

function lineOfSight(s: GameState, x1: number, y1: number, x2: number, y2: number, from = -1): boolean {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 4);
  for (let k = 1; k < steps; k++) {
    const t = tileOf(x1 + ((x2 - x1) * k) / steps, y1 + ((y2 - y1) * k) / steps);
    if (t !== from && !isWalkable(s.world.kind[t])) return false;
  }
  return true;
}

function nearestEnemy(s: GameState, x: number, y: number, range: number, from = -1): Enemy | null {
  let best: Enemy | null = null;
  let bd = Infinity;
  for (const e of s.enemies) {
    const dd = Math.hypot(e.x - x, e.y - y);
    if (dd <= range && dd < bd && lineOfSight(s, x, y, e.x, e.y, from)) { best = e; bd = dd; }
  }
  return best;
}

function spawn(s: GameState, x: number, y: number, kind: EnemyKind, hpMult: number): void {
  const hp = ENEMY[kind].hp * hpMult;
  s.enemies.push({ id: s.nextEnemy++, kind, x: x + 0.5, y: y + 0.5, hp, maxHp: hp, stun: 0, kb: null, hit: 0, chew: 0 });
  sink({ t: 'spawn', x: x + 0.5, y: y + 0.5 });
}

function reveal(s: GameState): void {
  const w = s.world;
  const d = s.drone;
  const cx = Math.floor(d.x), cy = Math.floor(d.y);
  const lens = has(s, 'lens');
  const r = Math.ceil(lens ? LENS_RANGE : VISION);
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (!inBounds(x, y)) continue;
      const dd = (x - cx) ** 2 + (y - cy) ** 2;
      const i = idx(x, y);
      if (dd <= VISION * VISION) w.seen[i] = 1;
      if (lens && dd <= LENS_RANGE * LENS_RANGE && !w.scan[i]) {
        const k = w.kind[i];
        if (k === T_ORE || k === T_RELIC || k === T_RIFT) {
          w.scan[i] = 1;
          if (!w.seen[i]) first(s, 'lens');
        }
      }
    }
  }
}

function respawn(s: GameState): void {
  const d = s.drone;
  d.x = SPAWN.x + 0.5;
  d.y = SPAWN.y + 0.5;
  d.path = [];
  d.dig = -1;
  d.hold = false;
  d.commit = false;
  d.approach = -1;
  d.recall = -1;
  d.face = 2;
}

function coreFall(s: GameState): void {
  const lost = Math.floor(s.ore * BASE.fallLoss);
  s.ore -= lost;
  s.enemies = [];
  s.base.hp = Math.round(maxBaseHp(s) * BASE.fallRestore);
  s.wave.toSpawn = 0;
  s.wave.active = false;
  s.wave.timer = Math.max(s.wave.timer, WAVE.interval);
  s.wave.announced = false;
  s.stats.coreFalls += 1;
  sink({ t: 'fall' });
  sink({ t: 'toast', text: `基地核心失守：損失 ${lost} 礦石，核心緊急修復到 ${Math.round(BASE.fallRestore * 100)}%`, tone: 'warn' });
  emit(s, { type: 'coreFell' });
}

// ---- Step -----------------------------------------------------------------------------

export function step(s: GameState, dt: number): void {
  const d = s.drone;
  const w = s.world;
  s.time += dt;
  d.pulseCd = Math.max(0, d.pulseCd - dt);
  d.gunCd = Math.max(0, d.gunCd - dt);
  d.hurt = Math.max(0, d.hurt - dt);
  s.cap.cd = Math.max(0, s.cap.cd - dt);
  s.repCd = Math.max(0, s.repCd - dt);
  s.bio = Math.max(0, s.bio - dt);

  // Scheduled chain hits.
  if (s.pending.length) {
    const due = s.pending.filter((p) => p.at <= s.time);
    if (due.length) {
      s.pending = s.pending.filter((p) => p.at > s.time);
      for (const p of due) {
        if (w.kind[p.tile] !== T_ORE) continue;
        if (p.from >= 0) sink({ t: 'link', from: p.from, to: p.tile, kind: 'chain' });
        w.hp[p.tile] -= CHAIN.damage;
        if (w.hp[p.tile] <= 1e-9) destroyTile(s, p.tile, 'chain', -1);
      }
    }
  }

  // The miner: respawn, recall, move, dig.
  if (d.dead >= 0) {
    d.dead -= dt;
    if (d.dead < 0) {
      respawn(s);
      d.shield = maxShield(s);
      sink({ t: 'respawn' });
    }
  } else if (d.recall >= 0) {
    d.recall += dt;
    if (d.recall >= RECALL_TIME) {
      respawn(s);
      sink({ t: 'recall', on: false });
      sink({ t: 'toast', text: '已回到基地', tone: 'good' });
    }
  } else if (d.path.length) {
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
    const here = droneTile(s);
    if (d.approach >= 0) {
      const t = d.approach;
      d.approach = -1;
      if (dirBetween(here, t) >= 0) {
        d.face = dirBetween(here, t);
        if (w.kind[t] === T_BASE) s.prompt = { kind: 'base' };
        else if (w.kind[t] === T_RELIC) {
          const site = s.sites.findIndex((p) => idx(p.x, p.y) === t);
          if (site >= 0 && !s.sites[site].activated) s.prompt = { kind: 'site', site };
        }
      }
    }
    if (d.dig >= 0) {
      const t = d.dig;
      if (!isDiggable(w.kind[t])) {
        d.dig = -1;
        d.commit = false;
      } else if (!d.hold && !d.commit) {
        d.dig = -1;
      } else {
        const dir = dirBetween(here, t);
        if (dir < 0) {
          const stand = standTile(s, t);
          const path = stand >= 0 ? pathTo(s, stand) : null;
          if (!path) {
            d.dig = -1;
            d.commit = false;
            sink({ t: 'unreachable', tile: t });
          } else d.path = path;
        } else {
          d.face = dir;
          d.swing += dt;
          const dmg = DIG_DPS * drillMult(s) * (s.bio > 0 ? BIO.mult : 1) * dt;
          sink({ t: 'dig', tile: t });
          w.hp[t] -= dmg;
          if (w.hp[t] <= 1e-9) {
            destroyTile(s, t, 'drill', dir);
            d.commit = false;
            if (!d.hold) d.dig = -1;
          }
        }
      }
    }
  }
  if (d.dead < 0) {
    s.maxDepth = Math.max(s.maxDepth, Math.floor(d.y));
    reveal(s);
  }

  // Waves.
  const wv = s.wave;
  wv.timer -= dt;
  if (!wv.announced && wv.timer <= WAVE.warn) {
    wv.announced = true;
    sink({ t: 'quake' });
    sink({ t: 'toast', text: `地心震動：第 ${wv.n + 1} 波 ${WAVE.warn} 秒後湧出`, tone: 'threat' });
  }
  if (wv.timer <= 0) {
    const threat = threatOf(s);
    wv.n += 1;
    wv.toSpawn += waveSize(wv.n, threat);
    wv.hpMult = 1 + WAVE.hpGrowth * (wv.n - 1);
    wv.armoredEvery = armoredEvery(wv.n, threat);
    wv.spawnT = 0;
    wv.active = true;
    wv.timer = WAVE.interval;
    wv.announced = false;
    sink({ t: 'wave', n: wv.n });
  }
  if (wv.toSpawn > 0) {
    wv.spawnT -= dt;
    if (wv.spawnT <= 0 && s.enemies.length < MAX_ENEMIES) {
      wv.spawnT = WAVE.gap;
      const r = s.rifts[wv.spawned % s.rifts.length];
      const armored = wv.armoredEvery > 0 && (wv.spawned + 1) % wv.armoredEvery === 0;
      spawn(s, r.x, r.y, armored ? 'armored' : 'crawler', wv.hpMult);
      wv.spawned += 1;
      wv.toSpawn -= 1;
    }
  }

  // Monsters.
  const pd = distMap(s);
  const here = droneTile(s);
  const hx = tileX(here), hy = tileY(here);
  const alive = d.dead < 0;
  for (const e of [...s.enemies]) {
    e.hit = Math.max(0, e.hit - dt);
    e.chew = Math.max(0, e.chew - dt);
    if (e.kb) {
      e.kb.t = Math.min(1, e.kb.t + dt / 0.18);
      const k = 1 - (1 - e.kb.t) ** 2;
      e.x = e.kb.fx + (e.kb.tx - e.kb.fx) * k;
      e.y = e.kb.fy + (e.kb.ty - e.kb.fy) * k;
      if (e.kb.t >= 1) e.kb = null;
      continue;
    }
    if (e.stun > 0) {
      e.stun -= dt;
      continue;
    }
    if (w.trap[tileOf(e.x, e.y)]) {
      damageEnemy(s, e, TRAP_DPS * dt);
      if (e.hp <= 0) continue;
    }
    const def = ENEMY[e.kind];
    const et = tileOf(e.x, e.y);
    const ex = tileX(et), ey = tileY(et);
    let tx: number, ty: number, stop = 0;
    const aggro = alive && Math.hypot(e.x - d.x, e.y - d.y) <= AGGRO && pd[et] >= 0 && pd[et] <= 6;
    if (aggro && Math.abs(ex - hx) + Math.abs(ey - hy) <= 1) {
      tx = d.x; ty = d.y; stop = 0.55;
    } else if (aggro) {
      let next = -1;
      for (const nb of neighbors(et)) if (pd[nb] >= 0 && pd[nb] < pd[et] && (next < 0 || pd[nb] < pd[next])) next = nb;
      if (next < 0) continue;
      tx = tileX(next) + 0.5; ty = tileY(next) + 0.5;
    } else {
      const next = nextStep(s, et);
      if (next < 0) continue;
      const nk = w.kind[next];
      if (isWalkable(nk)) {
        tx = tileX(next) + 0.5; ty = tileY(next) + 0.5;
      } else {
        // Blocked: settle on the tile centre, then chew or smash what is in the way.
        const cx = ex + 0.5, cy = ey + 0.5;
        const off = Math.hypot(cx - e.x, cy - e.y);
        if (off > 0.05) {
          const mv = Math.min(def.speed * dt, off);
          e.x += ((cx - e.x) / off) * mv;
          e.y += ((cy - e.y) / off) * mv;
          continue;
        }
        e.chew = 0.2;
        if (nk === T_BASE) {
          s.base.hp -= def.smash * dt;
          if (Math.random() < dt * 2) sink({ t: 'baseHit' });
        } else if (isRock(nk)) {
          w.hp[next] -= def.burrow * dt;
          if (w.hp[next] <= 1e-9) destroyTile(s, next, 'monster', -1);
        } else if (isStructure(nk)) {
          w.hp[next] -= def.smash * dt;
          if (w.hp[next] <= 0) {
            w.kind[next] = T_EMPTY;
            w.hp[next] = 0;
            delete s.towers[next];
            markDirty(s);
            sink({ t: 'smashed', tile: next });
          }
        }
        continue;
      }
    }
    const dx = tx - e.x, dy = ty - e.y;
    const len = Math.hypot(dx, dy);
    if (len <= stop) continue;
    const mv = Math.min(def.speed * dt, len - stop);
    e.x += (dx / len) * mv;
    e.y += (dy / len) * mv;
  }

  // Turrets.
  const tm = towerMult(s);
  for (const key of Object.keys(s.towers)) {
    const t = Number(key);
    if (w.kind[t] !== T_TURRET) {
      delete s.towers[t];
      continue;
    }
    const tw = s.towers[t];
    tw.cd = Math.max(0, tw.cd - dt);
    const x = tileX(t) + 0.5, y = tileY(t) + 0.5;
    const target = nearestEnemy(s, x, y, TOWER.range, t);
    if (!target) continue;
    tw.angle = Math.atan2(target.y - y, target.x - x);
    if (tw.cd > 0) continue;
    tw.cd = TOWER.interval;
    sink({ t: 'shot', x1: x, y1: y, x2: target.x, y2: target.y, tower: true });
    damageEnemy(s, target, TOWER.damage * tm);
  }

  if (alive) {
    // The miner's own gun.
    const near = nearestEnemy(s, d.x, d.y, GUN.range);
    if (near && d.gunCd <= 0) {
      d.gunCd = GUN.interval;
      sink({ t: 'shot', x1: d.x, y1: d.y, x2: near.x, y2: near.y, tower: false });
      damageEnemy(s, near, GUN.damage);
    }
    if (has(s, 'capacitor') && s.cap.count >= CAPACITOR.tiles && s.cap.cd <= 0) {
      s.cap.count -= CAPACITOR.tiles;
      s.cap.cd = CAPACITOR.cooldown;
      first(s, 'capacitor');
      sink({ t: 'ring', x: d.x, y: d.y, r: CAPACITOR.radius, kind: 'cap' });
      for (const e of [...s.enemies]) if (Math.hypot(e.x - d.x, e.y - d.y) <= CAPACITOR.radius + 0.3) damageEnemy(s, e, CAPACITOR.damage);
    }
    if (has(s, 'repulsor') && s.repCd <= 0) {
      const inRange = s.enemies.filter((e) => Math.hypot(e.x - d.x, e.y - d.y) <= REPULSOR.radius);
      if (inRange.length) {
        s.repCd = REPULSOR.interval;
        first(s, 'repulsor');
        for (const e of inRange) knock(s, e, REPULSOR.push, 0.3);
        sink({ t: 'ring', x: d.x, y: d.y, r: REPULSOR.radius, kind: 'rep' });
      }
    }
    // Contact damage. At zero the probe breaks down and is rebuilt at the base.
    for (const e of s.enemies) {
      if (Math.hypot(e.x - d.x, e.y - d.y) < CONTACT && !e.kb) {
        d.shield -= ENEMY[e.kind].dps * dt;
        if (d.hurt <= 0) sink({ t: 'hurt' });
        d.hurt = 0.25;
      }
    }
    if (d.shield <= 0) {
      d.shield = 0;
      d.dead = RESPAWN_TIME;
      d.path = [];
      d.dig = -1;
      d.hold = false;
      d.recall = -1;
      s.stats.deaths += 1;
      sink({ t: 'death' });
      sink({ t: 'toast', text: `探機損毀，${RESPAWN_TIME} 秒後在基地重建`, tone: 'warn' });
    }
  }

  if (s.base.hp <= 0) coreFall(s);
  if (wv.active && wv.toSpawn === 0 && s.enemies.length === 0) {
    wv.active = false;
    const bonus = waveBonus(wv.n);
    s.ore += bonus;
    s.stats.bestWave = Math.max(s.stats.bestWave, wv.n);
    sink({ t: 'toast', text: `第 ${wv.n} 波已擊退：補給 +${bonus} 礦石`, tone: 'good' });
    emit(s, { type: 'waveCleared', n: wv.n });
  }
}
