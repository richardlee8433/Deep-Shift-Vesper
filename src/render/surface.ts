// The surface: Vesper at dusk. Static scenery is cached; lights, smoke, wheels,
// the transport and people are drawn live on top.

import { GROUND_Y, MINE_TOP, SHAFT_W, SHAFT_X, STORE_X, WORLD_W } from '../config';
import {
  P, box, circle, glow, inked, line, makeCache, outlinedText, poly, rivet, rng, roundRect, shade, text, type Cache,
} from './draw';

export const HEAD_TOP = GROUND_Y - 106; // sheave wheel centre
export const HX = SHAFT_X + SHAFT_W / 2;
export const DORM = { x: 138, w: 76, h: 66 };
export const CANTEEN = { x: 222, w: 62, h: 48 };
export const OFFICE = { x: 292, w: 84, h: 118 };
export const PAD = { x: 386, w: 92 };
export const DORM_DOOR = 160;
export const CANTEEN_DOOR = 246;
export const LAMP_POSTS = [134, 290, 382];
const REFINERY_LIGHTS = [[172, 112], [196, 96], [118, 128]];

let surfaceCache: Cache | null = null;

function paintSky(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  g.addColorStop(0, '#120e24');
  g.addColorStop(0.42, '#2c2042');
  g.addColorStop(0.72, '#69384b');
  g.addColorStop(0.9, '#c46a49');
  g.addColorStop(1, '#e89a5a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WORLD_W, GROUND_Y);

  const r = rng(11);
  for (let k = 0; k < 90; k++) {
    const x = r() * WORLD_W, y = r() * GROUND_Y * 0.55, s = r() * 1.1 + 0.3;
    ctx.fillStyle = `rgba(245,236,255,${0.25 + r() * 0.6})`;
    ctx.fillRect(x, y, s, s);
  }

  // Ringed gas giant, low in the sky
  ctx.save();
  ctx.translate(74, 96);
  ctx.rotate(-0.25);
  ctx.strokeStyle = 'rgba(232,190,160,0.45)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(0, 0, 66, 12, 0, Math.PI, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.closePath();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#b77a6a';
  ctx.fillRect(-42, -42, 84, 84);
  for (let b = -40; b < 40; b += 9) {
    ctx.fillStyle = b % 18 === 0 ? 'rgba(90,50,70,0.35)' : 'rgba(240,200,170,0.25)';
    ctx.fillRect(-42, b, 84, 4);
  }
  const shadowG = ctx.createRadialGradient(-22, -16, 10, -10, -6, 60);
  shadowG.addColorStop(0, 'rgba(30,18,40,0)');
  shadowG.addColorStop(1, 'rgba(30,18,40,0.85)');
  ctx.fillStyle = shadowG;
  ctx.fillRect(-42, -42, 84, 84);
  ctx.restore();
  ctx.strokeStyle = 'rgba(232,190,160,0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(0, 0, 66, 12, 0, 0, Math.PI); ctx.stroke();
  ctx.restore();

  // Long dusk clouds lit from below
  for (const [cx, cy, cw] of [[300, 70, 120], [120, 150, 150], [420, 140, 110], [230, 118, 90]]) {
    ctx.fillStyle = 'rgba(120,62,86,0.55)';
    ctx.beginPath(); ctx.ellipse(cx, cy, cw / 2, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(250,160,110,0.35)';
    ctx.beginPath(); ctx.ellipse(cx + 6, cy + 2.5, cw / 2.4, 2, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Far mesas with a rim of last light
  const mesa = (pts: number[], fill: string, rim: string) => {
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.lineTo(WORLD_W, GROUND_Y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
  };
  mesa([0, 168, 40, 166, 52, 150, 120, 148, 132, 170, 210, 172, 228, 140, 300, 138, 316, 160, 380, 162, 396, 146, 480, 144], '#5a2f45', 'rgba(236,140,110,0.55)');
  mesa([0, 196, 60, 190, 90, 176, 150, 182, 200, 194, 260, 188, 300, 178, 360, 186, 420, 176, 480, 184], '#3c2232', 'rgba(220,120,100,0.4)');
}

function paintRefinery(ctx: CanvasRenderingContext2D): void {
  const c = '#2d1b2a';
  ctx.fillStyle = c;
  ctx.fillRect(106, 132, 18, 60);
  ctx.fillRect(160, 118, 24, 76);
  ctx.fillRect(190, 100, 12, 96);
  ctx.fillRect(126, 160, 34, 34);
  ctx.beginPath(); ctx.arc(143, 160, 17, Math.PI, 0); ctx.fill();
  ctx.fillRect(100, 176, 110, 20);
  ctx.strokeStyle = c;
  ctx.lineWidth = 2;
  for (const [x1, y1, x2, y2] of [[124, 150, 160, 150], [184, 130, 190, 130], [110, 140, 106, 196]]) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
}

function paintO2Tank(ctx: CanvasRenderingContext2D): void {
  const x = 240, y = 152;
  for (const lx of [-16, -6, 6, 16]) line(ctx, x + lx, y + 10, x + lx * 1.3, y + 30, P.steelDark, 2.2);
  circle(ctx, x, y, 22, '#a9bcc7', 1.6);
  ctx.fillStyle = '#c9d8e0';
  ctx.beginPath(); ctx.ellipse(x - 8, y - 9, 8, 5, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(40,60,70,0.25)';
  ctx.beginPath(); ctx.arc(x + 6, y + 6, 18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2f6f86';
  ctx.fillRect(x - 22, y - 3, 44, 7);
  ctx.strokeStyle = P.outline; ctx.lineWidth = 1; ctx.strokeRect(x - 21.5, y - 3, 43, 7);
  text(ctx, 'O₂', x, y + 3.4, 5.5, '#e6f6fb', 'center', 700);
}

function container(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string): void {
  box(ctx, x, y, w, h, fill, 1.5, 1.4);
  ctx.strokeStyle = shade(fill, -0.25);
  ctx.lineWidth = 1;
  for (let cx = x + 4; cx < x + w - 2; cx += 4) {
    ctx.beginPath(); ctx.moveTo(cx, y + 2); ctx.lineTo(cx, y + h - 2); ctx.stroke();
  }
  ctx.fillStyle = shade(fill, 0.2);
  ctx.fillRect(x + 1.5, y + 1.5, w - 3, 1.6);
}

function windowLit(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lit: boolean, color = '#ffd27a'): void {
  box(ctx, x, y, w, h, lit ? color : '#2b2433', 0.8, 1.1);
  if (lit) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(x + 1, y + 1, w * 0.35, h - 2);
  }
}

function paintDorm(ctx: CanvasRenderingContext2D): void {
  const { x, w, h } = DORM;
  const y = GROUND_Y - h;
  container(ctx, x, y + h / 2, w, h / 2, '#4a5560');
  container(ctx, x + 4, y, w - 8, h / 2, '#5b4f60');
  // Doors and windows
  const r = rng(3);
  for (let i = 0; i < 3; i++) {
    windowLit(ctx, x + 8 + i * 22, y + 8, 9, 7, r() > 0.25);
    windowLit(ctx, x + 8 + i * 22, y + h / 2 + 7, 9, 7, r() > 0.25);
  }
  box(ctx, DORM_DOOR - 5, GROUND_Y - 16, 10, 16, '#2e2a30', 1, 1.2);
  ctx.fillStyle = P.lamp;
  ctx.fillRect(DORM_DOOR - 1, GROUND_Y - 19.5, 2, 1.6);
  text(ctx, 'A-07', x + w - 14, y + h / 2 + 22, 4.4, '#d9e1e6', 'center', 700);
  // Exterior stair to the upper module
  for (let s = 0; s < 6; s++) box(ctx, x + w - 2 + s * 0.2, y + h / 2 + 2 + s * 5, 6, 1.6, P.steel, 0, 0.8);
  line(ctx, x + w + 4, y + h / 2 - 6, x + w + 4, GROUND_Y, P.steelDark, 1.3);
  // Roof antenna and laundry line
  line(ctx, x + 10, y, x + 10, y - 12, P.steelDark, 1.2);
  line(ctx, x + 10, y - 12, x + 36, y - 4, '#8a7f86', 0.8);
  for (const [lx, c] of [[17, '#c9605a'], [24, '#6ea0b8'], [30, '#e2c46a']] as const) box(ctx, x + lx, y - 9 + (lx - 10) * 0.3, 4, 5, c, 0.5, 0.8);
  box(ctx, x + w - 26, y - 5, 10, 5, P.steel, 1, 1);
}

function paintCanteen(ctx: CanvasRenderingContext2D): void {
  const { x, w, h } = CANTEEN;
  const y = GROUND_Y - h;
  box(ctx, x, y, w, h, '#6a4a48', 1.5, 1.4);
  ctx.fillStyle = shade('#6a4a48', 0.15);
  ctx.fillRect(x + 1.5, y + 1.5, w - 3, 1.6);
  // Chimney
  box(ctx, x + w - 16, y - 12, 8, 13, '#4a3436', 1, 1.2);
  // Big warm window and door
  box(ctx, x + 6, y + 18, 30, 16, '#ffcf7e', 1, 1.2);
  ctx.fillStyle = 'rgba(120,70,40,0.5)';
  for (let k = 0; k < 3; k++) ctx.fillRect(x + 9 + k * 9, y + 26, 5, 8);
  line(ctx, x + 21, y + 18, x + 21, y + 34, P.outline, 1);
  box(ctx, CANTEEN_DOOR - 5 + 2, GROUND_Y - 15, 10, 15, '#3a2a2c', 1, 1.2);
  // Striped awning
  for (let k = 0; k < 7; k++) {
    poly(ctx, [x + 2 + k * 9, y + 12, x + 11 + k * 9, y + 12, x + 12 + k * 9, y + 17, x + 1 + k * 9, y + 17], k % 2 ? '#efe2c8' : '#c1453f', 1);
  }
  // Sign board (neon text drawn live)
  box(ctx, x + 10, y - 9, 34, 10, '#241b20', 2, 1.2);
}

function paintOffice(ctx: CanvasRenderingContext2D): void {
  const { x, w, h } = OFFICE;
  const y = GROUND_Y - h;
  box(ctx, x, y, w, h, '#2a3840', 1.5, 1.6);
  ctx.fillStyle = '#1e2a31';
  ctx.fillRect(x + w - 16, y + 1.5, 14.5, h - 3);
  // Glass curtain wall
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 4; c++) {
      const lit = (r * 4 + c) % 5 !== 0;
      const wx = x + 6 + c * 16, wy = y + 16 + r * 11.5;
      ctx.fillStyle = lit ? 'rgba(159,224,239,0.75)' : '#1b262c';
      ctx.fillRect(wx, wy, 11, 6.5);
      if (lit) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(wx, wy, 3, 6.5); }
    }
  }
  ctx.strokeStyle = '#11191e';
  ctx.lineWidth = 1;
  for (let c = 0; c <= 4; c++) { ctx.beginPath(); ctx.moveTo(x + 4 + c * 16, y + 12); ctx.lineTo(x + 4 + c * 16, GROUND_Y - 14); ctx.stroke(); }
  // Entrance
  box(ctx, x + 22, GROUND_Y - 14, 22, 14, '#9fe0ef', 1, 1.2);
  line(ctx, x + 33, GROUND_Y - 14, x + 33, GROUND_Y, P.outline, 1);
  box(ctx, x + 18, GROUND_Y - 17, 30, 3, P.steelHi, 0.5, 1);
  // Logo plate and antenna
  box(ctx, x + 8, y - 15, w - 16, 12, '#0d151a', 2, 1.4);
  line(ctx, x + w / 2, y - 15, x + w / 2, y - 30, P.steelHi, 1.4);
  line(ctx, x + w / 2 - 5, y - 24, x + w / 2 + 5, y - 24, P.steelHi, 1);
}

function paintPad(ctx: CanvasRenderingContext2D): void {
  const { x, w } = PAD;
  box(ctx, x, GROUND_Y - 7, w, 7, '#3b3640', 1, 1.4);
  ctx.save();
  ctx.beginPath(); ctx.rect(x + 1, GROUND_Y - 6, w - 2, 2.5); ctx.clip();
  for (let k = x - 6; k < x + w; k += 7) {
    ctx.fillStyle = '#f2c230';
    ctx.beginPath(); ctx.moveTo(k, GROUND_Y - 3.5); ctx.lineTo(k + 3.5, GROUND_Y - 3.5); ctx.lineTo(k + 6, GROUND_Y - 6); ctx.lineTo(k + 2.5, GROUND_Y - 6); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  // Fuel line and crane
  line(ctx, x + w - 6, GROUND_Y - 7, x + w - 6, GROUND_Y - 58, P.steelDark, 3);
  line(ctx, x + w - 6, GROUND_Y - 56, x + w - 34, GROUND_Y - 56, P.steelDark, 2.4);
  line(ctx, x + w - 30, GROUND_Y - 56, x + w - 30, GROUND_Y - 44, '#8a7f86', 0.8);
  box(ctx, x + w - 33, GROUND_Y - 44, 6, 4, '#c1453f', 0.8, 0.9);
}

function paintHeadframe(ctx: CanvasRenderingContext2D): void {
  const l = SHAFT_X - 6, r = SHAFT_X + SHAFT_W + 6;
  const top = HEAD_TOP + 6;
  // Two lattice legs
  const leg = (x1: number, x2: number) => {
    line(ctx, x1, GROUND_Y, x2, top, P.outline, 5.2);
    line(ctx, x1, GROUND_Y, x2, top, P.steel, 3);
  };
  leg(l, HX - 8);
  leg(r, HX + 8);
  // Cross bracing
  for (let k = 0; k < 4; k++) {
    const t1 = k / 4, t2 = (k + 1) / 4;
    const y1 = GROUND_Y - (GROUND_Y - top) * t1, y2 = GROUND_Y - (GROUND_Y - top) * t2;
    const lx1 = l + (HX - 8 - l) * t1, lx2 = l + (HX - 8 - l) * t2;
    const rx1 = r + (HX + 8 - r) * t1, rx2 = r + (HX + 8 - r) * t2;
    line(ctx, lx1, y1, rx2, y2, P.steelDark, 1.6);
    line(ctx, rx1, y1, lx2, y2, P.steelDark, 1.6);
    line(ctx, lx2, y2, rx2, y2, P.steel, 2);
  }
  // Platform at the top
  box(ctx, HX - 20, top - 2, 40, 6, P.steel, 1, 1.3);
  for (let rx = HX - 16; rx <= HX + 16; rx += 8) rivet(ctx, rx, top + 1);
  // Shaft collar through the ground strip
  ctx.fillStyle = '#17110f';
  ctx.fillRect(SHAFT_X, GROUND_Y, SHAFT_W, MINE_TOP - GROUND_Y);
  box(ctx, SHAFT_X - 4, GROUND_Y - 4, SHAFT_W + 8, 5, P.woodHi, 1, 1.3);
  // Control box with a little sign
  box(ctx, 2, GROUND_Y - 22, 16, 22, '#4a5560', 1.5, 1.3);
  box(ctx, 5, GROUND_Y - 18, 10, 6, '#2c3a40', 1, 1);
  ctx.fillStyle = '#7fd18b';
  ctx.fillRect(7, GROUND_Y - 16.5, 2, 2);
  ctx.fillStyle = '#ef7c66';
  ctx.fillRect(11, GROUND_Y - 16.5, 2, 2);
}

function paintGround(ctx: CanvasRenderingContext2D): void {
  const h = MINE_TOP - GROUND_Y;
  ctx.fillStyle = P.soil;
  ctx.fillRect(0, GROUND_Y, WORLD_W, h);
  const r = rng(77);
  for (let k = 0; k < 70; k++) {
    const x = r() * WORLD_W, y = GROUND_Y + 5 + r() * (h - 6), s = 1.5 + r() * 3;
    ctx.fillStyle = r() < 0.5 ? P.soilDark : P.soilHi;
    ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.6, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = P.soilHi;
  ctx.fillRect(0, GROUND_Y, WORLD_W, 3);
  ctx.fillStyle = P.outline;
  ctx.fillRect(0, GROUND_Y - 0.5, WORLD_W, 1);
  // Alien moss tufts along the edge
  for (let x = 4; x < WORLD_W; x += 9 + r() * 14) {
    if (x > SHAFT_X - 6 && x < SHAFT_X + SHAFT_W + 6) continue;
    ctx.fillStyle = r() < 0.5 ? P.moss : '#8a5a92';
    ctx.beginPath();
    ctx.moveTo(x - 3, GROUND_Y + 0.5);
    ctx.quadraticCurveTo(x - 2, GROUND_Y - 4, x, GROUND_Y - 5 - r() * 2);
    ctx.quadraticCurveTo(x + 2, GROUND_Y - 4, x + 3, GROUND_Y + 0.5);
    ctx.closePath();
    ctx.fill();
  }
}

function paintProps(ctx: CanvasRenderingContext2D): void {
  // Ore hopper at the surface store (heap drawn live)
  const hx = STORE_X - 8;
  for (const lx of [hx - 15, hx + 15]) line(ctx, lx, GROUND_Y - 14, lx, GROUND_Y, P.steelDark, 2.4);
  poly(ctx, [hx - 20, GROUND_Y - 30, hx + 20, GROUND_Y - 30, hx + 13, GROUND_Y - 13, hx - 13, GROUND_Y - 13], P.steel, 1.4);
  ctx.fillStyle = P.steelHi;
  ctx.fillRect(hx - 18, GROUND_Y - 28.5, 36, 1.6);
  for (const rx of [hx - 14, hx, hx + 14]) rivet(ctx, rx, GROUND_Y - 24);
  // Barrels and crates
  for (const bx of [276, 284]) {
    box(ctx, bx, GROUND_Y - 10, 7, 10, '#3f6b5e', 2, 1.2);
    line(ctx, bx + 0.5, GROUND_Y - 6.5, bx + 6.5, GROUND_Y - 6.5, P.outline, 0.8);
  }
  box(ctx, 372, GROUND_Y - 9, 10, 9, P.woodHi, 1, 1.2);
  box(ctx, 374, GROUND_Y - 16, 7, 7, P.wood, 1, 1.1);
  // Lamp posts (their light is live)
  for (const lx of LAMP_POSTS) {
    line(ctx, lx, GROUND_Y, lx, GROUND_Y - 34, P.outline, 3);
    line(ctx, lx, GROUND_Y, lx, GROUND_Y - 34, P.steelDark, 1.6);
    box(ctx, lx - 4, GROUND_Y - 37, 8, 3, P.steelDark, 1, 1);
  }
}

export function surfaceArt(k: number): Cache {
  if (surfaceCache && surfaceCache.k === k) return surfaceCache;
  surfaceCache = makeCache(WORLD_W, MINE_TOP, k, (ctx) => {
    paintSky(ctx);
    paintRefinery(ctx);
    paintO2Tank(ctx);
    paintDorm(ctx);
    paintCanteen(ctx);
    paintOffice(ctx);
    paintPad(ctx);
    paintGround(ctx);
    paintHeadframe(ctx);
    paintProps(ctx);
  });
  return surfaceCache;
}

// ---- Live surface details --------------------------------------------------

export function drawSurfaceLive(ctx: CanvasRenderingContext2D, time: number): void {
  // Twinkling stars and the evening star
  const r = rng(5);
  for (let k = 0; k < 12; k++) {
    const x = r() * WORLD_W, y = r() * 90;
    const a = 0.5 + 0.5 * Math.sin(time * (1 + r()) + k);
    ctx.fillStyle = `rgba(255,250,235,${a})`;
    ctx.fillRect(x - 0.5, y - 2, 1, 4);
    ctx.fillRect(x - 2, y - 0.5, 4, 1);
  }
  glow(ctx, 362, 46, 18 + Math.sin(time * 1.3) * 2, 0.55, 'rgba(255,240,214,');
  ctx.fillStyle = '#fff6e6';
  ctx.beginPath(); ctx.arc(362, 46, 2.2, 0, Math.PI * 2); ctx.fill();

  // Refinery smoke and warning lights
  for (let k = 0; k < 5; k++) {
    const t = (time * 0.12 + k / 5) % 1;
    ctx.fillStyle = `rgba(70,50,70,${0.4 * (1 - t)})`;
    ctx.beginPath(); ctx.arc(196 + t * 30, 98 - t * 50, 4 + t * 12, 0, Math.PI * 2); ctx.fill();
  }
  REFINERY_LIGHTS.forEach(([x, y], k) => {
    const on = Math.sin(time * 2 + k * 2.1) > 0.2;
    if (on) glow(ctx, x, y, 6, 0.7, 'rgba(255,90,70,');
    ctx.fillStyle = on ? '#ff6a55' : '#5a2224';
    ctx.fillRect(x - 1, y - 1, 2, 2);
  });

  // Canteen steam and neon sign
  for (let k = 0; k < 4; k++) {
    const t = (time * 0.35 + k / 4) % 1;
    ctx.fillStyle = `rgba(230,220,226,${0.3 * (1 - t)})`;
    ctx.beginPath(); ctx.arc(CANTEEN.x + CANTEEN.w - 12 + Math.sin(t * 6 + k) * 3, GROUND_Y - CANTEEN.h - 14 - t * 28, 2.5 + t * 6, 0, Math.PI * 2); ctx.fill();
  }
  const neon = Math.sin(time * 13) > -0.92;
  if (neon) glow(ctx, CANTEEN.x + 27, GROUND_Y - CANTEEN.h - 4, 16, 0.35, 'rgba(255,120,150,');
  text(ctx, '食堂', CANTEEN.x + 27, GROUND_Y - CANTEEN.h - 1.4, 5.6, neon ? '#ffb0c4' : '#6a3a48', 'center', 700);

  // Helion logo, beacon
  const ox = OFFICE.x + OFFICE.w / 2, oy = GROUND_Y - OFFICE.h;
  glow(ctx, ox, oy - 9, 30, 0.18, 'rgba(159,224,239,');
  text(ctx, 'HELION', ox, oy - 5.2, 6.5, P.helion, 'center', 700);
  const beacon = Math.sin(time * 3) > 0;
  if (beacon) glow(ctx, ox, oy - 31, 10, 0.8, 'rgba(255,80,70,');
  circle(ctx, ox, oy - 31, 1.8, beacon ? '#ff5b4f' : '#5a1f1c', 0.8);

  // Lamp posts
  for (const lx of LAMP_POSTS) {
    glow(ctx, lx, GROUND_Y - 33, 22, 0.32);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(lx - 3, GROUND_Y - 34, 6, 1.6);
  }

  // Pad lights
  for (let k = 0; k < 5; k++) {
    const on = Math.floor(time * 3) % 5 === k;
    ctx.fillStyle = on ? '#9fe0ef' : '#2c4a52';
    ctx.fillRect(PAD.x + 6 + k * 19, GROUND_Y - 8.4, 3, 1.6);
  }
}

/** The orbital transport on the pad. */
export function drawTransport(ctx: CanvasRenderingContext2D, time: number): void {
  const bob = Math.sin(time * 1.4) * 0.6;
  ctx.save();
  ctx.translate(PAD.x + 44, GROUND_Y - 8 + bob);
  // Landing legs
  line(ctx, -18, -4, -24, 1, P.outline, 2.4);
  line(ctx, 16, -4, 22, 1, P.outline, 2.4);
  // Engine glow
  const flick = 0.5 + 0.3 * Math.sin(time * 20);
  glow(ctx, -36, -12, 12, flick, 'rgba(159,224,239,');
  // Hull
  ctx.beginPath();
  ctx.moveTo(-34, -6);
  ctx.lineTo(-30, -20);
  ctx.lineTo(8, -24);
  ctx.quadraticCurveTo(30, -22, 36, -10);
  ctx.lineTo(32, -4);
  ctx.closePath();
  inked(ctx, '#9aa3ab', 1.5);
  ctx.fillStyle = '#b9c1c8';
  ctx.beginPath(); ctx.moveTo(-28, -19); ctx.lineTo(8, -22.5); ctx.quadraticCurveTo(22, -21.5, 28, -17); ctx.lineTo(-29, -15); ctx.closePath(); ctx.fill();
  // Helion stripe, cockpit, engine nozzle, panel lines
  ctx.fillStyle = '#2f6f86';
  ctx.fillRect(-30, -11, 58, 3);
  poly(ctx, [14, -21, 27, -18, 31, -12, 16, -13], P.glass, 1.2);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(17, -19, 4, 2);
  roundRect(ctx, -40, -16, 7, 8, 1.5);
  inked(ctx, P.steelDark, 1.2);
  ctx.strokeStyle = 'rgba(40,40,50,0.5)';
  ctx.lineWidth = 0.8;
  for (const px of [-18, -4, 6]) { ctx.beginPath(); ctx.moveTo(px, -22); ctx.lineTo(px, -6); ctx.stroke(); }
  outlinedText(ctx, 'F8-317', -8, -14.2, 4.6, '#eef2f5', 'center', 700);
  ctx.restore();
}

/** Sheave wheel and gear on the headframe, turning while the elevator moves. */
export function drawHeadWheels(ctx: CanvasRenderingContext2D, angle: number): void {
  const spoked = (x: number, y: number, rad: number, a: number, teeth: number) => {
    if (teeth > 0) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.beginPath();
      for (let t = 0; t < teeth; t++) {
        const a0 = (t / teeth) * Math.PI * 2;
        const a1 = a0 + Math.PI / teeth;
        ctx.lineTo(Math.cos(a0) * (rad + 2.4), Math.sin(a0) * (rad + 2.4));
        ctx.lineTo(Math.cos(a1) * (rad + 2.4), Math.sin(a1) * (rad + 2.4));
        ctx.lineTo(Math.cos(a1) * rad, Math.sin(a1) * rad);
        ctx.lineTo(Math.cos(a1 + Math.PI / teeth) * rad, Math.sin(a1 + Math.PI / teeth) * rad);
      }
      ctx.closePath();
      inked(ctx, '#8a6a4a', 1.3);
      ctx.restore();
    }
    circle(ctx, x, y, rad, teeth > 0 ? '#9c7a52' : P.steel, 1.4);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.strokeStyle = teeth > 0 ? '#5e4430' : P.steelDark;
    ctx.lineWidth = 1.6;
    for (let s = 0; s < 4; s++) {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos((s * Math.PI) / 2) * rad * 0.85, Math.sin((s * Math.PI) / 2) * rad * 0.85); ctx.stroke();
    }
    ctx.restore();
    circle(ctx, x, y, rad * 0.25, P.steelDark, 1);
  };
  spoked(HX + 22, HEAD_TOP + 22, 9, -angle * 1.4, 10);
  spoked(HX, HEAD_TOP, 11, angle, 0);
}
