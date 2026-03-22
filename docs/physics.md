# Physics Engine Analysis

**Status: Pending UQM source review**

## Key areas to document from UQM source

- [ ] Gravity well mechanics (black hole / star at center)
- [ ] Ship thrust and momentum accumulation
- [ ] Velocity cap per ship
- [ ] Collision detection method (AABB? pixel-perfect? bounding circle?)
- [ ] Collision response — the "quirks" that make combat feel right
  - Likely: collision resolution doesn't fully conserve momentum the way realistic physics would
  - Ships may pass through each other partially before pushing apart
- [ ] Wrap-around / edge-of-arena behavior
- [ ] Projectile physics (do projectiles inherit ship velocity?)
- [ ] Frame rate and timestep — fixed or variable?

## UQM source files to examine

- `sc2/src/uqm/battle.c` — main battle loop
- `sc2/src/uqm/collide.c` — collision detection
- `sc2/src/uqm/element.c` — "element" system (ships, projectiles, etc. are all elements)
- `sc2/src/uqm/gravity.c` (if exists) — gravity/attractor logic
- `sc2/src/libs/math/` — fixed-point math routines

## Notes

UQM uses fixed-point arithmetic (not floating point) for physics. This is likely a source of some of the "feel" — integer truncation artifacts in the physics math. We'll need to decide whether to faithfully emulate fixed-point or use float and manually reproduce the same behavior.
