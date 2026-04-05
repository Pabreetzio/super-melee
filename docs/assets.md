# Asset Catalog

**Status: Ship sprites, battle FX, planets, SFX, and victory ditties are extracted.**

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
- [x] `boom-big/med/sml-*.png` — ship explosion animation
- [x] `blast-big/med/sml-*.png` — weapon impact flash
- [ ] `asteroid-big/med/sml-*.png` — asteroid hazards (available in content package)
- [x] Planet sprites are extracted under `assets/planets/` and packed into per-planet atlases for battle use

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
- [x] Bitmap fonts — converted to woff2 and placed in `assets/fonts/` (see Fonts section below)
- [x] Battle and ship SFX (`assets/sounds/`)
- [x] Victory ditties (`assets/music/ditty/*.mod`)
- [ ] Full background music / remaining audio outside the current battle flow

## Fonts (`assets/fonts/`)

UQM uses custom bitmap fonts for all in-game UI text. Three fonts are relevant to the battle status panel:

| File | Source (content package) | Used for |
|------|--------------------------|----------|
| `starcon.woff2` / `.ttf` | `base/fonts/startcon.fon` | Race name header in status panel |
| `tiny.woff2` / `.ttf`    | `base/fonts/micro2.fon`  | Captain name between gauge bars |
| `micro.woff2` / `.ttf`   | `base/fonts/micro.fon`   | Small labels (reserved, not yet used) |

### Extraction / Conversion

The `.fon` files are Windows bitmap font resources. Conversion to web fonts was done with:
- `tools/convert-font.py` — extracts glyph bitmaps from `.fon` and builds a TTF via `fonttools`
- `tools/font-test.html` — browser preview for verifying glyph coverage and sizing

Converted fonts are committed to `assets/fonts/`; source `.fon` files remain in the gitignored content package.

### Usage in StatusPanel

`StatusPanel.tsx` loads all three fonts at module init via the CSS Font Loading API:

```ts
new FontFace('UQMStarCon', 'url(/fonts/starcon.woff2)')
new FontFace('UQMTiny',    'url(/fonts/tiny.woff2)')
```

The panel falls back to monospace until fonts are ready (`uqmFontsReady` flag), so the first frame is never blocked. Once loaded, the race name renders in **UQMStarCon** (auto-scaled to fit the panel width) and the captain name renders in **UQMTiny** (auto-scaled to fit between the crew/energy gauge columns).

Race name rendering matches UQM: text is drawn twice — once offset one pixel down in a lighter grey (drop shadow), then again in black on top.

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
