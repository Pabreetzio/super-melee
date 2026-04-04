# Rendering System — UQM Source Findings

Notes from reading `uqm-0.8.0/src/uqm/` source code. Recorded here so future
sessions can verify and build on these findings without re-reading the source.

---

## Coordinate Systems (units.h)

```c
#define ONE_SHIFT 2
#define SCALED_ONE (1 << ONE_SHIFT)          // = 4
#define DISPLAY_TO_WORLD(x) ((x) << ONE_SHIFT)  // display px → world units (* 4)
#define WORLD_TO_DISPLAY(x) ((x) >> ONE_SHIFT)  // world units → display px (/ 4)
```

1 display pixel = 4 world units. Velocity is a third scale: 1 world unit = 32
velocity units (`VELOCITY_SHIFT = 5`).

---

## Zoom / Reduction System (units.h, process.c)

Source files: `src/uqm/units.h`, `src/uqm/process.c` (`CalcReduction`,
`PreProcessQueue`)

### Arena size

```
SPACE_WIDTH  = 576   // display pixels wide (640 minus 64px status bar at right)
SPACE_HEIGHT = 480
MAX_REDUCTION = 3    // 4 discrete zoom levels (reduction 0–3 = 1×/2×/4×/8×)

Arena (logical world units):
  LOG_SPACE_WIDTH  = DISPLAY_TO_WORLD(SPACE_WIDTH)  << MAX_REDUCTION = 576*4*8 = 18432
  LOG_SPACE_HEIGHT = DISPLAY_TO_WORLD(SPACE_HEIGHT) << MAX_REDUCTION = 480*4*8 = 15360
```

Our port uses `CANVAS_W = 640` (no sidebar) so our arena is 20480×15360.

### World → display coordinate conversion at zoom level r

```
displayX = (worldX - camOriginX) >> (2 + r)
```

Verified: this is consistent with UQM's use of `WORLD_TO_DISPLAY` plus the
reduction shift. Camera origin (top-left of view):

```
camX = midX - (SPACE_WIDTH  << (1 + r))   // ship midpoint − half visible world
camY = midY - (SPACE_HEIGHT << (1 + r))
```

### Zoom selection (CalcReduction in process.c)

Finds the minimum `r` where both ships fit within the view:

```c
sep = max(dx, dy);   // wrap-aware ship separation
// zoom OUT immediately; zoom IN only after hysteresis
if (sep >= SPACE_WIDTH << (1 + r)) increase r;
if (sep <  (SPACE_WIDTH << (1 + r)) - HYSTERESIS) decrease r;
```

UQM hysteresis values from `process.c`:
- `HYSTERESIS_X = DISPLAY_TO_WORLD(24) = 96` world units
- `HYSTERESIS_Y = DISPLAY_TO_WORLD(20) = 80` world units

Our port uses 192 (slightly larger, no meaningful difference in feel).

---

## Sprite Sizes and Zoom Levels (assets/ships/{species}/*.ani)

**Key finding:** UQM does NOT scale a single sprite. It pre-renders three sizes
(`big`, `med`, `sml`) and switches between them based on the current reduction
level. Each size is designed to look correct at its target zoom level.

The mapping (verified from `.ani` files and game behavior):

| Reduction | Zoom | Sprite variant |
|-----------|------|---------------|
| 0 | 1× | `big` (native pixel size, closest zoom) |
| 1 | 2× | `med` (native pixel size) |
| 2 | 4× | `sml` (native pixel size) |
| 3 | 8× | `sml` (native pixel size, same as r=2) |

The `.ani` file format per frame: `<filename> <scale> <duration> <hotX> <hotY>`

The `hotX`/`hotY` values are the pixel offset from the image's top-left corner
to the ship's center point. These must be applied at each zoom level using the
correct size's hotspots (e.g. `cruiser-big.ani` hotspots for `big` frames,
`cruiser-med.ani` hotspots for `med` frames).

**Earthling Cruiser hotspot data (baked into sprites.ts):**

| Size | Approx image dims | Example hotspot (frame 0) |
|------|-------------------|--------------------------|
| big  | ~46×38 px         | (7, 19)                  |
| med  | ~18×18 px         | (2, 9)                   |
| sml  | ~12×12 px         | (1, 4)                   |

At `sml`, ships are intentionally very small — they're meant for the full-arena
(8× zoom-out) view. This is faithful to the original and correct.

---

## Star Tiles

The UQM battle star tiles (`base/battle/stars-000/001/002.png`) are 256×256 PNGs
with the space background color **baked in as opaque pixels** — they are not
dot sprites on a transparent background. The "space color" visible in the tile
background is approximately `#A4ACFC` (a blue-purple).

In UQM, these tiles are drawn with normal `source-over` blending as the battle
arena background. The colored background IS intentional — UQM space is
blue-purple-tinted, not pure black.

**Problem for our port:** Drawing them as fill patterns covers the entire canvas
with the blue-purple space color. No standard canvas compositing mode can strip
an opaque colored background from an opaque source image without per-pixel work.

**Options for a correct implementation:**
1. **Per-pixel processing:** `getImageData` on each tile, replace pixels close
   to the background color with transparent/black, cache the result, then use
   the modified image as the pattern. One-time cost at load, zero per-frame cost.
2. **Procedural stars:** Use a seeded RNG to scatter white/gray dots across
   the arena with 3 parallax speeds. Pure black background, dots move as camera
   moves. Simple and fast.
3. **Accept UQM's space color:** Draw tiles as-is; the purple-blue background
   IS faithful to UQM. Only change if aesthetics demand pure black.

**Current status:** Star tiles disabled; background is pure black. To be
revisited once option 1 or 2 is implemented.

---

## Rendering Pipeline and Upscaling

**Key finding:** UQM renders to a 640×480 internal framebuffer regardless of
display resolution. When running at higher resolutions, the entire rendered
frame is upscaled to the display. The upscale mode is user-configurable:

- `MeleeScale=smooth` (default): bilinear interpolation → slightly blurry
- `MeleeScale=step`: nearest-neighbor → crisp/blocky pixel art

Source: `src/uqm/setupmenu.c`, video scaling options.

**Implication for our port:** Do NOT CSS-scale the canvas element — this
introduces compositing artifacts and bypasses `imageSmoothingEnabled`. Instead:
1. Set `canvas.width`/`canvas.height` to the physical display area (scaled to
   fill the screen while maintaining 4:3 aspect ratio).
2. Apply `ctx.setTransform(uiScale, 0, 0, uiScale, 0, 0)` at the start of each
   frame, where `uiScale = min(displayW / 640, displayH / 480)`.
3. Set `ctx.imageSmoothingEnabled = false` for nearest-neighbor (step mode).
4. Draw all game elements in the logical 640×480 coordinate space — the
   transform maps them to physical pixels automatically.

This is equivalent to UQM's step scaling mode, and produces crisp pixel art
at any resolution without CSS compositing issues.

---

## Earthling Cruiser Physics Constants (ships/human/human.c)

All values verified against `uqm-0.8.0/src/uqm/ships/human/human.c`:

```c
#define MAX_CREW             18
#define MAX_ENERGY           18
#define ENERGY_REGENERATION  1
#define ENERGY_WAIT          8     // regen every 9 frames
#define MAX_THRUST           24    // world units  = DISPLAY_TO_WORLD(6) ✓
#define THRUST_INCREMENT     3     // world units  (comment says DISPLAY_TO_WORLD(2)=8 — comment is WRONG)
#define THRUST_WAIT          4     // frames between thrust applications
#define TURN_WAIT            1     // frames between turn steps
#define SHIP_MASS            6

// Nuclear missile
#define WEAPON_ENERGY_COST   9
#define WEAPON_WAIT          10
#define MIN_MISSILE_SPEED    DISPLAY_TO_WORLD(10)   // = 40 world units
#define MAX_MISSILE_SPEED    DISPLAY_TO_WORLD(20)   // = 80 world units
#define MISSILE_SPEED        MAX_THRUST             // = 24 (< MIN, so MIN wins: 40)
#define THRUST_SCALE         DISPLAY_TO_WORLD(1)    // = 4 (acceleration per frame)
#define MISSILE_LIFE         60                     // frames
#define MISSILE_DAMAGE       4

// Point-defense laser
#define SPECIAL_ENERGY_COST  4
#define SPECIAL_WAIT         9
#define LASER_RANGE          100   // display pixels
```

**Note on THRUST_INCREMENT:** The comment in `human.c` says `DISPLAY_TO_WORLD(2)`
which would equal 8, but the actual value hardcoded is `3`. The comment appears
to be a stale annotation from a refactor. The value `3` is what is compiled and
used. Our port uses `3`. Ships reach max speed from rest in:
`ceil(MAX_THRUST / THRUST_INCREMENT) * (THRUST_WAIT + 1)` = `8 * 5 = 40 frames`
≈ 1.67 seconds at 24 FPS. This matches the feel of the original.

---

## Thrust / Velocity Implementation (ship.c: inertial_thrust)

```c
// From src/uqm/ship.c, inertial_thrust():
thrust_increment = WORLD_TO_VELOCITY(thrust_increment);  // convert to velocity units
GetCurrentVelocityComponents(VelocityPtr, &cur_dx, &cur_dy);
delta_x = cur_dx + COSINE(CurrentAngle, thrust_increment);
delta_y = cur_dy + SINE(CurrentAngle, thrust_increment);
desired_speed = VelocitySquared(delta_x, delta_y);
max_speed = VelocitySquared(WORLD_TO_VELOCITY(max_thrust), 0);

if (desired_speed <= max_speed)
    SetVelocityComponents(VelocityPtr, delta_x, delta_y);   // normal acceleration
else if (in_gravity_well && desired_speed <= MAX_ALLOWED_SPEED_SQR)
    SetVelocityComponents(VelocityPtr, delta_x, delta_y);   // allow beyond-max in gravity
else if (desired_speed < current_speed)
    SetVelocityComponents(VelocityPtr, delta_x, delta_y);   // gravity deceleration
else if (TravelAngle == CurrentAngle)
    SetVelocityVector(VelocityPtr, max_thrust, facing);      // clamp to max, same dir
else
    // thrusting at angle while at max: blend (UQM uses half-subtraction; we approximate)
```

`MAX_ALLOWED_SPEED = WORLD_TO_VELOCITY(DISPLAY_TO_WORLD(18)) = 18*4*32 = 2304`
velocity units. This global cap (3× cruiser max) only matters for gravity whips.

Our port's `human.ts` matches this logic faithfully.

---

## Planet (misc.c, cons_res.c)

Source: `src/uqm/misc.c` (`spawn_planet`), `src/uqm/cons_res.c` (`load_gravity_well`)

- Planet mass_points = 200 → satisfies `GRAVITY_MASS(m) = (m > 100)` → immovable, gravity source
- `DEFY_PHYSICS` flag set — never moves
- Gravity applies to all ships within 255 display pixels (flat, no falloff)
- Collision damage: `ship.hit_points >> 2` (25% of current HP, min 1)

Planet sprite: pre-rendered per zoom level (big/med/sml), same switching logic
as ship sprites. The exact planet type used in Super Melee battles should be
confirmed from `load_gravity_well()` call in battle init.

---

## Status Panel Fonts

UQM bitmap fonts converted to woff2 and loaded via the CSS Font Loading API in `StatusPanel.tsx`.

| Token | Font file | Used for |
|-------|-----------|----------|
| `UQMStarCon` | `assets/fonts/starcon.woff2` | Race name (status panel header) |
| `UQMTiny`    | `assets/fonts/tiny.woff2`   | Captain name (between gauge bars) |

**Loading strategy:** Fonts are registered at module init using `new FontFace(...)` and added to `document.fonts`. A module-level `uqmFontsReady` flag is set when all `face.load()` promises resolve. Until then, the panel draws with `bold Npx monospace` as a fallback — no frame is blocked waiting for fonts.

**Race name rendering (faithful to UQM):**
- Full race name, uppercased
- Font size auto-scaled down if the text would exceed the panel width minus 4px padding each side
- Drawn twice: offset +1px down in `#787878` (lighter than panel background — acts as drop shadow), then in `#000000` on top

**Captain name rendering:**
- Drawn centered between the crew and energy gauge columns
- Auto-scaled to fit the available gap width
- Baseline sits at the bottom of the gauge bars so text straddles the bar bottom edge

See `docs/assets.md` (Fonts section) for extraction and conversion details.

---

## Open Questions (to verify from UQM source)

- [ ] Exact planet type used in Super Melee (check `spawn_planet` in `misc.c`)
- [ ] `COLLISION_TURN_WAIT` and `COLLISION_THRUST_WAIT` values (check `ship.h`)
- [ ] How `SetEquFrameIndex` normalizes collision frames
- [ ] Planet bounce impulse magnitude (direction confirmed: away from planet)
