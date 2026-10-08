// Pixel art drawn in code: 16 px tiles in a 3/4 top-down view (block top + front face),
// sprites authored as character grids. Everything is rendered once into small canvases.

import { rng } from './map';

export const TP = 16; // tile size in art pixels
export const WH = 6; // height of a block's front face

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number, draw: (c: Ctx) => void): HTMLCanvasElement {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  draw(el.getContext('2d')!);
  return el;
}

const dot = (c: Ctx, x: number, y: number, col: string) => {
  c.fillStyle = col;
  c.fillRect(x, y, 1, 1);
};

/** Turn a character grid into a canvas ('.' = transparent). */
function sprite(rows: string[], pal: Record<string, string>): HTMLCanvasElement {
  const w = Math.max(...rows.map((r) => r.length));
  return canvas(w, rows.length, (c) => {
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.' && pal[ch]) dot(c, x, y, pal[ch]); }));
  });
}

function flip(src: HTMLCanvasElement): HTMLCanvasElement {
  return canvas(src.width, src.height, (c) => {
    c.translate(src.width, 0);
    c.scale(-1, 1);
    c.drawImage(src, 0, 0);
  });
}

// ---- Palettes ---------------------------------------------------------------

export const ZONE_PAL = [
  { top: '#3e3027', hi: '#4f3e32', lo: '#2e231c', rim: '#a07c5a', front: '#2a1f18', frontLo: '#1d150f', floor: '#6e5541', floorHi: '#81664f', floorLo: '#5c4636' },
  { top: '#2e3440', hi: '#3b4351', lo: '#232832', rim: '#8794a8', front: '#1f242c', frontLo: '#151920', floor: '#565c66', floorHi: '#666d78', floorLo: '#484d56' },
  { top: '#30243f', hi: '#3e2f51', lo: '#251b31', rim: '#9a82bb', front: '#20182b', frontLo: '#16101e', floor: '#4f425f', floorHi: '#5e4f70', floorLo: '#41364f' },
];
export const GEM = [
  { c: '#f6c445', hi: '#fff1a8', lo: '#a8701c' },
  { c: '#4fd8c0', hi: '#c8fff4', lo: '#1f7f72' },
  { c: '#ff7d3b', hi: '#ffd2a0', lo: '#a8401a' },
];
export const INK = '#120d16';

// ---- Tile textures ------------------------------------------------------------

export interface Tex {
  rockTop: HTMLCanvasElement[][]; // [zone][variant]
  rockFront: HTMLCanvasElement[][];
  floor: HTMLCanvasElement[][];
  oreTop: HTMLCanvasElement[][]; // [value-1][variant]
  oreFront: HTMLCanvasElement[];
  wallTop: HTMLCanvasElement;
  wallFront: HTMLCanvasElement;
  metalTop: HTMLCanvasElement;
  metalFront: HTMLCanvasElement;
  relicTop: HTMLCanvasElement;
  relicDim: HTMLCanvasElement;
  relicFront: HTMLCanvasElement;
  trap: HTMLCanvasElement;
  plate: HTMLCanvasElement; // base chamber floor
  miner: Record<'down' | 'up' | 'right' | 'left', HTMLCanvasElement[]>;
  crawler: { right: HTMLCanvasElement[]; left: HTMLCanvasElement[] };
  armored: { right: HTMLCanvasElement[]; left: HTMLCanvasElement[] };
}

let tex: Tex | null = null;

export function textures(): Tex {
  if (tex) return tex;
  const r = rng(4242);
  const VAR = 4;

  const rockTop = ZONE_PAL.map((p) => Array.from({ length: VAR }, () => canvas(TP, TP, (c) => {
    c.fillStyle = p.top;
    c.fillRect(0, 0, TP, TP);
    for (let k = 0; k < 22; k++) dot(c, Math.floor(r() * TP), Math.floor(r() * TP), p.hi);
    for (let k = 0; k < 26; k++) dot(c, Math.floor(r() * TP), Math.floor(r() * TP), p.lo);
    for (let k = 0; k < 2; k++) {
      // a short crack
      let x = 2 + Math.floor(r() * 12), y = 2 + Math.floor(r() * 12);
      for (let s = 0; s < 4; s++) {
        dot(c, x, y, p.lo);
        x += r() < 0.5 ? 1 : 0;
        y += r() < 0.5 ? 1 : -1;
      }
    }
  })));
  const rockFront = ZONE_PAL.map((p) => Array.from({ length: VAR }, () => canvas(TP, WH, (c) => {
    c.fillStyle = p.front;
    c.fillRect(0, 0, TP, WH);
    c.fillStyle = p.frontLo;
    c.fillRect(0, WH - 1, TP, 1);
    for (let y = 2; y < WH - 1; y += 2) for (let x = 0; x < TP; x++) if (r() < 0.35) dot(c, x, y, p.frontLo);
    for (let k = 0; k < 4; k++) dot(c, Math.floor(r() * TP), 1 + Math.floor(r() * (WH - 2)), p.lo);
  })));
  const floor = ZONE_PAL.map((p) => Array.from({ length: VAR }, () => canvas(TP, TP, (c) => {
    c.fillStyle = p.floor;
    c.fillRect(0, 0, TP, TP);
    for (let k = 0; k < 14; k++) dot(c, Math.floor(r() * TP), Math.floor(r() * TP), p.floorLo);
    for (let k = 0; k < 4; k++) {
      const x = Math.floor(r() * (TP - 2)), y = Math.floor(r() * TP);
      c.fillStyle = p.floorHi;
      c.fillRect(x, y, 2, 1);
    }
  })));
  const gemAt = (c: Ctx, x: number, y: number, g: (typeof GEM)[number], big: boolean) => {
    c.fillStyle = INK;
    c.fillRect(x - 1, y - 1, big ? 5 : 4, big ? 5 : 4);
    c.fillStyle = g.lo;
    c.fillRect(x, y, big ? 3 : 2, big ? 3 : 2);
    c.fillStyle = g.c;
    c.fillRect(x, y, big ? 2 : 2, big ? 2 : 1);
    dot(c, x, y, g.hi);
  };
  const oreTop = GEM.map((g, gi) => Array.from({ length: VAR }, () => canvas(TP, TP, (c) => {
    const n = 3 + gi;
    for (let k = 0; k < n; k++) gemAt(c, 2 + Math.floor(r() * 11), 2 + Math.floor(r() * 11), g, gi > 0 && k === 0);
  })));
  const oreFront = GEM.map((g) => canvas(TP, WH, (c) => {
    for (let k = 0; k < 3; k++) {
      const x = 1 + Math.floor(r() * 13), y = 1 + Math.floor(r() * (WH - 3));
      c.fillStyle = g.c;
      c.fillRect(x, y, 2, 1);
      dot(c, x, y, g.hi);
    }
  }));

  const wallTop = canvas(TP, TP, (c) => {
    c.fillStyle = '#6f7f7c';
    c.fillRect(0, 0, TP, TP);
    c.fillStyle = '#4c5a58';
    for (let y = 0; y < TP; y += 4) c.fillRect(0, y, TP, 1);
    for (let y = 0; y < TP; y += 4) for (let x = (y / 4) % 2 ? 0 : 4; x < TP; x += 8) c.fillRect(x, y, 1, 4);
    c.fillStyle = '#8fa29e';
    for (let y = 1; y < TP; y += 4) c.fillRect(0, y, TP, 1);
    c.fillStyle = INK;
    c.strokeStyle = INK;
    c.strokeRect(0.5, 0.5, TP - 1, TP - 1);
  });
  const wallFront = canvas(TP, WH, (c) => {
    c.fillStyle = '#46524f';
    c.fillRect(0, 0, TP, WH);
    c.fillStyle = '#323b39';
    c.fillRect(0, 3, TP, 1);
    for (let x = 3; x < TP; x += 8) c.fillRect(x, 0, 1, 3);
    for (let x = 7; x < TP; x += 8) c.fillRect(x, 3, 1, 3);
    c.fillStyle = INK;
    c.fillRect(0, WH - 1, TP, 1);
  });
  const metalTop = canvas(TP, TP, (c) => {
    c.fillStyle = '#5e6873';
    c.fillRect(0, 0, TP, TP);
    c.fillStyle = '#7d8894';
    c.fillRect(1, 1, TP - 2, 1);
    c.fillRect(1, 1, 1, TP - 2);
    c.fillStyle = '#3f474f';
    c.fillRect(1, TP - 2, TP - 2, 1);
    c.fillRect(TP - 2, 1, 1, TP - 2);
    for (const [x, y] of [[3, 3], [12, 3], [3, 12], [12, 12]]) dot(c, x, y, '#a9b4bf');
    c.strokeStyle = INK;
    c.strokeRect(0.5, 0.5, TP - 1, TP - 1);
  });
  const metalFront = canvas(TP, WH, (c) => {
    c.fillStyle = '#3c444c';
    c.fillRect(0, 0, TP, WH);
    c.fillStyle = '#f2b33d';
    for (let x = 0; x < TP; x += 4) c.fillRect(x, 2, 2, 2);
    c.fillStyle = INK;
    c.fillRect(0, WH - 1, TP, 1);
  });
  const relicTopOf = (col: string, glow: string) => canvas(TP, TP, (c) => {
    c.fillStyle = '#3b4a57';
    c.fillRect(0, 0, TP, TP);
    c.strokeStyle = col;
    for (const f of [1, 4, 7]) c.strokeRect(f + 0.5, f + 0.5, TP - 2 * f - 1, TP - 2 * f - 1);
    c.fillStyle = glow;
    c.fillRect(7, 7, 2, 2);
    c.strokeStyle = INK;
    c.strokeRect(0.5, 0.5, TP - 1, TP - 1);
  });
  const relicTop = relicTopOf('#9fe0ef', '#eafcff');
  const relicDim = relicTopOf('#4f6c78', '#6f8c96');
  const relicFront = canvas(TP, WH, (c) => {
    c.fillStyle = '#2b3640';
    c.fillRect(0, 0, TP, WH);
    c.fillStyle = '#5ea8bc';
    for (let x = 2; x < TP; x += 4) c.fillRect(x, 2, 2, 1);
    c.fillStyle = INK;
    c.fillRect(0, WH - 1, TP, 1);
  });
  const trap = canvas(TP, TP, (c) => {
    for (const [x, y] of [[3, 4], [10, 3], [5, 11], [11, 10]]) {
      c.fillStyle = INK;
      c.fillRect(x - 1, y + 1, 4, 2);
      c.fillStyle = '#9aa3ad';
      c.fillRect(x, y, 2, 2);
      c.fillRect(x, y - 1, 1, 1);
      dot(c, x, y - 2, '#e8eef4');
    }
  });
  const plate = canvas(TP, TP, (c) => {
    c.fillStyle = '#2c3138';
    c.fillRect(0, 0, TP, TP);
    c.fillStyle = '#353b44';
    c.fillRect(1, 1, TP - 2, TP - 2);
    c.fillStyle = '#23272d';
    c.fillRect(0, TP / 2, TP, 1);
    c.fillRect(TP / 2, 0, 1, TP);
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) dot(c, x, y, '#4b525c');
  });

  // ---- Characters ----
  const minerPal = {
    k: INK, y: '#f2b33d', Y: '#b97a1f', L: '#fff4c2', s: '#f1c09a', S: '#c98d6b', e: INK,
    o: '#d9663a', O: '#9c4528', g: '#5b5f6b', b: '#3a2c2a',
  };
  const head = ['...kkkkkk...', '..kyyLLyyk..', '..kyyyyyyk..', '.kYYYYYYYYk.'];
  const down = [
    ...head,
    '..ksssssSk..', '..ksesseSk..', '..kssssSSk..', '...kkSSkk...',
    '..kooooook..', '.kooOooOook.', '.ksoooooosk.', '..kggggggk..', '..kooOOook..', '..kOOkkOOk..',
  ];
  const up = [
    '...kkkkkk...', '..kyyyyyyk..', '..kyyyyyyk..', '.kYYYYYYYYk.',
    '..kYYYYYYk..', '..ksSSSSsk..', '..kSSSSSSk..', '...kkSSkk...',
    '..kggggggk..', '.koggggggok.', '.ksggggggsk.', '..kggggggk..', '..kooOOook..', '..kOOkkOOk..',
  ];
  const side = [
    '...kkkkk....', '..kyyyyyk...', '..kyyyyyLk..', '.kYYYYYYYYk.',
    '...kSssssk..', '...kSssesk..', '...kSSsssk..', '....kkSSk...',
    '...kooook...', '..koOooook..', '..kOoooosk..', '...kggggk...', '...kOOOOk...', '...kOkkOk...',
  ];
  const legsA = ['..kbbk.kbbk.', '..kkk..kkk..'];
  const legsB = ['..kbbk..kbk.', '..kkk...kk..'];
  const sideA = ['...kbk.kbk..', '...kkk.kkk..'];
  const sideB = ['..kbk...kbk.', '..kkk...kkk.'];
  const right = [sprite([...side, ...sideA], minerPal), sprite([...side, ...sideB], minerPal)];
  const miner = {
    down: [sprite([...down, ...legsA], minerPal), sprite([...down, ...legsB], minerPal)],
    up: [sprite([...up, ...legsA], minerPal), sprite([...up, ...legsB], minerPal)],
    right,
    left: right.map(flip),
  };

  const bugPal = { k: '#1e0f26', p: '#9b5bd0', P: '#6a3896', h: '#d6a8ff', r: '#ff5a6e' };
  const crawlerBody = ['....kkkk....', '..kkpphpkk..', '.kpppphhppk.', '.kPpppppprk.', '.kPPpppppPk.', '..kPPPPPPk..'];
  const crawlerR = [
    sprite([...crawlerBody, '.k.k.k.k.k..', 'k.k.k.k.k...'], bugPal),
    sprite([...crawlerBody, '..k.k.k.k.k.', '.k.k.k.k.k..'], bugPal),
  ];
  const armorPal = { ...bugPal, a: '#8c8fa3', A: '#5a5c6e', H: '#c9ccd9' };
  const armorBody = ['....kkkkkk....', '..kkaaHHaakk..', '.kaaaHHaaaaak.', 'kAaaaaaaaaaark', 'kAAaAaaAaaAaPk', '.kAAAAAAAAAAk.', '..kPPPPPPPPk..'];
  const armoredR = [
    sprite([...armorBody, '.k.k.k..k.k.k.', 'k.k.k....k.k.k'], armorPal),
    sprite([...armorBody, '..k.k.kk.k.k..', '.k.k.k..k.k.k.'], armorPal),
  ];

  tex = {
    rockTop, rockFront, floor, oreTop, oreFront, wallTop, wallFront, metalTop, metalFront, relicTop, relicDim, relicFront,
    trap, plate, miner,
    crawler: { right: crawlerR, left: crawlerR.map(flip) },
    armored: { right: armoredR, left: armoredR.map(flip) },
  };
  return tex;
}

/** Plot a 1 px line on integer pixels (keeps tools crisp when rotated). */
export function pixelLine(c: Ctx, x0: number, y0: number, x1: number, y1: number, col: string): void {
  c.fillStyle = col;
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) c.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1);
}
