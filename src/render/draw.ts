// Shared palette and drawing primitives. Style: cartoon shapes with a dark outline,
// one highlight and one shadow tone per material, warm lamp light against a dusk sky.

export const FONT = '"Chakra Petch", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';

export const P = {
  outline: '#1a1216',
  text: '#fbf3e6',
  dim: '#c9b9a6',
  lamp: '#f6b73c',
  lampHi: '#ffe08a',
  lampGlow: 'rgba(246, 183, 60, ',
  helion: '#9fe0ef',
  warn: '#ef7c66',
  coin: '#f6c445',
  coinRim: '#b9821c',
  wood: '#8a5a36',
  woodHi: '#b07a4a',
  woodDark: '#563620',
  steel: '#61707b',
  steelHi: '#93a3ae',
  steelDark: '#3a454e',
  soil: '#5b3a2b',
  soilHi: '#7a4f39',
  soilDark: '#3b241b',
  moss: '#6b4a7a',
  glass: '#7fd2e6',
};

export const OUTLINE_W = 1.4;

export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shift a #rrggbb colour lighter (amt > 0) or darker (amt < 0). */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Fill the current path, then outline it. */
export function inked(ctx: CanvasRenderingContext2D, fill: string, width = OUTLINE_W): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = P.outline;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

export function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, r = 0, width = OUTLINE_W): void {
  if (r > 0) roundRect(ctx, x, y, w, h, r);
  else { ctx.beginPath(); ctx.rect(x, y, w, h); }
  inked(ctx, fill, width);
}

export function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, width = OUTLINE_W): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  inked(ctx, fill, width);
}

export function poly(ctx: CanvasRenderingContext2D, pts: number[], fill: string, width = OUTLINE_W): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  inked(ctx, fill, width);
}

export function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number, rgbaPrefix = P.lampGlow): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `${rgbaPrefix}${alpha})`);
  g.addColorStop(1, `${rgbaPrefix}0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// Canvas text is scaled up so labels stay legible when the world is shrunk to phone width.
export const TEXT_SCALE = 1.4;

export function text(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', weight = 600): void {
  ctx.font = `${weight} ${size * TEXT_SCALE}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, x, y);
}

/** Text with a dark outline, readable over any background (like the coin counters). */
export function outlinedText(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', weight = 700): void {
  ctx.font = `${weight} ${size * TEXT_SCALE}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = P.outline;
  ctx.lineWidth = 3.2;
  ctx.strokeText(str, x, y);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

export function textWidth(ctx: CanvasRenderingContext2D, str: string, size: number, weight = 700): number {
  ctx.font = `${weight} ${size * TEXT_SCALE}px ${FONT}`;
  return ctx.measureText(str).width;
}

export function coin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  circle(ctx, x, y, r, P.coinRim, 1.2);
  ctx.beginPath();
  ctx.arc(x - r * 0.08, y - r * 0.08, r * 0.72, 0, Math.PI * 2);
  ctx.fillStyle = P.coin;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.3, y - r * 0.35, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = P.coinRim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.05, y - r * 0.4);
  ctx.lineTo(x - r * 0.05, y + r * 0.4);
  ctx.stroke();
}

/** Coin icon + amount, centred on x (the counters above carts, the elevator and the bin). */
export function coinLabel(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, color = P.text): void {
  const w = textWidth(ctx, str, 8.5);
  const left = x - (w + 12) / 2;
  coin(ctx, left + 4.5, y - 4, 4.5);
  outlinedText(ctx, str, left + 12, y, 8.5, color, 'left');
}

export function rivet(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.arc(x + 0.4, y + 0.4, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath(); ctx.arc(x - 0.2, y - 0.2, 1, 0, Math.PI * 2); ctx.fill();
}

/** Offscreen canvas holding static art, drawn in world units at a fixed pixel ratio. */
export interface Cache {
  canvas: HTMLCanvasElement;
  k: number;
}

export function makeCache(w: number, h: number, k: number, paint: (ctx: CanvasRenderingContext2D) => void): Cache {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * k);
  canvas.height = Math.ceil(h * k);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(k, k);
  paint(ctx);
  return { canvas, k };
}
