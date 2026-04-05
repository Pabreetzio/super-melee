# Melnorme Trader

Source reference:
- `uqm-0.8.0/src/uqm/ships/melnorme/melnorme.c`
- `uqm-0.8.0/src/uqm/ships/melnorme/melnorme.h`

Implemented behavior notes:
- Primary weapon is the chargeable blaster pulse: hold to pump it up through larger damage tiers, release to fire the shot.
- Secondary weapon is the confusion pulse: a zero-damage disabling projectile that forces the victim into confused steering for a long duration.
- Trader base stats now match the UQM constants: 20 crew, 42 battery, thrust 36, thrust increment 6, energy wait 4, thrust wait 4, turn wait 4, mass 7.
- Offline cyborg behavior now uses the confusion pulse when it has the battery for it and otherwise tries to pressure with the charge shot.
