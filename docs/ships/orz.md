# Orz Nemesis

Source reference:
- `uqm-0.8.0/src/uqm/ships/orz/orz.c`
- `uqm-0.8.0/src/uqm/ships/orz/orz.h`

Implemented behavior notes:
- Primary weapon is the howitzer cannon fired from a separately rendered rotating turret. Holding special with left or right rotates the turret; normal hull turning is suppressed while that turret-control combo is active.
- The howitzer uses the Orz-specific projectile / shockwave art and explicitly plays the medium impact boom (`boom23`) on collision while keeping the custom impact animation.
- Secondary is the marine launch combo: marines are launched only while primary and special are held together, matching the original Orz control quirk rather than a plain special tap.
- Marines now use their own flight steering, only emit ion dots while maneuvering or accelerating, board enemy ships into deterministic status-panel slots, flash to the attack frame while biting, and return crew to the Nemesis if they make it home.
- The boarded-status art uses the same end result as UQM: slot placement is tracked separately, steady-state boarded marines display frame 30, and successful damage ticks flash frame 31 before returning to frame 30.
