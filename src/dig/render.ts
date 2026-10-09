// Pixel renderer: the world is drawn at 1 art pixel per buffer pixel (16 px tiles,
// 3/4 view: each block has a top face lifted by WH and a front face below it), then
// scaled up with nearest-neighbour. Rows are drawn top to bottom with sprites in
// between, so blocks in front hide the feet of whatever stands behind them.

import { BUILD, type BuildKind, MAP_H, MAP_W, RECALL_TIME, ROCK_HP, SIGNAL_RANGE, VISION } from './config';
import { BASE_POS, CHAMBER, idx, inBounds, isWalkable, RIFTS, rng, T_BASE, T_ORE, T_RELIC, T_RIFT, T_ROCK, T_TURRET, T_WALL, zoneOf } from './map';
import { GEM, INK, pixelLine, TP, textures, WH, ZONE_PAL } from './pixel';
import { has, routeFrom, type Signal, tileX, tileY } from './sim';
import { type GameState, maxBaseHp } from './state';

export const FONT = '"Chakra Petch", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';

export interface View {
  S: number; // CSS px per art pixel
  bw: number; // buffer size in art pixels
  bh: number;
  camX: number; // camera top-left in art pixels
  camY: number;
  w: number; // CSS size
  h: number;
  lookX: number; // manual offset in art pixels
  lookY: number;
}

export function newView(): View {
  return { S: 3, bw: 0, bh: 0, camX: 0, camY: 0, w: 0, h: 0, lookX: 0, lookY: 0 };
}

export function layout(v: View, s: GameState, w: number, h: number, dt: number, snap = false): void {
  v.w = w;
  v.h = h;
  v.S = Math.max(2, Math.round(Math.min(w / 330, h / 230)));
  v.bw = Math.ceil(w / v.S);
  v.bh = Math.ceil(h / v.S);
  const d = s.drone;
  let tx = d.x * TP - v.bw / 2 + v.lookX;
  let ty = d.y * TP - v.bh / 2 + v.lookY;
  const worldW = MAP_W * TP, worldH = MAP_H * TP;
  tx = v.bw >= worldW + 32 ? (worldW - v.bw) / 2 : Math.max(-16, Math.min(worldW + 16 - v.bw, tx));
  ty = v.bh >= worldH + 40 ? (worldH - v.bh) / 2 : Math.max(-24, Math.min(worldH + 16 - v.bh, ty));
  const k = snap ? 1 : Math.min(1, dt * 7);
  v.camX += (tx - v.camX) * k;
  v.camY += (ty - v.camY) * k;
}

/** Screen (CSS px inside the canvas) → tile. A block's lifted top face counts as that block. */
export function screenToTile(v: View, s: GameState, px: number, py: number): number {
  const wx = v.camX + px / v.S, wy = v.camY + py / v.S;
  const x = Math.floor(wx / TP);
  const yLift = Math.floor((wy + WH) / TP);
  if (inBounds(x, yLift) && !isWalkable(s.world.kind[yLift * MAP_W + x])) return idx(x, yLift);
  const y = Math.floor(wy / TP);
  return inBounds(x, y) ? idx(x, y) : -1;
}

/** Tile centre → CSS px on screen. */
export function tileToScreen(v: View, x: number, y: number): [number, number] {
  return [(x * TP - Math.round(v.camX)) * v.S, (y * TP - Math.round(v.camY)) * v.S];
}

// ---- Effects --------------------------------------------------------------------

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string }
interface Ring { x: number; y: number; r: number; t: number; color: string }
interface Line { x1: number; y1: number; x2: number; y2: number; t: number; dur: number; color: string; jag: boolean }
interface Float { x: number; y: number; text: string; color: string; t: number }
/** A turret round in flight: from the barrel tip to the target, in world tiles. */
interface Bolt { x1: number; y1: number; x2: number; y2: number; a: number; t: number; dur: number }

const MUZZLE = 0.12;
const BOLT_SPEED = 22; // tiles / s — slow enough to read across a few frames

const fx = {
  parts: [] as Particle[],
  rings: [] as Ring[],
  lines: [] as Line[],
  floats: [] as Float[],
  marks: [] as { x: number; y: number; t: number }[],
  shake: 0,
  quake: 0,
  hurt: 0,
  flash: 0,
  baseHit: 0,
  muzzle: new Map<number, number>(), // turret tile → seconds of flash / recoil left
  bolts: [] as Bolt[],
};
const prand = rng(99);

function burst(x: number, y: number, color: string, n: number, speed: number): void {
  for (let i = 0; i < n; i++) {
    const a = prand() * Math.PI * 2;
    const sp = speed * (0.4 + prand() * 0.8);
    const life = 0.3 + prand() * 0.35;
    fx.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life, max: life, color });
  }
}

/** Sparks and a small flash where a round lands. */
function impact(x: number, y: number, big: boolean): void {
  burst(x, y, '#ffd27a', big ? 9 : 3, big ? 4 : 3);
  burst(x, y, '#fff6dc', big ? 3 : 1, 2);
  fx.rings.push({ x, y, r: big ? 0.7 : 0.3, t: 0.1, color: '#fff3c4' });
}

const tc = (t: number): [number, number] => [tileX(t) + 0.5, tileY(t) + 0.5];

export function onSignal(sig: Signal, s: GameState | null, numbers: boolean): void {
  switch (sig.t) {
    case 'break': {
      const [x, y] = tc(sig.tile);
      const zone = zoneOf(tileY(sig.tile));
      burst(x, y, ['#a9865f', '#7a8698', '#7a6198'][zone], 8, 3);
      if (sig.ore) {
        burst(x, y, GEM[Math.min(2, sig.ore - 1)].c, 6, 3.5);
        if (numbers) fx.floats.push({ x, y, text: `+${sig.ore}`, color: GEM[Math.min(2, sig.ore - 1)].hi, t: 0 });
      }
      if (sig.source === 'chain' || sig.source === 'resonance') fx.shake = Math.max(fx.shake, 0.1);
      break;
    }
    case 'dig':
      if (prand() < 0.2 && s) {
        const [x, y] = tc(sig.tile);
        burst(x + (s.drone.x - x) * 0.45, y + (s.drone.y - y) * 0.45, '#ffe2a8', 1, 3);
      }
      break;
    case 'link': {
      const [x1, y1] = tc(sig.from), [x2, y2] = tc(sig.to);
      fx.lines.push({ x1, y1, x2, y2, t: 0, dur: 0.3, color: sig.kind === 'chain' ? '#ffe08a' : '#bdf3ff', jag: sig.kind === 'chain' });
      break;
    }
    case 'shot':
      if (sig.tower) {
        const a = Math.atan2(sig.y2 - sig.y1, sig.x2 - sig.x1);
        const dist = Math.hypot(sig.x2 - sig.x1, sig.y2 - sig.y1);
        fx.bolts.push({ x1: sig.x1, y1: sig.y1, x2: sig.x2, y2: sig.y2, a, t: 0, dur: Math.max(0.05, dist / BOLT_SPEED) });
        fx.muzzle.set(idx(Math.floor(sig.x1), Math.floor(sig.y1)), MUZZLE);
        // Spent casing kicked out of the side of the turret head.
        const side = a + Math.PI / 2 * (prand() < 0.5 ? 1 : -1);
        fx.parts.push({ x: sig.x1, y: sig.y1 - 0.2, vx: Math.cos(side) * 2, vy: -2.5, life: 0.4, max: 0.8, color: '#d9a441' });
      } else {
        fx.lines.push({ x1: sig.x1, y1: sig.y1, x2: sig.x2, y2: sig.y2, t: 0, dur: 0.1, color: '#fff3c4', jag: false });
        impact(sig.x2, sig.y2, false);
      }
      break;
    case 'ring':
      fx.rings.push({ x: sig.x, y: sig.y, r: sig.r, t: 0, color: sig.kind === 'pulse' ? '#bdf3ff' : sig.kind === 'cap' ? '#ffe08a' : '#8fb6ff' });
      break;
    case 'kill':
      burst(sig.x, sig.y, '#b47ce0', sig.kind === 'armored' ? 14 : 9, 3);
      break;
    case 'hurt':
      fx.hurt = 0.3;
      fx.shake = Math.max(fx.shake, 0.08);
      break;
    case 'spawn':
      burst(sig.x, sig.y, '#ff7a3b', 8, 2.5);
      break;
    case 'quake':
      fx.quake = 1.6;
      break;
    case 'wave':
      fx.quake = Math.max(fx.quake, 0.6);
      break;
    case 'baseHit':
      fx.baseHit = 0.15;
      burst(BASE_POS.x + 1, BASE_POS.y + 1.6, '#9fe0ef', 2, 2);
      break;
    case 'fall':
      fx.flash = 0.8;
      fx.shake = 0.5;
      break;
    case 'built': {
      const [x, y] = tc(sig.tile);
      burst(x, y, '#c9d4d0', 6, 2);
      break;
    }
    case 'smashed': {
      const [x, y] = tc(sig.tile);
      burst(x, y, '#8fa29e', 14, 3.5);
      fx.shake = Math.max(fx.shake, 0.12);
      break;
    }
    case 'relic':
      burst(sig.x, sig.y, '#9fe0ef', 22, 4);
      fx.rings.push({ x: sig.x, y: sig.y, r: 3, t: 0, color: '#9fe0ef' });
      fx.shake = Math.max(fx.shake, 0.15);
      break;
    case 'threat':
      if (numbers && s) fx.floats.push({ x: s.drone.x, y: s.drone.y - 0.8, text: `騷動 +${sig.amount}`, color: '#e3a6ff', t: 0 });
      break;
    case 'unreachable': {
      const [x, y] = tc(sig.tile);
      fx.marks.push({ x, y, t: 0 });
      break;
    }
    case 'death':
      if (s) burst(s.drone.x, s.drone.y, '#f2b33d', 18, 4);
      fx.shake = 0.25;
      break;
    case 'respawn':
      fx.rings.push({ x: s ? s.drone.x : 0, y: s ? s.drone.y : 0, r: 1.5, t: 0, color: '#9fe0ef' });
      break;
    default:
      break;
  }
}

export function clearFx(): void {
  fx.parts.length = fx.rings.length = fx.lines.length = fx.floats.length = fx.marks.length = fx.bolts.length = 0;
  fx.muzzle.clear();
  fx.shake = fx.quake = fx.hurt = fx.flash = fx.baseHit = 0;
}

function updateFx(dt: number): void {
  for (const p of fx.parts) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 9 * dt;
  }
  fx.parts = fx.parts.filter((p) => p.life > 0);
  for (const r of fx.rings) r.t += dt / 0.4;
  fx.rings = fx.rings.filter((r) => r.t < 1);
  for (const l of fx.lines) l.t += dt / l.dur;
  fx.lines = fx.lines.filter((l) => l.t < 1);
  for (const f of fx.floats) f.t += dt / 0.9;
  fx.floats = fx.floats.filter((f) => f.t < 1);
  for (const m of fx.marks) m.t += dt / 0.6;
  fx.marks = fx.marks.filter((m) => m.t < 1);
  for (const [k, v] of fx.muzzle) v - dt <= 0 ? fx.muzzle.delete(k) : fx.muzzle.set(k, v - dt);
  for (const bo of fx.bolts) {
    bo.t += dt / bo.dur;
    if (bo.t >= 1) impact(bo.x2, bo.y2, true);
  }
  fx.bolts = fx.bolts.filter((bo) => bo.t < 1);
  fx.shake = Math.max(0, fx.shake - dt);
  fx.quake = Math.max(0, fx.quake - dt);
  fx.hurt = Math.max(0, fx.hurt - dt);
  fx.flash = Math.max(0, fx.flash - dt);
  fx.baseHit = Math.max(0, fx.baseHit - dt);
}

// ---- Drawing ----------------------------------------------------------------------

export interface DrawOpts {
  hover: number;
  coverage: number[] | null; // open tiles a turret (placed or planned) can hit
  ghost: { tile: number; kind: BuildKind; ok: boolean } | null;
  dt: number;
  time: number;
  dpr: number;
}

const buf = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const vari = (x: number, y: number) => ((x * 7919 + y * 104729) >>> 0) % 4;
const enemyDir = new Map<number, { x: number; dir: 'left' | 'right' }>();

export function draw(main: CanvasRenderingContext2D, s: GameState, v: View, o: DrawOpts): void {
  updateFx(o.dt);
  if (!buf) return;
  const T = textures();
  if (buf.width !== v.bw || buf.height !== v.bh) {
    buf.width = v.bw;
    buf.height = v.bh;
  }
  const b = buf.getContext('2d')!;
  b.imageSmoothingEnabled = false;
  const w = s.world;
  const d = s.drone;
  const t = o.time;
  let shx = 0, shy = 0;
  const sh = Math.max(fx.shake, fx.quake * 0.5);
  if (sh > 0) {
    shx = Math.round((prand() - 0.5) * sh * 10);
    shy = Math.round((prand() - 0.5) * sh * 10);
  }
  const cx = Math.round(v.camX) + shx, cy = Math.round(v.camY) + shy;
  const X = (wx: number) => Math.round(wx * TP) - cx;
  const Y = (wy: number) => Math.round(wy * TP) - cy;
  b.fillStyle = '#07060a';
  b.fillRect(0, 0, v.bw, v.bh);

  const x0 = Math.floor(cx / TP) - 1, x1 = Math.ceil((cx + v.bw) / TP) + 1;
  const y0 = Math.floor(cy / TP) - 1, y1 = Math.ceil((cy + v.bh) / TP) + 2;
  const solidAt = (x: number, y: number) => !inBounds(x, y) || !w.seen[idx(x, y)] || !isWalkable(w.kind[idx(x, y)]);

  // Pass 1: floors.
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (solidAt(x, y)) continue;
      const i = idx(x, y);
      const px = x * TP - cx, py = y * TP - cy;
      const inChamber = x >= CHAMBER.x0 && x <= CHAMBER.x1 && y <= CHAMBER.y1;
      if (w.kind[i] === T_RIFT) drawRift(b, px, py, t, x);
      else b.drawImage(inChamber ? T.plate : T.floor[zoneOf(y)][vari(x, y)], px, py);
      if (w.trap[i]) b.drawImage(T.trap, px, py);
      if (solidAt(x, y - 1)) {
        b.fillStyle = 'rgba(0,0,0,0.4)';
        b.fillRect(px, py, TP, 3);
        b.fillStyle = 'rgba(0,0,0,0.2)';
        b.fillRect(px, py + 3, TP, 2);
      }
    }
  }

  // Turret coverage preview: the tunnel tiles it can shoot.
  if (o.coverage) {
    const pulse = 0.26 + 0.08 * Math.sin(t * 5);
    for (const c of o.coverage) {
      const px = tileX(c) * TP - cx, py = tileY(c) * TP - cy;
      b.fillStyle = `rgba(255,200,100,${pulse.toFixed(2)})`;
      b.fillRect(px, py, TP, TP);
      b.fillStyle = 'rgba(255,220,140,0.8)';
      b.fillRect(px + 7, py + 7, 2, 2);
      b.fillStyle = 'rgba(255,200,100,0.45)';
      b.fillRect(px, py, TP, 1);
      b.fillRect(px, py + TP - 1, TP, 1);
      b.fillRect(px, py, 1, TP);
      b.fillRect(px + TP - 1, py, 1, TP);
    }
  }

  // Entities grouped by the row their feet are in.
  type Ent = { row: number; draw: () => void };
  const ents: Ent[] = [];
  if (d.dead < 0) ents.push({ row: Math.floor(d.y), draw: () => drawMiner(b, s, X(d.x), Y(d.y), t) });
  for (const e of s.enemies) ents.push({ row: Math.floor(e.y), draw: () => drawEnemy(b, e, X(e.x), Y(e.y), t) });

  // Pass 2: blocks row by row, then the sprites standing in that row.
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!solidAt(x, y)) continue;
      drawBlock(b, s, x, y, x * TP - cx, y * TP - cy, t, solidAt);
    }
    for (const e of ents) if (e.row === y) e.draw();
  }

  // Ghost of the building about to be placed.
  if (o.ghost && o.ghost.tile >= 0) {
    const gx = tileX(o.ghost.tile) * TP - cx, gy = tileY(o.ghost.tile) * TP - cy;
    b.globalAlpha = 0.6;
    if (o.ghost.kind === 'trap') b.drawImage(T.trap, gx, gy);
    else {
      b.drawImage(o.ghost.kind === 'wall' ? T.wallTop : T.metalTop, gx, gy - WH);
      b.drawImage(o.ghost.kind === 'wall' ? T.wallFront : T.metalFront, gx, gy + TP - WH);
    }
    b.globalAlpha = 1;
    b.strokeStyle = o.ghost.ok ? '#93d49d' : '#ff7f93';
    b.strokeRect(gx + 0.5, gy - (o.ghost.kind === 'trap' ? 0 : WH) + 0.5, TP - 1, TP - 1 + (o.ghost.kind === 'trap' ? 0 : WH));
  }

  // Hover and dig target outlines.
  const outline = (tile: number, col: string, dashed: boolean) => {
    const lifted = !isWalkable(w.kind[tile]) || !w.seen[tile];
    const ox = tileX(tile) * TP - cx, oy = tileY(tile) * TP - cy - (lifted ? WH : 0);
    const hgt = TP + (lifted ? WH : 0);
    b.fillStyle = col;
    if (!dashed) {
      b.fillRect(ox, oy, TP, 1); b.fillRect(ox, oy + hgt - 1, TP, 1);
      b.fillRect(ox, oy, 1, hgt); b.fillRect(ox + TP - 1, oy, 1, hgt);
      return;
    }
    for (const [ax, ay] of [[ox, oy], [ox + TP - 4, oy], [ox, oy + hgt - 1], [ox + TP - 4, oy + hgt - 1]]) b.fillRect(ax, ay, 4, 1);
    for (const [ax, ay] of [[ox, oy], [ox + TP - 1, oy], [ox, oy + hgt - 4], [ox + TP - 1, oy + hgt - 4]]) b.fillRect(ax, ay, 1, 4);
  };
  if (o.hover >= 0 && !o.ghost) outline(o.hover, 'rgba(255,255,255,0.7)', false);
  if (d.dig >= 0) outline(d.dig, '#ffe08a', true);

  // Monster routes: always with the echo lens, and during the quake warning.
  if (has(s, 'lens') || s.wave.announced || s.raid.toSpawn > 0 || fx.quake > 0) {
    const blink = Math.sin(t * 10) > -0.3;
    if (blink) {
      for (const r of RIFTS) {
        if (!w.seen[idx(r.x, r.y)] && !w.scan[idx(r.x, r.y)] && !s.wave.announced && s.raid.toSpawn === 0) continue;
        const route = routeFrom(s, idx(r.x, r.y));
        for (let k = 1; k < route.length; k++) {
          if (k % 2) continue;
          const [ax, ay] = tc(route[k - 1]), [bx, by] = tc(route[k]);
          pixelLine(b, X(ax), Y(ay), X(bx), Y(by), 'rgba(255,90,110,0.85)');
        }
      }
    }
  }

  // Effects.
  for (const l of fx.lines) {
    b.globalAlpha = 1 - l.t;
    if (l.jag) {
      const r = rng(Math.floor(l.x1 * 97 + l.y2 * 13 + l.t * 8));
      let px = X(l.x1), py = Y(l.y1);
      for (let k = 1; k <= 3; k++) {
        const nx = k === 3 ? X(l.x2) : Math.round(X(l.x1) + (X(l.x2) - X(l.x1)) * (k / 3) + (r() - 0.5) * 6);
        const ny = k === 3 ? Y(l.y2) : Math.round(Y(l.y1) + (Y(l.y2) - Y(l.y1)) * (k / 3) + (r() - 0.5) * 6);
        pixelLine(b, px, py, nx, ny, l.color);
        px = nx; py = ny;
      }
    } else pixelLine(b, X(l.x1), Y(l.y1) - 4, X(l.x2), Y(l.y2) - 3, l.color);
  }
  b.globalAlpha = 1;
  for (const bo of fx.bolts) {
    // Start at the barrel tip (head sits 7 px above the tile centre), end at the target's body.
    const sx = X(bo.x1) + Math.cos(bo.a) * 9, sy = Y(bo.y1) - 7 + Math.sin(bo.a) * 9;
    const ex = X(bo.x2), ey = Y(bo.y2) - 4;
    const at = (f: number): [number, number] => [Math.round(sx + (ex - sx) * f), Math.round(sy + (ey - sy) * f)];
    const [hx, hy] = at(bo.t);
    const [tx, ty] = at(Math.max(0, bo.t - 0.6));
    const [mx, my] = at(Math.max(0, bo.t - 0.25));
    // Two-pixel-thick tracer: a faint long tail, a hot short core, a bright head.
    const ox = Math.abs(Math.cos(bo.a)) > Math.abs(Math.sin(bo.a)) ? 0 : 1, oy = 1 - ox;
    pixelLine(b, tx, ty, hx, hy, 'rgba(255,170,70,0.5)');
    pixelLine(b, tx + ox, ty + oy, hx + ox, hy + oy, 'rgba(255,170,70,0.35)');
    pixelLine(b, mx, my, hx, hy, '#ffd27a');
    pixelLine(b, mx + ox, my + oy, hx + ox, hy + oy, '#ffd27a');
    b.fillStyle = '#fff6dc';
    b.fillRect(hx - 1, hy - 1, 3, 3);
  }
  for (const r of fx.rings) {
    b.globalAlpha = 1 - r.t;
    b.strokeStyle = r.color;
    b.lineWidth = 1;
    b.beginPath();
    b.arc(X(r.x) + 0.5, Y(r.y) + 0.5, r.r * TP * (0.3 + 0.7 * r.t), 0, Math.PI * 2);
    b.stroke();
  }
  b.globalAlpha = 1;
  for (const p of fx.parts) {
    b.fillStyle = p.color;
    b.fillRect(X(p.x), Y(p.y) - 4, p.life > p.max * 0.5 ? 2 : 1, p.life > p.max * 0.5 ? 2 : 1);
  }
  for (const m of fx.marks) {
    b.fillStyle = `rgba(255,111,138,${1 - m.t})`;
    const mx = X(m.x), my = Y(m.y) - 3;
    for (let k = -3; k <= 3; k++) { b.fillRect(mx + k, my + k, 1, 1); b.fillRect(mx + k, my - k, 1, 1); }
  }

  drawLighting(b, s, v, cx, cy, t);
  drawSignals(b, s, X(d.x), Y(d.y) - 6, t);

  // Scale up.
  main.setTransform(1, 0, 0, 1, 0, 0);
  main.imageSmoothingEnabled = false;
  main.drawImage(buf, 0, 0, v.bw * v.S * o.dpr, v.bh * v.S * o.dpr);
  main.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);

  // Full-resolution overlays: floating numbers, minimap, vignettes.
  main.font = `700 ${Math.max(12, v.S * 5)}px ${FONT}`;
  main.textAlign = 'center';
  main.textBaseline = 'middle';
  for (const f of fx.floats) {
    main.globalAlpha = 1 - f.t * f.t;
    main.fillStyle = INK;
    const fxp = X(f.x) * v.S, fyp = (Y(f.y) - 10 - f.t * 10) * v.S;
    main.fillText(f.text, fxp + 1, fyp + 1);
    main.fillStyle = f.color;
    main.fillText(f.text, fxp, fyp);
  }
  main.globalAlpha = 1;
  if (d.dead >= 0) {
    main.fillStyle = '#fbf3e6';
    main.font = `700 ${Math.max(14, v.S * 6)}px ${FONT}`;
    main.fillText(`探機重建中… ${Math.ceil(d.dead)}`, v.w / 2, v.h * 0.4);
  }
  drawMinimap(main, s, v);
  if (fx.hurt > 0 || fx.flash > 0) {
    const a = Math.max(fx.hurt * 0.9, fx.flash * 0.7);
    const g = main.createRadialGradient(v.w / 2, v.h / 2, Math.min(v.w, v.h) * 0.3, v.w / 2, v.h / 2, Math.max(v.w, v.h) * 0.75);
    g.addColorStop(0, 'rgba(255,60,80,0)');
    g.addColorStop(1, `rgba(255,60,80,${a})`);
    main.fillStyle = g;
    main.fillRect(0, 0, v.w, v.h);
  }
}

function drawRift(b: CanvasRenderingContext2D, px: number, py: number, t: number, seed: number): void {
  b.fillStyle = '#2a0e12';
  b.fillRect(px, py, TP, TP);
  const r = rng(seed * 31 + 7);
  for (let k = 0; k < 18; k++) {
    const x = Math.floor(r() * TP), y = Math.floor(r() * TP);
    const glow = 0.5 + 0.5 * Math.sin(t * 4 + k);
    b.fillStyle = glow > 0.6 ? '#ffb347' : '#e0442a';
    b.fillRect(px + x, py + y, 1 + (k % 3 === 0 ? 1 : 0), 1);
  }
  b.fillStyle = `rgba(255,120,60,${0.15 + 0.1 * Math.sin(t * 3)})`;
  b.fillRect(px + 2, py + 2, TP - 4, TP - 4);
}

function drawBlock(
  b: CanvasRenderingContext2D, s: GameState, x: number, y: number, px: number, py: number, t: number,
  solidAt: (x: number, y: number) => boolean,
): void {
  const T = textures();
  const w = s.world;
  const zone = zoneOf(Math.max(0, Math.min(MAP_H - 1, y)));
  const v = vari(x, y);
  const i = inBounds(x, y) ? idx(x, y) : -1;
  const k = i >= 0 ? w.kind[i] : T_ROCK;
  const known = i >= 0 && w.seen[i];

  if (!known) {
    b.fillStyle = '#100d15';
    b.fillRect(px, py - WH, TP, TP);
    b.fillStyle = '#0b090f';
    b.fillRect(px, py + TP - WH, TP, WH);
    if (i >= 0 && w.scan[i] && (k === T_ORE || k === T_RELIC || k === T_RIFT)) {
      // Lens outline of something not yet seen.
      b.fillStyle = k === T_ORE ? GEM[Math.min(2, w.ore[i] - 1)].c : k === T_RIFT ? '#ff7a3b' : '#9fe0ef';
      b.globalAlpha = 0.5 + 0.2 * Math.sin(t * 3 + x);
      b.fillRect(px + 6, py - WH + 6, 4, 4);
      b.globalAlpha = 1;
    }
    return;
  }
  if (k === T_BASE) {
    if (x === BASE_POS.x && y === BASE_POS.y + 1) drawBase(b, s, px, py - TP, t);
    return;
  }
  if (k === T_ROCK || k === T_ORE) {
    b.drawImage(T.rockTop[zone][v], px, py - WH);
    b.drawImage(T.rockFront[zone][v], px, py + TP - WH);
    if (k === T_ORE) {
      const g = Math.min(2, w.ore[i] - 1);
      b.drawImage(T.oreTop[g][v], px, py - WH);
      b.drawImage(T.oreFront[g], px, py + TP - WH);
    }
    const frac = w.hp[i] / ROCK_HP[w.hard[i]];
    if (frac < 0.98) cracks(b, px, py - WH, 1 - frac, x * 13 + y);
  } else if (k === T_WALL) {
    b.drawImage(T.wallTop, px, py - WH);
    b.drawImage(T.wallFront, px, py + TP - WH);
    const frac = w.hp[i] / BUILD.wall.hp;
    if (frac < 0.98) cracks(b, px, py - WH, 1 - frac, i);
  } else if (k === T_TURRET) {
    b.drawImage(T.metalTop, px, py - WH);
    b.drawImage(T.metalFront, px, py + TP - WH);
    const tw = s.towers[i];
    const a = tw ? tw.angle : Math.PI / 2;
    const m = fx.muzzle.get(i) ?? 0;
    const kick = Math.round((m / MUZZLE) * 2); // recoil: the head jolts back when it fires
    const hx = px + 8 - Math.round(Math.cos(a) * kick), hy = py + 7 - WH - Math.round(Math.sin(a) * kick);
    b.fillStyle = INK;
    b.fillRect(hx - 4, hy - 3, 8, 7);
    b.fillStyle = '#2f363d';
    b.fillRect(hx - 3, hy - 3, 6, 6);
    b.fillStyle = '#4a545e';
    b.fillRect(hx - 3, hy - 3, 6, 2);
    pixelLine(b, hx, hy, Math.round(hx + Math.cos(a) * 7), Math.round(hy + Math.sin(a) * 7), '#cfd6dc');
    if (m > 0) {
      // Muzzle flash: a hot core, a forward jet and two side sparks.
      const fxp = Math.round(hx + Math.cos(a) * 9), fyp = Math.round(hy + Math.sin(a) * 9);
      const big = m > MUZZLE * 0.5;
      b.fillStyle = '#ff9a3c';
      b.fillRect(fxp - (big ? 3 : 2), fyp - (big ? 3 : 2), big ? 7 : 5, big ? 7 : 5);
      b.fillStyle = '#ffd27a';
      b.fillRect(fxp - 2, fyp - 2, 5, 5);
      b.fillStyle = '#fff6dc';
      b.fillRect(fxp - 1, fyp - 1, 3, 3);
      pixelLine(b, fxp, fyp, Math.round(fxp + Math.cos(a) * (big ? 8 : 4)), Math.round(fyp + Math.sin(a) * (big ? 8 : 4)), '#fff6dc');
      for (const side of [1, -1]) {
        const sa = a + side * 1.0;
        pixelLine(b, fxp, fyp, Math.round(fxp + Math.cos(sa) * (big ? 5 : 3)), Math.round(fyp + Math.sin(sa) * (big ? 5 : 3)), '#ffb347');
      }
    }
    b.fillStyle = Math.sin(t * 6) > 0 ? '#93d49d' : '#3f6f47';
    b.fillRect(hx - 1, hy + 2, 2, 1);
    const frac = w.hp[i] / BUILD.turret.hp;
    if (frac < 0.98) cracks(b, px, py - WH, 1 - frac, i);
  } else if (k === T_RELIC) {
    const site = s.sites.find((p) => p.x === x && p.y === y);
    b.drawImage(site?.activated ? T.relicDim : T.relicTop, px, py - WH);
    b.drawImage(T.relicFront, px, py + TP - WH);
    if (site && !site.activated && Math.sin(t * 3) > 0) {
      b.fillStyle = '#eafcff';
      b.fillRect(px + 7, py - WH + 7, 2, 2);
    }
  }
  // Rims where the block meets an open tunnel.
  if (k !== T_TURRET && k !== T_WALL && k !== T_RELIC) {
    const rim = ZONE_PAL[zone].rim;
    b.fillStyle = rim;
    if (!solidAt(x, y - 1)) b.fillRect(px, py - WH, TP, 1);
    if (!solidAt(x - 1, y)) b.fillRect(px, py - WH, 1, TP);
    if (!solidAt(x + 1, y)) b.fillRect(px + TP - 1, py - WH, 1, TP);
    b.fillStyle = INK;
    if (!solidAt(x - 1, y)) b.fillRect(px, py + TP - WH, 1, WH);
    if (!solidAt(x + 1, y)) b.fillRect(px + TP - 1, py + TP - WH, 1, WH);
  }
}

function cracks(b: CanvasRenderingContext2D, px: number, py: number, dmg: number, seed: number): void {
  const r = rng(seed * 17 + 3);
  b.fillStyle = INK;
  const n = 1 + Math.floor(dmg * 4);
  for (let k = 0; k < n; k++) {
    let x = 8, y = 8;
    const ang = r() * Math.PI * 2;
    const len = 3 + Math.floor(dmg * 6);
    for (let s = 0; s < len; s++) {
      b.fillRect(px + Math.round(x), py + Math.round(y), 1, 1);
      x += Math.cos(ang + (r() - 0.5));
      y += Math.sin(ang + (r() - 0.5));
    }
  }
}

function drawBase(b: CanvasRenderingContext2D, s: GameState, px: number, py: number, t: number): void {
  // 32 × (32 + WH): a drilling rig with a glowing core window.
  const top = py - WH;
  b.fillStyle = INK;
  b.fillRect(px, top + 4, 32, 28 + WH - 4);
  b.fillStyle = '#3a414a';
  b.fillRect(px + 1, top + 5, 30, 26);
  b.fillStyle = '#55606b';
  b.fillRect(px + 1, top + 5, 30, 4);
  b.fillStyle = '#2b3138';
  b.fillRect(px + 1, top + 31, 30, WH - 1);
  b.fillStyle = '#f2b33d';
  for (let x = 2; x < 30; x += 6) b.fillRect(px + x, top + 32, 3, 2);
  // Mast.
  b.fillStyle = INK;
  b.fillRect(px + 14, top, 4, 6);
  b.fillStyle = Math.sin(t * 4) > 0 ? '#ff5a6e' : '#7a2a35';
  b.fillRect(px + 15, top, 2, 2);
  // Core window.
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.5);
  b.fillStyle = INK;
  b.fillRect(px + 9, top + 12, 14, 14);
  b.fillStyle = fx.baseHit > 0 ? '#ff7f93' : pulse > 0.5 ? '#9fe0ef' : '#6fc2d6';
  b.fillRect(px + 10, top + 13, 12, 12);
  b.fillStyle = '#eafcff';
  b.fillRect(px + 14, top + 17, 4, 4);
  // Bolts.
  b.fillStyle = '#7d8894';
  for (const [x, y] of [[3, 11], [27, 11], [3, 27], [27, 27]]) b.fillRect(px + x, top + y, 2, 2);
  // Damage.
  const frac = s.base.hp / maxBaseHp(s);
  if (frac < 0.6) cracks(b, px + 4, top + 6, 1 - frac, 5);
  if (frac < 0.3) cracks(b, px + 18, top + 14, 1 - frac, 9);
  // HP bar.
  b.fillStyle = INK;
  b.fillRect(px + 2, top - 5, 28, 3);
  b.fillStyle = frac > 0.35 ? '#9fe0ef' : '#ff7f93';
  b.fillRect(px + 3, top - 4, Math.max(0, Math.round(26 * frac)), 1);
}

function drawMiner(b: CanvasRenderingContext2D, s: GameState, x: number, y: number, t: number): void {
  const T = textures();
  const d = s.drone;
  const face = (['up', 'right', 'down', 'left'] as const)[d.face];
  const moving = d.path.length > 0;
  const frames = T.miner[face];
  const fr = moving ? Math.floor(t * 8) % 2 : 0;
  const img = frames[fr];
  const sx = x - Math.floor(img.width / 2), sy = y + 3 - img.height - (moving && fr ? 1 : 0);
  // Shadow.
  b.fillStyle = 'rgba(0,0,0,0.35)';
  b.fillRect(x - 5, y + 2, 10, 2);
  if (d.recall >= 0) {
    const p = Math.min(1, d.recall / RECALL_TIME);
    b.fillStyle = `rgba(159,224,239,${0.25 + p * 0.5})`;
    b.fillRect(x - 4, y - 40, 8, 42);
  }
  const digging = d.dig >= 0 && !moving;
  const drawPick = () => {
    const base = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][d.face];
    const swing = digging ? Math.sin(t * 16) * 0.9 : 0.6;
    const a = base + swing - 0.3;
    const hx = x + (d.face === 1 ? 3 : d.face === 3 ? -3 : 0), hy = y - 6;
    const ex = Math.round(hx + Math.cos(a) * 8), ey = Math.round(hy + Math.sin(a) * 8);
    pixelLine(b, hx, hy, ex, ey, '#8a5a36');
    const pa = a + Math.PI / 2;
    pixelLine(b, Math.round(ex - Math.cos(pa) * 3), Math.round(ey - Math.sin(pa) * 3), Math.round(ex + Math.cos(pa) * 3), Math.round(ey + Math.sin(pa) * 3), '#c9d1d9');
  };
  if (d.face === 0) drawPick();
  if (d.hurt > 0 && Math.floor(t * 20) % 2) b.globalAlpha = 0.45;
  b.drawImage(img, sx, sy);
  b.globalAlpha = 1;
  if (d.face !== 0) drawPick();
  if (s.bio > 0) {
    b.fillStyle = '#93d49d';
    b.fillRect(x - 1, sy - 3, 2, 2);
  }
}

function drawEnemy(b: CanvasRenderingContext2D, e: GameState['enemies'][number], x: number, y: number, t: number): void {
  const T = textures();
  const prev = enemyDir.get(e.id);
  let dir: 'left' | 'right' = prev?.dir ?? 'right';
  if (prev && Math.abs(e.x - prev.x) > 0.002) dir = e.x > prev.x ? 'right' : 'left';
  enemyDir.set(e.id, { x: e.x, dir });
  const set = e.kind === 'armored' ? T.armored : T.crawler;
  const img = set[dir][Math.floor(t * 9 + e.id) % 2];
  const jitter = e.chew > 0 ? Math.round(Math.sin(t * 40)) : 0;
  b.fillStyle = 'rgba(0,0,0,0.35)';
  b.fillRect(x - img.width / 2 + 1, y + 2, img.width - 2, 2);
  if (e.hit > 0) b.globalAlpha = 0.55;
  b.drawImage(img, x - Math.floor(img.width / 2) + jitter, y + 3 - img.height);
  b.globalAlpha = 1;
  if (e.hp < e.maxHp) {
    b.fillStyle = INK;
    b.fillRect(x - 6, y - img.height - 1, 12, 3);
    b.fillStyle = '#e6c8ff';
    b.fillRect(x - 5, y - img.height, Math.max(0, Math.round(10 * (e.hp / e.maxHp))), 1);
  }
  if (e.stun > 0) {
    b.fillStyle = '#bdf3ff';
    b.fillRect(x - 2, y - img.height - 3, 1, 1);
    b.fillRect(x + 2, y - img.height - 4, 1, 1);
  }
}

/** Darkness with a lamp around the miner, glows at the base, turrets, rifts and relics. */
function drawLighting(b: CanvasRenderingContext2D, s: GameState, v: View, cx: number, cy: number, t: number): void {
  const w = s.world;
  const d = s.drone;
  const lights: { x: number; y: number; r: number; i: number }[] = [];
  if (d.dead < 0) lights.push({ x: d.x, y: d.y, r: VISION + 1.5 + Math.sin(t * 7) * 0.08, i: 1 });
  lights.push({ x: BASE_POS.x + 1, y: BASE_POS.y + 1, r: 5, i: 0.95 });
  for (const key of Object.keys(s.towers)) {
    const k = Number(key);
    const flash = (fx.muzzle.get(k) ?? 0) / MUZZLE;
    lights.push({ x: tileX(k) + 0.5, y: tileY(k) + 0.5, r: 2.6 + flash * 1.4, i: 0.7 + flash * 0.3 });
  }
  for (const r of RIFTS) if (w.seen[idx(r.x, r.y)]) lights.push({ x: r.x + 0.5, y: r.y + 0.5, r: 3.2, i: 0.8 });
  for (const p of s.sites) if (!p.activated && w.seen[idx(p.x, p.y)]) lights.push({ x: p.x + 0.5, y: p.y + 0.5, r: 2.2, i: 0.6 });
  const CELL = 4;
  for (let sy = 0; sy < v.bh; sy += CELL) {
    for (let sx = 0; sx < v.bw; sx += CELL) {
      const wx = (cx + sx + CELL / 2) / TP, wy = (cy + sy + CELL / 2 + WH / 2) / TP;
      let light = 0;
      for (const l of lights) {
        const dd = Math.hypot(wx - l.x, wy - l.y);
        if (dd < l.r) light = Math.max(light, (1 - dd / l.r) ** 0.8 * l.i);
      }
      const tx = Math.floor(wx), ty = Math.floor(wy);
      const seen = inBounds(tx, ty) && w.seen[idx(tx, ty)];
      const a = Math.min(seen ? 0.72 : 0.9, 0.92 * (1 - Math.min(1, light * 1.6)));
      if (a <= 0.01) continue;
      b.fillStyle = `rgba(4,3,8,${a.toFixed(2)})`;
      b.fillRect(sx, sy, CELL, CELL);
    }
  }
  // Coloured glows.
  b.globalCompositeOperation = 'lighter';
  const glow = (x: number, y: number, r: number, col: string) => {
    const g = b.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = g;
    b.fillRect(x - r, y - r, r * 2, r * 2);
  };
  if (d.dead < 0) glow(d.x * TP - cx, d.y * TP - cy - 6, 40, 'rgba(255,200,120,0.10)');
  for (const r of RIFTS) if (w.seen[idx(r.x, r.y)]) glow((r.x + 0.5) * TP - cx, (r.y + 0.5) * TP - cy, 44, `rgba(255,80,40,${0.22 + 0.06 * Math.sin(t * 3)})`);
  glow((BASE_POS.x + 1) * TP - cx, (BASE_POS.y + 1) * TP - cy - 4, 46, 'rgba(120,220,255,0.12)');
  for (const [k, m] of fx.muzzle) glow((tileX(k) + 0.5) * TP - cx, (tileY(k) + 0.5) * TP - cy - 7, 30, `rgba(255,190,90,${(0.5 * m / MUZZLE).toFixed(2)})`);
  for (const bo of fx.bolts) {
    const bx = bo.x1 + (bo.x2 - bo.x1) * bo.t, by = bo.y1 + (bo.y2 - bo.y1) * bo.t;
    glow(bx * TP - cx, by * TP - cy - 5, 12, 'rgba(255,200,110,0.45)');
  }
  b.globalCompositeOperation = 'source-over';
}

/** Fuzzy direction hints toward relic sites not yet seen. */
function drawSignals(b: CanvasRenderingContext2D, s: GameState, x: number, y: number, t: number): void {
  const d = s.drone;
  if (d.dead >= 0) return;
  s.sites.forEach((p, i) => {
    if (p.activated || s.world.seen[idx(p.x, p.y)]) return;
    const dist = Math.hypot(p.x + 0.5 - d.x, p.y + 0.5 - d.y);
    if (dist > SIGNAL_RANGE) return;
    const a = Math.atan2(p.y + 0.5 - d.y, p.x + 0.5 - d.x) + (((i * 37) % 10) / 10 - 0.5) * 0.5;
    const rr = 14 + Math.sin(t * 4 + i);
    const ax = Math.round(x + Math.cos(a) * rr), ay = Math.round(y + Math.sin(a) * rr);
    b.globalAlpha = 0.4 + 0.5 * (1 - dist / SIGNAL_RANGE);
    b.fillStyle = '#9fe0ef';
    b.fillRect(ax - 1, ay - 1, 3, 3);
    b.fillRect(Math.round(ax + Math.cos(a) * 3), Math.round(ay + Math.sin(a) * 3), 1, 1);
    b.globalAlpha = 1;
  });
}

let mini: HTMLCanvasElement | null = null;
let miniT = 0;

function drawMinimap(main: CanvasRenderingContext2D, s: GameState, v: View): void {
  const k = v.w < 600 ? 2 : 3;
  if (!mini) mini = document.createElement('canvas');
  const now = performance.now();
  if (now - miniT > 200 || mini.width !== MAP_W * k) {
    miniT = now;
    mini.width = MAP_W * k;
    mini.height = MAP_H * k;
    const m = mini.getContext('2d')!;
    m.fillStyle = 'rgba(8,6,12,0.85)';
    m.fillRect(0, 0, mini.width, mini.height);
    const w = s.world;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = idx(x, y);
        if (!w.seen[i]) continue;
        const kk = w.kind[i];
        m.fillStyle = isWalkable(kk) ? (kk === T_RIFT ? '#ff5a3b' : '#6e5a4c')
          : kk === T_WALL ? '#9fb3ae' : kk === T_TURRET ? '#f2b33d' : kk === T_RELIC ? '#9fe0ef'
          : kk === T_ORE ? GEM[Math.min(2, w.ore[i] - 1)].lo : '#2a2430';
        m.fillRect(x * k, y * k, k, k);
      }
    }
    for (const r of RIFTS) { m.fillStyle = '#ff5a3b'; m.fillRect(r.x * k, r.y * k, k, k); }
    m.fillStyle = '#9fe0ef';
    m.fillRect(BASE_POS.x * k, BASE_POS.y * k, 2 * k, 2 * k);
    m.fillStyle = '#ff5a6e';
    for (const e of s.enemies) m.fillRect(Math.floor(e.x) * k, Math.floor(e.y) * k, k, k);
    if (s.drone.dead < 0) {
      m.fillStyle = '#ffffff';
      m.fillRect(Math.floor(s.drone.x) * k - 1, Math.floor(s.drone.y) * k - 1, k + 2, k + 2);
    }
    // View rectangle.
    m.strokeStyle = 'rgba(255,255,255,0.5)';
    m.strokeRect((v.camX / TP) * k + 0.5, (v.camY / TP) * k + 0.5, (v.bw / TP) * k, (v.bh / TP) * k);
  }
  const mx = v.w - mini.width - 10, my = 10;
  main.globalAlpha = 0.9;
  main.drawImage(mini, mx, my);
  main.globalAlpha = 1;
  main.strokeStyle = 'rgba(239,230,218,0.25)';
  main.strokeRect(mx - 0.5, my - 0.5, mini.width + 1, mini.height + 1);
}
