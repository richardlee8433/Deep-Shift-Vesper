import { CONTRACTS, CROWD_DIVISOR, REPORT_PERIOD } from './config';
import { emptyLedger, type GameState, type Ledger, type Report } from './state';
import { haulerCount, oreValueMult } from './upgrades';

export function workerCount(s: GameState): number {
  let n = 1; // elevator operator
  s.layers.forEach((l) => { if (l.unlocked) n += l.crew; });
  return n + haulerCount(s.cargo.level);
}

export interface Rates {
  corp: number;
  oxygen: number;
  housing: number;
  equipment: number;
  transport: number;
}

export function currentRates(s: GameState): Rates {
  const c = CONTRACTS[s.contract];
  const crowd = 1 + workerCount(s) / CROWD_DIVISOR;
  return {
    corp: c.corp,
    oxygen: c.oxygen * crowd,
    housing: c.housing * crowd,
    equipment: c.equipment,
    transport: c.transport,
  };
}

export const totalDeduction = (r: Rates) => r.corp + r.oxygen + r.housing + r.equipment + r.transport;

// Rolling one-second buckets for the HUD rate readout (not saved).
const BUCKETS = 10;
const netBuckets: number[] = new Array(BUCKETS).fill(0);
const grossBuckets: number[] = new Array(BUCKETS).fill(0);
let bucketT = 0;
let bucketIdx = 0;

export function tickBuckets(dt: number): void {
  bucketT += dt;
  while (bucketT >= 1) {
    bucketT -= 1;
    bucketIdx = (bucketIdx + 1) % BUCKETS;
    netBuckets[bucketIdx] = 0;
    grossBuckets[bucketIdx] = 0;
  }
}

export function recentRate(): { net: number; gross: number } {
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  return { net: sum(netBuckets) / BUCKETS, gross: sum(grossBuckets) / BUCKETS };
}

function addLedger(into: Ledger, from: Ledger): void {
  (Object.keys(from) as (keyof Ledger)[]).forEach((k) => { into[k] += from[k]; });
}

/** Sell ore worth `value` (before ore-grade bonus) at the cargo port. */
export function sell(s: GameState, value: number): void {
  const gross = value * oreValueMult(s.oreValueLevel);
  const r = currentRates(s);
  const sale: Ledger = {
    gross,
    corp: gross * r.corp,
    oxygen: gross * r.oxygen,
    housing: gross * r.housing,
    equipment: gross * r.equipment,
    transport: gross * r.transport,
    net: 0,
    wages: 0,
    budget: 0,
  };
  sale.net = gross - sale.corp - sale.oxygen - sale.housing - sale.equipment - sale.transport;
  sale.wages = Math.min(sale.net, s.wagesOwed);
  s.wagesOwed -= sale.wages;
  sale.budget = sale.net - sale.wages;
  addLedger(s.lifetime, sale);
  addLedger(s.period, sale);
  s.credits += sale.budget;
  netBuckets[bucketIdx] += sale.budget;
  grossBuckets[bucketIdx] += gross;
}

/** Wages accrue over time at the contract rate and are paid out of sales. */
export function tickWages(s: GameState, dt: number): void {
  const perSec = workerCount(s) * CONTRACTS[s.contract].wage;
  s.wagesOwed = Math.min(s.wagesOwed + perSec * dt, perSec * REPORT_PERIOD);
}

export function tickReports(s: GameState, dt: number): void {
  s.period.t += dt;
  if (s.period.t < REPORT_PERIOD) return;
  const { t, ...ledger } = s.period;
  s.reportCount += 1;
  const report = { ...ledger, index: s.reportCount, duration: t, workers: workerCount(s) };
  // The very first period includes start-up time with no sales, so the baseline is period 2.
  if (!s.firstReport || s.firstReport.index === 1) s.firstReport = report;
  s.lastReport = report;
  s.period = { ...emptyLedger(), t: 0 };
}

/** Per-second figures from a report. */
export function perSecond(r: Report) {
  return {
    production: r.gross / r.duration,
    corporate: r.corp / r.duration,
    budget: r.budget / r.duration,
    perWorker: r.wages / r.duration / r.workers,
  };
}
