// Headless checks for the base-defence simulation. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILD, MAP_H, MAP_W, ROCK_HP, STEP, WAVE, waveSize } from '../src/dig/config';
import {
  BASE_POS, buildWorld, idx, isWalkable, RIFTS, SITES, SPAWN, T_EMPTY, T_ORE, T_RELIC, T_RIFT, T_ROCK, T_TURRET, T_WALL, zoneOf,
} from '../src/dig/map';
import {
  activateSite, build, demolish, droneTile, equipRelic, markDirty, monsterField, press, release, routeFrom, steer, step,
  tileX, tileY, turretCoverage, unequipRelic, usePulse,
} from '../src/dig/sim';
import { maxBaseHp, newGame, parseSave, threatOf, type GameState } from '../src/dig/state';
import { Game } from '../src/dig/game';

const run = (s: GameState, seconds: number) => {
  for (let t = 0; t < seconds; t += STEP) step(s, STEP);
};
const carve = (s: GameState, tiles: [number, number][]) => {
  for (const [x, y] of tiles) {
    const i = idx(x, y);
    s.world.kind[i] = T_EMPTY;
    s.world.hp[i] = 0;
    s.world.seen[i] = 1;
  }
  markDirty(s);
};
const quiet = (s: GameState) => { s.wave.timer = 1e9; }; // no waves unless a test wants them

test('world: solid rock with one hardness per zone, base chamber, sites and rifts', () => {
  const w = buildWorld();
  for (let i = 0; i < w.kind.length; i++) {
    const y = Math.floor(i / MAP_W);
    if (w.kind[i] === T_ROCK || w.kind[i] === T_ORE) assert.equal(w.hp[i], ROCK_HP[zoneOf(y)]);
  }
  assert.ok(Math.abs(ROCK_HP[1] / ROCK_HP[0] - 1.3) < 1e-9 && Math.abs(ROCK_HP[2] / ROCK_HP[1] - 1.3) < 1e-9);
  for (const p of SITES) assert.equal(w.kind[idx(p.x, p.y)], T_RELIC);
  for (const r of RIFTS) assert.equal(w.kind[idx(r.x, r.y)], T_RIFT);
  assert.ok(isWalkable(w.kind[idx(SPAWN.x, SPAWN.y)]));
  assert.ok(w.ore.filter((v) => v > 0).length > 60, 'plenty of ore');
});

test('monsters can reach the base from every rift (through rock if they must)', () => {
  const s = newGame(1);
  for (const r of RIFTS) {
    const route = routeFrom(s, idx(r.x, r.y));
    const end = route[route.length - 1];
    assert.ok(tileX(end) >= BASE_POS.x && tileX(end) < BASE_POS.x + 2 && tileY(end) < BASE_POS.y + 2, 'route ends at the base');
  }
});

test('a dug tunnel becomes the monsters\' road', () => {
  const s = newGame(1);
  const rift = RIFTS[1];
  const before = monsterField(s)[idx(rift.x, rift.y)];
  // A straight shaft from the chamber down to just above the rift.
  const shaft: [number, number][] = [];
  for (let y = 4; y < MAP_H - 1; y++) shaft.push([rift.x, y]);
  carve(s, shaft);
  const after = monsterField(s)[idx(rift.x, rift.y)];
  assert.ok(after < before / 3, `cheaper route (${before.toFixed(0)} → ${after.toFixed(0)})`);
  const route = routeFrom(s, idx(rift.x, rift.y));
  assert.ok(route.filter((t) => s.world.kind[t] === T_EMPTY).length > 30, 'route follows the shaft');
});

test('monsters chew up to the base, never stand in rock, and damage the core', () => {
  const s = newGame(1);
  quiet(s);
  s.drone.dead = 1e9; // keep the miner out of it
  const rift = RIFTS[1];
  const shaft: [number, number][] = [];
  for (let y = 4; y < MAP_H - 6; y++) shaft.push([rift.x, y]);
  carve(s, shaft); // 5 rows of rock left above the rift
  s.enemies.push({ id: 1, kind: 'crawler', x: rift.x + 0.5, y: rift.y + 0.5, hp: 1e9, maxHp: 1e9, stun: 0, kb: null, hit: 0, chew: 0 });
  const hp0 = s.base.hp;
  for (let t = 0; t < 120 && s.base.hp === hp0; t += STEP) {
    step(s, STEP);
    for (const e of s.enemies) assert.ok(isWalkable(s.world.kind[idx(Math.floor(e.x), Math.floor(e.y))]), 'monster on open floor');
  }
  assert.ok(s.base.hp < hp0, 'core took damage');
});

test('walls cost monsters time; they smash a wall when it is the only way', () => {
  const s = newGame(1);
  quiet(s);
  s.ore = 100;
  // Corridor right of the chamber; put the miner next to it to build.
  carve(s, [[19, 2], [20, 2], [21, 2], [22, 2]]);
  s.drone.x = 18.5; s.drone.y = 2.5;
  markDirty(s);
  assert.ok(build(s, idx(20, 2), 'wall').ok);
  assert.equal(s.world.kind[idx(20, 2)], T_WALL);
  assert.equal(s.ore, 100 - BUILD.wall.cost);
  s.drone.dead = 1e9;
  s.enemies.push({ id: 1, kind: 'armored', x: 22.5, y: 2.5, hp: 1e9, maxHp: 1e9, stun: 0, kb: null, hit: 0, chew: 0 });
  run(s, 6);
  const wallHp = s.world.hp[idx(20, 2)];
  const rockNear = [idx(21, 1), idx(21, 3)].some((t) => s.world.hp[t] < ROCK_HP[0]);
  assert.ok(wallHp < BUILD.wall.hp || rockNear, 'it attacks the wall or burrows around it');
});

test('building rules: walls and traps on the floor, turrets in the rock wall; demolish refunds half', () => {
  const s = newGame(1);
  s.ore = 20;
  assert.equal(build(s, idx(SPAWN.x, SPAWN.y), 'wall').ok, false, 'not under the miner');
  assert.equal(build(s, idx(SPAWN.x, SPAWN.y + 5), 'wall').ok, false, 'walls not on rock');
  assert.equal(build(s, idx(12, 3), 'turret').ok, false, 'turrets not on the open floor');
  assert.equal(build(s, idx(5, 5), 'turret').ok, false, 'turrets must touch a tunnel');
  assert.ok(build(s, idx(10, 3), 'turret').ok, 'turret set into the chamber wall');
  assert.equal(s.world.kind[idx(10, 3)], T_TURRET);
  assert.equal(s.ore, 5);
  assert.equal(build(s, idx(10, 2), 'turret').ok, false, 'cannot afford');
  assert.ok(build(s, idx(11, 0), 'wall').ok);
  assert.ok(demolish(s, idx(10, 3)).ok);
  assert.equal(s.world.kind[idx(10, 3)], T_ROCK, 'a wall turret leaves rock behind');
  assert.equal(s.ore, 2 + Math.floor(BUILD.turret.cost / 2));
});

test('turrets shoot monsters they can see', () => {
  const s = newGame(1);
  quiet(s);
  s.ore = 50;
  s.drone.x = 17.5; s.drone.y = 2.5;
  step(s, STEP); // look around
  assert.ok(build(s, idx(19, 2), 'turret').ok);
  s.drone.dead = 1e9;
  s.enemies.push({ id: 1, kind: 'crawler', x: 18.5, y: 0.5, hp: 12, maxHp: 12, stun: 0, kb: null, hit: 0, chew: 0 });
  run(s, 3);
  assert.equal(s.enemies.length, 0);
  assert.equal(s.stats.kills, 1);
});

test('a wall turret covers the corridor without blocking it', () => {
  const s = newGame(1);
  quiet(s);
  s.ore = 50;
  const corridor: [number, number][] = [];
  for (let x = 19; x <= 27; x++) corridor.push([x, 2]);
  carve(s, corridor);
  const routeBefore = routeFrom(s, idx(27, 2)).join();
  s.drone.x = 20.5; s.drone.y = 2.5;
  markDirty(s);
  step(s, STEP); // look around
  assert.ok(build(s, idx(22, 1), 'turret').ok, 'set into the corridor ceiling');
  assert.equal(routeFrom(s, idx(27, 2)).join(), routeBefore, 'monsters still walk the same corridor');
  const cover = turretCoverage(s, idx(22, 1));
  assert.ok(cover.includes(idx(25, 2)) && cover.includes(idx(19, 2)), 'sees along the corridor both ways');
  assert.ok(!cover.includes(idx(22, 4)), 'not through rock');
  s.drone.dead = 1e9;
  s.enemies.push({ id: 1, kind: 'crawler', x: 25.5, y: 2.5, hp: 12, maxHp: 12, stun: 0, kb: null, hit: 0, chew: 0 });
  s.enemies[0].stun = 99; // hold still
  run(s, 2.5);
  assert.equal(s.enemies.length, 0, 'shot from the wall');
});

test('waves arrive on the timer, scale with threat and come out of the rifts', () => {
  const s = newGame(1);
  s.drone.dead = 1e9;
  run(s, WAVE.first + 0.05);
  assert.equal(s.wave.n, 1);
  run(s, WAVE.gap * (waveSize(1, threatOf(s)) + 1));
  assert.equal(s.enemies.length, waveSize(1, threatOf(s)));
  for (const e of s.enemies) assert.ok(RIFTS.some((r) => Math.hypot(r.x + 0.5 - e.x, r.y + 0.5 - e.y) < 1.5));
  assert.ok(waveSize(5, 60) > waveSize(5, 0));
});

test('core falls: monsters cleared, 30% ore lost, core back at half', () => {
  const s = newGame(1);
  s.ore = 100;
  s.enemies.push({ id: 1, kind: 'crawler', x: 20.5, y: 20.5, hp: 5, maxHp: 5, stun: 0, kb: null, hit: 0, chew: 0 });
  s.base.hp = 0.0001;
  s.wave.toSpawn = 5;
  s.enemies[0].x = BASE_POS.x + 2.5; s.enemies[0].y = BASE_POS.y + 0.5;
  s.drone.dead = 1e9;
  s.base.hp = 0;
  step(s, STEP);
  assert.equal(s.enemies.length, 0);
  assert.equal(s.wave.toSpawn, 0);
  assert.equal(s.ore, 70);
  assert.equal(s.base.hp, Math.round(maxBaseHp(s) / 2));
  assert.equal(s.stats.coreFalls, 1);
});

test('the miner breaks down and is rebuilt at the base', () => {
  const s = newGame(1);
  quiet(s);
  s.drone.shield = 0.01;
  s.enemies.push({ id: 1, kind: 'armored', x: s.drone.x + 0.3, y: s.drone.y, hp: 1e9, maxHp: 1e9, stun: 0, kb: null, hit: 0, chew: 0 });
  step(s, STEP);
  assert.ok(s.drone.dead > 0);
  s.enemies = [];
  run(s, 6);
  assert.equal(s.drone.dead < 0, true);
  assert.equal(droneTile(s), idx(SPAWN.x, SPAWN.y));
  assert.equal(s.stats.deaths, 1);
});

test('holding a direction key tunnels straight that way', () => {
  const s = newGame(1);
  quiet(s);
  const start = droneTile(s);
  for (let i = 0; i < 60 * 4; i++) { steer(s, 2, i === 0); step(s, STEP); }
  release(s, false);
  for (let i = 0; i < 60 && s.drone.path.length; i++) step(s, STEP);
  for (let y = tileY(start) + 1; y <= tileY(start) + 3; y++) assert.equal(s.world.kind[idx(tileX(start), y)], T_EMPTY);
  assert.ok(s.ore >= 12, 'ore kept');
});

test('relics: activation adds threat, swaps cancel effects, re-equip at base', () => {
  const s = newGame(1);
  quiet(s);
  const t0 = threatOf(s);
  activateSite(s, 0, 'add');
  assert.deepEqual(s.relics.equipped, ['resonance']);
  assert.equal(threatOf(s), t0 + 15);
  // Resonance: one extra tile, no second penetration.
  carve(s, []);
  const col = SPAWN.x;
  press(s, idx(col, 4)); release(s, true);
  run(s, 1.2);
  assert.equal(s.world.kind[idx(col, 4)], T_EMPTY);
  assert.equal(s.world.kind[idx(col, 5)], T_EMPTY, 'resonance hit');
  assert.ok(s.world.kind[idx(col, 6)] !== T_EMPTY, 'no second penetration');
  unequipRelic(s, 'resonance');
  const hp = s.world.hp[idx(col, 7)];
  steer(s, 2, true);
  run(s, 3);
  assert.equal(s.world.hp[idx(col, 7)], hp, 'no resonance once unequipped');
  assert.ok(equipRelic(s, 'resonance').ok);
});

test('chains stop at 6 tiles, add threat once each, and terminate', () => {
  const s = newGame(1);
  quiet(s);
  s.relics.found = ['detonator'];
  s.relics.equipped = ['detonator'];
  for (let y = 4; y <= 7; y++) for (let x = 10; x <= 15; x++) {
    const t = idx(x, y); s.world.kind[t] = T_ORE; s.world.hp[t] = 1; s.world.ore[t] = 1; s.world.hard[t] = 0;
  }
  markDirty(s);
  const ore0 = s.ore;
  press(s, idx(13, 4)); release(s, true);
  run(s, 3);
  assert.equal(s.pending.length, 0);
  assert.equal(s.threat.chain, 2);
  assert.equal(s.ore - ore0, 7, 'dug tile + 6 chained');
});

test('pausing freezes the clock and cooldowns', () => {
  const g = new Game(newGame(1));
  usePulse(g.state);
  const cd = g.state.drone.pulseCd;
  g.pause('menu');
  g.tick(5);
  assert.equal(g.state.drone.pulseCd, cd);
  assert.equal(g.state.time, 0);
  g.resume('menu');
  g.tick(1);
  assert.ok(g.state.drone.pulseCd < cd);
});

test('save round trip keeps the world', () => {
  const s = newGame(1);
  s.ore = 33;
  s.world.kind[idx(3, 3)] = T_EMPTY;
  const back = parseSave(JSON.parse(JSON.stringify(s)))!;
  assert.equal(back.ore, 33);
  assert.equal(back.world.kind[idx(3, 3)], T_EMPTY);
  assert.equal(parseSave({ version: 1 }), null);
});
