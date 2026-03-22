# Asset Catalog

**Status: Pending extraction from UQM content package**

## License

The Ur-Quan Masters game content (ships, music, sounds, graphics) is distributed under a non-commercial fan license with explicit blessing from Toys for Bob. This project is non-commercial. Attribution required.

Reference: http://sc2.sourceforge.net/content.php (check for current license terms in the UQM content package)

## Assets Needed

### Ship Sprites
Each ship needs:
- [ ] Ship body (rotated frames — UQM uses pre-rendered rotation frames, not real-time rotation)
- [ ] Thruster animation frames
- [ ] Destruction animation frames
- [ ] Projectile sprites (per weapon)

### UI
- [ ] Fleet selection screen assets
- [ ] Energy/crew bars
- [ ] Ship silhouettes for fleet display

### Audio
- [ ] Per-ship combat music (each ship has its own track in SC2)
- [ ] Weapon sound effects
- [ ] Engine thrust sounds
- [ ] Explosion sounds
- [ ] UI sounds

### Ships (all 25+)
To be cataloged. Priority order for implementation TBD.

Tier 1 (implement first — distinct, iconic):
- [ ] Earthling Cruiser
- [ ] Spathi Eluder
- [ ] Ur-Quan Dreadnought
- [ ] Pkunk Fury
- [ ] VUX Intruder

## UQM Content Package

Place `uqm-0.8.0-content.uqm` at the repo root (it is gitignored).
It is a standard zip archive. Extract with: `unzip uqm-0.8.0-content.uqm -d uqm-content/`

All ship assets live under `base/ships/{shipname}/` inside the archive. Format is PNG + `.ani` animation descriptor files.

### Full ship list in content package
androsynth, arilou, chenjesu, chmmr, drone, druuge, flagship, human, ilwrath,
kohrah, melnorme, mmrnmhrm, mycon, orz, pkunk, samatra, shofixti, slylandro,
spathi, supox, syreen, thraddash, umgah, urquan, utwig, vux, yehat, zoqfotpik

### Other relevant asset dirs
- `base/battle/` — battle UI, starfield, planet/star sprites
- `base/fonts/` — bitmap fonts (one per alien race + UI fonts)
- `base/comm/{race}/` — alien portrait animations (not needed for Super Melee)
- `base/cutscene/` — intro/outro (not needed)
- `base/nav/`, `base/planets/` — full game only (not needed)

### Asset extraction plan
When ready to extract ship assets:
```bash
unzip uqm-0.8.0-content.uqm "base/ships/*" -d uqm-content/
unzip uqm-0.8.0-content.uqm "base/battle/*" -d uqm-content/
```
Then copy relevant files into `/assets/` in this repo.
