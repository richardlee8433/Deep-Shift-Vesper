import './style.css';
import { OFFLINE_CAP, WORLD_W } from './config';
import { addTapFx, contentHeight, render, type Camera, type Hit } from './render/index';
import { loadAssets } from './render/assets';
import { addRush, fastForward, step } from './sim';
import { clearSave, loadGame, newGame, parseSave, saveGame, type GameState } from './state';
import { handleAction, initUi, queueNotice, updateHud } from './ui';
import { credits, duration } from './format';

declare global {
  interface Window {
    claude?: {
      hot?: {
        ready?: (start: (data: Record<string, unknown>) => void) => void;
        snapshot?: (fn: () => Record<string, unknown>) => void;
        data?: Record<string, unknown>;
      };
    };
  }
}

let state: GameState;
let speed = 1;

function boot(data: Record<string, unknown>): void {
  state = parseSave(data.state) ?? loadGame() ?? newGame();

  const away = (Date.now() - state.savedAt) / 1000;
  if (state.playTime > 0 && away > 30) {
    const secs = Math.min(away, OFFLINE_CAP);
    const earned = fastForward(state, secs);
    queueNotice('離線期間', `你離開了 ${duration(away)}。礦坑沒有停，工人實收 ${credits(earned)}。${away > OFFLINE_CAP ? `（最多計算 ${duration(OFFLINE_CAP)}）` : ''}`);
  }

  initUi({
    getState: () => state,
    setSpeed: (n) => { speed = n; },
    getSpeed: () => speed,
    reset: () => {
      clearSave();
      state = newGame();
      camera.y = 0;
    },
  });

  window.claude?.hot?.snapshot?.(() => ({ state }));
  setupCanvas();
  requestAnimationFrame(frame);
  window.setInterval(() => saveGame(state), 5000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(state); });
  window.addEventListener('pagehide', () => saveGame(state));
}

// ---- Canvas, camera, input -------------------------------------------------

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const stage = document.getElementById('stage')!;
const camera: Camera = { y: 0, scale: 1, viewW: WORLD_W, viewH: 600 };
const hits: Hit[] = [];
let dpr = 1;

function resize(): void {
  const rect = stage.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  camera.scale = rect.width / WORLD_W;
  camera.viewW = WORLD_W;
  camera.viewH = rect.height / camera.scale;
  clampCamera();
}

function clampCamera(): void {
  const max = Math.max(0, contentHeight(state) - camera.viewH);
  camera.y = Math.max(0, Math.min(max, camera.y));
}

function setupCanvas(): void {
  new ResizeObserver(resize).observe(stage);
  resize();

  let dragging = false;
  let startY = 0;
  let startCam = 0;
  let moved = 0;
  let pointerId = -1;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    pointerId = e.pointerId;
    startY = e.clientY;
    startCam = camera.y;
    moved = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const dy = e.clientY - startY;
    moved = Math.max(moved, Math.abs(dy));
    camera.y = startCam - dy / camera.scale;
    clampCamera();
  });
  const end = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    if (moved < 6) click(e);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.y += e.deltaY / camera.scale;
    clampCamera();
  }, { passive: false });
}

function click(e: PointerEvent): void {
  const rect = canvas.getBoundingClientRect();
  const wx = (e.clientX - rect.left) / camera.scale;
  const wy = (e.clientY - rect.top) / camera.scale + camera.y;
  // Later-drawn regions sit on top.
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (wx >= h.x && wx <= h.x + h.w && wy >= h.y && wy <= h.y + h.h) {
      if (h.action.startsWith('rush:')) {
        addRush(state, h.action.slice(5));
        addTapFx(wx, wy, '+1s');
      } else {
        handleAction(h.action);
      }
      return;
    }
  }
}

// ---- Loop ------------------------------------------------------------------

let last = performance.now();
let hudT = 0;

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  let simDt = dt * speed;
  while (simDt > 0) {
    const d = Math.min(0.05, simDt);
    step(state, d);
    simDt -= d;
  }
  clampCamera();
  render(ctx, state, camera, dpr, now / 1000, dt, hits);
  hudT += dt;
  if (hudT >= 0.15) {
    hudT = 0;
    updateHud();
  }
  requestAnimationFrame(frame);
}

const hot = window.claude?.hot;
loadAssets().then(() => {
  if (hot?.ready) hot.ready(boot);
  else boot(hot?.data ?? {});
});
