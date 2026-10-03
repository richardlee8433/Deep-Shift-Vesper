// Static underground art, painted once per layer into an offscreen cache.
// Local coordinates: x 0..WORLD_W, y 0..LAYER_H (0 = top of the layer band).

import { FACE_X, LAYER_H, LAYERS, SHAFT_W, SHAFT_X, WORLD_W } from '../config';
import { P, box, line, makeCache, poly, rivet, rng, shade, type Cache } from './draw';

export const T_TOP = 40; // tunnel ceiling, local y
export const T_FLOOR = LAYER_H - 16; // tunnel floor, local y
export const T_LEFT = SHAFT_X + SHAFT_W;
export const SUPPORTS = [124, 192, 260, 328];
export const LANTERNS = [158, 226, 294];

export type LayerArtState = 'open' | 'locked' | 'restricted';

const cache = new Map<string, Cache>();

function stones(ctx: CanvasRenderingContext2D, seed: number, rock: string, x0: number, y0: number, w: number, h: number, cell = 19): void {
  const r = rng(seed);
  ctx.fillStyle = shade(rock, -0.45);
  ctx.fillRect(x0, y0, w, h);
  const edge = shade(rock, -0.6);
  for (let gy = y0 - cell / 2; gy < y0 + h + cell; gy += cell * 0.82) {
    const offset = (Math.round(gy / cell) % 2) * cell * 0.5;
    for (let gx = x0 - cell + offset; gx < x0 + w + cell; gx += cell) {
      const cx = gx + (r() - 0.5) * cell * 0.45;
      const cy = gy + (r() - 0.5) * cell * 0.35;
      const rad = cell * (0.48 + r() * 0.16);
      const n = 7;
      const pts: number[] = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + r() * 0.4;
        const rr = rad * (0.78 + r() * 0.26);
        pts.push(cx + Math.cos(a) * rr * 1.12, cy + Math.sin(a) * rr * 0.86);
      }
      const tone = shade(rock, (r() - 0.45) * 0.24);
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
      ctx.closePath();
      ctx.fillStyle = tone;
      ctx.fill();
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      // Highlight on the upper-left of each stone
      ctx.fillStyle = shade(tone, 0.16);
      ctx.beginPath();
      ctx.ellipse(cx - rad * 0.28, cy - rad * 0.3, rad * 0.42, rad * 0.22, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function crystal(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, tilt: number): void {
  const pts = [0, -s * 1.3, s * 0.5, -s * 0.2, s * 0.25, s * 0.5, -s * 0.35, s * 0.5, -s * 0.5, -s * 0.1];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  poly(ctx, pts, color, 1.1);
  ctx.fillStyle = shade(color, 0.45);
  ctx.beginPath();
  ctx.moveTo(0, -s * 1.3); ctx.lineTo(s * 0.12, -s * 0.1); ctx.lineTo(-s * 0.32, -s * 0.05);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function nuggets(ctx: CanvasRenderingContext2D, seed: number, vein: string, avoid: (x: number, y: number) => boolean): void {
  const r = rng(seed);
  for (let k = 0; k < 14; k++) {
    const x = 8 + r() * (WORLD_W - 16);
    const y = 6 + r() * (LAYER_H - 12);
    if (avoid(x, y)) continue;
    const s = 2 + r() * 2.2;
    crystal(ctx, x, y, s, vein, (r() - 0.5) * 1.2);
    if (r() < 0.6) crystal(ctx, x + s * 1.3, y + s * 0.4, s * 0.7, vein, 0.5);
  }
}

function inTunnel(x: number, y: number): boolean {
  return x > T_LEFT - 4 && x < FACE_X + 24 && y > T_TOP - 6 && y < T_FLOOR + 6;
}

function paintShaftSection(ctx: CanvasRenderingContext2D): void {
  const x = SHAFT_X;
  ctx.fillStyle = '#17110f';
  ctx.fillRect(x, 0, SHAFT_W, LAYER_H);
  // Back-wall planks
  for (let px = x + 3; px < x + SHAFT_W - 3; px += 9) {
    ctx.fillStyle = shade(P.woodDark, -0.35);
    ctx.fillRect(px, 0, 8, LAYER_H);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(px + 8, 0, 1, LAYER_H);
  }
  // Cross braces
  for (let by = 10; by < LAYER_H; by += 42) {
    line(ctx, x + 4, by, x + SHAFT_W - 4, by + 26, shade(P.wood, -0.25), 2.4);
    line(ctx, x + SHAFT_W - 4, by, x + 4, by + 26, shade(P.wood, -0.25), 2.4);
  }
  // Steel guide rails
  for (const rx of [x + 3, x + SHAFT_W - 6]) {
    box(ctx, rx, -2, 3, LAYER_H + 4, P.steel, 0, 1.1);
    for (let ry = 8; ry < LAYER_H; ry += 24) rivet(ctx, rx + 1.5, ry);
  }
  // Landing ledge at the tunnel floor
  box(ctx, x, T_FLOOR, SHAFT_W + 4, 5, P.woodHi, 1, 1.2);
  ctx.fillStyle = P.wood;
  ctx.fillRect(x + 1, T_FLOOR + 3, SHAFT_W + 2, 1.5);
  // Side walls
  ctx.fillStyle = P.outline;
  ctx.fillRect(x - 1.5, 0, 1.5, LAYER_H);
  ctx.fillRect(x + SHAFT_W, 0, 1.5, LAYER_H);
}

function paintTunnel(ctx: CanvasRenderingContext2D, i: number): void {
  const def = LAYERS[i];
  const r = rng(500 + i);
  // Carved opening with a jagged ceiling and a rounded face
  ctx.beginPath();
  ctx.moveTo(T_LEFT, T_FLOOR + 4);
  ctx.lineTo(T_LEFT, T_TOP + 2);
  for (let x = T_LEFT; x < FACE_X - 12; x += 12) ctx.lineTo(x + 6, T_TOP - 1 - r() * 4);
  ctx.quadraticCurveTo(FACE_X + 14, T_TOP + 6, FACE_X + 10, T_FLOOR + 4);
  ctx.closePath();
  ctx.save();
  ctx.clip();
  stones(ctx, 900 + i, def.tunnel, T_LEFT, T_TOP - 8, FACE_X - T_LEFT + 30, T_FLOOR - T_TOP + 16, 26);
  ctx.fillStyle = 'rgba(8,5,6,0.22)';
  ctx.fillRect(T_LEFT, T_TOP - 8, FACE_X, T_FLOOR);
  const shadow = ctx.createLinearGradient(0, T_TOP - 4, 0, T_TOP + 22);
  shadow.addColorStop(0, 'rgba(0,0,0,0.5)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shadow;
  ctx.fillRect(T_LEFT, T_TOP - 8, FACE_X, 32);
  ctx.restore();
  ctx.strokeStyle = shade(def.rock, -0.65);
  ctx.lineWidth = 2;
  ctx.stroke();

  // Ore face: big crystals growing out of the rock wall
  const fr = rng(700 + i);
  for (let k = 0; k < 7; k++) {
    const y = T_TOP + 10 + k * ((T_FLOOR - T_TOP - 16) / 6);
    crystal(ctx, FACE_X + 2 + fr() * 8, y, 4 + fr() * 3.5, def.vein, -0.9 - fr() * 0.7);
  }

  // Floor: packed dirt, rail ties and a rail
  ctx.fillStyle = shade(def.tunnel, 0.12);
  ctx.fillRect(T_LEFT, T_FLOOR, FACE_X - T_LEFT + 4, 4);
  for (let x = T_LEFT + 4; x < FACE_X - 6; x += 11) box(ctx, x, T_FLOOR - 1.4, 6, 2.8, P.woodDark, 0.6, 0.9);
  box(ctx, T_LEFT, T_FLOOR - 2.6, FACE_X - T_LEFT - 8, 1.6, P.steelHi, 0, 0.8);

  // Timber supports: posts, a cap beam along the ceiling, corner braces
  for (const sx of SUPPORTS) {
    box(ctx, sx, T_TOP + 2, 5, T_FLOOR - T_TOP - 2, P.wood, 1, 1.3);
    ctx.fillStyle = P.woodHi;
    ctx.fillRect(sx + 1, T_TOP + 4, 1.4, T_FLOOR - T_TOP - 6);
    poly(ctx, [sx + 5, T_TOP + 7, sx + 14, T_TOP + 7, sx + 5, T_TOP + 16], P.woodDark, 1.1);
    poly(ctx, [sx, T_TOP + 7, sx - 9, T_TOP + 7, sx, T_TOP + 16], P.woodDark, 1.1);
  }
  box(ctx, T_LEFT - 2, T_TOP + 1, SUPPORTS[SUPPORTS.length - 1] - T_LEFT + 22, 6.5, P.wood, 1.5, 1.3);
  ctx.fillStyle = P.woodHi;
  ctx.fillRect(T_LEFT, T_TOP + 2.4, SUPPORTS[SUPPORTS.length - 1] - T_LEFT + 18, 1.4);
  for (const sx of SUPPORTS) rivet(ctx, sx + 2.5, T_TOP + 4.3);

  // Lantern hooks and bodies (their light is drawn live)
  for (const lx of LANTERNS) {
    line(ctx, lx, T_TOP + 7, lx, T_TOP + 12, P.outline, 1);
    box(ctx, lx - 3, T_TOP + 12, 6, 7, '#3a3236', 1.2, 1.1);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(lx - 1.8, T_TOP + 13.5, 3.6, 4);
    box(ctx, lx - 3.6, T_TOP + 11, 7.2, 1.8, P.steelDark, 0.5, 0.9);
  }

  // A stray crate and a pick leaning against a post near the cart
  box(ctx, 236, T_FLOOR - 9, 12, 9, P.woodHi, 1, 1.2);
  line(ctx, 236.5, T_FLOOR - 4.5, 247.5, T_FLOOR - 4.5, P.woodDark, 1);
}

function paintLocked(ctx: CanvasRenderingContext2D): void {
  // Survey marks where the tunnel will go
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(246,183,60,0.45)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(T_LEFT + 6, T_TOP, FACE_X - T_LEFT - 6, T_FLOOR - T_TOP);
  ctx.setLineDash([]);
  for (const fx of [T_LEFT + 6, FACE_X]) {
    line(ctx, fx, T_FLOOR, fx, T_FLOOR - 14, P.woodDark, 1.6);
    poly(ctx, [fx, T_FLOOR - 14, fx + 8, T_FLOOR - 11.5, fx, T_FLOOR - 9], '#e07a3a', 1);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, WORLD_W, LAYER_H);
}

function paintRestricted(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, WORLD_W, LAYER_H);
  // Helion blast door
  const dx = WORLD_W / 2 - 16, dy = T_TOP - 4, dw = 112, dh = T_FLOOR - T_TOP + 8;
  box(ctx, dx - 6, dy - 6, dw + 12, dh + 10, '#2c3338', 3, 1.6);
  box(ctx, dx, dy, dw, dh, '#46525a', 2, 1.4);
  ctx.fillStyle = '#56636c';
  ctx.fillRect(dx + 3, dy + 3, dw / 2 - 4, dh - 6);
  line(ctx, dx + dw / 2, dy + 2, dx + dw / 2, dy + dh - 2, P.outline, 1.6);
  for (let ry = dy + 8; ry < dy + dh - 4; ry += 14) { rivet(ctx, dx + 6, ry); rivet(ctx, dx + dw - 6, ry); }
  // Hazard tape across the door
  ctx.save();
  ctx.beginPath(); ctx.rect(dx - 30, dy + dh / 2 - 7, dw + 60, 14); ctx.clip();
  ctx.translate(0, 0);
  for (let x = dx - 40; x < dx + dw + 60; x += 12) {
    ctx.fillStyle = '#f2c230';
    ctx.beginPath();
    ctx.moveTo(x, dy + dh / 2 + 7); ctx.lineTo(x + 6, dy + dh / 2 + 7); ctx.lineTo(x + 12, dy + dh / 2 - 7); ctx.lineTo(x + 6, dy + dh / 2 - 7);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = P.outline;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(dx - 30, dy + dh / 2 - 7, dw + 60, 14);
}

export function layerArt(i: number, state: LayerArtState, k: number): Cache {
  const key = `${i}:${state}:${k}`;
  let c = cache.get(key);
  if (c) return c;
  for (const [ck, cv] of cache) if (cv.k !== k) cache.delete(ck);
  const def = LAYERS[i];
  c = makeCache(WORLD_W, LAYER_H, k, (ctx) => {
    stones(ctx, 100 + i * 31, def.rock, 0, 0, WORLD_W, LAYER_H);
    // Keep crystals out of the tunnel, the shaft and the label / plaque areas
    const clear = (x: number, y: number) => (y < 38 && (x < T_LEFT + 120 || x > WORLD_W - 164));
    nuggets(ctx, 300 + i, def.vein, state === 'open' ? (x, y) => inTunnel(x, y) || (x > SHAFT_X - 4 && x < T_LEFT + 2) || clear(x, y) : clear);
    // Strata seam along the top of the band
    ctx.fillStyle = shade(def.rock, -0.7);
    ctx.fillRect(0, 0, WORLD_W, 2.5);
    if (state === 'open') {
      paintShaftSection(ctx);
      paintTunnel(ctx, i);
    } else if (state === 'locked') {
      paintLocked(ctx);
    } else {
      paintRestricted(ctx);
    }
  });
  cache.set(key, c);
  return c;
}

export function bedrockArt(k: number): Cache {
  const key = `bedrock:${k}`;
  let c = cache.get(key);
  if (c) return c;
  c = makeCache(WORLD_W, LAYER_H, k, (ctx) => {
    stones(ctx, 4242, '#231c20', 0, 0, WORLD_W, LAYER_H, 24);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, WORLD_W, LAYER_H);
  });
  cache.set(key, c);
  return c;
}
