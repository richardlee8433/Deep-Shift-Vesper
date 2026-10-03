# Deep Shift: Vesper

A story-driven idle mining game set on Vesper (Helion designation: F8 Extraction Sector).
2D side view, Canvas + TypeScript, no runtime dependencies.

## Run

```bash
npm install
npm run dev       # local dev server
npm run build     # typecheck + build; also writes dist/vesper.html (single self-contained file)
```

## Art

Raw art lives in `art/source/`. `python3 scripts/process_art.py` (Pillow, numpy, scipy) slices the sprite sheets, aligns frames on helmet and boots, scales them, and writes game-ready files plus `sprites.json` to `src/assets/`. Layers without their own tunnel art get recoloured placeholders of the iron tunnel. Anything missing falls back to the procedural drawing. See `docs/ART_DIRECTION.md` for the asset list.

## Layout

| File | What it holds |
|---|---|
| `src/config.ts` | World layout, ore layers, Helion contract stages (fees, wages) |
| `src/upgrades.ts` | Upgrade formulas and costs — main balance knobs |
| `src/sim.ts` | Miners, elevator, haulers (visible agents drive production) |
| `src/economy.ts` | Sales → Helion share → fees → wages → operating budget; reports |
| `src/data/events.ts` | Story events and dialogue (**placeholder text**) |
| `src/data/objectives.ts` | Onboarding objectives with Helion bonus payouts |
| `src/render/` | Canvas scene: `draw` (palette, primitives), `people` (workers, carts), `terrain` / `surface` (cached scenery), `fx`, `index` (frame + hit regions) |
| `src/ui.ts` | HUD, upgrade sheets, report / stats, dialog |

## Prototype scope (v0.1)

- Core loop: mine → sell → hire → upgrade → dig deeper (4 layers + a restricted 5th)
- Contract revisions add Helion's share and fees over time; reports itemise every deduction
- Stats compare production, corporate revenue and (once unlocked) per-worker income
- Tap a tunnel, the shaft or the road to rush that section (×2 speed, +1 s per tap, up to 10 s); tap a badge to upgrade
- Offline progress (up to 4 h), autosave to localStorage, test speed ×1/×5/×20 in 設定

Not yet: quotas, worker fatigue, welfare upgrade tree, hidden escape-project tree, ending.
