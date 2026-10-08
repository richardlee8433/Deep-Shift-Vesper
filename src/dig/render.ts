// Canvas view: shapes only (no image assets). Every object is readable by shape,
// not just colour: rock = bevelled square, ore = faceted gems, probe = white disc
// with a drill line, relic = cyan concentric squares, crawler = triangle, armoured
// = triangle with a shell ring, nest = pulsing ring.

import { CAPACITOR, DEEP_ROW, ENEMY, EVAC_TIME, MAP_H, MAP_W, MID_ROW, NEST_HP, PULSE, REPULSOR, ROCK_HP, SIGNAL_RANGE, VISION } from './config';
import { DIRS, idx, rng, T_BEDROCK, T_CORE, T_EMPTY, T_NEST, T_ORE, T_RELIC, T_ROCK, zoneOf, ZONE_NAME } from './map';
import { canDig, has, pathFromTo, type Signal, tileX, tileY } from './sim';
import type { Nest, RunState } from './state';

export const FONT = '"Chakra Petch", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';

const C = {
  bg: '#0b090c',
  fog: '#100d11',
  fogDot: '#18141a',
  floor: ['#3a2c24', '#2f2630', '#26232f'],
  rock: ['#7a6d61', '#5b5c63', '#3e4456'],
  rockHi: ['#9a8b7c', '#787a83', '#56607a'],
  rockLo: ['#4c4239', '#393a40', '#282c39'],
  crack: '#191418',
  bedrock: '#151217',
  bedrockLine: '#231e27',
  ore: '#f6b73c',
  oreHi: '#ffe08a',
  oreLo: '#a8701c',
  deep: '#ff7d3b',
  deepHi: '#ffc38a',
  relic: '#9fe0ef',
  relicDim: '#4a6a72',
  core: '#eafcff',
  enemy: '#b47ce0',
  enemyHi: '#e6c8ff',
  nest: '#a65fd6',
  warn: '#ff6f8a',
  probe: '#f6f1ea',
  shield: '#7fd8ff',
  text: '#fbf3e6',
};

export interface View {
  ts: number; // tile size in CSS px
  ox: number; // map x offset in CSS px
  camY: number; // top row on screen (float)
  w: number;
  h: number;
  look: number; // manual scroll offset in tiles
}

export function newView(): View {
  return { ts: 32, ox: 0, camY: 0, w: 0, h: 0, look: 0 };
}

/** Fit the map width to the canvas (or follow the probe sideways on narrow screens) and ease the camera. */
export function layout(v: View, run: RunState, w: number, h: number, dt: number, snap = false): void {
  v.w = w;
  v.h = h;
  v.ts = Math.max(22, Math.min(44, Math.floor(w / MAP_W)));
  const k = snap ? 1 : Math.min(1, dt * 6);
  const mapW = v.ts * MAP_W;
  const ox = mapW <= w ? Math.floor((w - mapW) / 2) : Math.max(w - mapW, Math.min(0, w / 2 - run.drone.x * v.ts));
  v.ox = mapW <= w ? ox : v.ox + (ox - v.ox) * k;
  const rows = h / v.ts;
  const minY = -0.5, maxY = Math.max(minY, MAP_H + 0.5 - rows);
  v.look = Math.max(minY - run.drone.y, Math.min(maxY + rows - run.drone.y, v.look));
  const target = Math.max(minY, Math.min(maxY, run.drone.y - rows * 0.45 + v.look));
  v.camY = v.camY + (target - v.camY) * k;
}

export function screenToTile(v: View, px: number, py: number): number {
  const x = Math.floor((px - v.ox) / v.ts);
  const y = Math.floor(py / v.ts + v.camY);
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return -1;
  return idx(x, y);
}

// ---- Effects --------------------------------------------------------------

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
interface Ring { x: number; y: number; r: number; t: number; color: string }
interface Link { from: number; to: number; t: number; kind: 'resonance' | 'chain'; seed: number }
interface Shot { x1: number; y1: number; x2: number; y2: number; t: number }
interface Float { x: number; y: number; text: string; color: string; t: number }
interface Marker { x: number; y: number; t: number }

const fx = {
  parts: [] as Particle[],
  rings: [] as Ring[],
  links: [] as Link[],
  shots: [] as Shot[],
  floats: [] as Float[],
  markers: [] as Marker[],
  flash: 0, // probe flash (relic equipped / first use)
  hurt: 0,
  shake: 0,
};

const prand = rng(99);

function burst(x: number, y: number, color: string, n: number, speed: number, size = 0.08): void {
  for (let i = 0; i < n; i++) {
    const a = prand() * Math.PI * 2;
    const s = speed * (0.4 + prand() * 0.8);
    const life = 0.35 + prand() * 0.35;
    fx.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.6, life, max: life, color, size: size * (0.6 + prand()) });
  }
}

export function onSignal(s: Signal, run: RunState | null, numbers: boolean): void {
  switch (s.t) {
    case 'break': {
      const x = tileX(s.tile) + 0.5, y = tileY(s.tile) + 0.5;
      const hard = run ? run.world.hard[s.tile] : 0;
      burst(x, y, C.rock[hard], 9, 2.2);
      if (s.ore) {
        burst(x, y, s.ore > 1 ? C.deep : C.ore, 7, 2.6, 0.07);
        if (numbers) fx.floats.push({ x, y, text: `+${s.ore}`, color: s.ore > 1 ? C.deepHi : C.oreHi, t: 0 });
      }
      if (s.source !== 'drill') fx.shake = Math.max(fx.shake, 0.12);
      break;
    }
    case 'dig':
      if (prand() < 0.25) {
        const x = tileX(s.tile) + 0.5, y = tileY(s.tile) + 0.5;
        if (run) {
          const dx = run.drone.x - x, dy = run.drone.y - y;
          burst(x + dx * 0.45, y + dy * 0.45, '#ffd9a0', 1, 2.5, 0.05);
        }
      }
      break;
    case 'link':
      fx.links.push({ from: s.from, to: s.to, t: 0, kind: s.kind, seed: prand() * 1000 });
      break;
    case 'shot':
      fx.shots.push({ ...s, t: 0 });
      break;
    case 'ring':
      fx.rings.push({ x: s.x, y: s.y, r: s.r, t: 0, color: s.kind === 'pulse' ? '#bdf3ff' : s.kind === 'cap' ? C.oreHi : '#8fb6ff' });
      break;
    case 'kill':
      burst(s.x, s.y, C.enemy, s.kind === 'armored' ? 16 : 10, 2.4);
      break;
    case 'hurt':
      fx.hurt = 0.35;
      fx.shake = Math.max(fx.shake, 0.1);
      break;
    case 'spawn':
      burst(s.x, s.y, C.nest, 8, 1.6);
      break;
    case 'warn':
      fx.markers.push({ x: s.x, y: s.y, t: 0 });
      break;
    case 'nest':
      if (s.down) burst(tileX(s.tile) + 0.5, tileY(s.tile) + 0.5, C.nest, 22, 3);
      break;
    case 'relic':
      burst(s.x, s.y, s.relic ? C.relic : C.core, 26, 3.2);
      fx.rings.push({ x: s.x, y: s.y, r: 3, t: 0, color: C.relic });
      fx.flash = 0.6;
      fx.shake = Math.max(fx.shake, 0.18);
      break;
    case 'first':
      fx.flash = 0.6;
      break;
    case 'threat':
      if (numbers && run) fx.floats.push({ x: run.drone.x, y: run.drone.y - 0.6, text: `威脅 ${s.amount > 0 ? '+' : ''}${s.amount}`, color: s.amount > 0 ? '#e3a6ff' : '#9fe8b0', t: 0 });
      break;
    case 'unreachable':
      fx.markers.push({ x: tileX(s.tile) + 0.5, y: tileY(s.tile) + 0.5, t: 0.7 });
      break;
    default:
      break;
  }
}

export function clearFx(): void {
  fx.parts.length = fx.rings.length = fx.links.length = fx.shots.length = fx.floats.length = fx.markers.length = 0;
  fx.flash = fx.hurt = fx.shake = 0;
}

function updateFx(dt: number): void {
  for (const p of fx.parts) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 6 * dt;
    p.vx *= 0.96;
  }
  fx.parts = fx.parts.filter((p) => p.life > 0);
  for (const r of fx.rings) r.t += dt / 0.4;
  fx.rings = fx.rings.filter((r) => r.t < 1);
  for (const l of fx.links) l.t += dt / (l.kind === 'chain' ? 0.35 : 0.3);
  fx.links = fx.links.filter((l) => l.t < 1);
  for (const s of fx.shots) s.t += dt / 0.12;
  fx.shots = fx.shots.filter((s) => s.t < 1);
  for (const f of fx.floats) f.t += dt / 0.9;
  fx.floats = fx.floats.filter((f) => f.t < 1);
  for (const m of fx.markers) m.t += dt / 3;
  fx.markers = fx.markers.filter((m) => m.t < 1);
  fx.flash = Math.max(0, fx.flash - dt);
  fx.hurt = Math.max(0, fx.hurt - dt);
  fx.shake = Math.max(0, fx.shake - dt);
}

// ---- Drawing ----------------------------------------------------------------

export interface DrawOpts {
  hover: number;
  highlight: Nest | null;
  dt: number;
  time: number;
}

const tileSeed = (i: number) => {
  const r = rng(i * 7919 + 13);
  return [r(), r(), r(), r(), r(), r()];
};
const seeds: number[][] = Array.from({ length: MAP_W * MAP_H }, (_, i) => tileSeed(i));

export function draw(ctx: CanvasRenderingContext2D, run: RunState, v: View, o: DrawOpts): void {
  updateFx(o.dt);
  const { ts } = v;
  const w = run.world;
  const d = run.drone;
  const t = o.time;
  ctx.save();
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, v.w, v.h);
  if (fx.shake > 0) ctx.translate((prand() - 0.5) * fx.shake * ts * 0.6, (prand() - 0.5) * fx.shake * ts * 0.6);

  const SX = (x: number) => v.ox + x * ts;
  const SY = (y: number) => (y - v.camY) * ts;
  const y0 = Math.max(0, Math.floor(v.camY) - 1);
  const y1 = Math.min(MAP_H - 1, Math.ceil(v.camY + v.h / ts) + 1);
  const cx = Math.floor(d.x), cy = Math.floor(d.y);

  // Tiles.
  const x0 = Math.max(0, Math.floor(-v.ox / ts) - 1);
  const x1 = Math.min(MAP_W - 1, Math.ceil((v.w - v.ox) / ts) + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = idx(x, y);
      const k = w.kind[i];
      const px = SX(x), py = SY(y);
      const zone = zoneOf(y);
      if (k === T_BEDROCK) {
        drawBedrock(ctx, px, py, ts, w.seen[i] ? 1 : 0.65);
        continue;
      }
      if (!w.seen[i]) {
        ctx.fillStyle = C.fog;
        ctx.fillRect(px, py, ts, ts);
        const s = seeds[i];
        ctx.fillStyle = C.fogDot;
        ctx.fillRect(px + s[0] * ts * 0.8, py + s[1] * ts * 0.8, ts * 0.12, ts * 0.12);
        if (w.scan[i]) drawScan(ctx, run, i, px, py, ts, t);
        continue;
      }
      ctx.fillStyle = C.floor[zone];
      ctx.fillRect(px, py, ts, ts);
      if (k === T_ROCK || k === T_ORE) drawRock(ctx, px, py, ts, w.hard[i], w.hp[i] / ROCK_HP[w.hard[i]], seeds[i]);
      if (k === T_ORE) drawOre(ctx, px, py, ts, w.ore[i] > 1, seeds[i]);
      if (k === T_EMPTY) drawFloorShade(ctx, run, x, y, px, py, ts);
      if (k === T_RELIC) {
        const site = run.sites.find((s) => s.x === x && s.y === y);
        drawRelic(ctx, px, py, ts, !!site?.activated, t);
      }
      if (k === T_CORE) drawCore(ctx, px, py, ts, t);
      if (k === T_NEST) {
        const n = run.nests.find((nn) => nn.x === x && nn.y === y);
        if (n) drawNest(ctx, px, py, ts, n, t);
      }
      // Fog of war: explored but out of sight is dimmed.
      if ((x - cx) ** 2 + (y - cy) ** 2 > VISION * VISION + 0.5) {
        ctx.fillStyle = 'rgba(6, 4, 8, 0.42)';
        ctx.fillRect(px, py, ts, ts);
      }
    }
  }

  // Zone boundaries: a dashed line, the zone name and how much harder its rock is.
  ctx.font = `600 ${Math.max(10, ts * 0.34)}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const lx = Math.max(v.ox, 0) + 4;
  ctx.fillStyle = 'rgba(251, 243, 230, 0.55)';
  ctx.fillText('入口', lx, SY(0.5));
  for (const [row, zone] of [[MID_ROW, 1], [DEEP_ROW, 2]] as const) {
    const py = SY(row);
    if (py < -ts || py > v.h + ts) continue;
    ctx.save();
    ctx.strokeStyle = 'rgba(251, 243, 230, 0.28)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(v.ox, py);
    ctx.lineTo(v.ox + MAP_W * ts, py);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(251, 243, 230, 0.7)';
    ctx.fillText(`▼ ${ZONE_NAME[zone]}・岩石比上一層硬 ${Math.round((ROCK_HP[zone] / ROCK_HP[zone - 1] - 1) * 100)}%`, lx, py + ts * 0.3);
  }

  // Lens: nest ranges as dashed outlines.
  if (has(run, 'lens')) {
    for (const n of run.nests) {
      if (n.state === 'destroyed' || !w.scan[idx(n.x, n.y)]) continue;
      ctx.save();
      ctx.strokeStyle = 'rgba(180, 124, 224, 0.55)';
      ctx.setLineDash([ts * 0.15, ts * 0.12]);
      ctx.lineWidth = 1.5;
      for (const z of n.zone) ctx.strokeRect(SX(tileX(z)) + 2, SY(tileY(z)) + 2, ts - 4, ts - 4);
      ctx.restore();
    }
  }

  // Relic panel preview: mark the nest that would wake, even if unexplored.
  if (o.highlight) {
    const n = o.highlight;
    const px = SX(n.x + 0.5), py = SY(n.y + 0.5);
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    ctx.save();
    ctx.strokeStyle = C.warn;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(px, py, ts * (1.1 + pulse * 0.25), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.warn;
    ctx.font = `700 ${Math.max(11, ts * 0.36)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(`將喚醒：${n.name}`, px, py - ts * 1.6);
    ctx.restore();
  }

  // Warnings: first-spawn path from an awakened nest, and pending warning spawns.
  for (const n of run.nests) {
    if (n.warn <= 0 || n.state !== 'awake') continue;
    const path = pathFromTo(run, idx(n.x, n.y));
    const on = Math.sin(t * 14) > -0.2;
    if (on && path.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 111, 138, 0.85)';
      ctx.lineWidth = Math.max(2, ts * 0.1);
      ctx.setLineDash([ts * 0.25, ts * 0.18]);
      ctx.lineDashOffset = -t * ts * 2;
      ctx.beginPath();
      path.forEach((p, k) => (k ? ctx.lineTo : ctx.moveTo).call(ctx, SX(tileX(p) + 0.5), SY(tileY(p) + 0.5)));
      ctx.stroke();
      ctx.restore();
    }
  }
  for (const p of run.pending) {
    if (p.kind !== 'spawn') continue;
    drawWarnMarker(ctx, SX(tileX(p.tile) + 0.5), SY(tileY(p.tile) + 0.5), ts, t);
  }
  for (const m of fx.markers) {
    if (m.t >= 0.7) {
      // Unreachable flash: short red cross.
      const a = 1 - (m.t - 0.7) / 0.3;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = C.warn;
      ctx.lineWidth = 2;
      const px = SX(m.x), py = SY(m.y), r = ts * 0.25;
      ctx.beginPath();
      ctx.moveTo(px - r, py - r); ctx.lineTo(px + r, py + r);
      ctx.moveTo(px + r, py - r); ctx.lineTo(px - r, py + r);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Hover and dig target.
  if (o.hover >= 0) {
    const hk = w.kind[o.hover];
    const ok = hk === T_EMPTY || (w.seen[o.hover] && canDig(run, o.hover));
    ctx.strokeStyle = ok ? 'rgba(251, 243, 230, 0.75)' : 'rgba(255, 111, 138, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(SX(tileX(o.hover)) + 1.5, SY(tileY(o.hover)) + 1.5, ts - 3, ts - 3);
  }
  if (d.dig >= 0) {
    ctx.strokeStyle = 'rgba(255, 224, 138, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(SX(tileX(d.dig)) + 2, SY(tileY(d.dig)) + 2, ts - 4, ts - 4);
    ctx.setLineDash([]);
  }
  if (d.path.length) {
    const last = d.path[d.path.length - 1];
    ctx.fillStyle = 'rgba(251, 243, 230, 0.35)';
    ctx.beginPath();
    ctx.arc(SX(tileX(last) + 0.5), SY(tileY(last) + 0.5), ts * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // Enemies.
  for (const e of run.enemies) drawEnemy(ctx, SX(e.x), SY(e.y), ts, e.kind, d.x - e.x, d.y - e.y, e.hp / ENEMY[e.kind].hp, e.hit > 0, e.stun > 0);

  // Probe.
  drawProbe(ctx, run, SX(d.x), SY(d.y), ts, t);

  // Effects.
  for (const l of fx.links) {
    const a = 1 - l.t;
    const x1 = SX(tileX(l.from) + 0.5), y1 = SY(tileY(l.from) + 0.5), x2 = SX(tileX(l.to) + 0.5), y2 = SY(tileY(l.to) + 0.5);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.lineWidth = l.kind === 'chain' ? 2.5 : 3;
    ctx.strokeStyle = l.kind === 'chain' ? C.oreHi : '#bdf3ff';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    if (l.kind === 'chain') {
      const r = rng(Math.floor(l.seed + l.t * 10));
      for (let k = 1; k < 4; k++) {
        const f = k / 4;
        ctx.lineTo(x1 + (x2 - x1) * f + (r() - 0.5) * ts * 0.4, y1 + (y2 - y1) * f + (r() - 0.5) * ts * 0.4);
      }
    }
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }
  for (const s of fx.shots) {
    ctx.save();
    ctx.globalAlpha = 1 - s.t;
    ctx.strokeStyle = '#fff3c4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(SX(s.x1), SY(s.y1));
    ctx.lineTo(SX(s.x2), SY(s.y2));
    ctx.stroke();
    ctx.restore();
  }
  for (const r of fx.rings) {
    ctx.save();
    ctx.globalAlpha = (1 - r.t) * 0.9;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 3 * (1 - r.t) + 1;
    ctx.beginPath();
    ctx.arc(SX(r.x), SY(r.y), r.r * ts * (0.3 + 0.7 * r.t), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  for (const p of fx.parts) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    const s = p.size * ts;
    ctx.fillRect(SX(p.x) - s / 2, SY(p.y) - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
  ctx.font = `700 ${Math.max(11, ts * 0.38)}px ${FONT}`;
  ctx.textAlign = 'center';
  for (const f of fx.floats) {
    ctx.globalAlpha = 1 - f.t * f.t;
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, SX(f.x), SY(f.y) - f.t * ts * 0.9);
  }
  ctx.globalAlpha = 1;

  drawSignals(ctx, run, SX(d.x), SY(d.y), ts, t);

  ctx.restore();

  if (fx.hurt > 0) {
    const g = ctx.createRadialGradient(v.w / 2, v.h / 2, Math.min(v.w, v.h) * 0.3, v.w / 2, v.h / 2, Math.max(v.w, v.h) * 0.75);
    g.addColorStop(0, 'rgba(255, 60, 80, 0)');
    g.addColorStop(1, `rgba(255, 60, 80, ${fx.hurt * 0.9})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, v.w, v.h);
  }
}

function drawBedrock(ctx: CanvasRenderingContext2D, px: number, py: number, ts: number, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = C.bedrock;
  ctx.fillRect(px, py, ts, ts);
  ctx.strokeStyle = C.bedrockLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = -1; k <= 2; k++) {
    ctx.moveTo(px + k * ts * 0.4, py + ts);
    ctx.lineTo(px + k * ts * 0.4 + ts * 0.6, py);
  }
  ctx.save();
  ctx.rect(px, py, ts, ts);
  ctx.clip();
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawRock(ctx: CanvasRenderingContext2D, px: number, py: number, ts: number, hard: number, hpFrac: number, s: number[]): void {
  const g = Math.max(1, ts * 0.06);
  ctx.fillStyle = C.rockLo[hard];
  ctx.fillRect(px + g * 0.5, py + g * 0.5, ts - g, ts - g);
  ctx.fillStyle = C.rock[hard];
  ctx.fillRect(px + g * 0.5, py + g * 0.5, ts - g * 2, ts - g * 2);
  ctx.fillStyle = C.rockHi[hard];
  ctx.fillRect(px + g * 0.5, py + g * 0.5, ts - g * 2, g);
  ctx.fillRect(px + g * 0.5, py + g * 0.5, g, ts - g * 2);
  // Hardness glyph: soft = one notch, hard = two, dense = three.
  ctx.fillStyle = C.rockLo[hard];
  for (let k = 0; k <= hard; k++) ctx.fillRect(px + ts * (0.18 + k * 0.14), py + ts * 0.74, ts * 0.08, ts * 0.08);
  // Cracks grow with damage.
  const dmg = 1 - Math.max(0, Math.min(1, hpFrac));
  if (dmg > 0.02) {
    ctx.strokeStyle = C.crack;
    ctx.lineWidth = Math.max(1, ts * 0.05);
    ctx.beginPath();
    const n = 1 + Math.floor(dmg * 4);
    for (let k = 0; k < n; k++) {
      const a = s[k % 6] * Math.PI * 2;
      const mx = px + ts / 2, my = py + ts / 2;
      const len = ts * (0.2 + dmg * 0.3);
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + Math.cos(a) * len * 0.5 + s[(k + 1) % 6] * 3, my + Math.sin(a) * len * 0.5);
      ctx.lineTo(mx + Math.cos(a + 0.4) * len, my + Math.sin(a + 0.4) * len);
    }
    ctx.stroke();
  }
}

function gem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, hi: string, lo: string): void {
  ctx.fillStyle = lo;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.85, y - r * 0.2);
  ctx.lineTo(x + r * 0.5, y + r);
  ctx.lineTo(x - r * 0.5, y + r);
  ctx.lineTo(x - r * 0.85, y - r * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.85, y - r * 0.2);
  ctx.lineTo(x + r * 0.3, y + r * 0.5);
  ctx.lineTo(x - r * 0.6, y + r * 0.2);
  ctx.lineTo(x - r * 0.85, y - r * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = hi;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x - r * 0.85, y - r * 0.2);
  ctx.lineTo(x - r * 0.2, y - r * 0.1);
  ctx.closePath();
  ctx.fill();
}

function drawOre(ctx: CanvasRenderingContext2D, px: number, py: number, ts: number, deep: boolean, s: number[]): void {
  const fill = deep ? C.deep : C.ore, hi = deep ? C.deepHi : C.oreHi;
  gem(ctx, px + ts * (0.35 + s[2] * 0.1), py + ts * (0.4 + s[3] * 0.1), ts * (deep ? 0.22 : 0.17), fill, hi, C.oreLo);
  gem(ctx, px + ts * (0.66 + s[4] * 0.08), py + ts * (0.58 + s[5] * 0.1), ts * (deep ? 0.15 : 0.11), fill, hi, C.oreLo);
}

function drawFloorShade(ctx: CanvasRenderingContext2D, run: RunState, x: number, y: number, px: number, py: number, ts: number): void {
  // Soft shadow along edges that touch solid tiles.
  const k = run.world.kind;
  const solid = (xx: number, yy: number) => xx < 0 || yy < 0 || xx >= MAP_W || yy >= MAP_H || k[idx(xx, yy)] !== T_EMPTY;
  const e = ts * 0.12;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  if (solid(x, y - 1)) ctx.fillRect(px, py, ts, e);
  if (solid(x - 1, y)) ctx.fillRect(px, py, e, ts);
  ctx.fillStyle = 'rgba(255, 240, 220, 0.03)';
  if (solid(x, y + 1)) ctx.fillRect(px, py + ts - e, ts, e);
}

function drawRelic(ctx: CanvasRenderingContext2D, px: number, py: number, ts: number, used: boolean, t: number): void {
  const cx = px + ts / 2, cy = py + ts / 2;
  const col = used ? C.relicDim : C.relic;
  if (!used) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, ts);
    g.addColorStop(0, `rgba(159, 224, 239, ${0.25 + 0.15 * Math.sin(t * 3)})`);
    g.addColorStop(1, 'rgba(159, 224, 239, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(px - ts / 2, py - ts / 2, ts * 2, ts * 2);
  }
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1.5, ts * 0.06);
  for (const f of [0.42, 0.29, 0.16]) ctx.strokeRect(cx - ts * f, cy - ts * f, ts * f * 2, ts * f * 2);
  ctx.fillStyle = col;
  ctx.fillRect(cx - ts * 0.06, cy - ts * 0.06, ts * 0.12, ts * 0.12);
}

function drawCore(ctx: CanvasRenderingContext2D, px: number, py: number, ts: number, t: number): void {
  const cx = px + ts / 2, cy = py + ts / 2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, ts * 1.6);
  g.addColorStop(0, `rgba(234, 252, 255, ${0.45 + 0.2 * Math.sin(t * 2.5)})`);
  g.addColorStop(1, 'rgba(159, 224, 239, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(px - ts, py - ts, ts * 3, ts * 3);
  ctx.strokeStyle = C.relic;
  ctx.lineWidth = Math.max(1.5, ts * 0.06);
  ctx.strokeRect(px + ts * 0.06, py + ts * 0.06, ts * 0.88, ts * 0.88);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t * 0.8);
  ctx.fillStyle = C.core;
  ctx.beginPath();
  ctx.moveTo(0, -ts * 0.3);
  ctx.lineTo(ts * 0.22, 0);
  ctx.lineTo(0, ts * 0.3);
  ctx.lineTo(-ts * 0.22, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawNest(ctx: CanvasRenderingContext2D, px: number, py: number, ts: number, n: Nest, t: number): void {
  const cx = px + ts / 2, cy = py + ts / 2;
  const awake = n.state === 'awake';
  const speed = awake ? 5 : 1.4;
  const p = 0.5 + 0.5 * Math.sin(t * speed);
  ctx.fillStyle = awake ? 'rgba(166, 95, 214, 0.35)' : 'rgba(166, 95, 214, 0.15)';
  ctx.beginPath();
  ctx.arc(cx, cy, ts * 0.46, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = n.warn > 0 && Math.sin(t * 14) > 0 ? C.warn : awake ? '#d79bff' : '#7c4f9c';
  ctx.lineWidth = Math.max(2, ts * (awake ? 0.1 : 0.06));
  ctx.beginPath();
  ctx.arc(cx, cy, ts * (0.22 + p * 0.14), 0, Math.PI * 2);
  ctx.stroke();
  if (awake) {
    ctx.fillStyle = '#e6c8ff';
    ctx.beginPath();
    ctx.arc(cx, cy, ts * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  if (n.hp < NEST_HP) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(px + ts * 0.1, py + ts * 0.86, ts * 0.8, ts * 0.08);
    ctx.fillStyle = '#d79bff';
    ctx.fillRect(px + ts * 0.1, py + ts * 0.86, ts * 0.8 * Math.max(0, n.hp / NEST_HP), ts * 0.08);
  }
}

function drawScan(ctx: CanvasRenderingContext2D, run: RunState, i: number, px: number, py: number, ts: number, t: number): void {
  const k = run.world.kind[i];
  ctx.save();
  ctx.globalAlpha = 0.55 + 0.15 * Math.sin(t * 2 + i);
  ctx.lineWidth = 1.5;
  if (k === T_ORE) {
    ctx.strokeStyle = run.world.ore[i] > 1 ? C.deep : C.ore;
    ctx.beginPath();
    ctx.moveTo(px + ts / 2, py + ts * 0.25);
    ctx.lineTo(px + ts * 0.75, py + ts / 2);
    ctx.lineTo(px + ts / 2, py + ts * 0.75);
    ctx.lineTo(px + ts * 0.25, py + ts / 2);
    ctx.closePath();
    ctx.stroke();
  } else if (k === T_RELIC || k === T_CORE) {
    ctx.strokeStyle = k === T_CORE ? C.core : C.relic;
    ctx.strokeRect(px + ts * 0.12, py + ts * 0.12, ts * 0.76, ts * 0.76);
    ctx.strokeRect(px + ts * 0.3, py + ts * 0.3, ts * 0.4, ts * 0.4);
  } else if (k === T_NEST) {
    ctx.strokeStyle = C.nest;
    ctx.beginPath();
    ctx.arc(px + ts / 2, py + ts / 2, ts * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWarnMarker(ctx: CanvasRenderingContext2D, x: number, y: number, ts: number, t: number): void {
  if (Math.sin(t * 14) < -0.2) return;
  ctx.save();
  ctx.strokeStyle = C.warn;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, ts * 0.38, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = C.warn;
  ctx.font = `800 ${Math.max(12, ts * 0.5)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', x, y + 1);
  ctx.restore();
}

function drawEnemy(ctx: CanvasRenderingContext2D, x: number, y: number, ts: number, kind: 'crawler' | 'armored', dx: number, dy: number, hpFrac: number, hit: boolean, stunned: boolean): void {
  const a = Math.atan2(dy, dx);
  const r = ts * (kind === 'armored' ? 0.34 : 0.28);
  ctx.save();
  ctx.translate(x, y);
  if (kind === 'armored') {
    ctx.strokeStyle = C.enemyHi;
    ctx.lineWidth = Math.max(2, ts * 0.08);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.rotate(a);
  ctx.fillStyle = hit ? '#ffffff' : C.enemy;
  ctx.strokeStyle = '#2a1636';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(-r * 0.8, r * 0.75);
  ctx.lineTo(-r * 0.45, 0);
  ctx.lineTo(-r * 0.8, -r * 0.75);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  if (stunned) {
    ctx.fillStyle = 'rgba(189, 243, 255, 0.8)';
    ctx.fillRect(x - ts * 0.2, y - r - ts * 0.18, ts * 0.4, ts * 0.05);
  }
  if (hpFrac < 1) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - ts * 0.3, y + r + 2, ts * 0.6, 3);
    ctx.fillStyle = C.enemyHi;
    ctx.fillRect(x - ts * 0.3, y + r + 2, ts * 0.6 * Math.max(0, hpFrac), 3);
  }
}

function drawProbe(ctx: CanvasRenderingContext2D, run: RunState, x: number, y: number, ts: number, t: number): void {
  const d = run.drone;
  const r = ts * 0.3;
  // Evacuation beam.
  if (d.evac >= 0) {
    const p = Math.min(1, d.evac / EVAC_TIME);
    const g = ctx.createLinearGradient(x, y - ts * 6, x, y);
    g.addColorStop(0, 'rgba(159, 224, 239, 0)');
    g.addColorStop(1, `rgba(159, 224, 239, ${0.25 + p * 0.5})`);
    ctx.fillStyle = g;
    ctx.fillRect(x - ts * 0.35, y - ts * 6, ts * 0.7, ts * 6);
    ctx.strokeStyle = C.relic;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.7, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.stroke();
  }
  if (run.bio > 0) {
    ctx.fillStyle = `rgba(147, 212, 157, ${0.2 + 0.1 * Math.sin(t * 10)})`;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (fx.flash > 0) {
    ctx.fillStyle = `rgba(159, 224, 239, ${fx.flash * 0.6})`;
    ctx.beginPath();
    ctx.arc(x, y, r * (1.4 + (0.6 - fx.flash) * 2), 0, Math.PI * 2);
    ctx.fill();
  }
  // Drill line in the facing direction (jitters while digging).
  const [fx_, fy] = DIRS[d.face];
  const digging = d.dig >= 0 && d.path.length === 0;
  const j = digging ? Math.sin(t * 60) * ts * 0.03 : 0;
  ctx.strokeStyle = digging ? '#ffe08a' : '#cfc6bb';
  ctx.lineWidth = Math.max(3, ts * 0.12);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + fx_ * (r + ts * 0.2) + j, y + fy * (r + ts * 0.2) + j);
  ctx.stroke();
  ctx.lineCap = 'butt';
  // Body.
  ctx.fillStyle = d.hurt > 0 ? '#ffd0d6' : C.probe;
  ctx.strokeStyle = '#2b2228';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2b2228';
  ctx.beginPath();
  ctx.arc(x + fx_ * r * 0.35, y + fy * r * 0.35, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  // Shield ring.
  const frac = d.shield / d.maxShield;
  ctx.strokeStyle = frac > 0.35 ? C.shield : C.warn;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r + 4, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
  ctx.stroke();
  // Core carried.
  if (run.core.taken) {
    ctx.fillStyle = C.core;
    ctx.beginPath();
    ctx.moveTo(x, y - r - ts * 0.38);
    ctx.lineTo(x + ts * 0.1, y - r - ts * 0.24);
    ctx.lineTo(x, y - r - ts * 0.1);
    ctx.lineTo(x - ts * 0.1, y - r - ts * 0.24);
    ctx.closePath();
    ctx.fill();
  }
  // Pulse / capacitor / repulsor ranges hinted faintly.
  if (has(run, 'repulsor') && run.repCd <= 0.4) {
    ctx.strokeStyle = 'rgba(143, 182, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, REPULSOR.radius * ts, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (has(run, 'capacitor')) {
    const c = run.cap.count / CAPACITOR.tiles;
    ctx.strokeStyle = 'rgba(255, 224, 138, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r + 8, Math.PI / 2, Math.PI / 2 + c * Math.PI * 2);
    ctx.stroke();
  }
  if (d.pulseCd <= 0 && run.enemies.some((e) => Math.hypot(e.x - d.x, e.y - d.y) <= PULSE.radius)) {
    ctx.strokeStyle = `rgba(189, 243, 255, ${0.25 + 0.2 * Math.sin(t * 8)})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(x, y, PULSE.radius * ts, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Fuzzy direction hints toward relics and the core not yet seen. */
function drawSignals(ctx: CanvasRenderingContext2D, run: RunState, x: number, y: number, ts: number, t: number): void {
  const d = run.drone;
  const targets: { x: number; y: number; core: boolean; i: number }[] = [];
  run.sites.forEach((s, i) => {
    if (!s.activated && !run.world.seen[idx(s.x, s.y)]) targets.push({ x: s.x + 0.5, y: s.y + 0.5, core: false, i });
  });
  if (!run.core.taken && !run.world.seen[idx(run.core.x, run.core.y)]) targets.push({ x: run.core.x + 0.5, y: run.core.y + 0.5, core: true, i: 9 });
  for (const g of targets) {
    const dist = Math.hypot(g.x - d.x, g.y - d.y);
    if (dist > SIGNAL_RANGE && !g.core) continue;
    const fuzz = (seeds[g.i * 31][0] - 0.5) * 0.5 + Math.sin(t * 1.3 + g.i) * 0.08;
    const a = Math.atan2(g.y - d.y, g.x - d.x) + fuzz;
    const rr = ts * (1.05 + 0.08 * Math.sin(t * 4 + g.i));
    const ax = x + Math.cos(a) * rr, ay = y + Math.sin(a) * rr;
    const near = 1 - Math.min(1, dist / SIGNAL_RANGE);
    ctx.save();
    ctx.globalAlpha = g.core ? 0.55 + near * 0.4 : 0.35 + near * 0.55;
    ctx.translate(ax, ay);
    ctx.rotate(a);
    ctx.fillStyle = g.core ? C.core : C.relic;
    const s = ts * (g.core ? 0.2 : 0.16);
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.6, s * 0.7);
    ctx.lineTo(-s * 0.2, 0);
    ctx.lineTo(-s * 0.6, -s * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
