// Ties meta + run together: fixed-step ticking, pause reasons, settlement.

import { STEP } from './config';
import { step, type StepResult } from './sim';
import { newRun, settle, type MetaState, type RunState, type RunSummary } from './state';

export class Game {
  meta: MetaState;
  run: RunState | null = null;
  private acc = 0;
  private pauses = new Set<string>();

  constructor(meta: MetaState, run: RunState | null = null) {
    this.meta = meta;
    this.run = run;
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

  startRun(seed?: number): RunState {
    this.run = newRun(this.meta, seed);
    this.acc = 0;
    return this.run;
  }

  /** Advance by real time `dt`. Returns the end of the run if it ended this tick. */
  tick(dt: number): StepResult | null {
    if (!this.run || this.paused) return null;
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      const res = step(this.run, STEP);
      if (res) return res;
      if (this.run.prompt) {
        this.acc = 0;
        break;
      }
    }
    return null;
  }

  /** Pay out and clear the run. Idempotent through the run id. */
  finish(res: StepResult): RunSummary | null {
    if (!this.run) return null;
    const sum = settle(this.meta, this.run, res.result, res.cause);
    this.run = null;
    return sum;
  }
}
