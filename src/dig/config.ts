// Tuning for the dig prototype. Every number here is a starting value from the
// v0.1 plan, not a balanced one — change freely while playtesting.

export const MAP_W = 24;
export const MAP_H = 36;
/** First row of each depth zone (shallow starts at 0). */
export const MID_ROW = 13;
export const DEEP_ROW = 25;
export const MAP_SEED = 7; // fixed so loadouts can be compared on the same map

export const STEP = 1 / 60; // fixed simulation step, seconds

// Digging: HP per second. Soft / hard / dense rock HP gives ~0.5 / 1.5 / 3 s.
export const DIG_DPS = 2;
export const ROCK_HP = [1, 3, 6];
export const ROCK_NAME = ['軟岩', '硬岩', '緻密岩'];
export const ORE_VALUE = { normal: 1, deep: 3 };

export const MOVE_SPEED = 3; // tiles / s
export const VISION = 4;
export const LENS_RANGE = 7;
export const SIGNAL_RANGE = 16; // distant relics show as a fuzzy direction within this many tiles

export const SHIELD_BASE = 100;
export const TURRET = { interval: 1, damage: 5, range: 3 };
export const PULSE = { cooldown: 12, radius: 3, push: 2, stun: 0.6 };
export const EVAC_TIME = 5;

export type EnemyKind = 'crawler' | 'armored';
export const ENEMY: Record<EnemyKind, { name: string; hp: number; speed: number; dps: number }> = {
  crawler: { name: '爬蟲', hp: 10, speed: 1.5, dps: 4 },
  armored: { name: '裝甲蟲', hp: 30, speed: 1, dps: 8 },
};
export const CONTACT = 0.8; // tiles; enemies closer than this hurt the probe
export const NEST_HP = 40;
export const MAX_ENEMIES = 6;
export const WARN_TIME = 3;

export const THREAT = { tutorial: 15, relic: 20, chain: 3, core: 25, nestKill: -15 };
export const THREAT_STEPS = [40, 70];
export function spawnInterval(t: number): number {
  return t < 40 ? 25 : t < 70 ? 18 : 12;
}

// Relic numbers.
export const CHAIN = { max: 6, damage: 4, delay: 0.09 };
export const CAPACITOR = { tiles: 8, radius: 2, damage: 12, cooldown: 2 };
export const REPULSOR = { interval: 6, radius: 2, push: 2 };
export const BIO = { duration: 4, mult: 1.5 };

// Permanent upgrades (bought at base with ore).
export const DRILL_COSTS = [15, 35, 60];
export const DRILL_STEP = 0.25;
export const SHIELD_COSTS = [20, 45];
export const SHIELD_STEP = 25;
