# Zoq-Fot-Pik Stinger

Source reference:
- `uqm-0.8.0/src/uqm/ships/zoqfot/zoqfot.c`
- `uqm-0.8.0/src/uqm/ships/zoqfot/zoqfot.h`

Implemented behavior notes:
- Primary weapon is the spit pellet: 1 damage, 10 frame life, animated through the original spit frames while it sheds speed over flight.
- Special is the tongue strike: it costs 75% battery, shows the extracted proboscis overlay for the original cooldown window, and deals a heavy close-range frontal hit on activation.
- Base ship stats now match the UQM constants: 10 crew, 10 battery, thrust 40, thrust increment 10, energy wait 4, turn wait 1, mass 5.
- Offline cyborg behavior now prefers the tongue at knife range and otherwise uses the spit while closing.
