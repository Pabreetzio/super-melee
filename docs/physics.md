# Physics Engine Analysis

Deep dive into UQM physics based on reading:
- `uqm-0.8.0/src/uqm/velocity.h` + `velocity.c`
- `uqm-0.8.0/src/uqm/collide.c`
- `uqm-0.8.0/src/uqm/gravity.c`
- `uqm-0.8.0/src/uqm/element.h`
- `uqm-0.8.0/src/uqm/units.h`

---

## Coordinate Systems

Three nested coordinate spaces:

| Space | Unit | Conversion |
|---|---|---|
| Display (pixels) | 1 = 1 screen pixel | — |
| World (logical) | 1 = 4 display pixels | `DISPLAY_TO_WORLD(x) = x << 2` |
| Velocity | 1 = 1/32 world unit/tick | `WORLD_TO_VELOCITY(x) = x << 5` |

`SCALED_ONE = 4` is one display pixel in world units.

The arena wraps toroidally. Logical arena size is `SPACE_WIDTH * 32` × `SPACE_HEIGHT * 32` world units. `WRAP_DELTA_X/Y` macros compute shortest-path delta across the wrap boundary so gravity and collision work correctly at edges.

---

## Zoom / Camera System

**Source:** `src/uqm/units.h`, `src/uqm/process.c` (`CalcReduction`, `PreProcessQueue`)

UQM has two zoom modes (`optMeleeScale`): continuous trilinear (default) and fixed-step. For our port we implement fixed-step (simpler, deterministic, still faithful to feel).

### Arena size

```
SPACE_WIDTH  = 576   (battle area width in display pixels — 640 minus 64px status bar)
SPACE_HEIGHT = 480
MAX_REDUCTION = 3    (maximum zoom-out = 2^3 = 8×)

Arena width  = SPACE_WIDTH  * 32 = 18432 world units
Arena height = SPACE_HEIGHT * 32 = 15360 world units
```

Our port uses `CANVAS_W = 640` (full canvas, HUD is overlay), so:
```
WORLD_W = 640 * 32 = 20480
WORLD_H = 480 * 32 = 15360
```

### Zoom levels

| Reduction | Zoom | World units per display pixel | Screen shows (world) |
|-----------|------|-------------------------------|---------------------|
| 0 | 1× | 4 | 2560 × 1920 (1/8 arena) |
| 1 | 2× | 8 | 5120 × 3840 (1/4 arena) |
| 2 | 4× | 16 | 10240 × 7680 (1/2 arena) |
| 3 | 8× | 32 | 20480 × 15360 (full arena) |

### Coordinate conversion at zoom level `r`

```
displayX = (worldX - camOriginX) >> (2 + r)
```

Camera origin (top-left of view):
```
camX = midX - (CANVAS_W << (1 + r))   // midX = wrap-aware ship midpoint
camY = midY - (CANVAS_H << (1 + r))
```

### Zoom selection (CalcReduction)

Find the minimum `r` where both ships fit in the view:
```
sep = max(|ship1.x - ship0.x|, |ship1.y - ship0.y|)  // wrap-aware
zoom out  when sep >= CANVAS_W << (1 + r)             // immediate
zoom in   when sep <  (CANVAS_W << (1 + r)) - 192     // 192 world units hysteresis
```

UQM's hysteresis values: `HYSTERESIS_X = DISPLAY_TO_WORLD(24) = 96`, `HYSTERESIS_Y = DISPLAY_TO_WORLD(20) = 80` (from `process.c`). We use 192 (slightly larger) to prevent rapid toggling.

**Implementation status:** Implemented in `client/src/components/Battle.tsx` (`calcReduction`) and `client/src/engine/sprites.ts` (`drawSprite` accepts `reduction` parameter).

**Sprite zoom:** UQM does NOT scale a single sprite — it switches between pre-rendered `big`/`med`/`sml` variants. `drawSprite` draws at native pixel size; the caller (Battle.tsx) selects the correct set based on `r`: big→r=0, med→r=1, sml→r=2–3. See `docs/rendering.md` for full details.

---

## Angle System

**`FULL_CIRCLE = 64`** — angles are integers 0–63 (6-bit).

| Constant | Value | Degrees |
|---|---|---|
| FULL_CIRCLE | 64 | 360° |
| HALF_CIRCLE | 32 | 180° |
| QUADRANT | 16 | 90° |
| OCTANT | 8 | 45° |

Trig uses a precomputed integer sine table (`sinetab[]`, 64 entries), scaled by `SIN_SCALE = 16384` (14-bit fixed-point):

```c
SINE(angle, magnitude) = (sinetab[angle & 63] * magnitude) >> 14
COSINE(angle, magnitude) = SINE(angle + QUADRANT, magnitude)
```

Ship facing uses 16 directions (`FACING_SHIFT = 4`, so `1 << 4 = 16` facings). Facing→angle: `facing << (6 - 4) = facing << 2`.

**Implication for our port:** Use a 64-entry integer sine table. Never use `Math.sin()` in simulation code — it will produce different rounding results and break lockstep netplay.

---

## Velocity Representation

`VELOCITY_DESC` struct (`velocity.h`):

```c
typedef struct {
    COUNT TravelAngle;  // cached travel direction (0-63)
    EXTENT vector;      // integer world units per tick (width=dx, height=dy)
    EXTENT fract;       // sub-unit fractional remainder
    EXTENT error;       // Bresenham accumulator
    EXTENT incr;        // packed: LOBYTE = fractional step, HIBYTE = sign (+1 or 0xFF=-1)
} VELOCITY_DESC;
```

`VELOCITY_SHIFT = 5`, so velocity space is 32× world space.

This is **Bresenham's line algorithm applied to movement**. The velocity is split into:
- `vector`: how many whole world units to move per tick
- `fract`: the fractional leftover (in velocity units, i.e. /32 world)
- `error`: accumulator that advances `fract` across multiple frames

Each tick, actual movement = `vector` world units + sometimes ±1 world unit depending on the fractional accumulator. This produces pixel-level subframe precision from integer math alone.

`GetCurrentVelocityComponents()` returns the current dx/dy in velocity units:
```c
dx = WORLD_TO_VELOCITY(vector.width) + (fract.width - HIBYTE(incr.width))
```

`DeltaVelocityComponents()` adds a velocity delta by extracting current velocity, adding the delta, then calling `SetVelocityComponents()` to repack it.

**Implication:** Ship velocity is NOT a simple float pair. It's a Bresenham accumulator. For faithful reproduction, implement the same split-integer system in TypeScript.

---

## Gravity

**Source:** `gravity.c`, `CalculateGravity()`

### What creates gravity
`GRAVITY_MASS(m) = m > MAX_SHIP_MASS * 10 = m > 100`

Regular ships have `mass_points` ≤ 10. Gravity sources (stars, planets) have mass > 100. The planet/star at the center of the arena is the only gravity source in standard Super Melee.

### Gravity range
`GRAVITY_THRESHOLD = 255` display pixels. Outside this range: no effect at all. Inside: full effect. This is a step function, not inverse-square — **no falloff**.

### Gravity magnitude
**Exactly 1 world unit per tick** toward the attractor, regardless of distance (within threshold):
```c
DeltaVelocityComponents(&TestElementPtr->velocity,
    COSINE(angle, WORLD_TO_VELOCITY(1)),
    SINE(angle, WORLD_TO_VELOCITY(1)));
```

This is applied every tick the ship is within `GRAVITY_THRESHOLD` display pixels of the gravity source.

### Gravity and wrap
Uses `WRAP_DELTA_X/Y` to compute the shortest-path direction, so gravity works correctly when a ship is near a wrap boundary.

### Effect on status flags
When a ship is in the gravity well, `SHIP_IN_GRAVITY_WELL` flag is set and `SHIP_AT_MAX_SPEED` is cleared — the ship can exceed its normal max speed if gravity has been pulling it for a while.

**Implication:** Gravity is dead simple — constant 1-unit-per-tick pull within a fixed radius. The "feel" of the gravity well comes from accumulation over many ticks, not from a sophisticated formula.

---

## Collision

**Source:** `collide.c`, `collide()`

This is the most important function for the "feel" of the game. It is deliberately non-physical.

### Step 1: Determine impact angle
```c
dx_rel = ElementPtr0->next.location.x - ElementPtr1->next.location.x;
dy_rel = ElementPtr0->next.location.y - ElementPtr1->next.location.y;
ImpactAngle0 = ARCTAN(dx_rel, dy_rel);   // angle FROM element1 TO element0
ImpactAngle1 = ImpactAngle0 + HALF_CIRCLE; // opposite direction
```

### Step 2: Get relative velocity
```c
dx_rel = dx0 - dx1;
dy_rel = dy0 - dy1;
RelTravelAngle = ARCTAN(dx_rel, dy_rel);
speed = square_root(dx_rel² + dy_rel²);  // magnitude of relative velocity
```

### Step 3: Glancing collision correction — THE KEY QUIRK

```c
Directness = NORMALIZE_ANGLE(RelTravelAngle - ImpactAngle0);
if (Directness <= QUADRANT || Directness >= HALF_CIRCLE + QUADRANT)
{
    // "shapes just scraped each other but still collided,
    //  they will collide again unless we fudge it."
    Directness = HALF_CIRCLE;
    ImpactAngle0 = TravelAngle0 + HALF_CIRCLE;
    ImpactAngle1 = TravelAngle1 + HALF_CIRCLE;
}
```

When ships graze each other at a shallow angle (`Directness` is within 90° of perpendicular), the game **overrides physics entirely**: each ship bounces directly back along its own travel direction, and `Directness` is forced to `HALF_CIRCLE` (180°). This prevents ships from getting "stuck" re-colliding on consecutive ticks when sliding past each other.

### Step 4: Impulse formula
```c
scalar = SINE(Directness, speed << 1) * mass0 * mass1;

// For element 0:
speed0 = scalar / (mass0 * (mass0 + mass1));
DeltaVelocityComponents(&ElementPtr0->velocity,
    COSINE(ImpactAngle0, speed0),
    SINE(ImpactAngle0, speed0));

// For element 1:
speed1 = scalar / (mass1 * (mass0 + mass1));
DeltaVelocityComponents(&ElementPtr1->velocity,
    COSINE(ImpactAngle1, speed1),
    SINE(ImpactAngle1, speed1));
```

This is NOT standard elastic collision. The key non-physical aspects:
- Uses `SINE(Directness, speed * 2)` — sines the angle between travel and impact, and **doubles** the relative speed before that
- The result is that head-on collisions (Directness = 180°, SINE = 0) result in `scalar = 0` — **no impulse**. This means two ships traveling directly at each other pass through with no bounce from the formula... but are caught by the minimum speed floor below.
- Glancing collisions near 90° (SINE ≈ max) produce the strongest impulse
- The mass formula `scalar / (mass * (mass0 + mass1))` resembles conservation of momentum but the numerator is wrong for real physics

**This is intentional.** The formula makes glancing collisions feel "bouncy" and gives the combat its characteristic sliding/deflecting feel.

### Step 5: Minimum speed floor
After applying the impulse, if the resulting speed is below 1 display pixel/tick:
```c
if (VELOCITY_TO_WORLD(|dx| + |dy|) < SCALED_ONE)
    SetVelocityComponents(..., COSINE(ImpactAngle, WORLD_TO_VELOCITY(SCALED_ONE) - 1),
                               SINE(ImpactAngle, ...));
```

Ships are never allowed to come to rest from a collision. They always get kicked at least 1 display pixel/tick in the impact direction. This prevents ships from merging or getting "magnetized."

### Step 6: Control lockout after collision
```c
if (ElementPtr0->turn_wait < COLLISION_TURN_WAIT)
    ElementPtr0->turn_wait += COLLISION_TURN_WAIT;
if (ElementPtr0->thrust_wait < COLLISION_THRUST_WAIT)
    ElementPtr0->thrust_wait += COLLISION_THRUST_WAIT;
```

Ships lose turning and thrust control briefly after a collision. Values of `COLLISION_TURN_WAIT` and `COLLISION_THRUST_WAIT` need to be read from ship-specific code (likely defined per ship or in a shared header).

### Edge case: DEFY_PHYSICS
If both ships were stationary (position didn't change) and both have `DEFY_PHYSICS` set (e.g., they spawned overlapping):
```c
ImpactAngle0 = TravelAngle0 + HALF_CIRCLE - OCTANT;  // 135° redirect
ImpactAngle1 = TravelAngle1 + HALF_CIRCLE - OCTANT;
ZeroVelocityComponents(&ElementPtr0->velocity);
ZeroVelocityComponents(&ElementPtr1->velocity);
```
Velocities are zeroed and then re-applied at 135° from travel direction. Both get the `DEFY_PHYSICS | COLLISION` flags set.

---

## Collision Detection (not response)

**Source:** `gravity.c`, `TimeSpaceMatterConflict()`

Uses `DrawablesIntersect()` — **sprite-based collision detection**, not bounding circles or AABB. The actual sprite pixels determine collision. This is why ships with different shapes collide differently.

`INTERSECT_CONTROL` holds the origin point and the sprite frame. `SetEquFrameIndex()` normalizes which frame is used (not always the current animation frame — likely uses the "equivalent" collision frame).

**Implication:** We'll need per-ship collision masks or bounding shapes that approximate the pixel-perfect detection of the original. True pixel-perfect in a browser netplay context is complex. Closest approximation: bounding circles per ship tuned to match the feel, or polygon hulls.

---

## Summary: What to Replicate Faithfully

| System | Faithful to UQM? | Notes |
|---|---|---|
| 64-unit angle system | YES | Required for deterministic trig |
| Integer sine table | YES | No Math.sin() in sim code |
| Bresenham velocity accumulator | YES | Reproduces sub-pixel movement feel |
| Gravity as constant 1-unit pull in radius | YES | Simple, but the step-function cutoff matters |
| Glancing collision override (QUADRANT check) | YES | This IS the "feel" |
| Non-physical impulse formula | YES | SINE(Directness, speed*2) * masses |
| Minimum post-collision speed floor | YES | Prevents merging |
| Control lockout after collision | YES | turn_wait / thrust_wait |
| Pixel-perfect collision detection | APPROXIMATE | Use per-ship bounding shapes tuned to match |
| DEFY_PHYSICS overlap handling | YES | Edge case but affects spawn behavior |

---

## Planet Collision

**Source:** `src/uqm/ship.c`, `collision()` function; `src/uqm/misc.c`, `spawn_planet()`

The battle planet is a special element with `mass_points = 200`, which satisfies
`GRAVITY_MASS(m) = (m > 100)`. This makes it both a gravity source and an immovable obstacle.

### Planet properties
- `mass_points = 200` (from `misc.c:62`)
- `DEFY_PHYSICS` flag set — never moves from collisions
- Acts as gravity well: pulls all ships within `GRAVITY_THRESHOLD = 255` display pixels

### Collision damage
```c
// from ship.c, collision():
damage = ElementPtr0->hit_points >> 2;  // 1/4 of ship's current HP
if (damage == 0) damage = 1;            // minimum 1 point
do_damage(ElementPtr0, damage);
```

So hitting the planet removes 25% of a ship's current HP (not max HP), minimum 1 crew.

### Implementation needed
In `simulateFrame()` in `Battle.tsx`, add a planet circle overlap check after wrapping positions:
```typescript
// Planet collision: 25% current crew damage, bounce
const r = PLANET_RADIUS_W + DISPLAY_TO_WORLD(SHIP_RADIUS);
if (circleOverlap(ship.x, ship.y, 0, PLANET_X, PLANET_Y, r)) {
  ship.crew = Math.max(0, ship.crew - Math.max(1, ship.crew >> 2));
  // bounce: reverse velocity component toward planet
}
```

The bounce should use the same `worldAngle` + `DeltaVelocityComponents` pattern as gravity,
but applied in the opposite direction (away from planet) with a larger magnitude.

---

## Open Questions

- [ ] What are the values of `COLLISION_TURN_WAIT` and `COLLISION_THRUST_WAIT`? (check `ship.h` or `races.h`)
- [ ] How does each ship's max speed interact with the velocity accumulator? Where is max speed enforced?
- [ ] What exactly does `SetEquFrameIndex` do for collision frames?
- [ ] What is `NONSOLID` flag used for — which elements pass through others?
- [ ] Which planet type does Super Melee use? Check `load_gravity_well()` call in battle init.
