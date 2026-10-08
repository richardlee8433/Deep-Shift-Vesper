// Headless checks for the dig prototype (plan §12). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_H, MAP_W, ROCK_HP, STEP } from '../src/dig/config';
import { buildWorld, DIRS, idx, inBounds, T_BEDROCK, T_EMPTY, T_ORE, T_ROCK, zoneOf } from '../src/dig/map';
import { activateSite, distMap, droneTile, press, release, steer, step, takeCore, tileX, tileY, toggleEvac, usePulse } from '../src/dig/sim';
import { newMeta, newRun, settle, type RunState } from '../src/dig/state';
import { Game } from '../src/dig/game';

const run_ = (meta = newMeta()) => newRun(meta, 1234);

function run(r: RunState, seconds: number) {
  for (let t = 0; t < seconds; t += STEP) {
    const res = step(r, STEP);
    if (res) return res;
  }
  return null;
}

/** BFS through rock (not bedrock or objects) from the probe to a tile next to `goal`. */
function digRoute(r: RunState, goal: number): number[] {
  const { kind } = r.world;
  const start = droneTile(r);
  const prev = new Map<number, number>([[start, -1]]);
  const q = [start];
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    const x = c % MAP_W, y = Math.floor(c / MAP_W);
    for (const [dx, dy] of DIRS) {
      if (!inBounds(x + dx, y + dy)) continue;
      const n = idx(x + dx, y + dy);
      if (n === goal) {
        const path = [c];
        let p = prev.get(c)!;
        while (p >= 0) { path.push(p); p = prev.get(p)!; }
        return path.reverse().slice(1);
      }
      if (prev.has(n)) continue;
      if (kind[n] === T_EMPTY || kind[n] === T_ROCK || kind[n] === T_ORE) { prev.set(n, c); q.push(n); }
    }
  }
  return [];
}

/** Drive the probe along a route, digging whatever is in the way. */
function follow(r: RunState, route: number[]) {
  for (const t of route) {
    if (r.world.kind[t] !== T_EMPTY) {
      assert.ok(press(r, t).ok, `dig ${tileX(t)},${tileY(t)}`);
      release(r, true); // tap: commit to this tile
      for (let i = 0; i < 60 * 20 && r.world.kind[t] !== T_EMPTY; i++) assert.equal(step(r, STEP), null);
      assert.equal(r.world.kind[t], T_EMPTY, 'tile broke');
    }
    assert.ok(press(r, t).ok);
    for (let i = 0; i < 60 * 10 && droneTile(r) !== t; i++) step(r, STEP);
    for (let i = 0; i < 30; i++) step(r, STEP);
  }
}

test('map: a route to the core exists with base equipment only', () => {
  const w = buildWorld();
  const r = run_();
  const core = idx(w.core.x, w.core.y);
  const route = digRoute(r, core);
  assert.ok(route.length > 0, 'core reachable by digging');
  // Bedrock never lies on that route.
  assert.ok(route.every((t) => w.kind[t] !== T_BEDROCK));
  assert.equal(w.sites.length, 4);
  assert.equal(w.nests.length, 2);
});

test('map: no bedrock or open caves; one rock hardness per zone, 30% harder each zone', () => {
  const w = buildWorld();
  for (let i = 0; i < w.kind.length; i++) {
    const y = Math.floor(i / MAP_W);
    assert.notEqual(w.kind[i], T_BEDROCK);
    if (w.kind[i] === T_EMPTY) assert.ok(y <= 1, 'only the entrance is open');
    if (w.kind[i] === T_ROCK || w.kind[i] === T_ORE) {
      assert.equal(w.hard[i], zoneOf(y));
      assert.equal(w.hp[i], ROCK_HP[zoneOf(y)]);
    }
  }
  assert.equal(ROCK_HP[0], 1);
  assert.ok(Math.abs(ROCK_HP[1] / ROCK_HP[0] - 1.3) < 1e-9);
  assert.ok(Math.abs(ROCK_HP[2] / ROCK_HP[1] - 1.3) < 1e-9);
});

test('holding a direction key tunnels straight that way', () => {
  const r = run_();
  const start = droneTile(r);
  for (let i = 0; i < 60 * 4; i++) {
    steer(r, 2, i === 0); // S
    step(r, STEP);
  }
  release(r, false);
  for (let i = 0; i < 60 && r.drone.path.length; i++) step(r, STEP); // finish the last step
  const x = tileX(start);
  for (let y = tileY(start) + 1; y <= tileY(start) + 4; y++) assert.equal(r.world.kind[idx(x, y)], T_EMPTY, `dug ${x},${y}`);
  assert.ok(tileY(droneTile(r)) >= tileY(start) + 4, 'probe followed the tunnel');
  assert.equal(r.drone.face, 2);
  // Turning: D digs to the right of where the probe now stands.
  const here = droneTile(r);
  for (let i = 0; i < 60; i++) { steer(r, 1, i === 0); step(r, STEP); }
  assert.equal(r.world.kind[here + 1], T_EMPTY);
});

test('base loadout can dig to the core, take it and evacuate', () => {
  const meta = newMeta();
  const r = newRun(meta, 99);
  const core = idx(r.core.x, r.core.y);
  follow(r, digRoute(r, core));
  assert.ok(press(r, core).ok);
  run(r, 2);
  assert.deepEqual(r.prompt, { kind: 'core' });
  r.prompt = null;
  takeCore(r);
  toggleEvac(r);
  const res = run(r, 10);
  assert.equal(res?.result, 'success');
  const sum = settle(meta, r, 'success', 'ok');
  assert.ok(sum?.core);
  assert.equal(meta.cores, 1);
  console.log(`  bot reached the core in ${r.time.toFixed(0)} s, dug ${r.stats.tilesDug} tiles, ore ${r.ore}`);
});

test('enemies never stand inside rock', () => {
  const r = run_();
  // Open a corridor and drop crawlers in; walk them around for a while.
  const route = digRoute(r, idx(r.sites[0].x, r.sites[0].y));
  follow(r, route);
  for (let i = 0; i < 4; i++) {
    const t = route[Math.max(0, route.length - 6 - i)];
    r.enemies.push({ id: 100 + i, kind: 'crawler', x: tileX(t) + 0.5, y: tileY(t) + 0.5, hp: 1e9, stun: 0, kb: null, hit: 0 });
  }
  r.drone.shield = 1e9;
  for (let s = 0; s < 60 * 30; s++) {
    if (s % 240 === 0) usePulse(r);
    if (s % 300 === 0) r.drone.pulseCd = 0;
    step(r, STEP);
    for (const e of r.enemies) assert.equal(r.world.kind[idx(Math.floor(e.x), Math.floor(e.y))], T_EMPTY, 'enemy in open tile');
  }
});

test('a sealed nest never reaches the probe', () => {
  const r = run_();
  r.nests[0].state = 'awake';
  run(r, 60);
  assert.equal(r.enemies.length, 0, 'disconnected nest does not spawn');
  assert.equal(r.nests[0].armed, false);
});

test('replacing a relic removes its effect', () => {
  const meta = newMeta();
  const r = newRun(meta, 5);
  r.equipped = ['resonance', 'lens', 'capacitor'];
  // Find a straight run of two rock tiles under the probe.
  const below = idx(11, 2), behind = idx(11, 3);
  r.world.kind[below] = T_ROCK; r.world.hard[below] = 0; r.world.hp[below] = 1;
  r.world.kind[behind] = T_ROCK; r.world.hard[behind] = 0; r.world.hp[behind] = 1;
  const site = 1;
  r.sites[site].relic = 'repulsor';
  activateSite(r, meta, site, 'resonance');
  assert.deepEqual(r.equipped, ['repulsor', 'lens', 'capacitor']);
  assert.ok(r.spent.includes('resonance'));
  press(r, below); release(r, true);
  run(r, 2);
  assert.equal(r.world.kind[below], T_EMPTY);
  assert.equal(r.world.kind[behind], T_ROCK, 'no resonance hit after replacement');
  assert.equal(r.world.hp[behind], 1);
});

test('resonance hits exactly one tile behind', () => {
  const r = run_();
  r.equipped = ['resonance'];
  for (let y = 2; y <= 5; y++) { const t = idx(11, y); r.world.kind[t] = T_ROCK; r.world.hard[t] = 0; r.world.hp[t] = 1; }
  press(r, idx(11, 2)); release(r, true);
  run(r, 1);
  assert.equal(r.world.kind[idx(11, 2)], T_EMPTY);
  assert.equal(r.world.kind[idx(11, 3)], T_EMPTY, 'one extra');
  assert.equal(r.world.kind[idx(11, 4)], T_ROCK, 'no second penetration');
  assert.equal(r.world.hp[idx(11, 4)], 1);
});

test('chains stop at 6 tiles, add threat once and terminate', () => {
  const r = run_();
  r.equipped = ['detonator', 'resonance', 'capacitor'];
  // A 6×4 slab of ore under the entrance.
  for (let y = 2; y <= 5; y++) for (let x = 8; x <= 13; x++) {
    const t = idx(x, y); r.world.kind[t] = T_ORE; r.world.hard[t] = 0; r.world.hp[t] = 1; r.world.ore[t] = 1;
  }
  const before = r.stats.tilesDug;
  press(r, idx(11, 2)); release(r, true);
  run(r, 3);
  assert.equal(r.pending.length, 0, 'queue drained');
  // drill + resonance each start one chain of ≤ 6.
  assert.ok(r.stats.chains <= 2 && r.stats.chains >= 1);
  assert.equal(r.threat, 3 * r.stats.chains);
  assert.ok(r.stats.tilesDug - before <= 2 + 6 * r.stats.chains);
});

test('pausing does not advance cooldowns or the run clock', () => {
  const g = new Game(newMeta());
  g.startRun(42);
  const r = g.run!;
  usePulse(r);
  const cd = r.drone.pulseCd;
  g.pause('menu');
  g.tick(5);
  assert.equal(r.drone.pulseCd, cd);
  assert.equal(r.time, 0);
  g.resume('menu');
  g.tick(1);
  assert.ok(r.drone.pulseCd < cd);
});

test('settling twice pays once; reloading a settled run is refused', () => {
  const meta = newMeta();
  const r = run_(meta);
  r.ore = 21;
  settle(meta, r, 'success', 'x');
  settle(meta, r, 'success', 'x');
  assert.equal(meta.ore, 21);
  assert.equal(meta.runs, 1);
});

test('failure halves ore and loses new blueprints but keeps old ones and the tutorial backup', () => {
  const meta = newMeta();
  meta.unlocked = ['lens'];
  const r = newRun(meta, 7);
  // Tutorial site gives resonance and is backed up immediately.
  assert.equal(r.sites[0].relic, 'resonance');
  activateSite(r, meta, 0, 'add');
  assert.ok(meta.unlocked.includes('resonance'));
  r.sites[1].relic = 'bio';
  activateSite(r, meta, 1, 'add');
  r.ore = 15;
  const sum = settle(meta, r, 'fail', 'x')!;
  assert.equal(meta.ore, 7);
  assert.deepEqual(sum.lost, ['bio']);
  assert.ok(meta.unlocked.includes('lens'));
  assert.ok(meta.unlocked.includes('resonance'));
  assert.ok(!meta.unlocked.includes('bio'));
});

test('relic draws never repeat and skip the starting relic', () => {
  const meta = newMeta();
  meta.unlocked = ['resonance', 'lens'];
  meta.startRelic = 'lens';
  for (let s = 0; s < 20; s++) {
    const r = newRun(meta, s);
    const relics = r.sites.map((x) => x.relic);
    assert.equal(new Set(relics).size, relics.length);
    assert.ok(!relics.includes('lens'));
    assert.deepEqual(r.equipped, ['lens']);
  }
});

test('awakened nest warns, then spawns once connected; enemies are capped', () => {
  const r = run_();
  const n = r.nests[0];
  n.state = 'awake';
  // Connect the nest's cave to the probe with a straight carved shaft.
  for (let y = 2; y <= n.y; y++) r.world.kind[idx(11, y)] = y === n.y ? r.world.kind[idx(11, y)] : T_EMPTY;
  for (let y = 0; y < MAP_H; y++) if (r.world.kind[idx(11, y)] === T_BEDROCK) r.world.kind[idx(11, y)] = T_EMPTY;
  distMap(r);
  r.drone.shield = 1e9;
  r.threat = 100;
  step(r, STEP);
  assert.ok(n.armed);
  assert.equal(r.enemies.length, 0, 'warning first');
  run(r, 3.1);
  assert.equal(r.enemies.length, 1);
  r.drone.turretCd = 1e9; // stop the turret so enemies pile up
  run(r, 200);
  assert.ok(r.enemies.length <= 6);
  assert.ok(r.enemies.some((e) => e.kind === 'armored'));
});
