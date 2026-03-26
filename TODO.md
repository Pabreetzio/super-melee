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
- [x] Earthling Cruiser — fully playable (thrust, nuke, point defense laser)

### UI / Rendering
- [x] Fleet builder (pick ships for your fleet)
- [x] HUD (crew bars, energy bars)
- [x] Camera: tracks wrap-aware midpoint between ships
- [x] Arena: correct size — 20480×15360 world units (`640×480 × 32`), faithful to UQM `SPACE_WIDTH * 32`
- [x] Zoom: 4 discrete levels (1×/2×/4×/8×) driven by ship separation, with 192-unit hysteresis band
- [x] Starfield: UQM star tile PNGs (`stars-000/001/002.png`) rendered as 3 parallax layers
- [x] Planet: procedural circle at world center (sprites exist — see below)

### Assets
- [x] Extracted Earthling Cruiser sprites (cruiser-big, cruiser-sml, saturn-big — 16+ frames each)
- [x] Extracted all 24 other ships' 16-frame big rotation sprites into `assets/ships/`
- [x] Ship sprite path bug fixed (`sprites.ts` was constructing wrong filenames — `human-big-000` instead of `cruiser-big-000`)
- [x] Battle starfield tiles (`assets/battle/stars-000/001/002.png`)
- [x] Planet sprites available in content package: `base/planets/{type}-{big|med|sml}-000.png`, 60+ types

---

## Known Issues (fix next session)

### Rendering Bugs
- [ ] **Ship sprites don't scale with zoom** — `drawSprite` draws at native pixel size regardless of
  reduction level. At 8× zoom a ship sprite should appear ~1/8 its normal size. Fix: pass
  `reduction` into `ctx.drawImage` as scaled width/height and adjust hotspot:
  ```
  const w = frame.img.width  >> reduction;
  const h = frame.img.height >> reduction;
  const hx = frame.hotX >> reduction;
  const hy = frame.hotY >> reduction;
  ctx.drawImage(frame.img, drawX - hx, drawY - hy, w, h);
  ```

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
- [ ] **Spathi Eluder** — `engine/ships/spathi.ts`
  - BUTT (Rear-Mounted Automatic Tracking Torpedo) — fires backward, homes on enemy
  - Emergency Escape Warp (special) — instant teleport to random position
  - Hotspot data: parse `assets/ships/spathi/eluder-big.ani`
- [ ] **Ur-Quan Dreadnought** — `engine/ships/urquan.ts`
  - Fusion Blast (primary)
  - Fighter launch (special — autonomous fighters that fight independently)
- [ ] **Pkunk Fury** — `engine/ships/pkunk.ts`
  - Triple-shot spread gun (primary)
  - Resurrection (special — random chance to fully respawn on death)
- [ ] **VUX Intruder** — `engine/ships/vux.ts`
  - Laser (primary)
  - Limpet mines (special — attach to enemy, constant drain)

### Hotspot Data
- [ ] Parse `.ani` files for all 24 non-human ships and bake hotspots into `sprites.ts`
  - `.ani` format: see existing `assets/ships/human/cruiser-big.ani` for reference
  - Until done, ships render with (0,0) hotspot — visually offset from their actual position

### Rendering / Polish
- [ ] Thrust flame animation (UQM uses per-ship thruster sprites, currently orange circle)
- [ ] Explosion/destruction animations (`boom-big/med/sml`, `blast-big/med/sml` in `uqm-content/base/battle/`)
  - Copy to `assets/battle/`, play on ship death and projectile impact
- [ ] Ship radar / minimap (shows both ships across the large toroidal arena)

### Gameplay
- [ ] Asteroid hazards (sprites available: `asteroid-big/med/sml` in battle assets)
- [ ] Fleet progression: winner keeps ship, loser queues next; match ends when one fleet is gone
- [ ] Victory/defeat screen between rounds
- [ ] Score tracking

### Netplay / Lobby
- [ ] Room code UI polish (larger text, copy button)
- [ ] Reconnect handling
- [ ] Spectator mode

### Audio
- [ ] Per-ship combat music (each ship has a unique track in SC2)
- [ ] Weapon SFX, thrust sound, explosion sounds, UI sounds

### Input
- [ ] Gamepad support (see `docs/architecture.md` for axis/button mapping)

### Infrastructure
- [ ] Hosting (Vercel/Fly.io)
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
