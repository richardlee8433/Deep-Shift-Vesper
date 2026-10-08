# Deep Shift: Vesper

Set on Vesper (Helion designation: F8 Extraction Sector). Canvas + TypeScript, no runtime dependencies.
Two modes live side by side:

- **地底防線 (`dig.html`) — prototype of the new core loop.** Dig for ore on one persistent map, build
  walls / turrets / traps, and hold the base core against monsters that come up from the rifts at the
  bottom of the map. Pixel art drawn in code, Core Keeper-style 3/4 view.
- **放置經營 (`index.html`) — the original idle mining prototype**, kept unchanged with its own save.

## Run

```bash
npm install
npm run dev       # local dev server: /dig.html (dig mode), / (idle mode)
npm test          # headless checks for the dig simulation
npm run build     # typecheck + build; also writes dist/vesper-dig.html and dist/vesper.html (single self-contained files)
```

## 地底防線 (dig mode)

All numbers are starting values in `src/dig/config.ts`; nothing is balanced yet.

- **One persistent world** (30 × 48, `src/dig/map.ts`): base chamber at the top, solid rock everywhere
  else in three zones (each 30% harder than the one above), seeded ore veins, six relic sites, three
  rifts in the bottom row. Saved under `deep-shift-vesper/dig-v2`.
- **Controls:** `WASD` / arrows dig and walk; mouse click to move, hold rock to dig; `1` `2` `3` pick
  wall / turret / spike trap and click (or drag) or press `E` to place; right-click / `X` demolishes for
  half the cost back; `B` opens the base panel near the core (upgrades, repair, relic loadout);
  `Space` knock-back pulse; `R` recall to base; `Esc` pause.
- **Monsters** walk a cost field toward the base core: open tunnels are cheap, rock is slow to chew,
  walls and turrets cost more (`PATH_COST`). Every tile you dig is a cheaper road for them. Blocked,
  they chew rock or smash structures; near the miner they turn to fight.
- **Waves** start after 3 minutes and come every 2 minutes, with a 6 s quake warning that shows their
  routes. Size grows with the wave number and with 地心騷動 (threat): relic activations, detonator chains
  and the deepest row you have reached.
- **Losing is a setback, not an end:** if the core falls, monsters clear, 30% of ore is lost and the core
  is restored to half. A destroyed miner is rebuilt at the base after 5 s.
- **Relics** (six, one per site) go into a collection; up to three equipped, swapped at the base.
  The echo lens also keeps the monsters' routes on screen.

| File | What it holds |
|---|---|
| `src/dig/config.ts` | Every tuning number |
| `src/dig/map.ts` | World layout, tile kinds, ore veins |
| `src/dig/state.ts` | Game state, derived values, save |
| `src/dig/sim.ts` | Fixed-step simulation: miner, digging, building, monster cost field, waves, relic effects |
| `src/dig/pixel.ts` | Code-drawn pixel textures and sprites |
| `src/dig/render.ts` | 3/4 pixel renderer, lighting, effects, minimap |
| `src/dig/ui.ts`, `main.ts` | HUD, build bar, base / relic panels; input and loop |
| `tests/dig.test.ts` | Headless rule checks (routes, chewing, walls, turrets, waves, core fall, respawn, relics, save) |

## Idle mode

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
