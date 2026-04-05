# Druuge Mauler

Source reference:
- `uqm-0.8.0/src/uqm/ships/druuge/druuge.c`
- `uqm-0.8.0/src/uqm/ships/druuge/druuge.h`

Implemented behavior notes:
- Primary weapon is the mass-driver cannon: 6 damage, 4 hit points, 20 frame life, strong launch recoil on the Mauler, and impact knockback on struck ships.
- Secondary is the furnace: it burns 1 crew into 16 battery, respects the UQM restrictions, and uses the original secondary sound.
- Base ship stats now match the UQM constants: 14 crew, 32 battery, thrust 20, thrust increment 2, energy wait 50, thrust wait 1, turn wait 4, mass 5.
- Offline cyborg behavior now knows to fire aggressively at range and convert crew into energy when it wants another cannon shot but is running dry.
