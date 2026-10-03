// World layout (logical units; the canvas scales WORLD_W to the stage width).
export const WORLD_W = 480;
export const GROUND_Y = 230;
export const MINE_TOP = GROUND_Y + 24;
export const LAYER_H = 128;

export const SHAFT_X = 22;
export const SHAFT_W = 54;
export const STASH_X = 92;
export const DEPOSIT_X = 158;
export const FACE_X = 404;

export const STORE_X = 112;
export const PORT_X = 420;

// Agent tuning.
export const MINER_WALK = 74;
export const MINE_TIME = 2.2;
export const BASE_DRILL_RATE = 3; // ore units per second while mining
export const ELEVATOR_LOAD_TIME = 0.5;
export const HAULER_LOAD_TIME = 0.5;
export const MAX_CREW = 8;
export const MAX_HAULERS = 5;

// Transport (elevator + haulers). Capacity is in ₵ of ore per trip.
export const ELEVATOR_BASE_CAP = 40;
export const CARGO_BASE_CAP = 40;
export const TRANSPORT_CAP_GROWTH = 1.14;
export const TRANSPORT_COST_BASE = 80;
export const TRANSPORT_COST_GROWTH = 1.15;

// Tapping a section rushes it: everything there runs RUSH_MULT× faster while time remains.
export const RUSH_PER_TAP = 1; // seconds added per tap
export const RUSH_MAX = 10;
export const RUSH_MULT = 2;

export const REPORT_PERIOD = 30; // seconds of play per financial report
export const OFFLINE_CAP = 4 * 3600;

export interface LayerDef {
  id: string;
  name: string;
  ore: string;
  value: number; // credits per ore unit
  unlockCost: number;
  costScale: number;
  rock: string;
  tunnel: string;
  vein: string;
  restricted?: string; // cannot be unlocked in this build
}

export const LAYERS: LayerDef[] = [
  { id: 'iron', name: '鐵礦層', ore: '鐵', value: 1, unlockCost: 0, costScale: 1, rock: '#3b2e27', tunnel: '#241b17', vein: '#a3abb5' },
  { id: 'copper', name: '銅礦層', ore: '銅', value: 5, unlockCost: 400, costScale: 6, rock: '#3a2922', tunnel: '#221813', vein: '#d9894a' },
  { id: 'cobalt', name: '鈷礦層', ore: '鈷', value: 25, unlockCost: 8000, costScale: 35, rock: '#2b2530', tunnel: '#19151d', vein: '#5a86e0' },
  { id: 'crystal', name: '稀有晶礦層', ore: '晶', value: 125, unlockCost: 150000, costScale: 190, rock: '#232029', tunnel: '#141218', vein: '#8fe6ff' },
  { id: 'unknown', name: '???', ore: '?', value: 625, unlockCost: 0, costScale: 1000, rock: '#17151a', tunnel: '#0d0c0f', vein: '#55505c', restricted: '需要赫利昂授權' },
];

// Helion contract stages. Fee rates are fractions of gross revenue;
// oxygen and housing also grow with the size of the workforce.
// Wages come out of what is left; the remainder is the sector's operating budget.
export interface Contract {
  id: string;
  wage: number; // credits per worker per second, fixed by contract
  corp: number;
  oxygen: number;
  housing: number;
  equipment: number;
  transport: number;
}

export const CONTRACTS: Contract[] = [
  { id: 'F8-01', wage: 0.03, corp: 0.1, oxygen: 0, housing: 0, equipment: 0, transport: 0 },
  { id: 'F8-12', wage: 0.0315, corp: 0.2, oxygen: 0, housing: 0, equipment: 0, transport: 0 },
  { id: 'F8-14', wage: 0.033, corp: 0.2, oxygen: 0.04, housing: 0.05, equipment: 0, transport: 0 },
  { id: 'F8-19', wage: 0.0345, corp: 0.2, oxygen: 0.05, housing: 0.064, equipment: 0.039, transport: 0.02 },
];

export const CROWD_DIVISOR = 40; // per-worker fees double at 40 workers
