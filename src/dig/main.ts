import './dig.css';
import { DRILL_COSTS, SHIELD_COSTS } from './config';
import { Game } from './game';
import { play, setSound, unlockAudio } from './audio';
import { RELICS, type RelicId } from './relics';
import { clearFx, draw, layout, newView, onSignal, screenToTile } from './render';
import * as sim from './sim';
import { abandon, activateSite, press, previewSite, release, retarget, setSink, type StepResult, takeCore, toggleEvac, usePulse } from './sim';
import { clearSave, newMeta, readSave, writeSave, type MetaState, type Nest } from './state';
import {
  baseHtml, clearToasts, closeModal, corePanelHtml, escapeModal, HELP, initModal, logHtml, modalOpen, openModal,
  pauseHtml, relicPanelHtml, resetHud, resultHtml, showTip, tileInfo, toast, updateHud,
} from './ui';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const stage = document.getElementById('stage')!;
const view = newView();

let meta: MetaState;
let game: Game;
let highlight: Nest | null = null;
let hover = -1;
const pointer = { down: false, id: -1, t0: 0, x: 0, y: 0, inside: false };
let snapCamera = true;
let dpr = 1;
let cssW = 0;
let cssH = 0;

function save(): void {
  writeSave(meta, game.run);
}

// ---- Screens ------------------------------------------------------------------

function showBase(): void {
  game.pause('base');
  openModal(baseHtml(meta), (act) => {
    const [a, arg] = act.split(':');
    if (a === 'buy') {
      if (arg === 'drill' && DRILL_COSTS[meta.drill] !== undefined && meta.ore >= DRILL_COSTS[meta.drill]) {
        meta.ore -= DRILL_COSTS[meta.drill];
        meta.drill += 1;
      }
      if (arg === 'shield' && SHIELD_COSTS[meta.shield] !== undefined && meta.ore >= SHIELD_COSTS[meta.shield]) {
        meta.ore -= SHIELD_COSTS[meta.shield];
        meta.shield += 1;
      }
      save();
      showBase();
    } else if (a === 'start') {
      meta.startRelic = arg === 'none' ? null : (arg as RelicId);
      save();
      showBase();
    } else if (a === 'go') startRun();
    else if (a === 'help') openModal(`<h2>操作說明</h2>${HELP}<div class="panel-btns"><button type="button" class="primary" data-act="back" data-focus>返回</button></div>`, showBase, showBase);
    else if (a === 'log') {
      openModal(logHtml(meta), (b) => {
        if (b === 'copy') {
          void navigator.clipboard?.writeText(JSON.stringify(meta.history, null, 1)).then(() => toast('已複製試玩紀錄', 'good'));
        } else showBase();
      }, showBase, 'wide');
    } else if (a === 'settings') showSettings(false);
  }, null, 'base');
}

function startRun(): void {
  game.startRun();
  clearFx();
  clearToasts();
  resetHud();
  snapCamera = true;
  highlight = null;
  closeModal();
  game.resume('base');
  save();
  if (!meta.seenHelp) {
    meta.seenHelp = true;
    game.pause('help');
    openModal(`<p class="eyebrow">第一次下潛</p><h2>按住岩格挖掘</h2>${HELP}<div class="panel-btns"><button type="button" class="primary" data-act="ok" data-focus>開始挖掘</button></div>`, () => {
      closeModal();
      game.resume('help');
    }, () => { closeModal(); game.resume('help'); });
  }
  toast('按住岩格挖掘。青色箭頭指向遠古裝置的訊號。', 'info');
}

function endRun(res: StepResult): void {
  const sum = game.finish(res);
  highlight = null;
  pointer.down = false;
  save();
  if (!sum) {
    showBase();
    return;
  }
  game.pause('base');
  openModal(resultHtml(sum), () => showBase(), null, sum.result);
}

function openPanel(): void {
  const run = game.run!;
  const prompt = run.prompt!;
  game.pause('panel');
  pointer.down = false;
  release(run, false);
  const close = () => {
    run.prompt = null;
    highlight = null;
    closeModal();
    game.resume('panel');
    save();
  };
  if (prompt.kind === 'core') {
    openModal(corePanelHtml(run), (act) => {
      if (act === 'take') takeCore(run);
      close();
    }, close);
    return;
  }
  const site = prompt.site;
  const p = previewSite(run, meta, site);
  highlight = p.nest;
  openModal(relicPanelHtml(run, meta, site), (act) => {
    if (act === 'leave') return close();
    const choice = act === 'add' ? 'add' : act === 'none' ? 'none' : (act.split(':')[1] as RelicId);
    activateSite(run, meta, site, choice);
    const r = RELICS[run.sites[site].relic];
    if (p.backup) toast(`教學藍圖已備份：${r.name}`, 'good');
    else if (!p.owned) toast(`${r.name}藍圖：待撤離保存`, 'info');
    close();
  }, close);
}

function showPause(): void {
  if (!game.run) return;
  game.pause('menu');
  pointer.down = false;
  release(game.run, false);
  save();
  showSettings(true);
}

function showSettings(inRun: boolean): void {
  const back = () => {
    if (inRun) {
      closeModal();
      game.resume('menu');
    } else showBase();
  };
  openModal(pauseHtml(meta, inRun), (act, el) => {
    if (act === 'sound') {
      meta.settings.sound = (el as HTMLInputElement).checked;
      setSound(meta.settings.sound);
      save();
    } else if (act === 'numbers') {
      meta.settings.numbers = (el as HTMLInputElement).checked;
      save();
    } else if (act === 'resume' || act === 'close') back();
    else if (act === 'abandon') {
      if (!game.run || !window.confirm('放棄本趟？會照失敗結算：礦石減半、本趟新藍圖遺失。')) return;
      closeModal();
      game.resume('menu');
      endRun(abandon(game.run));
    } else if (act === 'reset') {
      if (!window.confirm('清除挖掘模式的所有進度（礦石、升級、藍圖）？舊版放置經營的存檔不受影響。')) return;
      clearSave();
      meta = newMeta();
      game = new Game(meta);
      showBase();
    }
  }, back);
}

// ---- Input ------------------------------------------------------------------

function local(e: { clientX: number; clientY: number }): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function setupInput(): void {
  canvas.addEventListener('pointerdown', (e) => {
    unlockAudio();
    const run = game.run;
    if (!run || game.paused) return;
    const [x, y] = local(e);
    pointer.x = x;
    pointer.y = y;
    hover = screenToTile(view, x, y);
    if (hover < 0) return;
    view.look = 0;
    const res = press(run, hover);
    if (!res.ok) {
      if (res.msg) toast(res.msg, 'warn');
      onSignal({ t: 'unreachable', tile: hover }, run, meta.settings.numbers);
      play({ t: 'unreachable', tile: hover });
      return;
    }
    pointer.down = true;
    pointer.id = e.pointerId;
    pointer.t0 = performance.now();
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    pointer.x = x;
    pointer.y = y;
    pointer.inside = true;
    hover = screenToTile(view, x, y);
  });
  const up = (e: PointerEvent) => {
    if (!pointer.down || e.pointerId !== pointer.id) return;
    pointer.down = false;
    if (game.run) release(game.run, performance.now() - pointer.t0 < 250);
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
    view.look += e.deltaY / Math.max(8, view.ts);
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  document.getElementById('btn-pulse')!.addEventListener('click', (e) => { (e.currentTarget as HTMLElement).blur(); doPulse(); });
  document.getElementById('btn-evac')!.addEventListener('click', (e) => { (e.currentTarget as HTMLElement).blur(); doEvac(); });
  document.getElementById('btn-menu')!.addEventListener('click', (e) => { (e.currentTarget as HTMLElement).blur(); showPause(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (escapeModal()) return;
      if (!modalOpen()) showPause();
      return;
    }
    if (modalOpen() || e.repeat) return;
    if (e.code === 'Space') {
      e.preventDefault();
      doPulse();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      doEvac();
    }
  });
}

function doPulse(): void {
  unlockAudio();
  const run = game.run;
  if (!run || game.paused) return;
  if (!usePulse(run)) toast(`脈衝冷卻中（${Math.ceil(run.drone.pulseCd)} 秒）`, 'info');
}

function doEvac(): void {
  unlockAudio();
  const run = game.run;
  if (!run || game.paused) return;
  pointer.down = false;
  toggleEvac(run);
  if (run.drone.evac >= 0) toast(run.core.taken ? '撤離中…撐過 5 秒就帶著核心回家' : '撤離中…5 秒後帶回全部收穫', 'info');
}

// ---- Loop -------------------------------------------------------------------

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
  const run = game.run;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (run) {
    if (pointer.down && hover >= 0 && !game.paused) retarget(run, hover);
    const res = game.tick(dt);
    if (res) {
      endRun(res);
    } else {
      if (run.prompt && !game.isPausedBy('panel') && !modalOpen()) openPanel();
      layout(view, run, cssW, cssH, dt, snapCamera);
      snapCamera = false;
      if (pointer.inside || pointer.down) hover = screenToTile(view, pointer.x, pointer.y);
      draw(ctx, run, view, { hover: game.paused ? -1 : hover, highlight, dt: game.paused ? 0 : dt, time: now / 1000 });
      hudT += dt;
      if (hudT > 0.08) {
        hudT = 0;
        updateHud(run);
        showTip(!game.paused && hover >= 0 && (pointer.inside || pointer.down) ? tileInfo(run, hover) : null, pointer.x, pointer.y);
      }
      saveT += dt;
      if (saveT > 3 && !game.paused) {
        saveT = 0;
        save();
      }
    }
  } else {
    ctx.fillStyle = '#0b090c';
    ctx.fillRect(0, 0, cssW, cssH);
    showTip(null, 0, 0);
  }
  requestAnimationFrame(frame);
}

function boot(): void {
  const file = readSave();
  meta = file?.meta ?? newMeta();
  game = new Game(meta, file?.run ?? null);
  setSound(meta.settings.sound);
  setSink((s) => {
    onSignal(s, game.run, meta.settings.numbers);
    play(s);
    if (s.t === 'toast') toast(s.text, s.tone);
    else if (s.t === 'threat') toast(`${s.text} ${s.amount > 0 ? '+' : ''}${s.amount}`, s.amount > 0 ? 'threat' : 'good');
  });
  initModal();
  new ResizeObserver(resize).observe(stage);
  resize();
  setupInput();

  if (game.run) {
    game.pause('restore');
    openModal(`<p class="eyebrow">已恢復</p><h2>上次的探索還在進行</h2><p>地圖、敵人、威脅與裝備都照存檔還原。</p><div class="panel-btns"><button type="button" class="primary" data-act="go" data-focus>繼續探索</button></div>`, () => {
      closeModal();
      game.resume('restore');
    });
  } else showBase();

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
