# Arilou Skiff

Source reference: `uqm-0.8.0/src/uqm/ships/arilou/arilou.c`

## Core behavior

- Primary is an immediate short-range laser.
- The laser auto-aims by at most one facing step toward the nearest valid ship before firing.
- Laser range is `DISPLAY_TO_WORLD(109)` with a `9px` muzzle offset.
- Primary costs `2` energy and uses `WEAPON_WAIT = 1`.

## Movement

- Arilou does not coast like normal ships.
- When thrust is not active and `thrust_wait == 0`, velocity is zeroed completely.
- `THRUST_INCREMENT == MAX_THRUST`, so active thrust snaps the ship to full speed in its current facing.
- In practice this means the ship can stop on a dime and largely shrugs off ordinary inertia.

## Teleport

- Special costs `3` energy and uses `SPECIAL_WAIT = 2`.
- Teleport lasts `HYPER_LIFE = 5` frames.
- The ship is non-solid during the teleport.
- Relocation happens in the middle of the warp, matching the original timing where the jump point changes before the exit frames play.
- The Skiff should not take ship, planet, or projectile collisions while teleporting.

## AI notes

- The original cyborg sets thrust on by default and uses `ENTICE` movement against enemy ships.
- It teleports defensively when an enemy weapon is about to connect.
- It suppresses primary fire when energy is too low to keep an escape reserve.
