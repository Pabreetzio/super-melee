# Super Melee — TODO

Faithful browser recreation of Star Control 2's Super Melee mode with online multiplayer.

---

## Done

### Core Engine
- [x] Physics: gravity, thrust, velocity, world wrap (integer UQM-accurate)
- [x] Collision detection: ship–ship, ship–projectile
- [x] Deterministic lockstep at 24 FPS
- [x] Netplay relay via Socket.io (input sync, checksum verification, desync detection)
- [x] Local 2P mode (same keyboard)
- [x] AI solo mode (basic human_intelligence behavior)

### Ships
- [x] Earthling Cruiser — fully playable
  - Thrust (inertial, UQM-accurate), turning, energy regen
  - Nuclear missile: correct spawn offset, ±1-facing-per-cycle tracking (`trackFacing` helper exported)
  - Point-defense laser: fires at missiles and enemy ship, PaidFor lazy-energy pattern, 1 damage to ships, free to activate when nothing in range

### UI / Rendering
- [x] Fleet builder (pick ships for your fleet)
- [x] HUD (crew bars, energy bars)
- [x] Camera: tracks wrap-aware midpoint between ships
- [x] Arena: correct size — 20480×15360 world units (`640×480 × 32`), faithful to UQM `SPACE_WIDTH * 32`
- [x] Zoom: 4 discrete levels (1×/2×/4×/8×) driven by ship separation, with 192-unit hysteresis band
- [x] Starfield: UQM star tile PNGs (`stars-000/001/002.png`) rendered as 3 parallax layers
- [x] Planet: procedural circle at world center (sprites exist — see below)

### Assets
- [x] Extracted Earthling Cruiser sprites: `cruiser-{big,med,sml}` and `saturn-{big,med,sml}` — 16 rotation frames each, all three zoom sizes
- [x] Extracted all 24 other ships' 16-frame big rotation sprites into `assets/ships/`
- [x] Ship sprite path bug fixed (`sprites.ts` was constructing wrong filenames — `human-big-000` instead of `cruiser-big-000`)
- [x] Battle starfield tiles (`assets/battle/stars-000/001/002.png`)
- [x] Planet sprites available in content package: `base/planets/{type}-{big|med|sml}-000.png`, 60+ types

---

## Known Issues (fix next session)

### Rendering Bugs
- [x] **Ship sprites don't scale with zoom** — Fixed: UQM uses pre-rendered `big`/`med`/`sml`
  sprite variants per zoom level, not mathematical downscaling. `drawSprite` draws at native
  size; Battle.tsx selects the correct set: `big` at r=0, `med` at r=1, `sml` at r=2–3.
  All three cruiser and saturn variants extracted with baked hotspots from `.ani` files.

- [ ] **Starfield parallax needs verification** — The 3-layer star PNG tile approach uses
  `CanvasPattern.setTransform` with a `DOMMatrix` offset. Needs testing to confirm tiles are
  visible and parallax scrolls as you fly. If `setTransform` is unreliable, fall back to manual
  tile blitting. The background must read as black with moving star dots — the primary navigation
  cue in the original game.

### Planet
- [ ] **Planet appearance** — Replace the procedural purple circle with a real UQM planet sprite.
  - Sprites are in `base/planets/{type}-{big|med|sml}-000.png` inside `uqm-0.8.0-content.uqm`
  - 3 size variants (`big`/`med`/`sml`) map to the 3 lower zoom levels (reduction 0/1/2); at
    reduction 3 (8× zoom, full arena view) the planet is tiny enough that any frame works
  - The specific planet type used in Super Melee battles needs to be confirmed from UQM source
    (check `load_gravity_well()` in `src/uqm/cons_res.c` and battle init). A good default is
    `oolite` (rocky brown) or `water` (blue) — both look clearly like planets at battle scale
  - Extract the chosen type's frames to `assets/battle/planet-big-000.png` etc., then swap the
    `ctx.arc` placeholder for a `drawImage` call that picks the frame by reduction level

- [ ] **Planet collision** — Ships currently pass through the planet. UQM behavior (from `ship.c`):
  - Planet has `mass_points = 200` → treated as `GRAVITY_MASS` (immovable, `DEFY_PHYSICS`)
  - On collision: `damage = ship.hit_points >> 2` (25% of max HP, minimum 1)
  - Implement as a circle overlap check between ship and planet (planet radius ≈ 40 display pixels
    = 160 world units at 1× zoom = `PLANET_RADIUS_W`). Apply damage and bounce ship away.

---

## Next Up (after fixing known issues)

### Ships — Tier 1
- [x] **Spathi Eluder** — `engine/ships/spathi.ts` (BUTT torpedo, Emergency Escape Warp)
- [x] **Ur-Quan Dreadnought** — `engine/ships/urquan.ts` (Fusion Blast, autonomous fighter launch)
- [x] **Pkunk Fury** — `engine/ships/pkunk.ts` (triple spread gun, 50% resurrection on death)
- [x] **VUX Intruder** — `engine/ships/vux.ts` (forward laser, limpet mines with movement impairment)

### Hotspot Data
- [x] Parse `.ani` files for all 24 non-human ships — hotspots baked into `sprites.ts`

### Rendering / Polish
- [x] Thrust flame animation — UQM-faithful ion trail dots (orange→red→dark-red), 12-color cycle from `cycle_ion_trail`, 1×1 px dots trailing behind ship
- [x] Explosion/destruction animations — `boom` on ship death, `blast` on missile impact; UQM sprites with canvas circle fallback; battle end delayed 10 frames to let boom play
- [x] Warp-in animation — 15-frame (HYPERJUMP_LIFE) invisible countdown when ship enters; shadow dot approaches from facing direction with UQM ion-trail colors; ship nonsolid during warp-in
- [ ] Ship radar / minimap (shows both ships across the large toroidal arena)

### Gameplay
- [ ] Asteroid hazards (sprites available: `asteroid-big/med/sml` in battle assets)
- [x] Fleet progression: winner keeps ship, loser queues next; match ends when one fleet is gone
- [x] Between-round ship selection UI (loser picks next ship from remaining fleet)
- [x] Winner preserves state (crew/energy/position/velocity/facing) across rounds; only new ship warps in
- [ ] Score tracking

### Netplay / Lobby
- [ ] Room code UI polish (larger text, copy button)
- [ ] Reconnect handling
- [ ] Spectator mode

### Audio
- [ ] Per-ship combat music (each ship has a unique track in SC2)
- [x] Weapon SFX: primary/secondary fire, fighter laser — extracted from UQM content to `assets/sounds/ships/<species>/`
- [x] Explosion SFX: `boom1/23/45/67.wav` for missile impacts, `shipdies.wav` for ship destruction
- [ ] Thrust sound
- [ ] UI sounds (menu, selection)

### Input
- [ ] Gamepad support (see `docs/architecture.md` for axis/button mapping)

### Infrastructure
- [x] Hosting — Railway deploy: `start` script added, client dist path fixed, compiled server path corrected
- [ ] CI / physics determinism tests

---

## Reference

### Ship Name → Asset Prefix

| Species     | Ship prefix    | Big frames |
|-------------|---------------|-----------|
| androsynth  | guardian      | 16        |
| arilou      | skiff         | 16        |
| chenjesu    | broodhome     | 16        |
| chmmr       | avatar        | 16        |
| druuge      | mauler        | 16        |
| **human**   | **cruiser**   | **16 ✓**  |
| ilwrath     | avenger       | 16        |
| kohrah      | marauder      | 16        |
| melnorme    | trader        | 16        |
| mmrnmhrm    | xform         | 16        |
| mycon       | podship       | 16        |
| orz         | nemesis       | 16        |
| pkunk       | fury          | 16        |
| shofixti    | scout         | 16        |
| slylandro   | probe         | 16        |
| spathi      | eluder        | 16        |
| supox       | blade         | 16        |
| syreen      | penetrator    | 16        |
| thraddash   | torch         | 16        |
| umgah       | drone         | 16        |
| urquan      | dreadnought   | 16        |
| utwig       | jugger        | 16        |
| vux         | intruder      | 16        |
| yehat       | terminator    | 16        |
| zoqfotpik   | stinger       | 16        |

### Planet Types (available in content package)
`acid` `alkali` `auric` `azure` `bluegas` `carbide` `chlorine` `chondrite` `cimmerian`
`copper` `crimson` `cyangas` `cyanic` `dust` `emerald` `fluorescent` `green` `greengas`
`greygas` `halide` `hydrocarbon` `infrared` `iodine` `lanthanide` `magma` `magnetic`
`maroon` `metal` `noble` `oolite` `opalescent` `organic` `pellucid` `plutonic` `primordial`
`purple` `purplegas` `quasidegenerate` `radioactive` `rainbow` `redgas` `redux` `ruby`
`samatra` `sapphire` `selenic` `shattered` `slaveshield` `superdense` `telluric` `treasure`
`ultramarine` `urea` `vinylogous` `violetgas` `water` `xenolithic` `yellowgas` `yttric`
