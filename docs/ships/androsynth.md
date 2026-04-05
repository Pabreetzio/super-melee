# Androsynth Guardian

Source reference:
- `uqm-0.8.0/src/uqm/ships/androsyn/androsyn.c`
- `uqm-0.8.0/src/uqm/ships/androsyn/androsyn.h`

Implemented behavior notes:
- Primary weapon is the acid bubble battery: 3 energy per shot, 2 damage, 3 hit points, 200 frame life, and retargeting every 2 frames with the same loose randomized steering style UQM uses.
- Secondary weapon is blazer form: immediate transformation for 2 energy, fixed 60 world-unit thrust, 1-frame turning, collision mass 1, and 3 collision damage against enemy ships.
- While in blazer form, the Guardian no longer behaves like a thrusting ship. It moves as a constant-speed contact weapon and drains 1 energy every 8 frames until the battery empties.
- Guardian base stats now match the UQM constants: 20 crew, 24 battery, thrust 24, thrust increment 3, turn wait 4, mass 6.
- Offline cyborg control prefers bubbles at range and switches to blazer as a dodge / close-range ram tool, following the original ship’s intended role more closely than the generic AI.
