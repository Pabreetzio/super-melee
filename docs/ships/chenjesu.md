# Chenjesu Broodhome

Source reference:
- `uqm-0.8.0/src/uqm/ships/chenjesu/chenjesu.c`
- `uqm-0.8.0/src/uqm/ships/chenjesu/chenjesu.h`

Implemented behavior notes:
- Primary weapon is the photon crystal: one crystal is launched on fire press, it persists while fire is held, and on release or impact it bursts into 8 shrapnel fragments.
- Crystal impacts use the Chenjesu sparkle animation and the dedicated `shrapnel.wav` effect instead of the generic blast.
- DOGI launch spends the full battery, spawns from the rear, seeks targets autonomously, survives ship contact, and drains up to 10 battery per bite while playing its bark/die sounds.
- DOGI sprites stay on their single live frame while active, then run the six-frame death animation after expiration or destruction.
- Broodhome base stats now match the UQM constants: 36 crew, 30 battery, thrust 27, thrust increment 3, thrust wait 4, turn wait 6, mass 10.
- Offline cyborg logic now handles crystal hold/release timing and DOGI deployment instead of relying on the generic forward-gun AI.
