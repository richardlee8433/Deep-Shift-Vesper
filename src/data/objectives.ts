// Onboarding objectives. Each pays a Helion "performance bonus" straight into the budget.
// PLACEHOLDER wording until the story is locked.

import { LAYERS } from '../config';
import type { GameState } from '../state';

export interface Objective {
  text: string;
  reward: number;
  /** Current and target values; done when current >= target. */
  progress: (s: GameState) => { now: number; goal: number; money?: boolean };
}

const level = (get: (s: GameState) => number, goal: number) => (s: GameState) => ({ now: get(s), goal });
const unlock = (i: number) => (s: GameState) =>
  s.layers[i].unlocked ? { now: 1, goal: 1 } : { now: Math.min(s.credits, LAYERS[i].unlockCost), goal: LAYERS[i].unlockCost, money: true };

export const OBJECTIVES: Objective[] = [
  { text: '鐵礦層鑽頭升到 Lv.3', reward: 15, progress: level((s) => s.layers[0].drill, 3) },
  { text: '點坑道催工 10 次', reward: 20, progress: level((s) => s.tapCount, 10) },
  { text: '鐵礦層雇到 2 名礦工', reward: 30, progress: level((s) => s.layers[0].crew, 2) },
  { text: '升降梯升到 Lv.3', reward: 60, progress: level((s) => s.elevator.level, 3) },
  { text: '開挖銅礦層', reward: 120, progress: unlock(1) },
  { text: '搬運隊升到 Lv.6（多一名搬運工）', reward: 250, progress: level((s) => s.cargo.level, 6) },
  { text: '銅礦層雇到 4 名礦工', reward: 600, progress: level((s) => s.layers[1].crew, 4) },
  { text: '開挖鈷礦層', reward: 2500, progress: unlock(2) },
  { text: '礦石品位升到 Lv.3', reward: 4000, progress: level((s) => s.oreValueLevel, 3) },
  { text: '鈷礦層雇到 6 名礦工', reward: 15000, progress: level((s) => s.layers[2].crew, 6) },
  { text: '開挖稀有晶礦層', reward: 60000, progress: unlock(3) },
  { text: '稀有晶礦層雇滿 8 名礦工', reward: 500000, progress: level((s) => s.layers[3].crew, 8) },
];

/** Pays out every objective that is now complete; returns the ones just finished. */
export function claimObjectives(s: GameState): Objective[] {
  const done: Objective[] = [];
  while (s.objective < OBJECTIVES.length) {
    const o = OBJECTIVES[s.objective];
    const p = o.progress(s);
    if (p.now < p.goal) break;
    s.credits += o.reward;
    s.objective += 1;
    done.push(o);
  }
  return done;
}
