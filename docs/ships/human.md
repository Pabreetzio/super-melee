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

The laser automatically fires at any targetable, non-cloaked object within 100 display pixels of the ship's center. It fires once per activation (costs 4 energy) and hits everything in range that frame. Multiple targets can be hit in a single activation if they're all in range.

The activation is auto-triggered by player pressing SPECIAL (or by AI when threat is within 2–4 turns).

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
