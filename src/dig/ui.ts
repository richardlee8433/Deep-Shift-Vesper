// DOM side: status strip, build bar, relic slots, toasts, tooltip and modal panels.

import {
  BUILD, BUILD_KINDS, type BuildKind, DIG_DPS, ENEMY, PULSE, RECALL_TIME, ROCK_HP, ROCK_NAME, THREAT, UPGRADE_IDS, UPGRADES, WAVE,
  armoredEvery, waveSize,
} from './config';
import { isWalkable, T_BASE, T_ORE, T_RELIC, T_RIFT, T_ROCK, T_TURRET, T_WALL, zoneOf, ZONE_NAME } from './map';
import { RELIC_IDS, RELICS, type RelicId } from './relics';
import { canDig, distMap, nearBase, repairCost, standTile, tileX, tileY } from './sim';
import { depthThreat, drillMult, type GameState, maxBaseHp, maxShield, threatOf } from './state';

const $ = (id: string) => document.getElementById(id)!;

export const icon = (r: RelicId, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${RELICS[r].icon}"/></svg>`;
const oreIco = '<svg class="ico ore-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 6-3 12H8L5 9z"/></svg>';
const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.max(0, Math.floor(sec % 60))).padStart(2, '0')}`;

// ---- HUD --------------------------------------------------------------------------

let slotKey = '';
let buildKey = '';

export function updateHud(s: GameState, sel: BuildKind | null): void {
  const d = s.drone;
  const ms = maxShield(s);
  $('shield-num').textContent = d.dead >= 0 ? '—' : String(Math.ceil(d.shield));
  const sf = $('shield-fill');
  sf.style.width = `${(d.dead >= 0 ? 0 : d.shield / ms) * 100}%`;
  sf.classList.toggle('low', d.shield / ms < 0.35);
  const mb = maxBaseHp(s);
  $('base-num').textContent = String(Math.ceil(s.base.hp));
  const bf = $('base-fill');
  bf.style.width = `${(s.base.hp / mb) * 100}%`;
  bf.classList.toggle('low', s.base.hp / mb < 0.35);
  $('ore').textContent = String(s.ore);
  $('threat-num').textContent = String(threatOf(s));
  const w = s.wave;
  const waveEl = $('wave');
  if (w.active) {
    const left = w.toSpawn + s.enemies.length;
    waveEl.textContent = `第 ${w.n} 波・剩 ${left} 隻`;
  } else waveEl.textContent = `第 ${w.n + 1} 波 ${fmtTime(w.timer)}`;
  waveEl.classList.toggle('alert', w.active || w.timer <= WAVE.warn);
  $('depth').textContent = `${ZONE_NAME[zoneOf(Math.floor(d.y))]}・${Math.floor(d.y)}`;

  const key = s.relics.equipped.join(',');
  if (key !== slotKey) {
    slotKey = key;
    const slots: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = s.relics.equipped[i];
      slots.push(r
        ? `<div class="slot" title="${RELICS[r].name}：${RELICS[r].effect}">${icon(r)}<span>${RELICS[r].name}</span></div>`
        : '<div class="slot empty" title="遺物欄位：在地圖上找遠古裝置"><span>空</span></div>');
    }
    $('slots').innerHTML = slots.join('');
  }
  const bk = `${sel}|${s.ore}`;
  if (bk !== buildKey) {
    buildKey = bk;
    $('builds').innerHTML = BUILD_KINDS.map((k, i) => `
      <button type="button" class="bld ${sel === k ? 'on' : ''} ${s.ore < BUILD[k].cost ? 'poor' : ''}" data-build="${k}" title="${BUILD[k].name}：${BUILD[k].text}">
        <kbd>${i + 1}</kbd><span>${BUILD[k].name}</span><small>${oreIco}${BUILD[k].cost}</small>
      </button>`).join('');
  }

  const pf = $('pulse-fill');
  pf.style.transform = `scaleX(${d.pulseCd > 0 ? 1 - d.pulseCd / PULSE.cooldown : 1})`;
  $('btn-pulse').classList.toggle('cooling', d.pulseCd > 0);
  $('pulse-label').textContent = d.pulseCd > 0 ? `脈衝 ${Math.ceil(d.pulseCd)}s` : '脈衝';
  const rec = d.recall >= 0;
  $('btn-recall').classList.toggle('on', rec);
  $('recall-fill').style.transform = `scaleX(${rec ? d.recall / RECALL_TIME : 0})`;
  $('recall-label').textContent = rec ? `返回 ${(RECALL_TIME - d.recall).toFixed(1)}s` : '回基地';
  $('btn-base').classList.toggle('near', nearBase(s));
}

export function resetHud(): void {
  slotKey = '';
  buildKey = '';
}

// ---- Toasts and tooltip -------------------------------------------------------------

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

export function tileInfo(s: GameState, tile: number): string | null {
  if (tile < 0) return null;
  const w = s.world;
  const k = w.kind[tile];
  if (!w.seen[tile]) {
    if (w.scan[tile] && k === T_ORE) return `<b>透鏡：礦脈</b><span>礦石 +${w.ore[tile]}</span>`;
    if (w.scan[tile] && k === T_RELIC) return '<b>透鏡：遠古裝置</b>';
    if (w.scan[tile] && k === T_RIFT) return '<b>透鏡：地心裂縫</b>';
    return '<b>未探索</b>';
  }
  const reach = (ok: boolean) => (ok ? '' : '<span class="bad">不可達：需要相鄰通道</span>');
  if (isWalkable(k)) {
    const rift = k === T_RIFT ? '<span class="bad">地心裂縫：怪物從這裡湧出</span>' : '';
    const trap = w.trap[tile] ? '<span>尖刺陷阱（右鍵／X 拆除）</span>' : '';
    return `<b>${k === T_RIFT ? '地心裂縫' : '通道'}</b>${rift}${trap}${distMap(s)[tile] >= 0 ? '' : '<span class="bad">不可達</span>'}`;
  }
  if (k === T_ROCK || k === T_ORE) {
    const h = w.hard[tile];
    const ore = k === T_ORE ? `<span class="good">礦石 +${w.ore[tile]}</span>` : '';
    const hp = w.hp[tile] < ROCK_HP[h] ? `<span>剩餘 ${Math.round((w.hp[tile] / ROCK_HP[h]) * 100)}%</span>` : '';
    return `<b>${ROCK_NAME[h]}</b><span>約 ${+(ROCK_HP[h] / (DIG_DPS * drillMult(s))).toFixed(2)} 秒</span>${ore}${hp}${reach(canDig(s, tile))}`;
  }
  if (k === T_WALL || k === T_TURRET) {
    const b = k === T_WALL ? BUILD.wall : BUILD.turret;
    return `<b>${b.name}</b><span>耐久 ${Math.ceil(w.hp[tile])} / ${b.hp}</span><span>${b.text}</span><span>右鍵／X 拆除（退回一半）</span>`;
  }
  if (k === T_RELIC) {
    const site = s.sites.find((p) => p.x === tileX(tile) && p.y === tileY(tile));
    if (!site) return null;
    if (site.activated) return `<b>${RELICS[site.relic].name}（已啟動）</b>`;
    return `<b>遠古裝置：${RELICS[site.relic].name}</b><span>${RELICS[site.relic].effect}</span><span class="warn">啟動代價：地心騷動 +${THREAT.relic}（之後每波更大）</span>${reach(standTile(s, tile) >= 0)}`;
  }
  if (k === T_BASE) return `<b>基地核心</b><span>耐久 ${Math.ceil(s.base.hp)} / ${maxBaseHp(s)}</span><span>靠近後按 B：升級、修復、換遺物</span>`;
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

// ---- Modal --------------------------------------------------------------------------

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
  $('modal-card').innerHTML = html;
  $('modal-card').className = `modal-card ${cls}`;
  $('modal').hidden = false;
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

// ---- Panels -------------------------------------------------------------------------

export const HELP = `
  <table class="help">
    <tr><th><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></th><td>朝該方向挖掘，挖通就走過去；按住一路往前挖（方向鍵也可以）</td></tr>
    <tr><th>滑鼠</th><td>點通道移動；按住岩格挖掘、拖到下一格接著挖；停留看資訊</td></tr>
    <tr><th><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd></th><td>選擇建造：岩牆／砲塔／尖刺陷阱。點通道放置（可拖曳連續放），或按 <kbd>E</kbd> 放在面前那格。<kbd>Q</kbd> 取消</td></tr>
    <tr><th>右鍵 / <kbd>X</kbd></th><td>拆除建築（滑鼠指的那格，或面前那格），退回一半礦石</td></tr>
    <tr><th><kbd>B</kbd></th><td>在基地附近開基地面板：升級、修復核心、更換遺物</td></tr>
    <tr><th><kbd>Space</kbd></th><td>脈衝：擊退附近怪物，冷卻 12 秒</td></tr>
    <tr><th><kbd>R</kbd></th><td>3 秒後傳回基地（可取消）</td></tr>
    <tr><th><kbd>Esc</kbd></th><td>暫停、說明與設定</td></tr>
  </table>
  <ul class="rules">
    <li>怪物每隔一段時間從地圖最底下的<b>地心裂縫</b>湧出，一路往上攻擊<b>基地核心</b>。</li>
    <li>牠們會優先走<b>你挖好的通道</b>；沒有通道就慢慢啃穿岩石。挖得越深越廣，資源越多，也替牠們開了越多條路。</li>
    <li>用<b>岩牆</b>堵路逼牠們繞道或啃牆，在窄道放<b>砲塔</b>和<b>陷阱</b>。</li>
    <li><b>地心騷動</b>越高每波越大：啟動遠古裝置、礦脈連鎖、以及你挖到的最深處都會提高它。</li>
    <li>核心被打爆不會結束遊戲：怪物退去、損失 30% 礦石、核心修回一半。探機損毀會在 5 秒後於基地重建。</li>
  </ul>`;

export function relicPanelHtml(s: GameState, site: number): string {
  const p = s.sites[site];
  const def = RELICS[p.relic];
  const full = s.relics.equipped.length >= 3;
  const equip = full
    ? `<p class="hint">欄位已滿：選一件換下（換下的會收進基地，之後可再裝），或先收藏。</p>
       <div class="swap">${s.relics.equipped.map((r) => `<button type="button" data-act="swap:${r}">換下 ${icon(r)}${RELICS[r].name}</button>`).join('')}</div>
       <button type="button" class="ghost" data-act="keep">啟動並收藏，不裝備</button>`
    : `<button type="button" class="primary" data-act="add" data-focus>啟動並裝備（騷動 +${THREAT.relic}）</button>`;
  const t = threatOf(s);
  return `
    <div class="relic-head">${icon(p.relic, 'ico big')}<div><p class="eyebrow">遠古裝置・${ZONE_NAME[zoneOf(p.y)]}</p><h2>${def.name}</h2></div></div>
    <p>${def.effect}</p>
    <p class="play">→ ${def.play}</p>
    <div class="cost">
      <div><span class="k">代價</span>地心騷動 +${THREAT.relic}（${t} → ${Math.min(100, t + THREAT.relic)}）</div>
      <div><span class="k">影響</span>下一波約 ${waveSize(s.wave.n + 1, t)} → ${waveSize(s.wave.n + 1, Math.min(100, t + THREAT.relic))} 隻</div>
    </div>
    <div class="panel-btns">${equip}<button type="button" class="ghost" data-act="leave">暫時放著</button></div>`;
}

export function basePanelHtml(s: GameState): string {
  const ups = UPGRADE_IDS.map((id) => {
    const u = UPGRADES[id];
    const lv = s.upgrades[id];
    const cost = u.costs[lv];
    return `<div class="up">
      <div><b>${u.name}</b> <span class="lv">Lv ${lv}/${u.costs.length}</span><p>${u.text(lv)}${cost !== undefined ? `<br>下一級：${u.text(lv + 1)}` : ''}</p></div>
      <button type="button" data-act="buy:${id}" ${cost === undefined || s.ore < cost ? 'disabled' : ''}>${cost === undefined ? '已滿級' : `${oreIco}${cost}`}</button>
    </div>`;
  }).join('');
  const rc = repairCost(s);
  const relics = RELIC_IDS.map((r) => {
    const found = s.relics.found.includes(r);
    const on = s.relics.equipped.includes(r);
    return `<button type="button" class="pick ${on ? 'on' : ''}" data-act="${found ? `toggle:${r}` : ''}" ${found ? '' : 'disabled'} title="${found ? RELICS[r].effect : '尚未找到'}">
      ${icon(r)}<span>${found ? RELICS[r].name : '？？？'}</span></button>`;
  }).join('');
  const t = threatOf(s);
  const next = waveSize(s.wave.n + 1, t);
  const ae = armoredEvery(s.wave.n + 1, t);
  return `
    <header class="base-head">
      <div><p class="eyebrow">VESPER・F8 地底防線</p><h2>基地核心</h2></div>
      <div class="bank">${oreIco}<b>${s.ore}</b></div>
    </header>
    <div class="core-row">
      <div class="meter"><span class="meter-label">核心</span><div class="bar wide"><i style="width:${(s.base.hp / maxBaseHp(s)) * 100}%"></i></div><b class="num">${Math.ceil(s.base.hp)}/${maxBaseHp(s)}</b></div>
      <button type="button" data-act="repair" ${rc <= 0 || s.ore <= 0 ? 'disabled' : ''}>修復 ${rc > 0 ? `${oreIco}${Math.min(rc, s.ore)}` : ''}</button>
    </div>
    <section><h2>升級</h2><div class="ups">${ups}</div></section>
    <section><h2>遺物 <small>點一下裝上／卸下，最多 3 件</small></h2><div class="picks">${relics}</div></section>
    <section class="intel">
      <h2>情報</h2>
      <p>地心騷動 <b>${t}</b>（遺跡 ${s.threat.relic}・連鎖 ${s.threat.chain}・深度 ${depthThreat(s)}）・下一波約 <b>${next}</b> 隻${ae ? `，每 ${ae} 隻一隻${ENEMY.armored.name}` : ''}</p>
      <p class="dim">擊殺 ${s.stats.kills}・挖掘 ${s.stats.tilesDug} 格・建造 ${s.stats.built}・最佳擊退第 ${s.stats.bestWave} 波・核心失守 ${s.stats.coreFalls} 次・探機損毀 ${s.stats.deaths} 次</p>
    </section>
    <div class="panel-btns"><button type="button" class="primary" data-act="close" data-focus>回到礦坑</button></div>`;
}

export function pauseHtml(s: GameState): string {
  return `
    <h2>暫停</h2>
    <div class="toggles">
      <label><input type="checkbox" data-act="sound" ${s.settings.sound ? 'checked' : ''}> 音效</label>
      <label><input type="checkbox" data-act="numbers" ${s.settings.numbers ? 'checked' : ''}> 跳字（礦石、騷動數字）</label>
    </div>
    <details><summary>操作說明</summary>${HELP}</details>
    <div class="panel-btns">
      <button type="button" class="primary" data-act="resume" data-focus>繼續</button>
      <button type="button" class="ghost danger" data-act="reset">重新開始（清除這個世界）</button>
      <a class="ghost link" href="./index.html">切換到舊版（放置經營）</a>
    </div>`;
}

export function introHtml(): string {
  return `<p class="eyebrow">VESPER・F8 地底防線　試玩版</p>
    <h2>挖礦、蓋防線，擋住從地心湧出的東西</h2>
    ${HELP}
    <div class="panel-btns"><button type="button" class="primary" data-act="ok" data-focus>開始</button></div>`;
}
