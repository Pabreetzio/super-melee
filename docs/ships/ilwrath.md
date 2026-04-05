# Ilwrath Avenger

Source reference:
- `uqm-0.8.0/src/uqm/ships/ilwrath/ilwrath.c`
- `uqm-0.8.0/src/uqm/ships/ilwrath/ilwrath.h`

Implemented behavior notes:
- Primary weapon is the hellfire spout: short-lived forward flame projectiles using the original 8-frame fire art.
- Secondary is the cloaking device: the Avenger can cloak, becomes visually dimmed, and uncloaks automatically when it attacks.
- Base ship stats now match the UQM constants: 22 crew, 16 battery, thrust 25, thrust increment 5, energy regeneration 4, turn wait 2, mass 7.
- Offline cyborg control now uses cloak to close distance before attacking instead of relying on generic pursuit logic.
