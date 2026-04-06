# Umgah Drone

Source references:
- `uqm-0.8.0/src/uqm/ships/umgah/umgah.c`
- `uqm-content/base/ships/umgah/cone-*.ani`

Key behaviors to preserve:
- Primary is the antimatter cone: it costs no battery, fires every frame while held, uses the cone sprite anchored on the ship, deals 1 crew per tick, and can keep chewing through targets/projectiles without despawning on contact.
- Even though the cone is free, firing it still interrupts the Umgah's unusual battery recovery window, matching the original `DeltaEnergy(..., 0)` side-effect pattern.
- Secondary is the retropropulsion zip: each successful burst spends 1 battery, instantly throws the ship `DISPLAY_TO_WORLD(40)` backward relative to its facing, and does not behave like normal sustained inertial thrust.
- Battery recovery is all-or-nothing: no slow passive regeneration. After any primary or special use, the Drone must wait the full `ENERGY_WAIT = 150` window uninterrupted before the battery refills to max in one step.
- Base stats from UQM: 10 crew, 30 battery, thrust 18, thrust increment 6, energy wait 150, thrust wait 3, turn wait 4, mass 1.
