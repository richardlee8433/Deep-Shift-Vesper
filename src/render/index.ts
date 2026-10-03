// Scene orchestration: cached scenery + live actors, plaques, labels and hit regions.

import {
  DEPOSIT_X, FACE_X, GROUND_Y, LAYER_H, LAYERS, MINE_TIME, MINE_TOP, PORT_X, RUSH_MAX, RUSH_MULT,
  SHAFT_W, SHAFT_X, STASH_X, STORE_X, WORLD_W,
} from '../config';
import { saleFx, workerCount } from '../economy';
import { flows, type Station } from '../flows';
import { credits } from '../format';
import { layerTop } from '../sim';
import type { GameState, Miner } from '../state';
import { anyAffordable, canUnlock, cargoCapacity, elevatorCapacity } from '../upgrades';
import { P, box, circle, coinLabel, glow, line, outlinedText, rivet, roundRect, shade, text } from './draw';
import { drawFrame, image, sheet } from './assets';
import { burst, drawFx, popup } from './fx';
import { drawCart, drawPerson, lookFor, type Look } from './people';
import {
  CANTEEN_DOOR, DORM_DOOR, HEAD_TOP, HX, OFFICE, drawHeadWheels, drawSurfaceLive, drawTransport, surfaceArt,
} from './surface';
import { LANTERNS, T_FLOOR, T_LEFT, T_TOP, bedrockArt, layerArt } from './terrain';

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

export function contentHeight(s: GameState): number {
  const unlocked = s.layers.filter((l) => l.unlocked).length;
  const shown = Math.min(LAYERS.length, unlocked + 1);
  return MINE_TOP + shown * LAYER_H + 24;
}

export function addTapFx(x: number, y: number, label: string): void {
  burst(x, y, [P.lamp, P.lampHi, '#fff3c4'], 7, 34);
  popup(x, y - 6, label);
}

// ---- Plaques (upgrade badges) ---------------------------------------------

export const PLAQUE_H = 22;
const POD_X = 142; // ore pod just right of the painted tunnel's door
const PAINTED_LAMPS = [161, 225, 308, 405];
const PLAQUE_PAD = 6;

function plaque(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, label: string, value: string, ready: boolean, warn: boolean, time: number): void {
  if (ready) glow(ctx, x + w / 2, y + PLAQUE_H / 2, w * 0.6, 0.18 + 0.08 * Math.sin(time * 4));
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, x + 1.5, y + 2, w, PLAQUE_H, 4);
  ctx.fill();
  roundRect(ctx, x, y, w, PLAQUE_H, 4);
  const g = ctx.createLinearGradient(0, y, 0, y + PLAQUE_H);
  g.addColorStop(0, '#4b5761');
  g.addColorStop(1, '#2c343b');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = ready ? P.lamp : P.outline;
  ctx.lineWidth = ready ? 1.8 : 1.4;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(x + 3, y + 2, w - 6, 1.4);
  rivet(ctx, x + 4, y + PLAQUE_H / 2);
  rivet(ctx, x + w - 4, y + PLAQUE_H / 2);
  text(ctx, label, x + 9, y + 15.5, 8.5, P.text, 'left', 600);
  text(ctx, value, x + w - (ready ? 21 : 9), y + 15.5, 8.5, ready ? P.lampHi : P.dim, 'right', 700);
  if (ready) {
    const b = Math.sin(time * 6) * 1.2;
    ctx.beginPath();
    ctx.moveTo(x + w - 17, y + 14 + b); ctx.lineTo(x + w - 12, y + 6 + b); ctx.lineTo(x + w - 7, y + 14 + b);
    ctx.closePath();
    ctx.fillStyle = P.lamp;
    ctx.fill();
    ctx.strokeStyle = P.outline;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (warn) {
    circle(ctx, x + 1, y + 1, 6.5, P.warn, 1.2);
    text(ctx, '!', x + 1, y + 4.6, 7, P.outline, 'center', 700);
  }
}

function plaqueHit(x: number, y: number, w: number, action: string): Hit {
  return { x: x - PLAQUE_PAD, y: y - PLAQUE_PAD, w: w + PLAQUE_PAD * 2, h: PLAQUE_H + PLAQUE_PAD * 2, action };
}

function rushBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, secs: number): void {
  if (secs <= 0) return;
  box(ctx, x + 4, y, w - 8, 4, 'rgba(20,14,16,0.8)', 2, 1);
  ctx.fillStyle = P.lamp;
  roundRect(ctx, x + 5, y + 1, (w - 10) * Math.min(1, secs / RUSH_MAX), 2, 1);
  ctx.fill();
  outlinedText(ctx, `×${RUSH_MULT}`, x + w - 4, y + 14, 7.5, P.lampHi, 'right');
}

// ---- Actors ----------------------------------------------------------------

const looks = new Map<string, Look>();
function look(key: string, seed: number, role: 'miner' | 'hauler' | 'operator' | 'civilian'): Look {
  let l = looks.get(key);
  if (!l) { l = lookFor(seed, role); looks.set(key, l); }
  return l;
}

const blink = (time: number, seed: number) => (time * 0.9 + seed * 0.37) % 4 < 0.12;

interface Walker { x: number; dir: 1 | -1; speed: number; phase: number; pause: number; seed: number }
const walkers: Walker[] = [];

function updateWalkers(s: GameState, dt: number): void {
  const want = Math.min(6, Math.floor(workerCount(s) / 5));
  while (walkers.length < want) {
    walkers.push({ x: DORM_DOOR + Math.random() * (CANTEEN_DOOR - DORM_DOOR), dir: Math.random() < 0.5 ? 1 : -1, speed: 12 + Math.random() * 8, phase: Math.random() * 10, pause: 0, seed: walkers.length + 40 });
  }
  walkers.length = want;
  for (const w of walkers) {
    if (w.pause > 0) { w.pause -= dt; continue; }
    w.x += w.dir * w.speed * dt;
    w.phase += dt * 7;
    if (w.x > CANTEEN_DOOR || w.x < DORM_DOOR) {
      w.x = Math.max(DORM_DOOR, Math.min(CANTEEN_DOOR, w.x));
      w.dir = w.dir === 1 ? -1 : 1;
      w.pause = 1.5 + Math.random() * 4;
    }
  }
}

const SWING_PERIOD = MINE_TIME / 4;
const MINER_SCALE = 1.3;
const lastSwing = new WeakMap<Miner, number>();

// Painted miners: about 44 world units from helmet to boots.
const SPRITE_H = 44;
const DRILL_FPS = 9;
const WALK_FPS = 10;
const lastDrillFrame = new WeakMap<Miner, number>();

/** Walking without ore: the walk cycle if we have it, else the idle drill pose with a bob. */
function drawWalker(ctx: CanvasRenderingContext2D, x: number, floor: number, phase: number, dir: 1 | -1, h: number): void {
  if (drawFrame(ctx, 'miner-walk', Math.floor(phase * WALK_FPS), x, floor, h, dir)) return;
  drawFrame(ctx, 'miner-drill', 0, x, floor - Math.abs(Math.sin(phase * 9)) * 1.4, h, dir);
}

function spriteShadow(ctx: CanvasRenderingContext2D, x: number, floor: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x, floor + 0.5, 9, 2.2, 0, 0, Math.PI * 2); ctx.fill();
}

function drawPaintedMiners(ctx: CanvasRenderingContext2D, s: GameState, i: number, floor: number): void {
  const def = LAYERS[i];
  for (const m of s.layers[i].miners) {
    spriteShadow(ctx, m.x, floor);
    if (m.state === 'mining') {
      const frame = Math.floor(m.t * DRILL_FPS);
      const prev = lastDrillFrame.get(m) ?? -1;
      if (frame !== prev && frame % 6 === 2) burst(m.x + 24, floor - 20, [def.vein, shade(def.vein, 0.4), '#bfefff'], 6, 30);
      lastDrillFrame.set(m, frame);
      drawFrame(ctx, 'miner-drill', frame, m.x, floor, SPRITE_H, 1);
    } else if (m.state === 'toStash') {
      drawFrame(ctx, 'miner-carry', Math.floor(m.phase * WALK_FPS), m.x, floor, SPRITE_H, -1);
    } else {
      drawWalker(ctx, m.x, floor, m.phase, 1, SPRITE_H);
    }
  }
}

function drawMiners(ctx: CanvasRenderingContext2D, s: GameState, i: number, floor: number, time: number): void {
  if (sheet('miner-drill') && sheet('miner-carry')) { drawPaintedMiners(ctx, s, i, floor); return; }
  const def = LAYERS[i];
  s.layers[i].miners.forEach((m, j) => {
    const mining = m.state === 'mining';
    const f = mining ? (m.t % SWING_PERIOD) / SWING_PERIOD : 0;
    if (mining) {
      const prev = lastSwing.get(m) ?? 0;
      if (prev < 0.7 && f >= 0.7) burst(m.x + 19, floor - 16, [def.vein, shade(def.rock, 0.2), shade(def.vein, 0.4)], 6, 28);
      lastSwing.set(m, f);
    }
    drawPerson(ctx, m.x, floor, {
      look: look(`m${i}:${j}`, i * 16 + j, 'miner'),
      pose: mining ? 'mine' : 'walk',
      dir: m.state === 'toStash' ? -1 : 1,
      phase: m.phase * 9,
      swing: f,
      sack: m.state === 'toStash' ? def.vein : null,
      lamp: true,
      scale: MINER_SCALE,
      blink: blink(time, i * 16 + j),
    });
  });
}

// ---- Surface ---------------------------------------------------------------

function drawSurface(ctx: CanvasRenderingContext2D, s: GameState, k: number, time: number, hits: Hit[], warn: Station | null): void {
  ctx.drawImage(surfaceArt(k).canvas, 0, 0, WORLD_W, MINE_TOP);
  drawSurfaceLive(ctx, time);
  drawTransport(ctx, time);

  // Hopper heap and counter
  const c = s.cargo;
  const hx = STORE_X - 8;
  if (c.storage > 0) {
    const fill = Math.min(1, c.storage / (cargoCapacity(c.level) * 3));
    ctx.beginPath();
    ctx.moveTo(hx - 17, GROUND_Y - 29);
    ctx.quadraticCurveTo(hx, GROUND_Y - 31 - 16 * fill, hx + 17, GROUND_Y - 29);
    ctx.closePath();
    ctx.fillStyle = '#9c8a78';
    ctx.fill();
    ctx.strokeStyle = P.outline;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  coinLabel(ctx, credits(c.storage), hx, GROUND_Y - 52);

  for (const w of walkers) {
    drawPerson(ctx, w.x, GROUND_Y - 1, { look: look(`w${w.seed}`, w.seed, 'civilian'), pose: w.pause > 0 ? 'idle' : 'walk', dir: w.dir, phase: w.phase, scale: 1.05, blink: blink(time, w.seed) });
  }

  c.haulers.forEach((h, j) => {
    const dir = h.state === 'toStore' ? -1 : 1;
    const moving = h.state === 'toStore' || h.state === 'toPort';
    if (sheet('miner-carry')) {
      spriteShadow(ctx, h.x, GROUND_Y - 1);
      if (h.state === 'toPort') drawFrame(ctx, 'miner-carry', Math.floor(h.phase * WALK_FPS), h.x, GROUND_Y - 1, 40, 1);
      else if (moving) drawWalker(ctx, h.x, GROUND_Y - 1, h.phase, -1, 40);
      else drawFrame(ctx, 'miner-carry', 0, h.x, GROUND_Y - 1, 40, 1);
    } else {
      drawCart(ctx, h.x + dir * 17, GROUND_Y, 24, h.carry > 0 ? 0.9 : 0, '#a3abb5', h.phase * 8);
      drawPerson(ctx, h.x, GROUND_Y - 1, { look: look(`h${j}`, 90 + j, 'hauler'), pose: moving ? 'push' : 'idle', dir, phase: h.phase * 9, scale: 1.2, blink: blink(time, 90 + j) });
    }
  });

  // Coin pop-ups for each sale at the port
  while (saleFx.length) popup(PORT_X - 8, GROUND_Y - 30, `+${credits(saleFx.shift()!).slice(1)}`, true);

  const cargoReady = anyAffordable(s, ['cargo', 'orevalue']);
  plaque(ctx, 176, GROUND_Y + 1, 128, '搬運隊', `Lv.${s.cargo.level}`, cargoReady, warn === 'cargo', time);
  rushBar(ctx, 176, GROUND_Y + PLAQUE_H + 2, 128, s.rush.cargo ?? 0);

  hits.push({ x: STORE_X - 30, y: GROUND_Y - 40, w: WORLD_W - STORE_X + 30, h: MINE_TOP - GROUND_Y + 40, action: 'rush:cargo' });
  hits.push({ x: OFFICE.x, y: GROUND_Y - OFFICE.h - 32, w: OFFICE.w, h: OFFICE.h - 8, action: 'report' });
  hits.push({ x: 138, y: GROUND_Y - 70, w: 146, h: 30, action: 'stats' });
  hits.push(plaqueHit(176, GROUND_Y + 1, 128, 'cargo'));
}

// ---- Layers ----------------------------------------------------------------

function drawOpenLayer(ctx: CanvasRenderingContext2D, s: GameState, i: number, time: number, hits: Hit[]): void {
  const def = LAYERS[i];
  const layer = s.layers[i];
  const top = layerTop(i);
  const floor = top + T_FLOOR;

  // Lamp light (the painted tunnel has wall lamps; the procedural one has lanterns) and ore sparkles
  if (image(`tunnel-${i}`)) {
    for (const lx of PAINTED_LAMPS) glow(ctx, lx, top + 30, 30, 0.22 * (0.85 + 0.15 * Math.sin(time * 7 + lx + i)));
  } else {
    for (const lx of LANTERNS) glow(ctx, lx, top + T_TOP + 16, 36, 0.26 * (0.85 + 0.15 * Math.sin(time * 9 + lx + i)));
  }
  for (let k = 0; k < 4; k++) {
    const a = Math.sin(time * 2.2 + k * 1.9 + i);
    if (a > 0.6) {
      const sx = FACE_X + 4 + ((k * 7) % 12), sy = top + T_TOP + 14 + k * 15;
      ctx.fillStyle = `rgba(255,255,255,${(a - 0.6) * 2.2})`;
      ctx.fillRect(sx - 0.5, sy - 2.5, 1, 5);
      ctx.fillRect(sx - 2.5, sy - 0.5, 5, 1);
    }
  }

  // Ore pod (or cart) at the tunnel mouth holding the stash
  const fill = layer.stash > 0 ? Math.min(1, 0.25 + layer.stash / (elevatorCapacity(s.elevator.level) * 1.5)) : 0;
  const pod = image('ore-pod');
  if (pod) {
    const w = 50, h = (w * pod.height) / pod.width;
    const rim = floor - h + 3;
    if (fill > 0) {
      ctx.beginPath();
      ctx.moveTo(POD_X - w * 0.38, rim + 2);
      ctx.quadraticCurveTo(POD_X, rim - 4 - fill * 14, POD_X + w * 0.38, rim + 2);
      ctx.closePath();
      ctx.fillStyle = shade(def.vein, -0.1);
      ctx.fill();
      ctx.strokeStyle = P.outline;
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.fillStyle = shade(def.vein, 0.4);
      for (let k = 0; k < 5; k++) ctx.fillRect(POD_X - 10 + k * 5, rim - fill * 6 - (k % 2) * 3, 2, 2);
    }
    ctx.drawImage(pod, POD_X - w / 2, floor - h + 1, w, h);
    coinLabel(ctx, credits(layer.stash), POD_X, floor - h - 14);
  } else {
    drawCart(ctx, STASH_X + 20, floor, 38, fill, def.vein);
    coinLabel(ctx, credits(layer.stash), STASH_X + 20, floor - 40);
  }

  drawMiners(ctx, s, i, floor, time);

  outlinedText(ctx, `${i + 1}・${def.name}`, T_LEFT + 6, top + 17, 10, P.text, 'left');
  outlinedText(ctx, `每單位 ${credits(def.value)}`, T_LEFT + 6, top + 31, 7, P.dim, 'left', 600);
  const bx = WORLD_W - 156;
  plaque(ctx, bx, top + 7, 148, `鑽頭 Lv.${layer.drill}`, `${layer.crew} 人`, anyAffordable(s, [`drill:${i}`, `crew:${i}`]), false, time);
  rushBar(ctx, bx, top + 7 + PLAQUE_H + 2, 148, s.rush[`layer:${i}`] ?? 0);

  if (i === 0 && !s.flags.tapped) tapHint(ctx, (DEPOSIT_X + FACE_X) / 2 + 16, top + T_TOP + 30, time);

  hits.push({ x: T_LEFT, y: top, w: WORLD_W - T_LEFT, h: LAYER_H, action: `rush:layer:${i}` });
  hits.push(plaqueHit(bx, top + 7, 148, `layer:${i}`));
}

function tapHint(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  const p = (time * 1.2) % 1;
  ctx.strokeStyle = `rgba(246,183,60,${0.9 * (1 - p)})`;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, 6 + p * 16, 0, Math.PI * 2); ctx.stroke();
  circle(ctx, x, y, 4, P.lamp, 1.2);
  outlinedText(ctx, '點坑道催工 ×2', x, y + 34, 8.5, P.lampHi, 'center');
}

function drawLockedLayer(ctx: CanvasRenderingContext2D, s: GameState, i: number, time: number, hits: Hit[]): void {
  const def = LAYERS[i];
  const top = layerTop(i);
  const cx = (T_LEFT + FACE_X) / 2 + 8;
  const cy = top + LAYER_H / 2 + 2;
  if (def.restricted) {
    const on = Math.sin(time * 4) > 0;
    if (on) glow(ctx, WORLD_W / 2 + 40, top + T_TOP - 14, 14, 0.8, 'rgba(255,80,70,');
    circle(ctx, WORLD_W / 2 + 40, top + T_TOP - 14, 3, on ? '#ff5b4f' : '#5a1f1c', 1.1);
    outlinedText(ctx, `${i + 1}・${def.name}`, T_LEFT + 6, top + 17, 10, P.dim, 'left');
    outlinedText(ctx, def.restricted, WORLD_W / 2 + 40, top + T_FLOOR + 12, 8.5, P.warn, 'center');
    return;
  }
  const afford = canUnlock(s, i) && s.credits >= def.unlockCost;
  const bw = 220, bh = 52;
  // Wooden sign on two posts
  line(ctx, cx - 70, cy + bh / 2, cx - 70, cy + 40, P.woodDark, 4);
  line(ctx, cx + 70, cy + bh / 2, cx + 70, cy + 40, P.woodDark, 4);
  if (afford) glow(ctx, cx, cy, bw * 0.6, 0.22 + 0.08 * Math.sin(time * 4));
  box(ctx, cx - bw / 2, cy - bh / 2, bw, bh, afford ? P.woodHi : P.wood, 4, afford ? 2 : 1.5);
  ctx.strokeStyle = shade(P.wood, -0.3);
  ctx.lineWidth = 1;
  for (const ly of [cy - 8, cy + 9]) { ctx.beginPath(); ctx.moveTo(cx - bw / 2 + 4, ly); ctx.lineTo(cx + bw / 2 - 4, ly); ctx.stroke(); }
  for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) rivet(ctx, cx + nx * (bw / 2 - 6), cy + ny * (bh / 2 - 6));
  outlinedText(ctx, `開挖：${def.name}`, cx, cy - 2, 10, P.text, 'center');
  const costStr = credits(def.unlockCost);
  coinLabel(ctx, costStr.slice(1), cx, cy + 18, afford ? P.lampHi : P.dim);
  hits.push({ x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh, action: `unlock:${i}` });
}

// ---- Elevator --------------------------------------------------------------

let wheelAngle = 0;

function drawElevator(ctx: CanvasRenderingContext2D, s: GameState, time: number, dt: number, hits: Hit[], warn: Station | null): void {
  const e = s.elevator;
  if (e.state === 'moving') wheelAngle += dt * 5 * (e.targetLayer < 0 ? -1 : 1);
  drawHeadWheels(ctx, wheelAngle);

  const carW = 44, carH = 40;
  const carX = SHAFT_X + (SHAFT_W - carW) / 2;
  const carTop = e.y - carH;
  line(ctx, HX, HEAD_TOP + 11, HX, carTop - 4, P.outline, 2.2);
  line(ctx, HX, HEAD_TOP + 11, HX, carTop - 4, '#a99a8e', 0.9);

  // Cage: back panel, operator, load, bars, frame
  ctx.fillStyle = '#262b30';
  ctx.fillRect(carX, carTop, carW, carH);
  if (!drawFrame(ctx, 'miner-walk', 0, carX + 15, e.y - 4, 32, 1) && !drawFrame(ctx, 'miner-drill', 0, carX + 13, e.y - 4, 32, 1)) {
    drawPerson(ctx, carX + 12, e.y - 4, { look: look('op', 77, 'operator'), pose: 'ride', dir: 1, phase: 0, lamp: true, scale: 1.05, blink: blink(time, 77) });
  }
  if (e.load > 0) {
    const fill = Math.min(1, e.load / elevatorCapacity(e.level));
    ctx.beginPath();
    ctx.moveTo(carX + 22, e.y - 4);
    ctx.quadraticCurveTo(carX + 33, e.y - 6 - 20 * fill, carX + carW - 2, e.y - 4);
    ctx.closePath();
    ctx.fillStyle = '#9c8a78';
    ctx.fill();
    ctx.strokeStyle = P.outline;
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
  ctx.strokeStyle = P.steelDark;
  ctx.lineWidth = 1.3;
  for (let bx = carX + 6; bx < carX + carW - 2; bx += 6) { ctx.beginPath(); ctx.moveTo(bx, carTop + 2); ctx.lineTo(bx, e.y - 4); ctx.stroke(); }
  ctx.strokeStyle = P.outline;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(carX, carTop, carW, carH);
  box(ctx, carX - 3, carTop - 5, carW + 6, 6, P.steel, 1.5, 1.3);
  box(ctx, carX - 3, e.y - 4, carW + 6, 5, P.steel, 1.5, 1.3);
  rivet(ctx, carX + 2, carTop - 2);
  rivet(ctx, carX + carW - 2, carTop - 2);
  glow(ctx, HX, carTop - 6, 16, 0.35);
  box(ctx, HX - 3, carTop - 8, 6, 3, '#ffe9a8', 1, 0.9);
  if (e.load > 0) coinLabel(ctx, credits(e.load), HX, carTop - 12, e.load >= elevatorCapacity(e.level) * 0.99 ? P.lampHi : P.text);

  const py = HEAD_TOP - 42;
  plaque(ctx, 8, py, 108, '升降梯', `Lv.${e.level}`, anyAffordable(s, ['elevator']), warn === 'elevator', time);
  rushBar(ctx, 8, py + PLAQUE_H + 2, 108, s.rush.elevator ?? 0);

  let deepest = 0;
  s.layers.forEach((l, i) => { if (l.unlocked) deepest = i; });
  const bottom = layerTop(deepest) + LAYER_H;
  hits.push({ x: SHAFT_X - 8, y: HEAD_TOP - 14, w: SHAFT_W + 16, h: bottom - HEAD_TOP + 14, action: 'rush:elevator' });
  hits.push(plaqueHit(8, py, 108, 'elevator'));
}

// ---- Frame -----------------------------------------------------------------

export function render(ctx: CanvasRenderingContext2D, s: GameState, cam: Camera, dpr: number, time: number, dt: number, hits: Hit[]): void {
  hits.length = 0;
  updateWalkers(s, dt);
  const warn = flows(s).bottleneck;
  const px = cam.scale * dpr;
  const k = Math.min(3, Math.round(px * 4) / 4); // cache resolution, quantised so resizes reuse caches

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0d0b0c';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(px, 0, 0, px, 0, -cam.y * px);
  ctx.imageSmoothingEnabled = true;

  const viewTop = cam.y;
  const viewBottom = cam.y + cam.viewH;
  if (viewTop < MINE_TOP) drawSurface(ctx, s, k, time, hits, warn);

  const unlocked = s.layers.filter((l) => l.unlocked).length;
  const shown = Math.min(LAYERS.length, unlocked + 1);
  for (let i = 0; i < shown; i++) {
    const top = layerTop(i);
    if (top > viewBottom || top + LAYER_H < viewTop) continue;
    const layer = s.layers[i];
    const state = layer.unlocked ? 'open' : LAYERS[i].restricted ? 'restricted' : 'locked';
    ctx.drawImage(layerArt(i, state, k).canvas, 0, top, WORLD_W, LAYER_H);
    if (layer.unlocked) drawOpenLayer(ctx, s, i, time, hits);
    else drawLockedLayer(ctx, s, i, time, hits);
  }

  // Unexplored bedrock fills the rest of the view
  const bedTop = layerTop(shown);
  if (bedTop < viewBottom) {
    const tile = bedrockArt(k).canvas;
    for (let y = bedTop; y < viewBottom; y += LAYER_H) ctx.drawImage(tile, 0, y, WORLD_W, LAYER_H);
    const g = ctx.createLinearGradient(0, bedTop, 0, bedTop + 260);
    g.addColorStop(0, 'rgba(13,11,12,0.2)');
    g.addColorStop(1, 'rgba(13,11,12,0.92)');
    ctx.fillStyle = g;
    ctx.fillRect(0, bedTop, WORLD_W, Math.max(260, viewBottom - bedTop));
    outlinedText(ctx, '未探勘區域', WORLD_W / 2 + 20, bedTop + 46, 8, 'rgba(201,185,166,0.7)', 'center', 600);
  }

  drawElevator(ctx, s, time, dt, hits, warn);
  drawFx(ctx, dt);
}
