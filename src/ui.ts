import { CONTRACTS, LAYERS } from './config';
import { currentRates, perSecond, recentRate, totalDeduction, workerCount } from './economy';
import { credits, duration, fmt, pct } from './format';
import type { GameState, Ledger } from './state';
import { getEvent, SPEAKERS } from './data/events';
import { buy, drillMult, getUpgrade, oreValueMult, quote, unlockLayer, type BuyMode } from './upgrades';
import { cargoFlow, elevatorFlow, flows, layerFlow, type Station } from './flows';

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export interface UiHooks {
  getState: () => GameState;
  setSpeed: (n: number) => void;
  getSpeed: () => number;
  reset: () => void;
}

let hooks: UiHooks;
let buyMode: BuyMode = 1;
let sheetUpdate: (() => void) | null = null;
let modalOpen = false;
let modalExtra: { title: string; lines: { tag: string; name: string; text: string; corp: boolean }[] }[] = [];

export function initUi(h: UiHooks): void {
  hooks = h;
  $('#btn-report').addEventListener('click', () => openSheet('report'));
  $('#btn-stats').addEventListener('click', () => openSheet('stats'));
  $('#btn-menu').addEventListener('click', () => openSheet('menu'));
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#modal-next').addEventListener('click', advanceModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });
}

// ---- HUD -------------------------------------------------------------------

export function updateHud(): void {
  const s = hooks.getState();
  $('#credits').textContent = credits(s.credits);
  const r = recentRate();
  $('#rate').textContent = `+${fmt(r.net)} / 秒`;
  $('#contract').textContent = `合約 ${CONTRACTS[s.contract].id}`;
  sheetUpdate?.();
  if (!modalOpen && (s.eventQueue.length > 0 || modalExtra.length > 0)) advanceModal();
}

export function toast(msg: string): void {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  window.clearTimeout((el as HTMLElement & { _t?: number })._t);
  (el as HTMLElement & { _t?: number })._t = window.setTimeout(() => el.classList.remove('show'), 2200);
}

// ---- Dialog (story events, offline summary) ------------------------------

export function queueNotice(title: string, text: string): void {
  modalExtra.push({ title, lines: [{ tag: 'F8', name: '開採區系統', text, corp: true }] });
}

function advanceModal(): void {
  const s = hooks.getState();
  let title = '';
  let lines: { tag: string; name: string; text: string; corp: boolean }[] = [];
  const extra = modalExtra.shift();
  if (extra) {
    title = extra.title;
    lines = extra.lines;
  } else {
    const id = s.eventQueue.shift();
    const ev = id ? getEvent(id) : undefined;
    if (!ev) {
      $('#modal').hidden = true;
      modalOpen = false;
      return;
    }
    title = ev.title ?? '';
    lines = ev.lines(s).map((l) => ({ ...SPEAKERS[l.speaker], text: l.text, corp: l.speaker === 'helion' }));
  }
  modalOpen = true;
  const body = $('#modal-body');
  $('#modal-title').textContent = title;
  $('#modal-title').hidden = !title;
  body.innerHTML = '';
  for (const l of lines) {
    const row = document.createElement('div');
    row.className = `line ${l.corp ? 'corp' : 'person'}`;
    row.innerHTML = `<div class="who"><span class="tag">${l.tag}</span><span class="name">${l.name}</span></div><p></p>`;
    $('p', row).textContent = l.text;
    body.appendChild(row);
  }
  $('#modal').hidden = false;
  $<HTMLButtonElement>('#modal-next').focus();
}

// ---- Bottom sheet ----------------------------------------------------------

export function handleAction(action: string): void {
  const s = hooks.getState();
  const [kind, idx] = action.split(':');
  if (kind === 'unlock') {
    const i = Number(idx);
    if (unlockLayer(s, i)) toast(`${LAYERS[i].name}開挖完成`);
    else toast(`還差 ${credits(LAYERS[i].unlockCost - s.credits)}`);
    return;
  }
  openSheet(action);
}

function closeSheet(): void {
  $('#sheet').hidden = true;
  $('#sheet-backdrop').hidden = true;
  sheetUpdate = null;
}

function openSheet(kind: string): void {
  const body = $('#sheet-body');
  body.innerHTML = '';
  const [type, idx] = kind.split(':');
  let title = '';
  switch (type) {
    case 'layer': {
      const i = Number(idx);
      title = `${i + 1}・${LAYERS[i].name}`;
      sheetUpdate = buildUpgradeSheet(body, [`drill:${i}`, `crew:${i}`], `每單位 ${credits(LAYERS[i].value)}。礦工把礦挖出來，堆在坑道口等升降梯。點坑道可以催工，速度 ×2。`);
      break;
    }
    case 'elevator':
      title = '升降梯';
      sheetUpdate = buildUpgradeSheet(body, ['elevator'], '從最深的一層開始收礦，再送回地面。運量跟不上產出時，礦就會在坑道口堆起來。');
      break;
    case 'cargo':
      title = '搬運隊・貨運港';
      sheetUpdate = buildUpgradeSheet(body, ['cargo', 'orevalue'], '把地面的礦搬到貨運港賣掉。每筆收入都會先扣掉合約上的項目。');
      break;
    case 'report':
      title = '財務報表';
      sheetUpdate = buildReportSheet(body);
      break;
    case 'stats':
      title = '開採區統計';
      sheetUpdate = buildStatsSheet(body);
      break;
    case 'menu':
      title = '設定';
      sheetUpdate = buildMenuSheet(body);
      break;
    default:
      return;
  }
  $('#sheet-title').textContent = title;
  $('#sheet').hidden = false;
  $('#sheet-backdrop').hidden = false;
  sheetUpdate?.();
}

/** Throughput a row's upgrade gives at a level, in sale ₵ per second. */
function flowAt(s: GameState, id: string, lvl: number): { label: string; value: number } | null {
  const [kind, idx] = id.split(':');
  const i = Number(idx);
  const grade = oreValueMult(s.oreValueLevel);
  switch (kind) {
    case 'elevator': return { label: '運量', value: elevatorFlow(s, lvl) * grade };
    case 'cargo': return { label: '運量', value: cargoFlow(s, lvl) * grade };
    case 'drill': return { label: '產出', value: (layerFlow(s, i) * drillMult(lvl)) / drillMult(s.layers[i].drill) * grade };
    case 'crew': return { label: '產出', value: layerFlow(s, i, lvl) * grade };
  }
  return null;
}

const STATIONS: { key: Station; label: string }[] = [
  { key: 'mine', label: '礦坑產出' },
  { key: 'elevator', label: '升降梯' },
  { key: 'cargo', label: '搬運隊' },
];

function buildUpgradeSheet(body: HTMLElement, ids: string[], note: string): () => void {
  const intro = document.createElement('p');
  intro.className = 'sheet-note';
  intro.textContent = note;
  body.appendChild(intro);

  // Mine → elevator → haulers, each with its ₵/s; the station holding output back is flagged.
  const pipe = document.createElement('div');
  pipe.className = 'pipeline';
  pipe.innerHTML = STATIONS.map((st) => `
    <div class="pipe-cell" data-station="${st.key}">
      <div class="pipe-label">${st.label}<span class="pipe-chip">瓶頸</span></div>
      <div class="pipe-value"></div>
    </div>`).join('<div class="pipe-arrow" aria-hidden="true">→</div>');
  body.appendChild(pipe);

  const modes = document.createElement('div');
  modes.className = 'buy-modes';
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', '購買數量');
  const modeList: BuyMode[] = [1, 10, 'max'];
  const modeButtons = modeList.map((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = m === 'max' ? 'MAX' : `×${m}`;
    b.addEventListener('click', () => { buyMode = m; update(); });
    modes.appendChild(b);
    return { m, b };
  });
  body.appendChild(modes);

  const rows = ids.map((id) => {
    const row = document.createElement('div');
    row.className = 'up-row';
    row.innerHTML = `
      <div class="up-info">
        <div class="up-head"><span class="up-label"></span><span class="up-level"></span></div>
        <div class="up-effect"><span class="now"></span><span class="arrow">→</span><span class="next"></span></div>
        <div class="up-flow"><span class="flow-now"></span><span class="arrow">→</span><span class="flow-next"></span></div>
      </div>
      <button type="button" class="up-buy"><span class="qty"></span><span class="cost"></span></button>`;
    const btn = $<HTMLButtonElement>('.up-buy', row);
    btn.addEventListener('click', () => {
      if (buy(hooks.getState(), id, buyMode)) update();
    });
    body.appendChild(row);
    return { id, row, btn };
  });

  function update(): void {
    const s = hooks.getState();
    modeButtons.forEach(({ m, b }) => b.setAttribute('aria-pressed', String(m === buyMode)));
    const f = flows(s);
    const grade = oreValueMult(s.oreValueLevel);
    for (const st of STATIONS) {
      const cell = $(`[data-station="${st.key}"]`, pipe);
      cell.classList.toggle('limit', f.bottleneck === st.key);
      $('.pipe-value', cell).textContent = `${credits(f[st.key] * grade)}/秒`;
    }
    for (const r of rows) {
      const u = getUpgrade(s, r.id)!;
      const q = quote(s, u, buyMode);
      const maxed = u.level >= u.maxLevel;
      $('.up-label', r.row).textContent = u.label;
      $('.up-level', r.row).textContent = maxed ? `Lv.${u.level}・已滿` : `Lv.${u.level}`;
      $('.now', r.row).textContent = u.effect(u.level);
      $('.next', r.row).textContent = maxed ? '' : u.effect(u.level + q.n);
      $('.arrow', r.row).hidden = maxed;
      const fl = flowAt(s, r.id, u.level);
      const flowRow = $('.up-flow', r.row);
      flowRow.hidden = !fl;
      if (fl) {
        $('.flow-now', r.row).textContent = `${fl.label} ${credits(fl.value)}/秒`;
        $('.flow-next', r.row).textContent = maxed ? '' : `${credits(flowAt(s, r.id, u.level + q.n)!.value)}/秒`;
        $('.arrow', flowRow).hidden = maxed;
      }
      $('.qty', r.row).textContent = maxed ? '' : `升級 ×${q.n}`;
      $('.cost', r.row).textContent = maxed ? '已滿' : credits(q.cost);
      r.btn.disabled = maxed || q.cost > s.credits;
    }
  }
  return update;
}

const FEE_ROWS: { key: keyof Ledger; label: string; rate: (s: GameState) => number }[] = [
  { key: 'corp', label: '公司抽成', rate: (s) => currentRates(s).corp },
  { key: 'oxygen', label: '氧氣服務費', rate: (s) => currentRates(s).oxygen },
  { key: 'housing', label: '住宿費', rate: (s) => currentRates(s).housing },
  { key: 'equipment', label: '設備租賃費', rate: (s) => currentRates(s).equipment },
  { key: 'transport', label: '運輸費', rate: (s) => currentRates(s).transport },
];

function buildReportSheet(body: HTMLElement): () => void {
  const wrap = document.createElement('div');
  body.appendChild(wrap);
  return () => {
    const s = hooks.getState();
    const r = s.lastReport;
    const rates = currentRates(s);
    const visible = FEE_ROWS.filter((f) => (r && r[f.key] > 0) || f.rate(s) > 0);
    const left = Math.max(0, 30 - s.period.t);
    if (!r) {
      wrap.innerHTML = `<p class="sheet-note">第一份報表將在 ${Math.ceil(left)} 秒後產生。</p>`;
      return;
    }
    wrap.innerHTML = `
      <p class="ledger-meta">第 ${r.index} 期・${Math.round(r.duration)} 秒・下一期 ${Math.ceil(left)} 秒後</p>
      <table class="ledger">
        <tbody>
          <tr><th>總收入</th><td class="pos">+${fmt(r.gross)}</td></tr>
          ${visible.map((f) => `<tr><th>${f.label}<small>${(f.rate(s) * 100).toFixed(1)}%</small></th><td class="neg">-${fmt(r[f.key])}</td></tr>`).join('')}
        </tbody>
        <tbody class="split">
          <tr class="sub"><th>開採區淨額</th><td>${fmt(r.net)}</td></tr>
          <tr><th>工人薪資<small>每人 ${fmt(CONTRACTS[s.contract].wage * 60)} ₵/分</small></th><td class="neg">-${fmt(r.wages)}</td></tr>
        </tbody>
        <tfoot><tr><th>營運預算<small>可用於升級</small></th><td>${fmt(r.budget)}</td></tr></tfoot>
      </table>
      <p class="sheet-note">目前每筆收入扣除 ${(totalDeduction(rates) * 100).toFixed(1)}%。合約 ${CONTRACTS[s.contract].id}。</p>
      <p class="ledger-meta">累計總收入 ${credits(s.lifetime.gross)}・累計公司抽成 ${credits(s.lifetime.corp)}</p>`;
  };
}

function buildStatsSheet(body: HTMLElement): () => void {
  const wrap = document.createElement('div');
  body.appendChild(wrap);
  return () => {
    const s = hooks.getState();
    const first = s.firstReport;
    const last = s.lastReport;
    if (!first || !last) {
      wrap.innerHTML = '<p class="sheet-note">還沒有報表。統計會在第一份報表產生後開始比較。</p>';
      return;
    }
    const a = perSecond(first);
    const b = perSecond(last);
    const change = (x: number, y: number) => (x > 0 ? pct(y / x - 1) : '—');
    const rows = [
      { label: '產量', unit: '₵ / 秒', now: b.production, delta: change(a.production, b.production), hl: false },
      { label: '企業收入', unit: '₵ / 秒', now: b.corporate, delta: change(a.corporate, b.corporate), hl: false },
    ];
    if (s.flags.workerIncome) {
      rows.push({ label: '每位工人收入', unit: '₵ / 分', now: b.perWorker * 60, delta: change(a.perWorker, b.perWorker), hl: true });
    }
    wrap.innerHTML = `
      <p class="ledger-meta">與第 1 期報表相比（第 ${last.index} 期）</p>
      <div class="stats">
        ${rows.map((r) => `
          <div class="stat ${r.hl ? 'hl' : ''}">
            <div class="stat-label">${r.label}</div>
            <div class="stat-now">${fmt(r.now)}<small>${r.unit}</small></div>
            <div class="stat-delta">${r.delta}</div>
          </div>`).join('')}
      </div>
      <p class="ledger-meta">工人 ${workerCount(s)} 人・遊戲時間 ${duration(s.playTime)}</p>`;
  };
}

function buildMenuSheet(body: HTMLElement): () => void {
  body.innerHTML = `
    <p class="sheet-note">Deep Shift: Vesper v0.1 原型。劇情文字都是暫定版。進度自動存在這個瀏覽器裡。</p>
    <div class="menu-group">
      <div class="menu-label">遊戲速度（測試用）</div>
      <div class="buy-modes" id="speed-modes"></div>
    </div>
    <div class="menu-group">
      <div class="menu-label">重新開始</div>
      <button type="button" class="danger" id="reset-btn">清除進度</button>
    </div>`;
  const speeds = [1, 5, 20];
  const speedWrap = $('#speed-modes', body);
  const speedBtns = speeds.map((n) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `×${n}`;
    b.addEventListener('click', () => { hooks.setSpeed(n); update(); });
    speedWrap.appendChild(b);
    return { n, b };
  });
  const reset = $<HTMLButtonElement>('#reset-btn', body);
  let armed = false;
  reset.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      reset.textContent = '再按一次確認清除';
      return;
    }
    hooks.reset();
    closeSheet();
  });
  function update(): void {
    speedBtns.forEach(({ n, b }) => b.setAttribute('aria-pressed', String(hooks.getSpeed() === n)));
  }
  return update;
}
