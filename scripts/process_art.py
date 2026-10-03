#!/usr/bin/env python3
"""Turn the raw art in art/source/ into game-ready assets in src/assets/.

- Sprite sheets (six poses in a row): frames are found by their transparent gaps,
  aligned on the helmet (horizontal) and the boot soles (vertical), scaled down and
  packed into an evenly spaced strip. Frame metadata goes to src/assets/sprites.json.
- The tunnel background is scaled to the tunnel's band and recoloured into
  placeholder variants for the layers that have no art yet.

Usage: python3 scripts/process_art.py   (needs Pillow, numpy, scipy)
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'art' / 'source'
OUT = ROOT / 'src' / 'assets'

CHAR_H = 200  # output height of a character, helmet top to boot sole, in px
ALPHA_MIN = 24


def split_frames(a: np.ndarray, expect: int) -> list[np.ndarray]:
    """Per-frame RGBA arrays. Characters are found as large solid components;
    faint pixels (glow, sparks) go to whichever character is nearest."""
    alpha = a[:, :, 3]
    lab, n = ndimage.label(alpha > 120)
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    big = [i + 1 for i, sz in enumerate(sizes) if sz > 20000]
    if len(big) != expect:
        raise SystemExit(f'found {len(big)} characters, expected {expect}')
    owner = np.zeros_like(lab)
    for k, comp in enumerate(big, start=1):
        owner[lab == comp] = k
    # Nearest character for every remaining pixel
    _, (iy, ix) = ndimage.distance_transform_edt(owner == 0, return_indices=True)
    owner = owner[iy, ix]
    order = sorted(range(1, expect + 1), key=lambda k: np.where(owner == k)[1].mean())
    frames = []
    for k in order:
        f = a.copy()
        f[owner != k] = 0
        frames.append(f)
    return frames


def slice_sheet(name: str, expect: int = 6) -> dict:
    a = np.array(Image.open(SRC / f'{name}.webp').convert('RGBA'))
    layers = split_frames(a, expect)

    frames = []
    for f in layers:
        sub = f[:, :, 3] > ALPHA_MIN
        rows = np.where(sub.any(axis=1))[0]
        cols = np.where(sub.any(axis=0))[0]
        y0, y1 = int(rows[0]), int(rows[-1])
        x0, x1 = int(cols[0]), int(cols[-1]) + 1
        # Helmet band: the top 30% of the figure is the most stable part between poses.
        band = sub[y0:y0 + int((y1 - y0) * 0.3)]
        cx = float(np.mean(np.where(band)[1]))
        frames.append({'img': Image.fromarray(f, 'RGBA'), 'x0': x0, 'x1': x1, 'y0': y0, 'y1': y1, 'cx': cx})

    # Boot soles: the lowest solid row, shared by every frame so feet stay on the floor
    height = max(f['y1'] - f['y0'] for f in frames)
    scale = CHAR_H / height
    left = max(f['cx'] - f['x0'] for f in frames)
    right = max(f['x1'] - f['cx'] for f in frames)
    up = max(f['y1'] - f['y0'] for f in frames)
    pad = 6
    fw = int(np.ceil((left + right) * scale)) + pad * 2
    fh = int(np.ceil(up * scale)) + pad * 2
    ax = int(round(left * scale)) + pad  # anchor: helmet centre / boot sole
    ay = fh - pad

    sheet = Image.new('RGBA', (fw * len(frames), fh), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        crop = f['img'].crop((f['x0'], f['y0'], f['x1'], f['y1'] + 1))
        w = max(1, round(crop.width * scale))
        h = max(1, round(crop.height * scale))
        crop = crop.resize((w, h), Image.LANCZOS)
        px = i * fw + ax - round((f['cx'] - f['x0']) * scale)
        sheet.alpha_composite(crop, (px, ay - h))
    sheet.save(OUT / f'{name}.webp', 'WEBP', quality=90, method=6)
    return {'frames': len(frames), 'frameW': fw, 'frameH': fh, 'anchorX': ax, 'anchorY': ay, 'charH': CHAR_H}


def trim_image(name: str, width: int) -> dict:
    im = Image.open(SRC / f'{name}.webp').convert('RGBA')
    box = im.getchannel('A').point(lambda v: 255 if v > ALPHA_MIN else 0).getbbox()
    im = im.crop(box)
    h = round(im.height * width / im.width)
    im = im.resize((width, h), Image.LANCZOS)
    im.save(OUT / f'{name}.webp', 'WEBP', quality=90, method=6)
    return {'w': width, 'h': h}


# Placeholder recolours for layers without their own tunnel art.
# rock: (target hue, saturation scale, value scale) for the warm rock tones only;
# ore: hue the grey ore face on the right is tinted to.
VARIANTS = {
    'tunnel-copper': {'rock': (0.99, 0.4, 0.8), 'ore': 0.07},
    'tunnel-cobalt': {'rock': (0.60, 0.45, 0.72), 'ore': 0.60},
    'tunnel-crystal': {'rock': (0.62, 0.22, 0.55), 'ore': 0.50},
}

TUNNEL_W, TUNNEL_H = 1616, 512  # 404 x 128 world units at 4 px per unit


def recolour(hsv: np.ndarray, rock: tuple[float, float, float], ore_hue: float) -> np.ndarray:
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    # Warm rock: red/orange hues; lamps (very bright) and cyan accents are left alone.
    warm = ((h < 0.13) | (h > 0.96)) & (s > 0.2)
    keep_bright = np.clip((0.95 - v) / 0.12, 0, 1)
    w = warm * keep_bright
    out = hsv.copy()
    out[:, :, 0] = np.where(w > 0, rock[0], h)
    out[:, :, 1] = s * (1 - w) + s * rock[1] * w
    out[:, :, 2] = v * (1 - w) + v * rock[2] * w
    # Ore face: grey crystals on the right become the layer's ore colour.
    H, W = h.shape
    yy, xx = np.mgrid[0:H, 0:W]
    ore = (xx > W * 0.83) & (yy > H * 0.25) & (s < 0.28) & (v > 0.4)
    out[:, :, 0] = np.where(ore, ore_hue, out[:, :, 0])
    out[:, :, 1] = np.where(ore, 0.55 + s * 0.5, out[:, :, 1])
    return out


def tunnel_backgrounds() -> dict:
    im = Image.open(SRC / 'tunnel-iron.webp').convert('RGB')
    h = round(im.height * TUNNEL_W / im.width)
    im = im.resize((TUNNEL_W, h), Image.LANCZOS)
    top = h - TUNNEL_H  # keep the floor, trim the ceiling
    im = im.crop((0, top, TUNNEL_W, top + TUNNEL_H))
    im.save(OUT / 'tunnel-iron.webp', 'WEBP', quality=86, method=6)

    hsv = np.array(im.convert('HSV')).astype(np.float32) / 255.0
    for name, spec in VARIANTS.items():
        v = recolour(hsv, spec['rock'], spec['ore'])
        img = Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8), 'HSV').convert('RGB')
        img.save(OUT / f'{name}.webp', 'WEBP', quality=86, method=6)
    return {'w': TUNNEL_W, 'h': TUNNEL_H, 'cropTop': top}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {}
    for sheet in ('miner-drill', 'miner-carry', 'miner-walk'):
        if (SRC / f'{sheet}.webp').exists():
            meta[sheet] = slice_sheet(sheet)
    meta['ore-pod'] = trim_image('ore-pod', 400)
    meta['tunnel'] = tunnel_backgrounds()
    (OUT / 'sprites.json').write_text(json.dumps(meta, indent=2) + '\n')
    for k, v in meta.items():
        print(k, v)


if __name__ == '__main__':
    main()
