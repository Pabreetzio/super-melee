# Utwig Jugger

Reference: `uqm-0.8.0/src/uqm/ships/utwig/utwig.c`

## Implemented

- Six-projectile lance spread using extracted `lance-*` projectile sprites.
- Shield hold behavior with repeated battery drain while active.
- Blocked hits convert into battery gain through the generic `absorbHit(...)` hook.
- Shield interception now covers projectile hits, `MissileEffect.damageEnemy`,
  and direct immediate-weapon damage paths that use controller `applySpawn(...)`.
- Shield visual now uses a UQM-style blinking orange/red silhouette overlay on
  the Jugger sprite while the shield is active.
