// The six relics. Effects live in sim.ts (event handlers); this file holds what the UI shows.

export type RelicId = 'resonance' | 'detonator' | 'lens' | 'capacitor' | 'repulsor' | 'bio';

export interface RelicDef {
  name: string;
  effect: string;
  /** How it changes the way you play — shown under the effect. */
  play: string;
  /** SVG path (24×24 viewBox) for slots and panels. */
  icon: string;
}

export const RELIC_IDS: RelicId[] = ['resonance', 'detonator', 'lens', 'capacitor', 'repulsor', 'bio'];

export const RELICS: Record<RelicId, RelicDef> = {
  resonance: {
    name: '共鳴鑽頭',
    effect: '目標岩格破裂時，對挖掘方向後一格造成同等挖掘傷害（不連續穿透）。',
    play: '沿直線開路，挑有利的方向挖。',
    icon: 'M4 12h9M13 8l5 4-5 4M19 7v10',
  },
  detonator: {
    name: '礦脈引爆器',
    effect: '親自挖碎礦格時，沿相連礦格逐格連鎖，最多 6 格。每次連鎖威脅 +3。',
    play: '先看清礦脈結構，再決定一次清掉多少。',
    icon: 'M12 3l2 5 5 1-4 4 1 6-4-3-4 3 1-6-4-4 5-1z',
  },
  lens: {
    name: '回聲透鏡',
    effect: '顯示 7 格內的礦脈與遺跡輪廓，並標出巢穴範圍。',
    play: '用資訊換取更安全或更短的路線。',
    icon: 'M2 12c3-5 6.5-7 10-7s7 2 10 7c-3 5-6.5 7-10 7s-7-2-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  },
  capacitor: {
    name: '碎岩電容',
    effect: '任何來源每摧毀 8 格岩石，釋放半徑 2 格的防禦脈衝（12 傷害），最多每 2 秒一次。',
    play: '戰鬥中繼續挖，用破岩供應防禦。',
    icon: 'M13 2L5 14h6l-1 8 8-12h-6z',
  },
  repulsor: {
    name: '排斥場',
    effect: '每 6 秒把 2 格內的敵人擊退 2 格，碰牆停止。',
    play: '利用窄道與牆面拖延，持續工作或撤離。',
    icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 4l3 3M20 4l-3 3M4 20l3-3M20 20l-3-3',
  },
  bio: {
    name: '生質轉換器',
    effect: '擊殺敵人後 4 秒挖掘速度 +50%；再次擊殺刷新時間，不疊加倍率。',
    play: '願意靠近危險，用戰鬥換取短時爆發。',
    icon: 'M12 3c4 4 6 7 6 10a6 6 0 0 1-12 0c0-3 2-6 6-10zM9 14c1 2 2 3 4 3',
  },
};
