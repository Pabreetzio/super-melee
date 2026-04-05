# Thraddash Torch

Source reference:
- `uqm-0.8.0/src/uqm/ships/thradd/thradd.c`
- `uqm-0.8.0/src/uqm/ships/thradd/thradd.h`

Implemented behavior notes:
- Primary weapon is the ion blaster horn shot: 1 damage, 2 hit points, 15 frame life, and the original forward spawn offset.
- Special is the afterburner: it spends 1 battery per frame, replaces normal thrust with the Torch's boosted burn, and drops a stationary damaging napalm flame each frame of use.
- Napalm uses the original 48 frame life and 6-step decay timing, keeping the largest flame frame out first and then shrinking through the extracted animation frames.
- Base ship stats now match the UQM constants: 8 crew, 24 battery, thrust 28, thrust increment 7, energy wait 6, turn wait 1, mass 7.
