# Slylandro Probe

Reference: `uqm-0.8.0/src/uqm/ships/slylandr/slylandr.c`

## Implemented

- Constant-thrust movement with instant reverse-on-thrust input.
- Close-range lightning attack rendered as chained laser flashes.
- Junk harvesting special against neutral asteroid hazards, restoring the probe
  to full energy when nearby junk is collected.
- Crew immunity via the generic `isCrewImmune(...)` controller hook.
