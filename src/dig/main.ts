import './dig.css';
import { BUILD_KINDS, type BuildKind, type UpgradeId } from './config';
import { Game } from './game';
import { play, setSound, unlockAudio } from './audio';
import type { RelicId } from './relics';
import { clearFx, draw, layout, newView, onSignal, screenToTile } from './render';
import * as sim from './sim';
import {
  activateSite, build, buildError, buyUpgrade, demolish, equipRelic, frontTile, nearBase, press, release, repairBase,
  retarget, setSink, steer, toggleRecall, turretCoverage, unequipRelic, usePulse,
} from './sim';
import { T_TURRET } from './map';
import { clearSave, newGame, readSave, writeSave } from './state';
import {
  basePanelHtml, closeModal, escapeModal, initModal, introHtml, modalOpen, openModal, pauseHtml, relicPanelHtml, resetHud,
  showTip, tileInfo, toast, updateHud,
} from './ui';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const stage = document.getElementById('stage')!;
const view = newView();

let game: Game;
let hover = -1;
let selected: BuildKind | null = null;
const pointer = { down: false, id: -1, t0: 0, x: 0, y: 0, inside: false, building: false, lastBuilt: -1 };
let snapCamera = true;
let dpr = 1;
let cssW = 0;
let cssH = 0;

const S = () => game.state;
const save = () => writeSave(S());

// ---- Panels -----------------------------------------------------------------------

function openPanel(): void {
  const s = S();
  const prompt = s.prompt!;
  game.pause('panel');
  stopInput();
  const close = () => {
    s.prompt = null;
    closeModal();
    game.resume('panel');
    save();
  };
  if (prompt.kind === 'base') {
    s.prompt = null;
    game.resume('panel');
    openBase();
    return;
  }
  const site = prompt.site;
  openModal(relicPanelHtml(s, site), (act) => {
    if (act === 'leave') return close();
    const choice = act === 'add' ? 'add' : act === 'keep' ? 'keep' : (act.split(':')[1] as RelicId);
    activateSite(s, site, choice);
    close();
  }, close);
}

function openBase(): void {
  const s = S();
  if (!nearBase(s)) {
    toast('回到基地附近才能打開基地面板（按 R 傳送回去）', 'info');
    return;
  }
  game.pause('base');
  stopInput();
  const refresh = () => openModal(basePanelHtml(s), handle, close, 'base');
  const close = () => {
    closeModal();
    game.resume('base');
    save();
  };
  const handle = (act: string) => {
    const [a, arg] = act.split(':');
    if (a === 'close') return close();
    if (a === 'buy') {
      const r = buyUpgrade(s, arg as UpgradeId);
      if (!r.ok && r.msg) toast(r.msg, 'warn');
    } else if (a === 'repair') {
      const r = repairBase(s);
      if (!r.ok && r.msg) toast(r.msg, 'warn');
    } else if (a === 'toggle') {
      const rel = arg as RelicId;
      if (s.relics.equipped.includes(rel)) unequipRelic(s, rel);
      else {
        const r = equipRelic(s, rel);
        if (!r.ok && r.msg) toast(r.msg, 'warn');
      }
    } else return;
    save();
    refresh();
  };
  refresh();
}

function showPause(): void {
  game.pause('menu');
  stopInput();
  save();
  const back = () => {
    closeModal();
    game.resume('menu');
  };
  openModal(pauseHtml(S()), (act, el) => {
    const s = S();
    if (act === 'sound') {
      s.settings.sound = (el as HTMLInputElement).checked;
      setSound(s.settings.sound);
      save();
    } else if (act === 'numbers') {
      s.settings.numbers = (el as HTMLInputElement).checked;
      save();
    } else if (act === 'resume') back();
    else if (act === 'reset') {
      if (!window.confirm('清除這個世界的所有進度，從頭開始？舊版放置經營的存檔不受影響。')) return;
      clearSave();
      game = new Game(newGame());
      clearFx();
      resetHud();
      snapCamera = true;
      closeModal();
      showIntro();
    }
  }, back);
}

function showIntro(): void {
  game.pause('intro');
  openModal(introHtml(), () => {
    closeModal();
    S().seenHelp = true;
    game.resume('intro');
    save();
    toast('先往下挖、收集礦石。第一波會在 3 分鐘後從地心湧出。', 'info');
  }, null, 'wide');
}

// ---- Building ---------------------------------------------------------------------

function select(kind: BuildKind | null): void {
  selected = selected === kind ? null : kind;
}

function tryBuild(tile: number, quietFail = false): void {
  if (!selected) return;
  const r = build(S(), tile, selected);
  if (!r.ok && r.msg && !quietFail) toast(r.msg, 'warn');
}

function tryDemolish(tile: number): void {
  const r = demolish(S(), tile);
  if (!r.ok && r.msg) toast(r.msg, 'warn');
}

// ---- Input ------------------------------------------------------------------------

function local(e: { clientX: number; clientY: number }): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function stopInput(): void {
  pointer.down = false;
  pointer.building = false;
  heldDirs.length = 0;
  release(S(), false);
}

function setupInput(): void {
  canvas.addEventListener('pointerdown', (e) => {
    unlockAudio();
    if (game.paused) return;
    const [x, y] = local(e);
    pointer.x = x;
    pointer.y = y;
    hover = screenToTile(view, S(), x, y);
    if (hover < 0) return;
    view.lookX = view.lookY = 0;
    if (e.button === 2) {
      tryDemolish(hover);
      return;
    }
    if (selected) {
      tryBuild(hover);
      pointer.down = true;
      pointer.building = true;
      pointer.lastBuilt = hover;
      pointer.id = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    const res = press(S(), hover);
    if (!res.ok) {
      if (res.msg) toast(res.msg, 'warn');
      onSignal({ t: 'unreachable', tile: hover }, S(), S().settings.numbers);
      play({ t: 'unreachable', tile: hover });
      return;
    }
    pointer.down = true;
    pointer.building = false;
    pointer.id = e.pointerId;
    pointer.t0 = performance.now();
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    pointer.x = x;
    pointer.y = y;
    pointer.inside = true;
    hover = screenToTile(view, S(), x, y);
  });
  const up = (e: PointerEvent) => {
    if (!pointer.down || e.pointerId !== pointer.id) return;
    pointer.down = false;
    if (!pointer.building) release(S(), performance.now() - pointer.t0 < 250);
    pointer.building = false;
    if (e.pointerType !== 'mouse') hover = -1;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => {
    pointer.inside = false;
    if (!pointer.down) hover = -1;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.lookY += e.deltaY / view.S;
    view.lookX += e.deltaX / view.S;
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const btn = (id: string, fn: () => void) => document.getElementById(id)!.addEventListener('click', (e) => {
    (e.currentTarget as HTMLElement).blur();
    unlockAudio();
    fn();
  });
  btn('btn-pulse', doPulse);
  btn('btn-recall', doRecall);
  btn('btn-base', openBase);
  btn('btn-menu', showPause);
  document.getElementById('builds')!.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-build]');
    if (!el) return;
    el.blur();
    select(el.dataset.build as BuildKind);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (escapeModal()) return;
      if (modalOpen()) return;
      if (selected) selected = null;
      else showPause();
      return;
    }
    const dir = KEY_DIR[e.code];
    if (dir !== undefined) {
      e.preventDefault();
      if (modalOpen() || e.repeat) return;
      keyDown(dir);
      return;
    }
    if (modalOpen() || e.repeat || game.paused) return;
    const key = e.key.toLowerCase();
    if (e.code === 'Space') {
      e.preventDefault();
      doPulse();
    } else if (key === 'r') doRecall();
    else if (key === 'b') openBase();
    else if (key === 'q') selected = null;
    else if (key === '1' || key === '2' || key === '3') select(BUILD_KINDS[Number(key) - 1]);
    else if (key === 'e') {
      const t = frontTile(S());
      if (selected) tryBuild(t);
      else if (t >= 0) {
        const r = press(S(), t);
        if (!r.ok && r.msg) toast(r.msg, 'info');
      }
    } else if (key === 'x') tryDemolish(hover >= 0 && pointer.inside ? hover : frontTile(S()));
  });
  document.addEventListener('keyup', (e) => {
    const dir = KEY_DIR[e.code];
    if (dir === undefined) return;
    const i = heldDirs.indexOf(dir);
    if (i >= 0) heldDirs.splice(i, 1);
    if (!heldDirs.length && keySteering) {
      keySteering = false;
      if (!pointer.down) release(S(), false);
    }
  });
  window.addEventListener('blur', () => {
    heldDirs.length = 0;
    keySteering = false;
  });
}

const KEY_DIR: Record<string, number> = {
  KeyW: 0, ArrowUp: 0, KeyD: 1, ArrowRight: 1, KeyS: 2, ArrowDown: 2, KeyA: 3, ArrowLeft: 3,
};
const heldDirs: number[] = [];
let keySteering = false;

function keyDown(dir: number): void {
  unlockAudio();
  const i = heldDirs.indexOf(dir);
  if (i >= 0) heldDirs.splice(i, 1);
  heldDirs.push(dir);
  if (game.paused) return;
  view.lookX = view.lookY = 0;
  keySteering = true;
  const res = steer(S(), dir, true);
  if (!res.ok && res.msg) toast(res.msg, 'warn');
}

function doPulse(): void {
  const s = S();
  if (game.paused || s.drone.dead >= 0) return;
  if (!usePulse(s)) toast(`脈衝冷卻中（${Math.ceil(s.drone.pulseCd)} 秒）`, 'info');
}

function doRecall(): void {
  if (game.paused) return;
  stopInput();
  toggleRecall(S());
}

// ---- Loop -------------------------------------------------------------------------

function resize(): void {
  const r = stage.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cssW = r.width;
  cssH = r.height;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}

let last = performance.now();
let hudT = 0;
let saveT = 0;

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const s = S();
  if (!game.paused) {
    if (pointer.down && hover >= 0) {
      if (pointer.building) {
        if (hover !== pointer.lastBuilt && selected !== 'turret') {
          pointer.lastBuilt = hover;
          tryBuild(hover, true);
        }
      } else retarget(s, hover);
    }
    if (heldDirs.length) {
      keySteering = true;
      steer(s, heldDirs[heldDirs.length - 1], false);
    }
  }
  game.tick(dt);
  if (s.prompt && !game.isPausedBy('panel') && !modalOpen()) openPanel();
  layout(view, s, cssW, cssH, dt, snapCamera);
  snapCamera = false;
  if (pointer.inside || pointer.down) hover = screenToTile(view, s, pointer.x, pointer.y);
  const ghostTile = selected ? (pointer.inside && hover >= 0 ? hover : frontTile(s)) : -1;
  const ghostOk = selected && ghostTile >= 0 ? !buildError(s, ghostTile, selected) : false;
  // Show what a turret can hit: the one being placed, or an existing one under the pointer.
  let coverage: number[] | null = null;
  if (selected === 'turret' && ghostOk) coverage = turretCoverage(s, ghostTile);
  else if (!selected && hover >= 0 && pointer.inside && s.world.kind[hover] === T_TURRET) coverage = turretCoverage(s, hover);
  draw(ctx, s, view, {
    hover: game.paused ? -1 : hover,
    coverage: game.paused ? null : coverage,
    ghost: selected && ghostTile >= 0 ? { tile: ghostTile, kind: selected, ok: ghostOk } : null,
    dt: game.paused ? 0 : dt,
    time: now / 1000,
    dpr,
  });
  hudT += dt;
  if (hudT > 0.08) {
    hudT = 0;
    updateHud(s, selected);
    showTip(!game.paused && hover >= 0 && pointer.inside && !selected ? tileInfo(s, hover) : null, pointer.x, pointer.y);
  }
  saveT += dt;
  if (saveT > 5 && !game.paused) {
    saveT = 0;
    save();
  }
  requestAnimationFrame(frame);
}

function boot(): void {
  game = new Game(readSave() ?? newGame());
  setSound(S().settings.sound);
  setSink((sig) => {
    const s = S();
    onSignal(sig, s, s.settings.numbers);
    play(sig);
    if (sig.t === 'toast') toast(sig.text, sig.tone);
    else if (sig.t === 'threat') toast(`${sig.text}：地心騷動 +${sig.amount}`, 'threat');
    else if (sig.t === 'wave') toast(`第 ${sig.n} 波來襲！`, 'threat');
  });
  initModal();
  new ResizeObserver(resize).observe(stage);
  resize();
  setupInput();
  if (!S().seenHelp) showIntro();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game.pause('hidden');
      save();
    } else game.resume('hidden');
  });
  window.addEventListener('pagehide', save);
  // Dev-only handle for scripted playtests in the browser.
  if (import.meta.env.DEV) Object.assign(window, { __dig: { get game() { return game; }, sim, view } });
  requestAnimationFrame(frame);
}

boot();
