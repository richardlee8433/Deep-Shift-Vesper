// DOM side: HUD strip, bottom bar, toasts, tooltip and the modal screens
// (base, relic panel, core panel, pause, result, help).

import { DIG_DPS, DRILL_COSTS, DRILL_STEP, EVAC_TIME, NEST_HP, PULSE, ROCK_HP, ROCK_NAME, SHIELD_BASE, SHIELD_COSTS, SHIELD_STEP, spawnInterval, THREAT } from './config';
import { T_BEDROCK, T_CORE, T_EMPTY, T_NEST, T_ORE, T_RELIC, T_ROCK, zoneOf, ZONE_NAME } from './map';
import { RELIC_IDS, RELICS, type RelicId } from './relics';
import { canDig, distMap, nestOpening, nextThreshold, previewSite, standTile, tileX, tileY } from './sim';
import type { MetaState, RunState, RunSummary } from './state';

const $ = (id: string) => document.getElementById(id)!;

export const icon = (r: RelicId, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${RELICS[r].icon}"/></svg>`;
const oreIco = '<svg class="ico ore-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 6-3 12H8L5 9z"/></svg>';
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---- HUD --------------------------------------------------------------------

let slotKey = '';

export function updateHud(run: RunState): void {
  const d = run.drone;
  $('shield-num').textContent = String(Math.ceil(d.shield));
  const sf = $('shield-fill');
  sf.style.width = `${(d.shield / d.maxShield) * 100}%`;
  sf.classList.toggle('low', d.shield / d.maxShield < 0.35);
  $('ore').textContent = String(run.ore);
  $('threat-num').textContent = String(Math.round(run.threat));
  $('threat-fill').style.width = `${run.threat}%`;
  const next = nextThreshold(run.threat);
  $('threat-next').textContent = next
    ? `生成每 ${spawnInterval(run.threat)} 秒 · ${next} 起 ${spawnInterval(next)} 秒`
    : `生成每 ${spawnInterval(run.threat)} 秒 · 含裝甲蟲`;
  ($('core-badge') as HTMLElement).hidden = !run.core.taken;

  const key = run.equipped.join(',') + '|' + run.bio.toFixed(0);
  if (key !== slotKey) {
    slotKey = key;
    const slots: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = run.equipped[i];
      slots.push(r
        ? `<div class="slot" title="${RELICS[r].name}：${RELICS[r].effect}">${icon(r)}<span>${RELICS[r].name}</span></div>`
        : '<div class="slot empty"><span>空欄</span></div>');
    }
    $('slots').innerHTML = slots.join('');
  }

  const pf = $('pulse-fill');
  pf.style.transform = `scaleX(${d.pulseCd > 0 ? 1 - d.pulseCd / PULSE.cooldown : 1})`;
  $('btn-pulse').classList.toggle('cooling', d.pulseCd > 0);
  ($('btn-pulse').querySelector('.act-label') as HTMLElement).textContent = d.pulseCd > 0 ? `脈衝 ${Math.ceil(d.pulseCd)}s` : '脈衝';
  const evac = d.evac >= 0;
  $('btn-evac').classList.toggle('on', evac);
  $('evac-fill').style.transform = `scaleX(${evac ? d.evac / EVAC_TIME : 0})`;
  $('evac-label').textContent = evac ? `撤離 ${(EVAC_TIME - d.evac).toFixed(1)}s · 取消` : '撤離';
}

export function resetHud(): void {
  slotKey = '';
}

// ---- Toasts and tooltip -----------------------------------------------------

export function toast(text: string, tone: 'info' | 'good' | 'warn' | 'threat' = 'info'): void {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 4) box.firstElementChild!.remove();
  window.setTimeout(() => el.classList.add('out'), 2600);
  window.setTimeout(() => el.remove(), 3100);
}

export function clearToasts(): void {
  $('toasts').innerHTML = '';
}

export function tileInfo(run: RunState, tile: number): string | null {
  if (tile < 0) return null;
  const w = run.world;
  const k = w.kind[tile];
  const zone = ZONE_NAME[zoneOf(tileY(tile))];
  if (k === T_BEDROCK) return '<b>岩盤</b><span>無法鑽穿</span>';
  if (!w.seen[tile]) {
    if (w.scan[tile] && k === T_ORE) return `<b>透鏡：礦脈</b><span>${w.ore[tile] > 1 ? '深層礦 +3' : '礦石 +1'}</span>`;
    if (w.scan[tile] && (k === T_RELIC || k === T_CORE)) return `<b>透鏡：${k === T_CORE ? '主核心' : '遺跡輪廓'}</b>`;
    if (w.scan[tile] && k === T_NEST) return '<b>透鏡：巢穴</b>';
    return '<b>未探索</b><span>不可達</span>';
  }
  const reach = (ok: boolean) => (ok ? '' : '<span class="bad">不可達：需要相鄰通道</span>');
  if (k === T_EMPTY) {
    const ok = distMap(run)[tile] >= 0;
    return `<b>通道</b><span>${zone}</span>${ok ? '<span>點擊移動</span>' : '<span class="bad">不可達</span>'}`;
  }
  if (k === T_ROCK || k === T_ORE) {
    const h = w.hard[tile];
    const ore = k === T_ORE ? `<span class="good">${w.ore[tile] > 1 ? '深層礦 +3' : '礦石 +1'}</span>` : '';
    const hp = w.hp[tile] < ROCK_HP[h] ? `<span>剩餘 ${Math.round((w.hp[tile] / ROCK_HP[h]) * 100)}%</span>` : '';
    return `<b>${ROCK_NAME[h]}</b><span>基礎約 ${(ROCK_HP[h] / DIG_DPS).toFixed(1)} 秒</span>${ore}${hp}${reach(canDig(run, tile))}`;
  }
  if (k === T_RELIC) {
    const site = run.sites.findIndex((s) => s.x === tileX(tile) && s.y === tileY(tile));
    const s = run.sites[site];
    if (s.activated) return `<b>${RELICS[s.relic].name}（已啟動）</b><span>無法再次收取</span>`;
    const cost = s.tutorial ? `威脅 +${THREAT.tutorial}・附近出現 1 隻爬蟲` : `威脅 +${THREAT.relic}・喚醒最近的休眠巢穴`;
    return `<b>遠古裝置：${RELICS[s.relic].name}</b><span>${RELICS[s.relic].effect}</span><span class="warn">啟動代價：${cost}</span>${reach(standTile(run, tile) >= 0)}`;
  }
  if (k === T_CORE) {
    return `<b>主核心</b><span>目標：取出並安全撤離</span><span class="warn">取出代價：威脅 +${THREAT.core}・全部未清除巢穴甦醒</span>`;
  }
  if (k === T_NEST) {
    const n = run.nests.find((nn) => nn.x === tileX(tile) && nn.y === tileY(tile));
    if (!n) return null;
    const st = n.state === 'awake' ? '<span class="warn">已甦醒</span>' : '<span>休眠中</span>';
    const link = nestOpening(run, n) >= 0 ? '<span class="warn">已與通道連通</span>' : '<span>未連通：不會生成</span>';
    return `<b>${n.name}</b>${st}${link}<span>HP ${Math.ceil(n.hp)} / ${NEST_HP}・在鄰格挖掘可拆除${n.state === 'awake' ? `（威脅 ${THREAT.nestKill}）` : ''}</span>`;
  }
  return null;
}

export function showTip(html: string | null, x: number, y: number): void {
  const tip = $('tip');
  if (!html) {
    tip.hidden = true;
    return;
  }
  tip.hidden = false;
  if (tip.innerHTML !== html) tip.innerHTML = html;
  const stage = $('stage').getBoundingClientRect();
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = x + 16, top = y + 16;
  if (left + w > stage.width - 8) left = x - w - 12;
  if (top + h > stage.height - 8) top = y - h - 12;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}

// ---- Modal ------------------------------------------------------------------

type Handler = (act: string, el: HTMLElement) => void;
let handler: Handler | null = null;
let onEscape: (() => void) | null = null;

export function initModal(): void {
  $('modal-card').addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (el && handler && !(el as HTMLButtonElement).disabled) handler(el.dataset.act!, el);
  });
}

export function openModal(html: string, h: Handler, esc: (() => void) | null = null, cls = ''): void {
  const m = $('modal');
  $('modal-card').innerHTML = html;
  $('modal-card').className = `modal-card ${cls}`;
  m.hidden = false;
  handler = h;
  onEscape = esc;
  const first = $('modal-card').querySelector<HTMLElement>('[data-focus]') ?? $('modal-card').querySelector<HTMLElement>('button');
  first?.focus({ preventScroll: true });
}

export function closeModal(): void {
  $('modal').hidden = true;
  handler = null;
  onEscape = null;
}

export const modalOpen = () => !$('modal').hidden;
export const escapeModal = (): boolean => {
  if (!modalOpen() || !onEscape) return false;
  onEscape();
  return true;
};

// ---- Screens ----------------------------------------------------------------

export const HELP = `
  <table class="help">
    <tr><th>點擊通道</th><td>探機沿已挖通的路自動移動</td></tr>
    <tr><th>按住岩格</th><td>移到相鄰空格並持續挖掘；按住拖到下一個相鄰岩格可連續開路。輕點一下 = 挖穿這一格</td></tr>
    <tr><th>點遠處岩格</th><td>不可達：不會自動挖穿未知地圖</td></tr>
    <tr><th>滑鼠停留</th><td>顯示硬度、資源、危險與啟動代價</td></tr>
    <tr><th>點遺跡</th><td>探機抵達後開啟選擇面板（模擬暫停）</td></tr>
    <tr><th><kbd>Space</kbd></th><td>脈衝：擊退附近敵人，不造成傷害，冷卻 12 秒</td></tr>
    <tr><th><kbd>R</kbd></th><td>原地撤離 5 秒，可取消；受傷不中斷，但護盾歸零先判失敗</td></tr>
    <tr><th><kbd>Esc</kbd></th><td>暫停、說明與設定</td></tr>
  </table>
  <ul class="rules">
    <li>只能上下左右移動與挖掘；探機自動射擊 3 格內最近的敵人。</li>
    <li>挖掘與時間<b>不會</b>增加威脅。威脅來自啟動遺跡、礦脈連鎖與取出主核心。</li>
    <li>甦醒的巢穴要和你的通道<b>連通</b>才會生成敵人；敵人只沿挖通的格子前進。</li>
    <li>遠處遺跡只顯示模糊方向（探機旁的青色箭頭）；岩盤層的缺口一開始就看得到。</li>
    <li>撤離成功：帶回全部礦石與藍圖。失敗：礦石減半、本趟新藍圖遺失（已解鎖的不受影響）。</li>
  </ul>`;

function relicChip(r: RelicId, extra = ''): string {
  return `<span class="chip">${icon(r)}${RELICS[r].name}${extra}</span>`;
}

export function baseHtml(meta: MetaState): string {
  const drillCost = DRILL_COSTS[meta.drill];
  const shieldCost = SHIELD_COSTS[meta.shield];
  const last = meta.last;
  const lastLine = last
    ? `<div class="last ${last.result}">
        <b>上一趟：${last.result === 'success' ? (last.core ? '帶回主核心！' : '安全撤離') : '探機失聯'}</b>
        <span>${oreIco}+${last.ore}</span>
        ${last.saved.length ? `<span>新藍圖 ${last.saved.map((r) => RELICS[r].name).join('、')}</span>` : ''}
        ${last.lost.length ? `<span class="bad">遺失 ${last.lost.map((r) => RELICS[r].name).join('、')}</span>` : ''}
      </div>`
    : '';
  const relics = RELIC_IDS.map((r) => {
    const ok = meta.unlocked.includes(r);
    const on = meta.startRelic === r;
    return `<button type="button" class="pick ${on ? 'on' : ''}" data-act="start:${r}" ${ok ? '' : 'disabled'} title="${ok ? RELICS[r].effect : '撤離時帶回藍圖後解鎖'}">
      ${icon(r)}<span>${ok ? RELICS[r].name : '？？？'}</span></button>`;
  }).join('');
  return `
    <header class="base-head">
      <div>
        <p class="eyebrow">VESPER・F8 遺跡挖掘　試玩版 v0.1</p>
        <h1>挖出讓你更強的東西，<br>再用它處理被你喚醒的東西。</h1>
      </div>
      <div class="bank" title="永久礦石，用來購買升級">${oreIco}<b>${meta.ore}</b></div>
    </header>
    ${lastLine}
    <section>
      <h2>永久升級</h2>
      <div class="ups">
        <div class="up">
          <div><b>基礎鑽頭</b> <span class="lv">Lv ${meta.drill}/3</span><p>挖掘傷害 +${DRILL_STEP * 100}%／級（目前 ×${(1 + DRILL_STEP * meta.drill).toFixed(2)}）</p></div>
          <button type="button" data-act="buy:drill" ${drillCost === undefined || meta.ore < drillCost ? 'disabled' : ''}>${drillCost === undefined ? '已滿級' : `${oreIco}${drillCost}`}</button>
        </div>
        <div class="up">
          <div><b>護盾</b> <span class="lv">Lv ${meta.shield}/2</span><p>上限 +${SHIELD_STEP}／級（目前 ${SHIELD_BASE + SHIELD_STEP * meta.shield}）</p></div>
          <button type="button" data-act="buy:shield" ${shieldCost === undefined || meta.ore < shieldCost ? 'disabled' : ''}>${shieldCost === undefined ? '已滿級' : `${oreIco}${shieldCost}`}</button>
        </div>
      </div>
    </section>
    <section>
      <h2>起始遺物 <small>帶 1 件已回收藍圖出發，占 3 欄中的 1 欄</small></h2>
      <div class="picks">
        <button type="button" class="pick ${meta.startRelic ? '' : 'on'}" data-act="start:none"><span>不帶</span></button>
        ${relics}
      </div>
    </section>
    <footer class="base-foot">
      <div class="records">探索 ${meta.runs} 次・主核心 ${meta.cores}・藍圖 ${meta.unlocked.length}/6</div>
      <div class="base-btns">
        <button type="button" class="ghost" data-act="help">操作說明</button>
        <button type="button" class="ghost" data-act="log">試玩紀錄</button>
        <button type="button" class="ghost" data-act="settings">設定</button>
        <button type="button" class="primary" data-act="go" data-focus>出發</button>
      </div>
    </footer>`;
}

export function relicPanelHtml(run: RunState, meta: MetaState, site: number): string {
  const p = previewSite(run, meta, site);
  const def = RELICS[p.relic];
  const full = run.equipped.length >= 3;
  const nestLine = p.tutorial
    ? '附近通道會出現 1 隻警示爬蟲（3 秒預警）'
    : p.nest
      ? `喚醒 <b>${p.nest.name}</b>${nestOpening(run, p.nest) >= 0 ? '（<span class="bad">已與你的通道連通</span>）' : '（目前未連通：挖通後才會生成）'}`
      : '沒有休眠中的巢穴可喚醒';
  const bp = p.backup ? '<span class="good">教學藍圖會立即備份到基地</span>' : p.owned ? '藍圖已擁有' : '藍圖待撤離保存（失敗會遺失）';
  const equip = full
    ? `<p class="hint">欄位已滿：選一件替換（被替換的本趟不能再用），或只回收藍圖。</p>
       <div class="swap">${run.equipped.map((r) => `<button type="button" data-act="swap:${r}">替換 ${relicChip(r)}</button>`).join('')}</div>
       <button type="button" class="ghost" data-act="none">只啟動回收藍圖，不裝備</button>`
    : `<button type="button" class="primary" data-act="add" data-focus>啟動並裝備（威脅 +${p.threat}）</button>`;
  return `
    <div class="relic-head">${icon(p.relic, 'ico big')}<div><p class="eyebrow">遠古裝置・${ZONE_NAME[zoneOf(run.sites[site].y)]}</p><h2>${def.name}</h2></div></div>
    <p>${def.effect}</p>
    <p class="play">→ ${def.play}</p>
    <div class="cost">
      <div><span class="k">啟動代價</span>威脅 +${p.threat}（${Math.round(run.threat)} → ${Math.min(100, Math.round(run.threat + p.threat))}）</div>
      <div><span class="k">後果</span>${nestLine}</div>
      <div><span class="k">藍圖</span>${bp}</div>
    </div>
    <div class="panel-btns">${equip}<button type="button" class="ghost" data-act="leave">暫時放著</button></div>`;
}

export function corePanelHtml(run: RunState): string {
  const alive = run.nests.filter((n) => n.state !== 'destroyed');
  return `
    <div class="relic-head"><svg class="ico big" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l6 10-6 10-6-10z"/></svg><div><p class="eyebrow">深層・主核心室</p><h2>主核心</h2></div></div>
    <p>這趟探索的目標。核心不是裝備，不占欄位；必須<b>安全撤離</b>才算完成。</p>
    <div class="cost">
      <div><span class="k">代價</span>威脅 +${THREAT.core}（${Math.round(run.threat)} → ${Math.min(100, Math.round(run.threat + THREAT.core))}）</div>
      <div><span class="k">後果</span>${alive.length ? `全部未清除巢穴甦醒：${alive.map((n) => `<b>${n.name}</b>${nestOpening(run, n) >= 0 ? '（已連通）' : ''}`).join('、')}` : '所有巢穴都已拆除'}</div>
    </div>
    <div class="panel-btns"><button type="button" class="primary" data-act="take" data-focus>取出主核心</button><button type="button" class="ghost" data-act="leave">暫時放著</button></div>`;
}

export function pauseHtml(meta: MetaState, inRun: boolean): string {
  return `
    <h2>${inRun ? '暫停' : '設定'}</h2>
    <div class="toggles">
      <label><input type="checkbox" data-act="sound" ${meta.settings.sound ? 'checked' : ''}> 音效</label>
      <label><input type="checkbox" data-act="numbers" ${meta.settings.numbers ? 'checked' : ''}> 跳字（礦石、威脅數字）</label>
    </div>
    <details><summary>操作說明</summary>${HELP}</details>
    <div class="panel-btns">
      ${inRun ? '<button type="button" class="primary" data-act="resume" data-focus>繼續</button>' : '<button type="button" class="primary" data-act="close" data-focus>關閉</button>'}
      ${inRun ? '<button type="button" class="ghost danger" data-act="abandon">放棄本趟（視為失敗）</button>' : ''}
      <button type="button" class="ghost danger" data-act="reset">清除挖掘模式存檔</button>
      <a class="ghost link" href="./index.html">切換到舊版（放置經營）</a>
    </div>`;
}

export function resultHtml(s: RunSummary): string {
  const ok = s.result === 'success';
  const by = Object.entries(s.stats.threatBy).map(([k, v]) => `${({ relic: '遺跡', chain: '連鎖', core: '核心', nest: '拆巢' } as Record<string, string>)[k] ?? k} ${v > 0 ? '+' : ''}${v}`).join('・');
  return `
    <p class="eyebrow">${ok ? '探機已回收' : '訊號中斷'}</p>
    <h2>${ok ? (s.core ? '帶回主核心！' : '安全撤離') : '探機失聯'}</h2>
    ${ok ? '' : `<p class="dim">${s.cause}</p>`}
    <div class="result-grid">
      <div><span class="k">礦石</span><b>${oreIco}+${s.ore}</b>${ok ? '' : `<small>（${s.oreRaw} 的一半，向下取整）</small>`}</div>
      <div><span class="k">藍圖</span>${s.saved.length ? s.saved.map((r) => relicChip(r)).join('') : '—'}${s.lost.length ? `<div class="bad">遺失：${s.lost.map((r) => RELICS[r].name).join('、')}</div>` : ''}</div>
      <div><span class="k">主核心</span>${s.core ? '<b class="good">完成</b>' : '—'}</div>
      <div><span class="k">時間</span>${fmtTime(s.time)}・最深 ${ZONE_NAME[zoneOf(s.depth)]}（第 ${s.depth} 層）</div>
      <div><span class="k">戰鬥</span>擊殺 ${s.stats.kills}・拆巢 ${s.stats.nestsDestroyed}</div>
      <div><span class="k">威脅來源</span>${by || '—'}（最終 ${Math.round(s.threat)}）</div>
    </div>
    <div class="panel-btns"><button type="button" class="primary" data-act="base" data-focus>回基地</button></div>`;
}

export function logHtml(meta: MetaState): string {
  const rows = [...meta.history].reverse().map((s) => {
    const st = s.stats;
    const total = Math.max(1, st.digTime + st.moveTime + st.idleTime);
    const pct = (v: number) => `${Math.round((v / total) * 100)}%`;
    return `<tr>
      <td>${s.result === 'success' ? (s.core ? '核心' : '撤離') : '失敗'}</td>
      <td>${fmtTime(s.time)}</td>
      <td>${st.firstRelicAt >= 0 ? fmtTime(st.firstRelicAt) : '—'}</td>
      <td>${pct(st.digTime)} / ${pct(st.moveTime)} / ${pct(st.idleTime)}</td>
      <td>${s.loadout.map((r) => RELICS[r].name).join('、') || '—'}</td>
      <td>${st.replaced.length}</td>
      <td>${s.ore}</td>
      <td>${s.depth}</td>
    </tr>`;
  }).join('');
  return `
    <h2>試玩紀錄 <small>最近 ${meta.history.length} 趟</small></h2>
    <div class="log-wrap"><table class="log">
      <tr><th>結果</th><th>時間</th><th>首件遺物</th><th>挖／移動／等待</th><th>結束時裝備</th><th>替換</th><th>礦石</th><th>最深</th></tr>
      ${rows || '<tr><td colspan="8">還沒有紀錄</td></tr>'}
    </table></div>
    <div class="panel-btns">
      <button type="button" class="ghost" data-act="copy">複製 JSON</button>
      <button type="button" class="primary" data-act="close" data-focus>關閉</button>
    </div>`;
}
