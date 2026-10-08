# Deep Shift: Vesper

Set on Vesper (Helion designation: F8 Extraction Sector). Canvas + TypeScript, no runtime dependencies.
Two modes live side by side:

- **遺跡挖掘 (`dig.html`) — v0.1 prototype of the new core loop.** Top-down grid digging: dig toward
  ancient relics that change how you dig or fight, but activating them wakes the nests around you.
- **放置經營 (`index.html`) — the original idle mining prototype**, kept unchanged with its own save.

## Run

```bash
npm install
npm run dev       # local dev server: /dig.html (dig mode), / (idle mode)
npm test          # headless checks for the dig simulation
npm run build     # typecheck + build; also writes dist/vesper-dig.html and dist/vesper.html (single self-contained files)
```

## Dig mode (v0.1)

Built from the core gameplay plan (遺跡挖掘試玩版核心規劃 v0.1). All numbers are starting values in
`src/dig/config.ts`; nothing is balanced yet.

- **Controls:** `W` `A` `S` `D` (or arrow keys) dig in that direction and step into the tile once it is
  open — hold to keep tunnelling; tapping toward a relic opens its panel. Mouse: click an open tile to move; hold a reachable rock to dig (drag to the next adjacent rock;
  a quick tap digs that one tile); hover for hardness / ore / danger / activation cost; click a relic to
  walk up and open its panel (simulation pauses); `Space` knock-back pulse (12 s); `R` 5 s evacuation
  (cancellable, damage does not interrupt, hitting 0 shield fails first); `Esc` pause.
- **Map:** one fixed 24 × 36 map (`src/dig/map.ts`, ASCII template), solid rock everywhere except the
  entrance (no bedrock, no open caves). One hardness per zone: shallow is softest (~0.5 s a tile) and each
  deeper zone is 30% harder than the one above (`LAYER_STEP`). 4 relic sites, 2 nests, 1 core.
- **Relics (3 slots, no duplicates):** 共鳴鑽頭, 礦脈引爆器, 回聲透鏡, 碎岩電容, 排斥場, 生質轉換器.
  The first shallow site is always the resonance drill until its blueprint is saved (it is backed up
  immediately); other sites draw relics you have not unlocked first.
- **Threat 0–100:** only relic activations (+15 tutorial / +20), detonator chains (+3), taking the core
  (+25) and destroying an awakened nest (−15) change it. It sets the spawn interval (25 / 18 / 12 s,
  armoured every third spawn at ≥ 70). Awakened nests only spawn once connected to your tunnels, after a
  3 s path warning; max 6 enemies.
- **Between runs:** ore buys drill (3 levels) and shield (2 levels) upgrades; saved blueprints can be taken
  as the starting relic. Failure keeps half the ore (rounded down) and loses this run's new blueprints.
- **Playtest log:** base screen → 試玩紀錄 shows time to first relic, dig / move / idle split, loadout,
  replacements, ore and depth per run, and copies the raw JSON.
- Save key `deep-shift-vesper/dig-v1` (meta + in-progress run in one entry; settlement is idempotent by run id).

| File | What it holds |
|---|---|
| `src/dig/config.ts` | Every tuning number |
| `src/dig/map.ts` | Map template, tile kinds, world builder |
| `src/dig/relics.ts` | Relic names, effect text, icons |
| `src/dig/state.ts` | RunState / MetaState, relic draw, settlement, save |
| `src/dig/sim.ts` | Fixed-step simulation, commands, events and relic effects, BFS flow field |
| `src/dig/game.ts` | Pause reasons, fixed-step ticking, finishing a run |
| `src/dig/render.ts` | Canvas drawing (shapes only) and effects |
| `src/dig/ui.ts`, `main.ts` | HUD, panels, base / result screens; input and loop |
| `tests/dig.test.ts` | Route to the core exists, enemies stay out of rock, relic swap cancels effects, chains terminate, pause freezes cooldowns, settlement pays once, failure keeps old blueprints |

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
