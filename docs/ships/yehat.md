# Yehat Terminator

Source reference:
- `uqm-0.8.0/src/uqm/ships/yehat/yehat.c`
- `uqm-0.8.0/src/uqm/ships/yehat/yehat.h`

Implemented behavior notes:
- Primary weapon is the twin pulse cannon: two forward shots launched from offset gun positions each time the Terminator fires.
- Secondary is the force shield: a short-lived defensive shell that consumes 3 battery, blocks incoming collisions and projectiles during its active window, and is rendered as a bright shield ring around the ship.
- Base ship stats now match the UQM constants: 20 crew, 10 battery, thrust 30, thrust increment 6, energy regeneration 2, thrust wait 2, turn wait 2, mass 3.
- Offline cyborg logic uses the shield reactively against close threats while keeping the bow lined up for cannon passes.
