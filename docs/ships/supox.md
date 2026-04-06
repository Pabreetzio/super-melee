# Supox Blade

Reference: `uqm-0.8.0/src/uqm/ships/supox/supox.c`

## Core stats

- Crew 12, energy 16
- Energy regenerates 1 every 5 frames (`ENERGY_WAIT = 4`)
- Max thrust 40, thrust increment 8, thrust wait 0
- Turn wait 1
- Mass 4

## Primary: Glob launcher

- Costs 1 energy, waits 2 frames
- Spawns from `pixoffs = 23` in front of the ship
- Speed `DISPLAY_TO_WORLD(30)`, life 10, damage 1, hits 1
- Flight uses the normal glob frame; impact switches to the dedicated splatter frames
- Harmless expiry should not splatter
- Impact sound is the generic small battle hit `boom1.wav`, not a Supox-specific sound

## Special: Lateral / reverse thrust

- `supox_preprocess` repurposes the regular movement inputs while special is held
- `special + thrust` = reverse thrust
- `special + left` = strafe left
- `special + right` = strafe right
- `special + thrust + left/right` = reverse-diagonal thrust
- The special does not spend energy in UQM; the `DeltaEnergy` call is commented out in source
- `turn_wait` / `thrust_wait` are only nudged so the normal movement step does not also consume the same inputs that frame

## Porting notes

- Keep the projectile tagged as `supox_glob` through collision so shared hit logic can pick the right radius, explosion, and audio
- The glob hit effect intentionally suppresses the generic `blast` sprite and replaces it with a custom splatter animation
- In the shared hit pipeline, `skipBlast` must only suppress the stock blast; it must not block custom explosion types from spawning
