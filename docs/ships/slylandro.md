# Slylandro Probe

Reference: `uqm-0.8.0/src/uqm/ships/slylandr/slylandr.c`

## Implemented

- Constant-thrust movement with instant reverse-on-thrust input.
- Close-range lightning attack rendered as chained laser flashes.
- Crew immunity via the generic `isCrewImmune(...)` controller hook.

## Deferred

- Junk harvesting special is intentionally inactive for now.

Why:
- UQM harvests neutral space junk objects.
- The current melee battle sim does not yet include those arena objects.

Revisit when neutral asteroid/junk entities are added to battle state.
