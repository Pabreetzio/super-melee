# Earthling Cruiser (human)

Source: `uqm-0.8.0/src/uqm/ships/human/human.c`
Sprite frames: `assets/ships/human/cruiser-{big,med,sml}-000.png` – 016.png
Missile frames: `assets/ships/human/saturn-{big,med,sml}-000.png` – 025.png

## Ship Stats

| Constant            | Value | Notes |
|---------------------|-------|-------|
| MAX_CREW            | 18    | Hit points |
| MAX_ENERGY          | 18    | Battery capacity |
| ENERGY_REGENERATION | 1     | Energy restored per regen tick |
| ENERGY_WAIT         | 8     | Frames between regen ticks (regen every 9th frame) |
| MAX_THRUST          | 24    | World units — maximum speed (`DISPLAY_TO_WORLD(6)`) |
| THRUST_INCREMENT    | 3     | World units added per thrust application (NOT `DISPLAY_TO_WORLD(2)`; the comment in source is stale) |
| THRUST_WAIT         | 4     | Frames between thrust applications (applies every 5th frame) |
| TURN_WAIT           | 1     | Frames between turns (turns every 2nd frame) |
| SHIP_MASS           | 6     | Collision mass |
| Super Melee cost    | 11    | Point value in original game |

## Coordinate Conversions

`DISPLAY_TO_WORLD(x) = x * 4` (ONE_SHIFT=2)
`WORLD_TO_VELOCITY(x) = x * 32` (VELOCITY_SHIFT=5)

So:
- MAX_THRUST in velocity units: 24 * 32 = **768**
- max_speed² = 768² = **589,824**
- THRUST_INCREMENT in velocity units: 3 * 32 = **96**
- Each thrust adds 96 velocity units (±48 per axis roughly, depending on angle)

## Primary Weapon: Nuclear Missile

| Constant         | Value | Notes |
|-----------------|-------|-------|
| WEAPON_ENERGY_COST | 9  | Battery cost per nuke |
| WEAPON_WAIT     | 10    | Frames between shots |
| MISSILE_LIFE    | 60    | Frames until self-destruct |
| MISSILE_SPEED   | 40    | `DISPLAY_TO_WORLD(10)` — initial speed (since MAX_THRUST=24 < MIN_MISSILE_SPEED=40) |
| MAX_MISSILE_SPEED | 80  | `DISPLAY_TO_WORLD(20)` — accelerates each frame |
| THRUST_SCALE    | 4     | `DISPLAY_TO_WORLD(1)` — acceleration per frame (`+4 velocity units/frame`) |
| MISSILE_DAMAGE  | 4     | Crew damage on impact |
| MISSILE_HITS    | 1     | Hit points of missile |
| TRACK_WAIT      | 3     | Frames between tracking updates |
| HUMAN_OFFSET    | 42    | Sprite offset from ship center (nuke launch position) |

Missile acceleration per frame: `speed = min(MISSILE_SPEED + (MISSILE_LIFE - life_span) * THRUST_SCALE, MAX_MISSILE_SPEED)`
→ starts at 40 world units, gains 4 per frame, caps at 80 after 10 frames.

Tracking: every TRACK_WAIT+1 frames (every 4 frames), the missile re-aims at the nearest enemy ship (standard UQM `TrackShip` behavior).

## Secondary Weapon: Point-Defense Laser

| Constant            | Value | Notes |
|--------------------|-------|-------|
| SPECIAL_ENERGY_COST | 4    | Battery cost per activation |
| SPECIAL_WAIT        | 9    | Cooldown frames after activation |
| LASER_RANGE         | 100  | Display pixels (not world units!) |
| LASER_DAMAGE        | 1    | From `initialize_laser`: `mass_points = 1` always |

The laser fires at every `CollidingElement` (non-cloaked, non-owner) within 100 display pixels of
the ship's center. This includes **enemy missiles AND the enemy ship**. All targets in range are
hit in a single activation; multiple laser lines are drawn in one frame.

**Energy/cooldown are deducted lazily (PaidFor flag, from `spawn_point_defense`):**
- Cost (4 energy) and cooldown (9 frames) are charged **only when the laser actually hits something**
- If nothing is in range: no energy spent, no cooldown — pressing SPECIAL is free
- Once it fires at anything, the 9-frame cooldown prevents re-firing — timing matters

**Range check** uses a box pre-filter followed by circle: `|dx| ≤ 100 && |dy| ≤ 100 && dx²+dy² ≤ 100²`
(all in display pixels; convert from world: `WORLD_TO_DISPLAY(d) = d >> 2`).

The activation is triggered by player pressing SPECIAL, or by AI when enemy weapon is within
2 turns OR enemy ship within 4 turns (`human_intelligence` in `human.c`).

## AI Behavior

From `human_intelligence`:
1. Uses SPECIAL when enemy weapon is within 2 turns OR enemy ship within 4 turns
2. Fires WEAPON when enemy ship is in range and not turning sharply

## Sprite System

- **16 rotation frames** (facing 0–15, `FACING_SHIFT=4`)
- Facing → sprite frame: `frame = facing & 15` (since FACING_TO_ANGLE maps facing*4 → angle, and there are 16 facings for 64 angles)
- Angle → facing: `facing = (angle + 2) >> 2` (round to nearest)
- Hotspots from `cruiser-big.ani`: ship center/pivot for positioning
- `cruiser-big`: ~28×38px sprites (battle rendering)
- `cruiser-med`: smaller (HUD or zoomed-out)
- `cruiser-sml`: HUD/icon size

The **Saturn (nuclear missile)** has 25 frames in the .ani file:
- Frames 0–15: 16 rotation frames (same facing system as ship)
- Frames 16–24: thrust/trail animation frames (currently unused)

## Implementation Notes

The thrust model is `inertial_thrust` from `ship.c`:
1. Compute new velocity = current + COSINE/SINE(facing, THRUST_INCREMENT * 32)
2. If |new_velocity|² ≤ MAX_THRUST²*32² → apply
3. If at max speed in same direction → clamp to max
4. If at max speed turning → partial velocity vector blending

Energy regen: subtract 1 from `energy_wait` counter each frame; when it reaches 0, restore ENERGY_REGENERATION and reset counter to ENERGY_WAIT.

### Missile tracking (`nuke_preprocess`)

`TrackShip` turns the missile **±1 facing unit** (out of 16) per `TRACK_WAIT+1 = 4` frames toward
the nearest enemy ship by Manhattan distance. It does NOT snap to the target angle. This is
implemented as `trackFacing(facing, targetAngle)` in `engine/ships/human.ts` and exported for
reuse by other seeking-missile ships.

The nuke spawns offset **`HUMAN_OFFSET = 42` display pixels** (168 world units) in the ship's
facing direction, computed via `COSINE/SINE(launchAngle, DISPLAY_TO_WORLD(42))`.

### Point-defense laser (`spawn_point_defense`)

Implemented as a deferred two-stage spawn in UQM (sentinel element → death_func fires actual
lasers). In our port, `humanController.applySpawn` resolves the effect after `updateHumanShip`
each frame, using the shared battle helpers to apply 1 point of laser damage to enemy weapons.

### Plasmoid interaction (for future Mycon implementation)

The Mycon plasmoid has `hit_points = 10` and recalculates them every frame from `life_span`.
A laser hit (1 damage) reduces `hit_points` by 1 and causes `plasma_preprocess` to shorten
`life_span = hit_points * PLASMA_DURATION`. The plasmoid is only destroyable by laser when
`life_span ≤ 14` (hit_points already = 1). Multiple laser hits accelerate dispersal but cannot
instantly kill a fresh plasmoid.
