import {
  FACE_X, GROUND_Y, LAYER_H, LAYERS, MINE_TOP, RUSH_MAX, RUSH_MULT, SHAFT_W, SHAFT_X, STASH_X, STORE_X, WORLD_W,
} from './config';
import { workerCount } from './economy';
import { credits } from './format';
import type { GameState } from './state';
import { layerFloor, layerTop } from './sim';
import { anyAffordable, canUnlock, elevatorCapacity } from './upgrades';
import { flows, type Station } from './flows';

export interface Camera {
  y: number;
  scale: number;
  viewW: number; // world units
  viewH: number; // world units
}

export interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  action: string;
}

const FONT = '"Chakra Petch", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
const C = {
  lamp: '#f4b53f',
  lampGlow: 'rgba(244, 181, 63, 0.16)',
  helion: '#9fe0ef',
  text: '#efe6da',
  dim: '#a8998a',
  ok: '#7fd18b',
  warn: '#e48a78',
  skin: '#d9a982',
  suit: '#5d6b74',
  suitHaul: '#7a5f4a',
};

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r0 = rng(7);
const STARS = Array.from({ length: 70 }, () => ({ x: r0() * WORLD_W, y: r0() * (GROUND_Y - 80), s: r0() * 1.2 + 0.3, p: r0() * 6 }));
const RIDGE_FAR = Array.from({ length: 13 }, (_, i) => ({ x: (i / 12) * WORLD_W, y: GROUND_Y - 46 - r0() * 34 }));
const RIDGE_NEAR = Array.from({ length: 17 }, (_, i) => ({ x: (i / 16) * WORLD_W, y: GROUND_Y - 18 - r0() * 22 }));
const SPECKLES = LAYERS.map((_, i) => {
  const r = rng(100 + i);
  return Array.from({ length: 46 }, () => ({ x: r() * WORLD_W, y: r() * LAYER_H, s: r() * 2 + 0.8, v: r() < 0.35 }));
});

// Ambient surface pedestrians (visual only).
interface Walker { x: number; dir: number; speed: number; phase: number; pause: number }
const walkers: Walker[] = [];
const DORM_DOOR = 176;
const CANTEEN_DOOR = 252;

function updateWalkers(s: GameState, dt: number): void {
  const want = Math.min(7, Math.floor(workerCount(s) / 4));
  while (walkers.length < want) {
    walkers.push({ x: DORM_DOOR + Math.random() * (CANTEEN_DOOR - DORM_DOOR), dir: Math.random() < 0.5 ? 1 : -1, speed: 14 + Math.random() * 10, phase: Math.random() * 10, pause: 0 });
  }
  walkers.length = want;
  for (const w of walkers) {
    if (w.pause > 0) { w.pause -= dt; continue; }
    w.x += w.dir * w.speed * dt;
    w.phase += dt * (w.speed / 25);
    if (w.x > CANTEEN_DOOR || w.x < DORM_DOOR) {
      w.x = Math.max(DORM_DOOR, Math.min(CANTEEN_DOOR, w.x));
      w.dir *= -1;
      w.pause = 1 + Math.random() * 4;
    }
  }
}

export function contentHeight(s: GameState): number {
  const unlocked = s.layers.filter((l) => l.unlocked).length;
  const shown = Math.min(LAYERS.length, unlocked + 1);
  return MINE_TOP + shown * LAYER_H + 24;
}

// ---- Primitive helpers -----------------------------------------------------

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Canvas text is scaled up so labels stay legible when the world is shrunk to phone width.
const TEXT_SCALE = 1.4;

function text(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', weight = 600): void {
  ctx.font = `${weight} ${size * TEXT_SCALE}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, x, y);
}

interface WorkerOpts {
  dir: number;
  phase: number;
  walking: boolean;
  suit: string;
  sack?: number; // 0..1 fullness
  swing?: number; // pickaxe angle driver, undefined = no pick
  lamp?: boolean;
  scale?: number;
}

function drawWorker(ctx: CanvasRenderingContext2D, x: number, floor: number, o: WorkerOpts): void {
  const k = o.scale ?? 1;
  ctx.save();
  ctx.translate(x, floor);
  ctx.scale(o.dir * k, k);
  if (o.lamp) {
    const g = ctx.createRadialGradient(3, -18, 1, 3, -18, 26);
    g.addColorStop(0, C.lampGlow);
    g.addColorStop(1, 'rgba(244,181,63,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-26, -46, 60, 56);
  }
  // legs
  const stride = o.walking ? Math.sin(o.phase * 11) * 3 : 0;
  ctx.strokeStyle = '#2a2420';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-1, -7); ctx.lineTo(-1 + stride, 0);
  ctx.moveTo(1, -7); ctx.lineTo(1 - stride, 0);
  ctx.stroke();
  // sack on back
  if (o.sack && o.sack > 0) {
    ctx.fillStyle = '#8b7a64';
    ctx.beginPath();
    ctx.arc(-4.5, -12, 2.5 + o.sack * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  // body
  ctx.fillStyle = o.suit;
  roundRect(ctx, -3, -16, 6, 10, 1.5);
  ctx.fill();
  // head + helmet
  ctx.fillStyle = C.skin;
  ctx.beginPath();
  ctx.arc(0.5, -19, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.lamp;
  ctx.beginPath();
  ctx.arc(0.5, -19.6, 3, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(3, -20.5, 1.6, 1.6);
  // pickaxe
  if (o.swing !== undefined) {
    const a = -0.9 + Math.max(0, Math.sin(o.swing * 7)) * 1.6;
    ctx.save();
    ctx.translate(1.5, -13);
    ctx.rotate(a);
    ctx.strokeStyle = '#7b5a3c';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(8, 0); ctx.stroke();
    ctx.strokeStyle = '#b9c0c6';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(7, -3); ctx.quadraticCurveTo(9.5, 0, 7, 3); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// ---- Scene -----------------------------------------------------------------

function drawSky(ctx: CanvasRenderingContext2D, time: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  g.addColorStop(0, '#120f22');
  g.addColorStop(0.55, '#33223f');
  g.addColorStop(0.85, '#7a3f45');
  g.addColorStop(1, '#c26a48');
  ctx.fillStyle = g;
  ctx.fillRect(0, -400, WORLD_W, GROUND_Y + 400);

  for (const st of STARS) {
    ctx.globalAlpha = 0.35 + 0.35 * Math.sin(time * 0.8 + st.p);
    ctx.fillStyle = '#f3ecff';
    ctx.fillRect(st.x, st.y, st.s, st.s);
  }
  ctx.globalAlpha = 1;

  // The evening star.
  const ex = 360, ey = 48;
  const glow = ctx.createRadialGradient(ex, ey, 0, ex, ey, 22);
  glow.addColorStop(0, 'rgba(255,240,214,0.75)');
  glow.addColorStop(1, 'rgba(255,240,214,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(ex - 22, ey - 22, 44, 44);
  ctx.fillStyle = '#fff6e6';
  ctx.beginPath(); ctx.arc(ex, ey, 2.2, 0, Math.PI * 2); ctx.fill();

  // Gas giant crescent low on the horizon.
  ctx.save();
  ctx.beginPath(); ctx.arc(70, 120, 44, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = 'rgba(214,150,120,0.35)';
  ctx.fillRect(20, 70, 100, 100);
  ctx.fillStyle = '#2b1f36';
  ctx.beginPath(); ctx.arc(84, 112, 44, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  const ridge = (pts: { x: number; y: number }[], color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    pts.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(WORLD_W, GROUND_Y);
    ctx.closePath();
    ctx.fill();
  };
  ridge(RIDGE_FAR, '#4a2c3e');
  ridge(RIDGE_NEAR, '#2e1f2a');
}

function drawBuilding(ctx: CanvasRenderingContext2D, x: number, w: number, h: number, body: string, roof: string, label: string, windowColor: string, cols: number, rows: number, time: number): void {
  const y = GROUND_Y - h;
  ctx.fillStyle = body;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = roof;
  ctx.fillRect(x - 3, y - 4, w + 6, 5);
  const ww = 6, wh = 5;
  const gx = (w - cols * ww) / (cols + 1);
  const gy = Math.min(10, (h - 22 - rows * wh) / (rows + 1));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const flick = Math.sin(time * 0.3 + r * 3.1 + c * 1.7 + x) > -0.85;
      ctx.fillStyle = flick ? windowColor : '#2a2230';
      ctx.fillRect(x + gx + c * (ww + gx), y + 8 + gy + r * (wh + gy), ww, wh);
    }
  }
  text(ctx, label, x + w / 2, GROUND_Y - 4, 8, C.dim, 'center', 600);
}

function drawSurface(ctx: CanvasRenderingContext2D, s: GameState, time: number, hits: Hit[]): void {
  drawSky(ctx, time);

  // Dormitory
  drawBuilding(ctx, 138, 76, 62, '#3a3140', '#2a2330', '宿舍', '#e9b86a', 4, 3, time);
  // Canteen with steam
  drawBuilding(ctx, 222, 62, 46, '#423441', '#2e2430', '食堂', '#f0c27a', 3, 2, time);
  for (let k = 0; k < 3; k++) {
    const t = (time * 0.35 + k / 3) % 1;
    ctx.globalAlpha = 0.25 * (1 - t);
    ctx.fillStyle = '#d8cfd6';
    ctx.beginPath(); ctx.arc(270 + Math.sin(t * 6 + k) * 3, GROUND_Y - 54 - t * 26, 3 + t * 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#2e2430';
  ctx.fillRect(266, GROUND_Y - 56, 7, 10);

  // Helion office: taller, colder.
  const ox = 292, ow = 84, oh = 116;
  ctx.fillStyle = '#26323a';
  ctx.fillRect(ox, GROUND_Y - oh, ow, oh);
  ctx.fillStyle = '#1b252c';
  ctx.fillRect(ox + ow - 14, GROUND_Y - oh, 14, oh);
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 4; c++) {
      ctx.fillStyle = (r * 4 + c) % 5 === 0 ? '#1d2830' : 'rgba(159,224,239,0.55)';
      ctx.fillRect(ox + 8 + c * 15, GROUND_Y - oh + 22 + r * 12, 9, 5);
    }
  }
  ctx.fillStyle = '#0f171c';
  roundRect(ctx, ox + 10, GROUND_Y - oh - 14, ow - 20, 12, 2);
  ctx.fill();
  text(ctx, 'HELION', ox + ow / 2, GROUND_Y - oh - 4.5, 8.5, C.helion, 'center', 700);
  ctx.fillStyle = Math.sin(time * 3) > 0 ? '#ff5b4f' : '#5a1f1c';
  ctx.fillRect(ox + ow / 2 - 1, GROUND_Y - oh - 22, 2, 6);
  text(ctx, '企業辦公室', ox + ow / 2, GROUND_Y - 4, 8, C.dim, 'center');

  // Cargo port with the orbital transport.
  ctx.fillStyle = '#3b3640';
  ctx.fillRect(386, GROUND_Y - 6, 92, 6);
  ctx.fillStyle = '#f4b53f';
  for (let k = 0; k < 6; k++) ctx.fillRect(390 + k * 15, GROUND_Y - 4, 7, 1.5);
  const bob = Math.sin(time * 1.4) * 0.6;
  ctx.save();
  ctx.translate(432, GROUND_Y - 8 + bob);
  ctx.fillStyle = '#8c939b';
  ctx.beginPath();
  ctx.moveTo(-30, 0); ctx.lineTo(-24, -16); ctx.lineTo(14, -18); ctx.lineTo(30, -8); ctx.lineTo(28, 0);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5c636b';
  ctx.fillRect(-22, -10, 30, 6);
  ctx.fillStyle = C.helion;
  ctx.fillRect(16, -14, 8, 4);
  text(ctx, 'F8-317', -4, -20, 6.5, '#c9ced3', 'center', 700);
  ctx.restore();
  text(ctx, '貨運港', 432, GROUND_Y + 17, 8, C.dim, 'center');

  // Ground and road.
  ctx.fillStyle = '#2a1f1b';
  ctx.fillRect(0, GROUND_Y, WORLD_W, MINE_TOP - GROUND_Y);
  ctx.fillStyle = '#3a2c25';
  ctx.fillRect(0, GROUND_Y, WORLD_W, 3);

  // Ambient pedestrians between dorm and canteen.
  for (const w of walkers) {
    drawWorker(ctx, w.x, GROUND_Y - 1, { dir: w.dir, phase: w.phase, walking: w.pause <= 0, suit: '#6f6378', scale: 0.8 });
  }

  // Surface storage pile.
  const c = s.cargo;
  const pile = Math.min(18, 3 + Math.log10(1 + c.storage) * 4);
  ctx.fillStyle = '#5e5048';
  ctx.beginPath();
  ctx.moveTo(STORE_X - 22, GROUND_Y);
  ctx.quadraticCurveTo(STORE_X - 6, GROUND_Y - pile * 2, STORE_X + 6, GROUND_Y);
  ctx.closePath();
  ctx.fill();
  text(ctx, credits(c.storage), STORE_X - 8, GROUND_Y - Math.max(pile, 24) - 4, 8, C.text, 'center', 700);

  // Haulers with carts.
  for (const h of c.haulers) {
    const dir = h.state === 'toStore' ? -1 : 1;
    const walking = h.state === 'toStore' || h.state === 'toPort';
    const cartX = h.x + dir * 10;
    ctx.fillStyle = '#4b423c';
    ctx.fillRect(cartX - 6, GROUND_Y - 9, 12, 6);
    if (h.carry > 0) {
      ctx.fillStyle = '#9c8a78';
      ctx.beginPath(); ctx.arc(cartX, GROUND_Y - 9, 4.5, Math.PI, 0); ctx.fill();
    }
    ctx.fillStyle = '#1c1714';
    ctx.beginPath(); ctx.arc(cartX - 4, GROUND_Y - 2, 2, 0, Math.PI * 2); ctx.arc(cartX + 4, GROUND_Y - 2, 2, 0, Math.PI * 2); ctx.fill();
    drawWorker(ctx, h.x, GROUND_Y - 1, { dir, phase: h.phase, walking, suit: C.suitHaul });
  }

  // Cargo upgrade badge.
  const cargoReady = anyAffordable(s, ['cargo', 'orevalue']);
  drawBadge(ctx, 176, GROUND_Y + 1, 128, '搬運隊', `Lv.${s.cargo.level}`, cargoReady, bottleneck === 'cargo');

  drawRushBar(ctx, 176, GROUND_Y + 1 + BADGE_H + 1, 128, s.rush.cargo ?? 0);

  // Road, haulers, storage pile and port rush the haulers; building tops open panels; the badge opens upgrades.
  hits.push({ x: STORE_X - 30, y: GROUND_Y - 40, w: WORLD_W - STORE_X + 30, h: MINE_TOP - GROUND_Y + 40, action: 'rush:cargo' });
  hits.push({ x: 384, y: GROUND_Y - 44, w: 96, h: 20, action: 'rush:cargo' });
  hits.push({ x: ox, y: GROUND_Y - oh - 22, w: ow, h: oh - 18, action: 'report' });
  hits.push({ x: 138, y: GROUND_Y - 66, w: 146, h: 26, action: 'stats' });
  hits.push(badgeHit(176, GROUND_Y + 1, 128, 'cargo'));
}

const BADGE_PAD = 6; // badges get a larger tap target than they draw

function badgeHit(x: number, y: number, w: number, action: string): Hit {
  return { x: x - BADGE_PAD, y: y - BADGE_PAD, w: w + BADGE_PAD * 2, h: BADGE_H + BADGE_PAD * 2, action };
}

// Remaining rush time, drawn as a thin bar under a section's badge.
function drawRushBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, secs: number): void {
  if (secs <= 0) return;
  ctx.fillStyle = 'rgba(244,181,63,0.2)';
  ctx.fillRect(x + 4, y, w - 8, 3);
  ctx.fillStyle = C.lamp;
  ctx.fillRect(x + 4, y, (w - 8) * Math.min(1, secs / RUSH_MAX), 3);
  text(ctx, `×${RUSH_MULT}`, x + w - 4, y + 13, 7.5, C.lamp, 'right', 700);
}

// ---- Tap feedback ------------------------------------------------------------

interface Fx { x: number; y: number; t: number; label: string; sparks: { dx: number; dy: number }[] }
const fx: Fx[] = [];
const FX_LIFE = 0.8;

export function addTapFx(x: number, y: number, label: string): void {
  const sparks = Array.from({ length: 6 }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = 14 + Math.random() * 16;
    return { dx: Math.cos(a) * v, dy: Math.sin(a) * v - 8 };
  });
  fx.push({ x, y, t: 0, label, sparks });
  if (fx.length > 24) fx.shift();
}

function drawFx(ctx: CanvasRenderingContext2D, dt: number): void {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.t += dt;
    if (f.t >= FX_LIFE) { fx.splice(i, 1); continue; }
    const k = f.t / FX_LIFE;
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = C.lamp;
    for (const sp of f.sparks) ctx.fillRect(f.x + sp.dx * k, f.y + sp.dy * k + 20 * k * k, 2, 2);
    text(ctx, f.label, f.x, f.y - 10 - k * 18, 8.5, C.lamp, 'center', 700);
  }
  ctx.globalAlpha = 1;
}

export const BADGE_H = 22;

function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, label: string, level: string, ready: boolean, warn = false): void {
  ctx.fillStyle = ready ? 'rgba(244,181,63,0.2)' : 'rgba(20,16,14,0.78)';
  roundRect(ctx, x, y, w, BADGE_H, 5);
  ctx.fill();
  ctx.strokeStyle = ready ? C.lamp : 'rgba(168,153,138,0.35)';
  ctx.lineWidth = 1;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, BADGE_H - 1, 5);
  ctx.stroke();
  text(ctx, label, x + 7, y + 15.5, 8.5, C.text, 'left', 600);
  text(ctx, level, x + w - (ready ? 20 : 7), y + 15.5, 8.5, ready ? C.lamp : C.dim, 'right', 700);
  if (ready) {
    ctx.fillStyle = C.lamp;
    ctx.beginPath();
    ctx.moveTo(x + w - 15, y + 15); ctx.lineTo(x + w - 10, y + 7); ctx.lineTo(x + w - 5, y + 15);
    ctx.closePath(); ctx.fill();
  }
  if (warn) {
    // Bottleneck marker on the badge's top-left corner.
    ctx.fillStyle = C.warn;
    ctx.beginPath(); ctx.arc(x + 1, y + 1, 6, 0, Math.PI * 2); ctx.fill();
    text(ctx, '!', x + 1, y + 4.5, 7, '#1a1517', 'center', 700);
  }
}

function drawLayer(ctx: CanvasRenderingContext2D, s: GameState, i: number, time: number, hits: Hit[]): void {
  const def = LAYERS[i];
  const layer = s.layers[i];
  const top = layerTop(i);
  const floor = layerFloor(i);

  ctx.fillStyle = def.rock;
  ctx.fillRect(0, top, WORLD_W, LAYER_H);
  for (const sp of SPECKLES[i]) {
    ctx.fillStyle = sp.v ? def.vein : 'rgba(0,0,0,0.25)';
    ctx.globalAlpha = sp.v ? 0.35 : 1;
    ctx.fillRect(sp.x, top + sp.y, sp.s, sp.s);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, top, WORLD_W, 2);

  if (!layer.unlocked) {
    drawLockedLayer(ctx, s, i, top, hits);
    return;
  }

  // Tunnel
  const tx = SHAFT_X + SHAFT_W;
  const tTop = top + 40;
  ctx.fillStyle = def.tunnel;
  ctx.beginPath();
  ctx.moveTo(tx, floor + 3);
  ctx.lineTo(tx, tTop);
  ctx.lineTo(FACE_X - 10, tTop + 2);
  ctx.quadraticCurveTo(FACE_X + 8, tTop + 20, FACE_X + 2, floor + 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(tx, floor, FACE_X - tx, 3);

  // Timber supports and lamps.
  for (let x = 120; x < FACE_X - 30; x += 64) {
    ctx.fillStyle = '#5a4130';
    ctx.fillRect(x, tTop, 3, floor - tTop);
    ctx.fillRect(x - 6, tTop, 15, 3);
    const flicker = 0.8 + 0.2 * Math.sin(time * 9 + x + i);
    const g = ctx.createRadialGradient(x + 1.5, tTop + 9, 0, x + 1.5, tTop + 9, 30);
    g.addColorStop(0, `rgba(244,181,63,${0.22 * flicker})`);
    g.addColorStop(1, 'rgba(244,181,63,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 30, tTop - 20, 62, 60);
    ctx.fillStyle = C.lamp;
    ctx.fillRect(x, tTop + 7, 3, 3);
  }

  // Ore face
  ctx.fillStyle = def.vein;
  for (let k = 0; k < 9; k++) {
    const vy = tTop + 8 + ((k * 37) % (floor - tTop - 12));
    const vx = FACE_X - 2 + ((k * 13) % 14);
    ctx.globalAlpha = 0.55 + 0.25 * Math.sin(time * 1.5 + k);
    ctx.beginPath();
    ctx.moveTo(vx, vy); ctx.lineTo(vx + 5, vy - 2); ctx.lineTo(vx + 8, vy + 3); ctx.lineTo(vx + 2, vy + 4);
    ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Stash crate
  ctx.fillStyle = '#5b4332';
  ctx.fillRect(STASH_X, floor - 14, 36, 14);
  ctx.strokeStyle = '#3d2c21';
  ctx.lineWidth = 1;
  ctx.strokeRect(STASH_X + 0.5, floor - 13.5, 35, 13);
  if (layer.stash > 0) {
    const h = Math.min(12, 2 + Math.log10(1 + layer.stash) * 2.6);
    ctx.fillStyle = def.vein;
    ctx.beginPath();
    ctx.moveTo(STASH_X + 2, floor - 14);
    ctx.quadraticCurveTo(STASH_X + 18, floor - 14 - h * 2, STASH_X + 34, floor - 14);
    ctx.closePath();
    ctx.fill();
  }
  text(ctx, credits(layer.stash), STASH_X + 18, floor - 30, 8.5, C.text, 'center', 700);

  // Miners
  for (const m of layer.miners) {
    const mining = m.state === 'mining';
    drawWorker(ctx, m.x, floor, {
      dir: m.state === 'toStash' ? -1 : 1,
      phase: m.phase,
      walking: !mining,
      suit: C.suit,
      sack: m.state === 'toStash' ? 1 : 0,
      swing: mining ? m.t : undefined,
      lamp: true,
    });
  }

  // Header: name + upgrade badge
  text(ctx, `${i + 1}・${def.name}`, tx + 8, top + 18, 10, C.text, 'left', 700);
  text(ctx, `每單位 ${credits(def.value)}`, tx + 8, top + 33, 7.5, C.dim, 'left', 500);
  const ready = anyAffordable(s, [`drill:${i}`, `crew:${i}`]);
  const bx = WORLD_W - 156;
  drawBadge(ctx, bx, top + 8, 148, `鑽頭 Lv.${layer.drill}`, `${layer.crew} 人`, ready);
  drawRushBar(ctx, bx, top + 8 + BADGE_H + 2, 148, s.rush[`layer:${i}`] ?? 0);

  if (i === 0 && !s.flags.tapped) drawTapHint(ctx, (DEPOSIT_HINT_X + FACE_X) / 2, tTop + 26, time);

  hits.push({ x: tx, y: top, w: WORLD_W - tx, h: LAYER_H, action: `rush:layer:${i}` });
  hits.push(badgeHit(bx, top + 8, 148, `layer:${i}`));
}

const DEPOSIT_HINT_X = 160;

function drawTapHint(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  const p = (time * 1.2) % 1;
  ctx.strokeStyle = `rgba(244,181,63,${0.8 * (1 - p)})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, 6 + p * 14, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = C.lamp;
  ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  text(ctx, '點坑道催工 ×2', x, y + 32, 8.5, C.lamp, 'center', 700);
}

function drawLockedLayer(ctx: CanvasRenderingContext2D, s: GameState, i: number, top: number, hits: Hit[]): void {
  const def = LAYERS[i];
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, top, WORLD_W, LAYER_H);
  const cx = WORLD_W / 2 + 20;
  const cy = top + LAYER_H / 2;
  if (def.restricted) {
    text(ctx, `${i + 1}・${def.name}`, cx, cy - 4, 12, C.dim, 'center', 700);
    text(ctx, def.restricted, cx, cy + 14, 9, '#c06a5a', 'center', 600);
    return;
  }
  const can = canUnlock(s, i);
  const afford = can && s.credits >= def.unlockCost;
  const bw = 240, bh = 56;
  ctx.fillStyle = afford ? 'rgba(244,181,63,0.16)' : 'rgba(20,16,14,0.75)';
  roundRect(ctx, cx - bw / 2, cy - bh / 2, bw, bh, 6);
  ctx.fill();
  ctx.strokeStyle = afford ? C.lamp : 'rgba(168,153,138,0.4)';
  ctx.setLineDash([4, 3]);
  roundRect(ctx, cx - bw / 2 + 0.5, cy - bh / 2 + 0.5, bw - 1, bh - 1, 6);
  ctx.stroke();
  ctx.setLineDash([]);
  text(ctx, `開挖：${def.name}`, cx, cy - 4, 10, C.text, 'center', 700);
  text(ctx, credits(def.unlockCost), cx, cy + 17, 9, afford ? C.lamp : C.dim, 'center', 700);
  hits.push({ x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh, action: `unlock:${i}` });
}

// Unexplored rock below the deepest visible layer, filled to the bottom of the view.
function drawBedrock(ctx: CanvasRenderingContext2D, top: number, bottom: number): void {
  if (bottom <= top) return;
  const g = ctx.createLinearGradient(0, top, 0, top + 360);
  g.addColorStop(0, '#1a1416');
  g.addColorStop(1, '#0d0b0c');
  ctx.fillStyle = g;
  ctx.fillRect(0, top, WORLD_W, bottom - top);
  ctx.strokeStyle = 'rgba(239,230,218,0.04)';
  ctx.lineWidth = 1;
  for (let y = top + 22, k = 0; y < bottom; y += 34, k++) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= WORLD_W; x += 40) ctx.lineTo(x, y + Math.sin(x * 0.03 + k * 1.7) * 5);
    ctx.stroke();
  }
  text(ctx, '未探勘區域', WORLD_W / 2 + 20, top + 48, 8, 'rgba(168,153,138,0.45)', 'center', 600);
}

function drawShaft(ctx: CanvasRenderingContext2D, s: GameState, time: number, hits: Hit[]): void {
  let deepest = 0;
  s.layers.forEach((l, i) => { if (l.unlocked) deepest = i; });
  const bottom = layerFloor(deepest) + 6;

  ctx.fillStyle = '#110d0c';
  ctx.fillRect(SHAFT_X, GROUND_Y, SHAFT_W, bottom - GROUND_Y);
  ctx.fillStyle = '#3b3330';
  ctx.fillRect(SHAFT_X + 4, GROUND_Y, 2, bottom - GROUND_Y);
  ctx.fillRect(SHAFT_X + SHAFT_W - 6, GROUND_Y, 2, bottom - GROUND_Y);
  for (let i = 0; i <= deepest; i++) {
    ctx.fillStyle = '#2b2422';
    ctx.fillRect(SHAFT_X, layerFloor(i) + 1, SHAFT_W, 3);
  }

  // Headframe
  const hx = SHAFT_X + SHAFT_W / 2;
  const wheelY = GROUND_Y - 88;
  ctx.strokeStyle = '#6a5a52';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(SHAFT_X - 2, GROUND_Y); ctx.lineTo(hx - 4, wheelY);
  ctx.moveTo(SHAFT_X + SHAFT_W + 2, GROUND_Y); ctx.lineTo(hx + 4, wheelY);
  ctx.moveTo(SHAFT_X + 6, GROUND_Y - 30); ctx.lineTo(SHAFT_X + SHAFT_W - 6, GROUND_Y - 30);
  ctx.moveTo(SHAFT_X + 12, GROUND_Y - 58); ctx.lineTo(SHAFT_X + SHAFT_W - 12, GROUND_Y - 58);
  ctx.stroke();
  ctx.save();
  ctx.translate(hx, wheelY);
  ctx.rotate(s.elevator.state === 'moving' ? time * 6 : 0);
  ctx.strokeStyle = '#a99484';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.moveTo(0, -8); ctx.lineTo(0, 8); ctx.stroke();
  ctx.restore();

  // Cable + car
  const e = s.elevator;
  const carH = 30, carW = 40;
  const carX = SHAFT_X + (SHAFT_W - carW) / 2;
  const carTop = e.y - carH;
  ctx.strokeStyle = '#8d7d72';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(hx, wheelY + 8); ctx.lineTo(hx, carTop); ctx.stroke();
  ctx.fillStyle = '#4c5359';
  ctx.fillRect(carX, carTop, carW, carH);
  ctx.fillStyle = '#2a2f33';
  ctx.fillRect(carX + 3, carTop + 4, carW - 6, carH - 8);
  if (e.load > 0) {
    // Heap size shows how full the car is.
    const fill = Math.min(1, e.load / elevatorCapacity(e.level));
    ctx.fillStyle = '#9c8a78';
    ctx.beginPath(); ctx.arc(hx + 4, carTop + carH - 4, 4 + fill * 9, Math.PI, 0); ctx.fill();
    text(ctx, credits(e.load), hx, carTop - 3, 8, fill > 0.99 ? C.lamp : C.text, 'center', 700);
  }
  drawWorker(ctx, carX + 10, carTop + carH - 4, { dir: 1, phase: 0, walking: false, suit: C.suit, scale: 0.75, lamp: true });

  drawBadge(ctx, 10, GROUND_Y - 122, 106, '升降梯', `Lv.${e.level}`, anyAffordable(s, ['elevator']), bottleneck === 'elevator');
  drawRushBar(ctx, 10, GROUND_Y - 122 + BADGE_H + 1, 106, s.rush.elevator ?? 0);

  hits.push({ x: SHAFT_X - 8, y: GROUND_Y - 92, w: SHAFT_W + 16, h: bottom - GROUND_Y + 92, action: 'rush:elevator' });
  hits.push(badgeHit(10, GROUND_Y - 122, 106, 'elevator'));
}

let bottleneck: Station | null = null;

export function render(ctx: CanvasRenderingContext2D, s: GameState, cam: Camera, dpr: number, time: number, dt: number, hits: Hit[]): void {
  hits.length = 0;
  bottleneck = flows(s).bottleneck;
  updateWalkers(s, dt);
  const k = cam.scale * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0d0b0c';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(k, 0, 0, k, 0, -cam.y * k);

  const viewTop = cam.y;
  const viewBottom = cam.y + cam.viewH;
  if (viewTop < MINE_TOP) drawSurface(ctx, s, time, hits);
  const shown = Math.min(LAYERS.length, s.layers.filter((l) => l.unlocked).length + 1);
  for (let i = 0; i < shown; i++) {
    const top = layerTop(i);
    if (top > viewBottom || top + LAYER_H < viewTop) continue;
    drawLayer(ctx, s, i, time, hits);
  }
  drawBedrock(ctx, layerTop(shown), viewBottom);
  drawShaft(ctx, s, time, hits);
  drawFx(ctx, dt);
}
