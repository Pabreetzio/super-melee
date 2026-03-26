# Asset Catalog

**Status: Ship sprites extracted. Planet and battle FX still needed.**

## License

The Ur-Quan Masters game content (ships, music, sounds, graphics) is distributed under a non-commercial fan license with explicit blessing from Toys for Bob. This project is non-commercial. Attribution required.

Reference: http://sc2.sourceforge.net/content.php (check for current license terms in the UQM content package)

## Current Extraction Status

### Ship Body Sprites (`assets/ships/`)
All 25 ships have 16-frame big rotation sprites extracted:
- [x] `human/cruiser-big-000..015.png` + hotspot data baked into `sprites.ts`
- [x] All 24 other ships: big rotation frames extracted (hotspot data still needed — see below)

Hotspot data (center offset per frame) is required for correct rendering. Currently only the
Earthling Cruiser has hotspot data. Other ships render at (0,0) until their `.ani` files are
parsed and added to `sprites.ts`.

To parse a `.ani` file: each line is `<filename> <duration> <hotX> <hotY>`.
Example (`cruiser-big.ani`):
```
cruiser-big-000.png 1 7 19
cruiser-big-001.png 1 12 19
...
```

### Battle FX Sprites (`assets/battle/`)
- [x] `stars-000/001/002.png` — starfield tiles (3 layers for parallax)
- [ ] `boom-big/med/sml-*.png` — ship explosion animation (available in content package)
- [ ] `blast-big/med/sml-*.png` — weapon impact flash (available in content package)
- [ ] `asteroid-big/med/sml-*.png` — asteroid hazards (available in content package)
- [ ] `planet-big/med/sml-000.png` — battle planet (see Planet section below)

### Planet Sprites
UQM renders the battle planet using a pre-rendered sprite, NOT procedurally.

**Source:** `src/uqm/cons_res.c`, `load_gravity_well()` — loads `planet.[type].[size]` resources.

**Asset location in content package:** `base/planets/{type}-{big|med|sml}-000.png`

**60+ planet types available:**
`acid`, `alkali`, `auric`, `azure`, `bluegas`, `carbide`, `chlorine`, `chondrite`, `cimmerian`,
`copper`, `crimson`, `cyangas`, `cyanic`, `dust`, `emerald`, `fluorescent`, `green`, `greengas`,
`greygas`, `halide`, `hydrocarbon`, `infrared`, `iodine`, `lanthanide`, `magma`, `magnetic`,
`maroon`, `metal`, `noble`, `oolite`, `opalescent`, `organic`, `pellucid`, `plutonic`,
`primordial`, `purple`, `purplegas`, `quasidegenerate`, `radioactive`, `rainbow`, `redgas`,
`redux`, `ruby`, `samatra`, `sapphire`, `selenic`, `shattered`, `slaveshield`, `superdense`,
`telluric`, `treasure`, `ultramarine`, `urea`, `vinylogous`, `violetgas`, `water`,
`xenolithic`, `yellowgas`, `yttric`

**3 size variants** (`big`, `med`, `sml`) map to zoom reduction levels:
- reduction 0 (1×): use `big`
- reduction 1 (2×): use `med`
- reduction 2–3 (4×/8×): use `sml`

**TODO:** Determine which planet type UQM uses in Super Melee battles. Check the call to
`load_gravity_well()` in battle init (`src/uqm/misc.c`, search for `spawn_planet`). Extract
the chosen type to `assets/battle/planet-big-000.png`, `planet-med-000.png`, `planet-sml-000.png`.

**Temporary:** Current code renders a procedural purple circle. Replace with `drawImage` once
planet sprites are extracted.

### Assets Still Needed
- [ ] Ship thruster animation frames (per ship — used when thrusting)
- [ ] Ship destruction frames (per ship — played on death)
- [ ] Per-ship projectile sprites (varies by ship)
- [ ] Bitmap fonts (`base/fonts/`) for UI text matching original style
- [ ] Audio (music + SFX — format TBD, likely OGG in the content package)

## UQM Content Package

Place `uqm-0.8.0-content.uqm` at the repo root (it is gitignored).
Extract the full package with: `unzip -n uqm-0.8.0-content.uqm -d uqm-content/`
(The `-n` flag skips files that already exist.)

All ship assets live under `base/ships/{species}/` and use the pattern
`{shipname}-{big|med|sml}-{NNN}.png` + `.ani` animation descriptor.

### Key asset directories in content package
- `base/ships/{species}/` — ship sprites, thruster frames, projectile sprites, `.ani` files
- `base/battle/` — starfield tiles, explosion/blast/asteroid animations
- `base/planets/` — planet sprites (60+ types × 3 sizes)
- `base/fonts/` — bitmap fonts (one per alien race + UI fonts)
- `base/comm/{race}/` — alien portrait animations (not needed for Super Melee)
- `base/cutscene/` — intro/outro sequences (not needed)

### Copying assets into `/assets/`
Ship rotation sprites (already done for all 25 ships):
```bash
# Copy main ship body frames for a given species/shipname:
cp uqm-content/base/ships/{species}/{shipname}-big-*.png assets/ships/{species}/
cp uqm-content/base/ships/{species}/{shipname}-big.ani   assets/ships/{species}/
```

Planet sprites (extract one type for the battle screen):
```bash
unzip -n uqm-0.8.0-content.uqm "base/planets/oolite-*" -d uqm-content/
cp uqm-content/base/planets/oolite-big-000.png assets/battle/planet-big-000.png
cp uqm-content/base/planets/oolite-med-000.png assets/battle/planet-med-000.png
cp uqm-content/base/planets/oolite-sml-000.png assets/battle/planet-sml-000.png
```

Battle FX:
```bash
cp uqm-content/base/battle/boom-big-*.png   assets/battle/
cp uqm-content/base/battle/boom-med-*.png   assets/battle/
cp uqm-content/base/battle/blast-big-*.png  assets/battle/
cp uqm-content/base/battle/asteroid-big-*.png assets/battle/
```
