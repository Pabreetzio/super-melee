# Shofixti Scout

Source reference:
- `uqm-0.8.0/src/uqm/ships/shofixti/shofixti.c`
- `uqm-0.8.0/src/uqm/ships/shofixti/shofixti.h`

Implemented behavior notes:
- Primary weapon is the dart gun: a low-damage forward shot with a 3-frame refire delay.
- Secondary is the Glory Device: a short self-destruct windup followed by a radial blast that heavily damages nearby ships and clears missiles in the blast radius.
- The captain/status display now uses the original arming portrait frames: safe green (`scout-cap-012`), then yellow, then red before detonation, and the battle explosion uses the extracted `destruct-*` animation frames instead of a generic blast placeholder.
- Base ship stats now match the UQM constants: 6 crew, 4 battery, thrust 35, thrust increment 5, energy regeneration 1, turn wait 1, mass 1.
- Offline cyborg logic prefers dart-gun pursuit, but will trigger the Glory Device when cornered or when a close trade is favorable.
