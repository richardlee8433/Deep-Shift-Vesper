// Tuning for the base-defence prototype. Every number here is a starting value —
// change freely while playtesting.

export const MAP_W = 30;
export const MAP_H = 48;
/** First row of each depth zone (shallow starts at 0). */
export const MID_ROW = 16;
export const DEEP_ROW = 32;
export const MAP_SEED = 20261008; // one fixed world, so tests and playtests see the same map

export const STEP = 1 / 60; // fixed simulation step, seconds

// Digging: HP per second. Every tile in a zone has the same rock; the shallow zone is
// the softest (~0.5 s) and each deeper zone is LAYER_STEP harder than the one above.
export const DIG_DPS = 2;
export const LAYER_STEP = 0.3;
export const ROCK_HP = [0, 1, 2].map((zone) => (1 + LAYER_STEP) ** zone); // 1, 1.3, 1.69
export const ROCK_NAME = ['淺層岩', '中層岩', '深層岩'];
export const ORE_VALUE = [1, 2, 3]; // per zone

export const MOVE_SPEED = 3.5; // tiles / s
export const VISION = 4.5;
export const LENS_RANGE = 7;
export const SIGNAL_RANGE = 18; // unseen relic sites show as a fuzzy direction within this many tiles

// The miner.
export const SHIELD_BASE = 100;
export const GUN = { interval: 1, damage: 5, range: 3 };
export const PULSE = { cooldown: 12, radius: 3, push: 2, stun: 0.6 };
export const RECALL_TIME = 3;
export const RESPAWN_TIME = 5;
export const START_ORE = 12;

// The base core at the entrance.
export const BASE = { hp: 300, fallLoss: 0.3, fallRestore: 0.5, menuRange: 4 };

// Building.
export type BuildKind = 'wall' | 'turret' | 'trap';
export const BUILD_KINDS: BuildKind[] = ['wall', 'turret', 'trap'];
export const BUILD: Record<BuildKind, { name: string; cost: number; hp: number; text: string }> = {
  wall: { name: '岩牆', cost: 3, hp: 60, text: '堵住通道。怪物會改道，沒有別的路才會啃牆。' },
  turret: { name: '砲塔', cost: 15, hp: 80, text: '自動射擊 4.5 格內最近的怪物。' },
  trap: { name: '尖刺陷阱', cost: 8, hp: 0, text: '鋪在通道上，持續傷害經過的怪物。' },
};
export const BUILD_RANGE = 6;
export const DEMOLISH_REFUND = 0.5;
export const TOWER = { interval: 0.8, damage: 6, range: 4.5 };
export const TRAP_DPS = 8;

// Monsters come up from the rifts at the bottom of the map.
export type EnemyKind = 'crawler' | 'armored';
export const ENEMY: Record<EnemyKind, { name: string; hp: number; speed: number; dps: number; burrow: number; smash: number }> = {
  // burrow: rock HP per second they chew through; smash: structure / core damage per second
  crawler: { name: '爬蟲', hp: 12, speed: 1.6, dps: 5, burrow: 0.8, smash: 6 },
  armored: { name: '裝甲蟲', hp: 40, speed: 1, dps: 10, burrow: 1.2, smash: 14 },
};
export const CONTACT = 0.8; // tiles; monsters closer than this hurt the miner
export const AGGRO = 3; // monsters within this many tiles (and a short open path) go for the miner
export const MAX_ENEMIES = 40;
/** Path costs for the monsters' route to the base: open tiles are cheap, rock and walls cost by HP. */
export const PATH_COST = { open: 1, rockPerHp: 6, structPerHp: 0.3 };

export const WAVE = { first: 180, interval: 120, warn: 6, gap: 0.7, hpGrowth: 0.1 };
export function waveSize(n: number, threat: number): number {
  return Math.round((3 + 1.5 * (n - 1)) * (1 + threat / 100));
}
/** Every k-th monster of a wave is armoured (0 = none). */
export function armoredEvery(n: number, threat: number): number {
  if (threat >= 60) return 3;
  if (n >= 3 || threat >= 30) return 4;
  return 0;
}
export const waveBonus = (n: number) => 4 + 2 * n;

// 地心騷動 (threat, 0–100): makes waves bigger. Relics and chains add to it, and so does
// how deep the miner has gone.
export const THREAT = { relic: 15, chain: 2, depth: 30 };

// Relic numbers.
export const CHAIN = { max: 6, damage: 4, delay: 0.09 };
export const CAPACITOR = { tiles: 8, radius: 2, damage: 12, cooldown: 2 };
export const REPULSOR = { interval: 6, radius: 2, push: 2 };
export const BIO = { duration: 4, mult: 1.5 };

// Upgrades bought at the base.
export type UpgradeId = 'drill' | 'shield' | 'base' | 'tower';
export const UPGRADES: Record<UpgradeId, { name: string; costs: number[]; step: number; text: (lv: number) => string }> = {
  drill: { name: '鑽頭', costs: [10, 25, 50, 90, 150], step: 0.25, text: (lv) => `挖掘速度 ×${(1 + 0.25 * lv).toFixed(2)}` },
  shield: { name: '護盾', costs: [15, 35, 70, 120], step: 25, text: (lv) => `護盾上限 ${SHIELD_BASE + 25 * lv}` },
  base: { name: '基地核心', costs: [30, 70, 140], step: 150, text: (lv) => `核心耐久 ${BASE.hp + 150 * lv}` },
  tower: { name: '砲塔火力', costs: [25, 60, 120], step: 0.25, text: (lv) => `砲塔傷害 ×${(1 + 0.25 * lv).toFixed(2)}` },
};
export const UPGRADE_IDS: UpgradeId[] = ['drill', 'shield', 'base', 'tower'];
