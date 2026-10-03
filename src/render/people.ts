// Workers. Drawn facing right with feet at (0, 0), about 30 units tall.
// Everyone on Vesper wears a helmet lamp and an oxygen tank — the air is company-supplied.

import { P, circle, glow, inked, rng, roundRect, shade } from './draw';

export interface Look {
  skin: string;
  hair: string;
  suit: string;
  stripe: string;
}

const SKINS = ['#f1c9a2', '#dca77c', '#b77d55', '#8c5a3c', '#e8b98f'];
const HAIRS = ['#2a1c15', '#5b3a22', '#a4552c', '#d9b46a', '#3a3a48', '#7c2f30', '#c9c2b8'];
const SUITS_MINER = ['#4c6b78', '#56705a', '#5f5878', '#6b5f4d'];
const SUITS_HAULER = ['#8a5f3e', '#7a6a40'];

export function lookFor(seed: number, role: 'miner' | 'hauler' | 'operator' | 'civilian'): Look {
  const r = rng(seed * 7919 + 13);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const suits = role === 'hauler' ? SUITS_HAULER : role === 'civilian' ? ['#6f6378', '#5d6a72', '#7a5a5a'] : SUITS_MINER;
  return { skin: pick(SKINS), hair: pick(HAIRS), suit: pick(suits), stripe: '#e9d27e' };
}

export type Pose = 'walk' | 'mine' | 'idle' | 'push' | 'ride';

export interface PersonOpts {
  look: Look;
  pose: Pose;
  dir: 1 | -1;
  phase: number; // walk cycle, radians
  swing?: number; // 0..1 through a pickaxe swing
  sack?: string | null; // ore colour when carrying a sack
  lamp?: boolean;
  scale?: number;
  tank?: boolean;
  blink?: boolean;
}

const BOOT = '#2a2224';
const GLOVE = '#4a3426';

function limb(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, w: number): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = P.outline;
  ctx.lineWidth = w + 2.4;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

/** Pickaxe angle (radians from +x, around the shoulder) for a point in the swing. */
export function swingAngle(f: number): number {
  if (f < 0.55) {
    const t = f / 0.55;
    return 0.55 + (-2.25 - 0.55) * (1 - (1 - t) * (1 - t)); // wind up, easing out
  }
  if (f < 0.7) {
    const t = (f - 0.55) / 0.15;
    return -2.25 + (0.6 + 2.25) * t * t; // strike, accelerating
  }
  return 0.6 - (f - 0.7) * 0.15;
}

function pickaxe(ctx: CanvasRenderingContext2D, hx: number, hy: number, a: number): void {
  const len = 12;
  const ex = hx + Math.cos(a) * len;
  const ey = hy + Math.sin(a) * len;
  limb(ctx, hx - Math.cos(a) * 2, hy - Math.sin(a) * 2, ex, ey, P.woodHi, 1.6);
  // Curved steel head, perpendicular to the handle.
  const px = -Math.sin(a), py = Math.cos(a);
  ctx.beginPath();
  ctx.moveTo(ex + px * 5.5 - Math.cos(a) * 1.5, ey + py * 5.5 - Math.sin(a) * 1.5);
  ctx.quadraticCurveTo(ex + Math.cos(a) * 2.6, ey + Math.sin(a) * 2.6, ex - px * 5.5 - Math.cos(a) * 1.5, ey - py * 5.5 - Math.sin(a) * 1.5);
  ctx.quadraticCurveTo(ex + Math.cos(a) * 0.4, ey + Math.sin(a) * 0.4, ex + px * 5.5 - Math.cos(a) * 1.5, ey + py * 5.5 - Math.sin(a) * 1.5);
  inked(ctx, '#c3ccd3', 1.1);
}

export function drawPerson(ctx: CanvasRenderingContext2D, x: number, y: number, o: PersonOpts): void {
  const k = o.scale ?? 1;
  const L = o.look;
  const walking = o.pose === 'walk' || o.pose === 'push';
  const stride = walking ? Math.sin(o.phase) * 3.6 : 0;
  const bob = walking ? -Math.abs(Math.sin(o.phase)) * 1.1 : o.pose === 'idle' ? Math.sin(o.phase * 0.3) * 0.3 : 0;
  const suitDark = shade(L.suit, -0.28);

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(o.dir * k, k);

  if (o.lamp) {
    // Headlamp light: a soft glow plus a faint forward cone.
    glow(ctx, 9, -26 + bob, 22, 0.16);
    const cone = ctx.createLinearGradient(8, 0, 44, 0);
    cone.addColorStop(0, 'rgba(255,224,140,0.16)');
    cone.addColorStop(1, 'rgba(255,224,140,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(8, -27 + bob); ctx.lineTo(44, -38 + bob); ctx.lineTo(44, -10 + bob);
    ctx.closePath(); ctx.fill();
  }

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(0, 0.5, 7, 1.8, 0, 0, Math.PI * 2); ctx.fill();

  ctx.translate(0, bob);

  // Oxygen tank (or ore sack) on the back
  if (o.tank !== false && !o.sack) {
    roundRect(ctx, -9, -21, 5.5, 12, 2.4);
    inked(ctx, '#a9bcc7');
    ctx.fillStyle = '#7d909c';
    ctx.fillRect(-8.2, -14, 3.9, 4);
    roundRect(ctx, -7.8, -23.5, 3, 3, 0.8);
    inked(ctx, P.steelDark, 1);
  }

  // Back arm and back leg (darker)
  const shoulderX = 0, shoulderY = -17.5;
  if (o.pose === 'walk') limb(ctx, shoulderX - 1, shoulderY, -1 + stride * 0.9, -9.5, suitDark, 3);
  else if (o.pose === 'idle' || o.pose === 'ride') limb(ctx, shoulderX - 1, shoulderY, -1.5, -9.5, suitDark, 3);
  limb(ctx, -1.6, -7.5, -1.6 - stride, -1.6, shade(L.suit, -0.4), 3.4);
  roundRect(ctx, -4.4 - stride, -2.6, 5.4, 2.8, 1.2);
  inked(ctx, BOOT, 1.1);

  // Front leg
  limb(ctx, 1.4, -7.5, 1.4 + stride, -1.6, shade(L.suit, -0.15), 3.4);
  roundRect(ctx, -1.2 + stride, -2.6, 5.8, 2.8, 1.2);
  inked(ctx, BOOT, 1.1);

  // Torso with chest stripe and tank strap
  roundRect(ctx, -5, -19.5, 10, 13, 3.2);
  inked(ctx, L.suit);
  ctx.fillStyle = L.stripe;
  ctx.fillRect(-4.3, -14.5, 8.6, 1.6);
  ctx.strokeStyle = suitDark;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(-3.5, -19); ctx.lineTo(3.5, -8.5); ctx.stroke();
  ctx.fillStyle = suitDark;
  ctx.fillRect(-4.6, -8.8, 9.2, 1.4); // belt

  // Ore sack over the shoulder
  if (o.sack) {
    ctx.beginPath();
    ctx.ellipse(-7.5, -17, 5.4, 6, -0.3, 0, Math.PI * 2);
    inked(ctx, '#a68a62');
    ctx.fillStyle = o.sack;
    for (const [sx, sy] of [[-9, -19], [-6.5, -15.5], [-8.5, -14.5]]) ctx.fillRect(sx, sy, 1.8, 1.8);
    ctx.strokeStyle = '#6e5a3e';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-4, -22); ctx.lineTo(-3, -18); ctx.stroke();
  }

  // Head
  const hx = 1, hy = -24.5;
  circle(ctx, hx, hy, 5.6, L.skin);
  // Hair peeking out at the back and the sideburn
  ctx.beginPath();
  ctx.moveTo(hx - 5.6, hy - 1); ctx.quadraticCurveTo(hx - 6.4, hy + 3.6, hx - 3.2, hy + 4.4);
  ctx.lineTo(hx - 1.6, hy + 0.5); ctx.lineTo(hx - 0.2, hy - 1.4); ctx.closePath();
  inked(ctx, L.hair, 1.1);
  // Face
  if (!o.blink) {
    ctx.fillStyle = P.outline;
    ctx.beginPath(); ctx.ellipse(hx + 2, hy + 0.2, 0.75, 1.15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(hx + 4.4, hy + 0.2, 0.7, 1.1, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.strokeStyle = P.outline; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(hx + 1.3, hy + 0.4); ctx.lineTo(hx + 2.7, hy + 0.4); ctx.moveTo(hx + 3.8, hy + 0.4); ctx.lineTo(hx + 5, hy + 0.4); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(230,110,100,0.45)';
  ctx.beginPath(); ctx.arc(hx + 4.2, hy + 2.4, 1.1, 0, Math.PI * 2); ctx.fill();

  // Helmet with brim and headlamp
  ctx.beginPath();
  ctx.arc(hx, hy - 0.6, 6.3, Math.PI * 1.02, Math.PI * 1.98);
  ctx.lineTo(hx + 8.2, hy - 0.4);
  ctx.lineTo(hx + 8.2, hy + 0.9);
  ctx.lineTo(hx - 6.6, hy + 0.9);
  ctx.closePath();
  inked(ctx, '#f2b33d');
  ctx.fillStyle = '#ffd77a';
  ctx.beginPath(); ctx.ellipse(hx - 1.4, hy - 4.4, 2.6, 1.2, -0.3, 0, Math.PI * 2); ctx.fill();
  roundRect(ctx, hx + 3.8, hy - 5.6, 3.6, 3.2, 1);
  inked(ctx, P.steelDark, 1);
  ctx.fillStyle = o.lamp ? '#fff3c4' : '#d9d2b8';
  ctx.beginPath(); ctx.arc(hx + 6.4, hy - 4, 1.1, 0, Math.PI * 2); ctx.fill();

  // Front arm (and tool)
  if (o.pose === 'mine') {
    const a = swingAngle(o.swing ?? 0);
    const hxp = shoulderX + Math.cos(a) * 5.5;
    const hyp = shoulderY + 1 + Math.sin(a) * 5.5;
    pickaxe(ctx, hxp, hyp, a);
    limb(ctx, shoulderX + 1, shoulderY, hxp, hyp, L.suit, 3);
    circle(ctx, hxp, hyp, 1.7, GLOVE, 1);
  } else if (o.pose === 'push') {
    limb(ctx, shoulderX + 1, shoulderY, 8, -12, L.suit, 3);
    circle(ctx, 8.3, -12, 1.7, GLOVE, 1);
  } else {
    const ax = o.pose === 'walk' ? 1 - stride * 0.9 : 2;
    limb(ctx, shoulderX + 1, shoulderY, ax, -9.5, L.suit, 3);
    circle(ctx, ax, -9.3, 1.7, GLOVE, 1);
  }

  ctx.restore();
}

/** A mine cart, drawn with its base on y. `fill` 0..1 sets the ore heap; `spin` turns the wheels. */
export function drawCart(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, fill: number, ore: string, spin = 0): void {
  const h = w * 0.42;
  const top = y - 4 - h;
  if (fill > 0) {
    const heap = Math.min(1, fill);
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + 2, top + 2);
    ctx.quadraticCurveTo(x, top - h * 0.9 * heap - 2, x + w / 2 - 2, top + 2);
    ctx.closePath();
    inked(ctx, shade(ore, -0.15), 1.2);
    const r = rng(Math.round(w * 13));
    ctx.fillStyle = shade(ore, 0.35);
    for (let i = 0; i < 6 * heap + 1; i++) {
      const px = x + (r() - 0.5) * w * 0.6;
      ctx.fillRect(px, top - r() * h * 0.6 * heap, 2, 2);
    }
  }
  ctx.beginPath();
  ctx.moveTo(x - w / 2, top);
  ctx.lineTo(x + w / 2, top);
  ctx.lineTo(x + w / 2 - 3, y - 4);
  ctx.lineTo(x - w / 2 + 3, y - 4);
  ctx.closePath();
  inked(ctx, P.steel);
  ctx.fillStyle = P.steelHi;
  ctx.fillRect(x - w / 2 + 1.5, top + 1.2, w - 3, 1.4);
  ctx.strokeStyle = P.steelDark;
  ctx.lineWidth = 1;
  for (const f of [-0.22, 0.22]) {
    ctx.beginPath(); ctx.moveTo(x + w * f, top + 2); ctx.lineTo(x + w * f * 0.9, y - 5); ctx.stroke();
  }
  for (const wx of [x - w * 0.3, x + w * 0.3]) {
    circle(ctx, wx, y - 3, 3, '#2d2a2c', 1.1);
    ctx.strokeStyle = '#6d6a6c';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(wx + Math.cos(spin) * 2.2, y - 3 + Math.sin(spin) * 2.2);
    ctx.lineTo(wx - Math.cos(spin) * 2.2, y - 3 - Math.sin(spin) * 2.2);
    ctx.stroke();
  }
}
