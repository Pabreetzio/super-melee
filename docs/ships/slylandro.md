# Slylandro Probe

Reference: `uqm-0.8.0/src/uqm/ships/slylandr/slylandr.c`

Deep dive: `docs/ships/slylandro-lightning-analysis.md`

## Implemented

- Constant-thrust movement with instant reverse-on-thrust input.
- Lightning primary implemented as a recursive battle-state chain of short
  line segments, with per-segment retargeting, random length/angle selection,
  collision-driven truncation, and interaction with ships, missiles, asteroids,
  and the planet.
- Junk harvesting special against neutral asteroid hazards, restoring the probe
  to full energy when nearby junk is collected.
- Crew immunity via the generic `isCrewImmune(...)` controller hook.
