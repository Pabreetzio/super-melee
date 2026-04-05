# Battle Spawn And Transition Notes

Source files:
- `uqm-0.8.0/src/uqm/ship.c`
- `uqm-0.8.0/src/uqm/gravity.c`
- `uqm-0.8.0/src/uqm/tactrans.c`
- `uqm-0.8.0/src/uqm/ships/vux/vux.c`

## Ordinary ship spawn

Super Melee ships do not start at fixed mirrored positions around the planet.

The default rule in `spawn_ship()` is:
- pick a random facing
- pick a random arena position aligned to display-pixel boundaries
- reroll while `CalculateGravity()` says the ship is inside the gravity well
- reroll while `TimeSpaceMatterConflict()` says the ship overlaps another collidable object or ship in transition

Implications:
- spawn distance is genuinely random
- ships can begin quite close together as long as they are not overlapping
- memorable “spawned right on top of me” openings are real, not just confirmation bias

## VUX exception

VUX does not use the ordinary spawn point when its `APPEARING` preprocess runs.

`vux_preprocess()`:
- picks a random point inside a rectangle centered on the enemy ship
- rectangle width/height are based on laser range plus an extra warp offset
- rerolls for gravity/conflict just like normal spawn
- turns the VUX to face the opponent

So VUX aggressive entry is a true ship-specific exception, not just luck.

## Warp-in visual

The entry effect is not a separate bitmap asset.

`ship_transition()` creates temporary copies of the ship image:
- same frame/outline as the ship itself
- drawn as `STAMPFILL_PRIM`
- tinted through the orange-to-red ion color table from `cycle_ion_trail()`
- spawned repeatedly along the ship's facing vector to form the warp trail

That is why the effect looks like the exact ship silhouette in orange/red.

## Between-round pause

After a ship dies:
- the dead ship finishes exploding
- `cleanup_dead_ship()` starts the victory ditty and keeps a placeholder element alive
- `new_ship()` waits until `readyForBattleEnd()` says the ditty is done
- only then does the next ship get chosen and spawned

`MIN_DITTY_FRAME_COUNT` is 72 frames at 24 FPS, so the post-battle pause is about 3 seconds.

During that pause, based on the source, the arena simulation is still running. In practice this means momentum/gravity/planet crashes can still matter while waiting for the next ship.
