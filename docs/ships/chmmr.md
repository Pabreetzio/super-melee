# Chmmr Avatar

Source reference:
- `uqm-0.8.0/src/uqm/ships/chmmr/chmmr.c`
- `uqm-0.8.0/src/uqm/ships/chmmr/chmmr.h`

Implemented behavior notes:
- Primary weapon is the megawatt laser with the original 4-step color cycle and 2-point beam damage.
- Secondary is the tractor beam: it drains 1 battery per frame of use and pulls the enemy toward a point ahead of the Avatar instead of acting like a projectile.
- The Avatar now spawns its 3 orbiting zap-sats, animates them as independent battle entities, and gives them autonomous point-defense fire against nearby missiles and ships.
- Base ship stats now match the UQM constants: 42 crew, 42 battery, thrust 35, thrust increment 7, energy wait 1, thrust wait 5, turn wait 3, mass 10.
- Offline cyborg control now uses the Avatar’s beam-and-tractor rhythm instead of the generic forward-gun AI.
