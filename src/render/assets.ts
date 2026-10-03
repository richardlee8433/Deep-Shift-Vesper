// Painted art from src/assets (produced by scripts/process_art.py). Images are inlined
// into the bundle, so they decode quickly; the game starts once they are ready.
// Anything missing falls back to the procedural drawing.

import meta from '../assets/sprites.json';
import minerCarry from '../assets/miner-carry.webp';
import minerDrill from '../assets/miner-drill.webp';
import minerWalk from '../assets/miner-walk.webp';
import orePod from '../assets/ore-pod.webp';
import tunnelCobalt from '../assets/tunnel-cobalt.webp';
import tunnelCopper from '../assets/tunnel-copper.webp';
import tunnelCrystal from '../assets/tunnel-crystal.webp';
import tunnelIron from '../assets/tunnel-iron.webp';

export interface SheetMeta {
  frames: number;
  frameW: number;
  frameH: number;
  anchorX: number;
  anchorY: number;
  charH: number;
}

export type SheetName = 'miner-drill' | 'miner-carry' | 'miner-walk';

const SOURCES: Record<string, string> = {
  'miner-drill': minerDrill,
  'miner-carry': minerCarry,
  'miner-walk': minerWalk,
  'ore-pod': orePod,
  'tunnel-0': tunnelIron,
  'tunnel-1': tunnelCopper,
  'tunnel-2': tunnelCobalt,
  'tunnel-3': tunnelCrystal,
};

const images = new Map<string, HTMLImageElement>();

export function loadAssets(): Promise<void> {
  const jobs = Object.entries(SOURCES).map(([key, src]) => new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => { images.set(key, img); resolve(); };
    img.onerror = () => resolve(); // keep the procedural fallback
    img.src = src;
  }));
  return Promise.all(jobs).then(() => undefined);
}

export const image = (key: string) => images.get(key);

export function sheet(name: SheetName): { img: HTMLImageElement; meta: SheetMeta } | null {
  const img = images.get(name);
  const m = (meta as unknown as Record<string, SheetMeta | undefined>)[name];
  return img && m ? { img, meta: m } : null;
}

/** Draw one frame with its anchor (helmet centre, boot sole) at (x, y), `height` world units tall. */
export function drawFrame(ctx: CanvasRenderingContext2D, name: SheetName, frame: number, x: number, y: number, height: number, dir: 1 | -1): boolean {
  const s = sheet(name);
  if (!s) return false;
  const m = s.meta;
  const k = height / m.charH;
  const f = ((frame % m.frames) + m.frames) % m.frames;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir * k, k);
  ctx.drawImage(s.img, f * m.frameW, 0, m.frameW, m.frameH, -m.anchorX, -m.anchorY, m.frameW, m.frameH);
  ctx.restore();
  return true;
}
