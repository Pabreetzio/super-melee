# Syreen Penetrator

Reference: `uqm-0.8.0/src/uqm/ships/syreen/syreen.c`

## Implemented

- Forward dagger missile with extracted `dagger-*` projectile sprites.
- Syreen song special now ejects visible abandoner crew pods that drift toward
  the Penetrator and only restore crew when actually collected.
- Stolen crew restores the Syreen ship up to the UQM higher max-crew cap of 42
  while still starting each life at 12 crew.
- Crew theft respects the generic `isCrewImmune(...)` hook.
