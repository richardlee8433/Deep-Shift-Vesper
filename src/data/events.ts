// Story events. ALL TEXT HERE IS PLACEHOLDER until the story is locked.
// Each event fires once when its trigger passes; `effect` runs at trigger time
// (so it also applies during offline progress), and the dialog is queued.

import { CONTRACTS } from '../config';
import { perSecond } from '../economy';
import type { GameState } from '../state';
import { credits, pct } from '../format';

export type Speaker = 'helion' | 'teo' | 'mara' | 'juno';

export interface Line {
  speaker: Speaker;
  text: string;
}

export interface StoryEvent {
  id: string;
  title?: string;
  trigger: (s: GameState) => boolean;
  effect?: (s: GameState) => void;
  lines: (s: GameState) => Line[];
}

export const SPEAKERS: Record<Speaker, { name: string; tag: string }> = {
  helion: { name: '赫利昂企業', tag: 'HELION' },
  teo: { name: '提歐', tag: 'TEO' },
  mara: { name: '瑪拉', tag: 'MARA' },
  juno: { name: '朱諾', tag: 'JUNO' },
};

const setContract = (s: GameState, idx: number) => { s.contract = Math.max(s.contract, idx); };

export const EVENTS: StoryEvent[] = [
  {
    id: 'intro',
    title: '上任通知',
    trigger: () => true,
    lines: () => [
      { speaker: 'helion', text: '歡迎上任，主管。F8 開採區目前狀態：運作中。產能：低於目標。' },
      { speaker: 'helion', text: '您的任務很簡單：開採。' },
      { speaker: 'teo', text: '別理那份維修報告，Bertha。你還能再撐一千個小時。' },
      { speaker: 'teo', text: '……喔，新主管？想催工就點坑道，大家會跑快一點。要看裝備，點右邊的標籤。' },
    ],
  },
  {
    id: 'first-report',
    title: '第一份財務報表',
    trigger: (s) => s.firstReport !== null,
    lines: (s) => {
      const r = s.firstReport!;
      return [
        { speaker: 'helion', text: `總收入 ${credits(r.gross)}，公司抽成 ${credits(r.corp)}，淨額 ${credits(r.net)}。` },
        { speaker: 'helion', text: '公司抽成 10%。報表可隨時在「報表」中查閱。' },
      ];
    },
  },
  {
    id: 'production-up',
    title: '產能通知',
    trigger: (s) => {
      if (!s.firstReport || !s.lastReport || s.lastReport.index < 2) return false;
      return perSecond(s.lastReport).production >= perSecond(s.firstReport).production * 1.18;
    },
    lines: (s) => {
      const gain = perSecond(s.lastReport!).production / perSecond(s.firstReport!).production - 1;
      return [{ speaker: 'helion', text: `恭喜，主管。產量提升 ${pct(gain)}。赫利昂感謝您的投入。` }];
    },
  },
  {
    id: 'copper-oxygen',
    trigger: (s) => s.layers[1].unlocked,
    lines: () => [
      { speaker: 'juno', text: '銅礦層開了！主管，我問你喔——你覺得有沒有一顆星球，氧氣是免費的？' },
      { speaker: 'teo', text: '朱諾，回去工作。' },
    ],
  },
  {
    id: 'contract-f8-12',
    title: 'CONTRACT REVISION F8-12',
    trigger: (s) => s.lifetime.gross >= 4000,
    effect: (s) => setContract(s, 1),
    lines: () => [
      { speaker: 'helion', text: '因 Vesper 基礎建設成本上升，公司抽成調整如下：10% → 20%。' },
      { speaker: 'helion', text: '此修訂即日生效。感謝您的理解。' },
    ],
  },
  {
    id: 'mara-intro',
    trigger: (s) => s.layers[2].unlocked,
    lines: () => [
      { speaker: 'mara', text: '鈷礦的第一批貨，我今晚送上軌道。' },
      { speaker: 'mara', text: '……清單我會自己核。' },
    ],
  },
  {
    id: 'contract-f8-14',
    title: 'CONTRACT REVISION F8-14',
    trigger: (s) => s.lifetime.gross >= 40000,
    effect: (s) => setContract(s, 2),
    lines: () => [
      { speaker: 'helion', text: '自本期起，以下服務改為依使用量計費：氧氣服務費、住宿費。' },
      { speaker: 'helion', text: '費率依開採區人數調整。' },
    ],
  },
  {
    id: 'teo-bertha',
    trigger: (s) => s.layers.some((l) => l.drill >= 15),
    lines: () => [
      { speaker: 'teo', text: '又要加速？Bertha 會抗議的。' },
      { speaker: 'teo', text: '公司說她「不值得修」。我說那公司也不值得修，可是我們還不是天天在修。' },
    ],
  },
  {
    id: 'contract-f8-19',
    title: 'CONTRACT REVISION F8-19',
    trigger: (s) => s.lifetime.gross >= 300000,
    effect: (s) => setContract(s, 3),
    lines: () => [
      { speaker: 'helion', text: `新增扣款項目：設備租賃費、運輸費。目前合約：${CONTRACTS[3].id}。` },
    ],
  },
  {
    id: 'juno-numbers',
    title: '朱諾的問題',
    trigger: (s) => s.lifetime.gross >= 3_000_000 && s.firstReport !== null && s.lastReport !== null,
    effect: (s) => { s.flags.workerIncome = true; },
    lines: () => [
      { speaker: 'juno', text: '主管……如果我們挖得比去年多十倍，為什麼大家還是一樣窮？' },
      { speaker: 'juno', text: '你看一下「統計」。不要看產量，看工人收入。' },
    ],
  },
];

const byId = new Map(EVENTS.map((e) => [e.id, e]));
export const getEvent = (id: string) => byId.get(id);

export function checkEvents(s: GameState): void {
  for (const e of EVENTS) {
    if (s.seenEvents.includes(e.id)) continue;
    if (!e.trigger(s)) continue;
    s.seenEvents.push(e.id);
    e.effect?.(s);
    s.eventQueue.push(e.id);
  }
}
