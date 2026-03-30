# Porting UQM Ships — Reference Guide

Read this before porting a new ship. It captures the key patterns and pitfalls.

---

## Finding Source Files

| What you need | Where to look |
|---|---|
| Ship physics & weapon logic | `uqm-0.8.0/src/uqm/ships/<name>/<name>.c` |
| Ship constants header | `uqm-0.8.0/src/uqm/ships/<name>/<name>.h` |
| Resource names (sprite/sound IDs) | `uqm-0.8.0/src/uqm/ships/<name>/resinst.h` |
| Coordinate/unit macros | `uqm-0.8.0/src/uqm/units.h` |
| Velocity system | `uqm-0.8.0/src/uqm/velocity.h` + `velocity.c` |
| Weapon spawn helper | `uqm-0.8.0/src/uqm/weapon.c` (`initialize_missile`) |
| Ship update dispatch | `uqm-0.8.0/src/uqm/ship.c` |
| AI behavior | `uqm-0.8.0/src/uqm/intel.c` |

## Finding Assets

UQM assets are packed in `uqm-0.8.0-content.uqm` (a zip file). Ship sprites live under
`base/ships/<name>/`. Extract with:

```bash
unzip uqm-0.8.0-content.uqm "base/ships/<name>/*" -d uqm-content/
```

Then copy into `assets/ships/<name>/`. See `docs/assets.md` for the full catalog and naming conventions.

Each sprite size has a `.ani` file alongside the PNGs. The `.ani` file lists hotspot offsets
(the pixel within the sprite that maps to the element's world position). These values go into
the `*_HOTSPOTS` tables in `client/src/engine/sprites.ts`.

---

## Speed & Distance: The Unit Conversion Rule

### The trap

UQM ship `.c` files mix two conventions without labeling them:

| Convention | Example from UQM source | What to do in our port |
|---|---|---|
| Already in world units (bare number) | `#define MAX_THRUST 24` | Use as-is |
| In display pixels (has wrapper) | `#define MIN_MISSILE_SPEED DISPLAY_TO_WORLD(10)` | Wrap with `DISPLAY_TO_WORLD()` |

**If the UQM source has `DISPLAY_TO_WORLD(x)`, keep the wrapper.**
**If the UQM source has a bare number used as a speed/thrust, do NOT add `DISPLAY_TO_WORLD()`.**

### Why

`SetVelocityVector(velocity, speed, facing)` in UQM internally calls `WORLD_TO_VELOCITY(speed)`.
If you also apply `DISPLAY_TO_WORLD()` before passing it, you multiply by 4 twice and get 4× overspeed.

### The human.c Rosetta Stone

`human.c` is the best reference because it preserves the original units as comments:

```c
#define MAX_THRUST /* DISPLAY_TO_WORLD (6) */ 24
#define THRUST_INCREMENT /* DISPLAY_TO_WORLD (2) */ 3
```

These mean: "was `DISPLAY_TO_WORLD(6)=24`, but hardcoded the result." The bare `24` **is already in world units.**

### Which constants need `DISPLAY_TO_WORLD()` and which don't

| Constant type | UQM usage | Needs wrapper? |
|---|---|---|
| Thrust / missile speed | passed to `SetVelocityVector` | Only if source has `DISPLAY_TO_WORLD(x)` |
| Spawn offset (`pixoffs`) | sprite pixel offset | YES — always display pixels |
| Range / distance thresholds | location comparison | YES if bare number in pixel space |
| Crew / energy / wait counts | dimensionless | NO |

When in doubt: check `intel.h` — `CLOSE_RANGE_WEAPON = DISPLAY_TO_WORLD(50)` and
`LONG_RANGE_WEAPON = DISPLAY_TO_WORLD(1000)` show the expected scale of range constants.

### Quick speed sanity check

At r=0 (1× zoom), 1 display pixel = 4 world units. A speed of `N` world units/frame
moves `N/4` display pixels per frame. At 24 fps, it should cross the ~640px visible screen
in roughly 1–3 seconds for a typical fast projectile. If it crosses in under 0.5s, the speed
is probably 4× too high.

---

## Animation Frames: Normal vs Special States

UQM sprites often pack multiple animation sequences into one strip (all sizes share the same
frame layout). Always check the ship's `preprocess_func` to find how many frames are used for
normal flight vs special states (hit reaction, death, etc.).

Key variable to look for: **`LAST_SPIN_INDEX`** or equivalent — the highest normal animation
frame index. Cycling beyond this will show death/explosion frames during normal flight.

`SAW_RATE` (or `turn_wait` / `track_wait`) controls animation speed:
- `0` = advance one frame every game tick
- `N` = advance one frame every `N+1` ticks

The animation frame counter must be **independent of `life_span`** if the weapon's life is
being actively managed (e.g., replenished while a button is held). Use a dedicated tick
counter, not `life & 1` or `(LIFE - life) & mask`.

---

## Weapon Lifetime: The `spin_preprocess` Pattern

Many UQM weapons manage their own `life_span` by incrementing it every frame to counteract
the engine's automatic decrement. The weapon then lives until an external event (hit, FIFO
cap, explicit kill) rather than until a timer expires.

**How to spot it:** look for `++ElementPtr->life_span` inside a preprocess function.
If a weapon's `preprocess_func` chain calls a helper (e.g. `spin_preprocess`) at the *end*
of every phase function, that helper is almost certainly the one doing the replenishment.

**The trap:** the replenishment must happen in **all** phases of the preprocess chain, not
just the first one. In UQM `blackurq.c`:
- `buzzsaw_preprocess` calls `spin_preprocess` (held phase)
- `decelerate_preprocess` calls `spin_preprocess` (slowing down)
- `buzztrack_preprocess` calls `spin_preprocess` (stationary / homing)

If you only replenish life in phase 1, the weapon expires the moment it transitions to
phase 2 — it looks like a ~1-second timer because `life >>= 1` at the transition point
(half of `MISSILE_LIFE = 64` frames = ~1.3 s at 24 fps).

**In our port:** the engine does `m.life--` every frame. Mirror UQM's replenishment by
doing `m.life++` inside every phase branch of the weapon's lifecycle block.

---

## Weapon Behavior Patterns

### `preprocess_func` chain

Most per-frame weapon logic in UQM is in `preprocess_func`. A weapon may swap its
`preprocess_func` pointer mid-flight to change behavior phases (e.g., moving → decelerating
→ homing). Identify all the functions in the chain to understand the full weapon lifecycle.

### `postprocess_func`

Usually handles rendering-specific cloning of elements — **does not need to be ported**
for gameplay.

### Active-instance caps

Many UQM weapons cap how many can exist simultaneously. In UQM this is typically tracked
via `special_wait` on the ship element. In our port, enforce the cap in the ship's update
function by counting existing missiles with the matching `weaponType` in `bs.missiles`
(passed in or accessible via context).

### Edge-triggered vs continuous fire

Some weapons fire once per key-press (edge-triggered); others fire continuously while held.
Check the UQM source for whether the weapon is spawned on every frame the WEAPON flag is set,
or only when the flag transitions from unset → set. For edge-triggered weapons, track
`prevFireHeld` in the ship state (`HumanShipState.prevFireHeld`) and only spawn on
`fireNow && !prevFireHeld`.

---

## Coordinate Quick Reference

```
display pixels  ×4   world units  ×32   velocity units
                ÷4                 ÷32
```

- `DISPLAY_TO_WORLD(x) = x * 4`
- `WORLD_TO_VELOCITY(x) = x * 32`
- Arena at r=0: 640 × 480 display pixels = 2560 × 1920 world units visible
- Full arena: 20480 × 15360 world units (WORLD_W × WORLD_H)
