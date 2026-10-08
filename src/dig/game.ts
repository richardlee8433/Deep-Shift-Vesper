// Fixed-step ticking with named pause reasons (menu, panel, hidden tab…).

import { STEP } from './config';
import { step } from './sim';
import type { GameState } from './state';

export class Game {
  state: GameState;
  private acc = 0;
  private pauses = new Set<string>();

  constructor(state: GameState) {
    this.state = state;
  }

  get paused(): boolean {
    return this.pauses.size > 0;
  }

  pause(reason: string): void {
    this.pauses.add(reason);
  }

  resume(reason: string): void {
    this.pauses.delete(reason);
  }

  isPausedBy(reason: string): boolean {
    return this.pauses.has(reason);
  }

  /** Advance by real time `dt`; stops early when a panel prompt appears. */
  tick(dt: number): void {
    if (this.paused) return;
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      step(this.state, STEP);
      if (this.state.prompt) {
        this.acc = 0;
        break;
      }
    }
  }
}
