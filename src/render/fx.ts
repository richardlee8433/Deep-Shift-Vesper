// Short-lived effects: tap sparks, rock debris from pickaxe strikes, coin pop-ups at the port.

import { P, coin, outlinedText } from './draw';

interface Particle { x: number; y: number; vx: number; vy: number; t: number; life: number; color: string; size: number }
interface Popup { x: number; y: number; t: number; label: string; coin: boolean }

const particles: Particle[] = [];
const popups: Popup[] = [];

export function burst(x: number, y: number, colors: string[], n: number, speed = 30): void {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
    const v = speed * (0.4 + Math.random() * 0.8);
    particles.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0,
      life: 0.45 + Math.random() * 0.35, color: colors[i % colors.length], size: 1.2 + Math.random() * 1.6,
    });
  }
  if (particles.length > 260) particles.splice(0, particles.length - 260);
}

export function popup(x: number, y: number, label: string, withCoin = false): void {
  popups.push({ x, y, t: 0, label, coin: withCoin });
  if (popups.length > 20) popups.shift();
}

export function drawFx(ctx: CanvasRenderingContext2D, dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += dt;
    if (p.t >= p.life) { particles.splice(i, 1); continue; }
    p.vy += 120 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    ctx.globalAlpha = 1 - p.t / p.life;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  for (let i = popups.length - 1; i >= 0; i--) {
    const u = popups[i];
    u.t += dt;
    const life = 1.1;
    if (u.t >= life) { popups.splice(i, 1); continue; }
    const k = u.t / life;
    ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    const y = u.y - 22 * (1 - (1 - k) * (1 - k));
    if (u.coin) coin(ctx, u.x - 14, y - 4, 4.5);
    outlinedText(ctx, u.label, u.coin ? u.x - 8 : u.x, y, 8.5, P.lampHi, u.coin ? 'left' : 'center');
  }
  ctx.globalAlpha = 1;
}
