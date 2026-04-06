# Constants Quick Reference

Constants used throughout the battle engine. Derive all unit conversions from
these — do not guess from sprite pixel measurements or memory summaries.

## Timing

| Constant | Value | Source |
|---|---|---|
| `BATTLE_FPS` | 24 | UQM `BATTLE_FRAME_RATE = ONE_SECOND/24`, `ONE_SECOND=840` |
| `ONE_SECOND` | 840 | UQM ticks per second |

## Angle / Rotation

| Constant | Value | Notes |
|---|---|---|
| `FULL_CIRCLE` | 64 | UQM uses 64-step circle |
| `HALF_CIRCLE` | 32 | |
| `QUADRANT` | 16 | |
| `FACING_TO_ANGLE(f)` | `f * 4` | Facing (0–15) → angle (0–63) |
| `SINE_SCALE` | 16384 | 14-bit fixed point |
| `sinetab[0]` | −16384 | Angle 0 = North (upward) |

## Coordinate Units

Three unit systems are in use simultaneously:

```
display pixels
    × 4 (ONE_SHIFT=2)
world units
    × 32 (VELOCITY_SHIFT=5)
velocity units  ← vx/vy stored here
```

| Conversion | Formula | Code |
|---|---|---|
| display px → world units | `× 4` | `DISPLAY_TO_WORLD(x) = x << 2` |
| world units → display px | `÷ 4` | `WORLD_TO_DISPLAY(x) = x >> 2` |
| world units → velocity units | `× 32` | `WORLD_TO_VELOCITY(x) = x << 5` |
| velocity units → world units | `÷ 32` | `VELOCITY_TO_WORLD(x) = x >> 5` |
| display px → velocity units | `× 128` | compose the two above |

**Common mistake:** reading the old MEMORY.md which stated "world units = 1/32
display pixels". The correct relationship is 1 display px = 4 world units.
Source of truth: `client/src/engine/velocity.ts` lines 14–20.

## Physics

| Constant | Value | Notes |
|---|---|---|
| `GRAVITY_THRESHOLD` | 255 world units | Constant pull, no falloff beyond this radius |

## Sync / Checksum

| Constant | Value | Notes |
|---|---|---|
| Park-Miller `A` | 16807 | |
| Park-Miller `M` | 2147483647 | `2^31 − 1` |
| Park-Miller `Q` | 127773 | `M ÷ A` |
| Park-Miller `R` | 2836 | `M mod A` |

## Fleet / UI

| Constant | Value | Notes |
|---|---|---|
| `FLEET_SIZE` | 14 | 2 rows × 7 columns |
