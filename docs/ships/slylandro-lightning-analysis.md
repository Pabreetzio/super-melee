# Slylandro Lightning: UQM Vs Current Port

This note is meant to stop the current tuning loop and capture what the
original UQM code is actually doing, what the current TypeScript port is doing,
and where the two differ structurally.

Primary references:

- `uqm-0.8.0/src/uqm/ships/slylandr/slylandr.c`
- `uqm-0.8.0/src/uqm/weapon.c`
- `uqm-0.8.0/src/uqm/ship.c`
- `uqm-0.8.0/src/uqm/process.c`
- `client/src/engine/ships/slylandro.ts`
- `client/src/components/Battle.tsx`

## Original UQM Lightning

### 1. Fire entry point

The player does not directly spawn a prebuilt multi-bolt effect.

- `ship_postprocess()` in `src/uqm/ship.c` handles weapon fire.
- When `weapon_counter == 0` and the weapon button is pressed,
  `init_weapon_func` is called. For Slylandro, that is
  `initialize_lightning()` in `src/uqm/ships/slylandr/slylandr.c`.
- After the initial call returns, `ship_postprocess()` sets
  `weapon_counter = WEAPON_WAIT` where `WEAPON_WAIT = 17`.

Important implication:

- The initial root lightning segment is spawned before the weapon counter is
  set back to `17`.

### 2. One lightning segment is a real weapon element

`initialize_lightning()` does not create a cosmetic-only bolt. It first calls
`initialize_laser()` in `src/uqm/weapon.c`.

That generic laser element has these important properties:

- `life_span = 1`
- `hit_points = 1`
- `mass_points = 1`
- primitive type `LINE_PRIM`
- `blast_offset = 1`
- generic collision callback `weapon_collision_cb`

So each lightning segment is a real 1-damage line weapon element, not just a
rendered effect.

### 3. Segment direction is target-biased but randomized

Inside `initialize_lightning()`:

- the code starts from the current element position
- calls `TrackShip()` to turn one facing step toward the nearest target
- then adds extra random angle offset based on how far off-target that step is

The random angle logic is not "draw one bolt toward the enemy with noise."
It is:

- steer one step toward target
- then perturb that angle again
- then use that perturbed angle for this segment

This means each segment has its own heading and that heading is only loosely
target-seeking.

### 4. `LASER_LENGTH` is per-segment length, not total attack range

`slylandr.c` defines:

- `LASER_LENGTH 32`

But the code uses it like this:

- `DISPLAY_TO_WORLD((HIWORD(rand_val) & (LASER_LENGTH - 1)) + 4)`

So each segment length is random in the range `4..35` display pixels.

Important implication:

- `LASER_LENGTH` is not the total length of the full lightning attack.
- The full visible weapon can be much longer than 32 display pixels because it
  is made from many segments chained together.

### 5. The weapon is recursive

Every lightning segment can spawn another lightning segment in its
`lightning_postprocess()` callback.

Rules:

- if `turn_wait > 0`
- and the segment has not collided
- spawn one child via `initialize_lightning()`

For child segments:

- the child copies the parent's color
- the child calls `TrackShip()` again
- the child gets `turn_wait = parent.turn_wait - 1`

This is the core of the original look:

- the weapon is not three independent branches
- it is a recursive chain of individually steered line elements

### 6. Root chain depth comes from `weapon_counter`

For player-fired roots, `initialize_lightning()` computes root `turn_wait`
from the ship's current `weapon_counter`, mirrored around the midpoint of the
17-frame weapon cycle.

Practical sequence:

- initial root at fire time: `turn_wait = 0`
- later roots while `weapon_counter` counts down: `1, 2, 3, 4, 5, 6, 7, 8, 8,
  7, 6, 5, 4, 3, 2, 1`

That means the root chain lengths are not constant. Over the weapon cycle the
weapon emits:

- a short root when the shot begins
- longer recursive chains near the middle
- then shorter recursive chains again near the end

### 7. New roots are emitted across the weapon cycle

`slylandro_postprocess()` in `slylandr.c` does this:

- while `weapon_counter > 0`
- and `weapon_counter < WEAPON_WAIT`
- call `initialize_lightning()` again and `PutElement()` the new root

So one button press produces:

- the initial root from `ship_postprocess()`
- plus additional root chains on later frames while the counter runs down

This is not one fixed burst. It is a sustained stream of root chains whose
depth changes over the cycle.

### 8. Recursive children appear in the same frame

`PostProcessQueue()` in `src/uqm/process.c` is important here. Newly added
elements are preprocessed and collision-tested in the same queue pass.

That means a segment can:

- postprocess
- spawn a child
- and that child can still be processed and rendered in the same frame

Important implication:

- the dense crackling look comes from many line elements existing together in
  one frame, not from a single polyline approximation

### 9. Collisions shorten the remaining attack

`lightning_collision()` does more than generic weapon damage.

Before calling `weapon_collision()` it:

- folds the ship's `weapon_counter` around the midpoint if needed
- subtracts the hit segment's `turn_wait`
- sets that segment's `turn_wait = 0`

Effects:

- a hit on a segment prevents that segment from spawning more children
- a hit can shorten the remaining weapon cycle on the owning ship

This is why the original weapon's damage feel is emergent:

- a branch that hits early collapses sooner
- a branch that misses can continue to grow
- later roots depend on how earlier segments collided

### 10. Generic weapon collision still applies

Because lightning segments are normal weapon elements:

- they deal 1 damage through `weapon_collision()`
- they spawn the normal blast effect on impact
- they can collide with more than just the enemy ship

In other words, original lightning is not "ship-only contact damage."
It participates in the normal battle collision system.

## Current Port

### 1. Fire entry point

The current implementation is in `client/src/engine/ships/slylandro.ts`.

`updateSlylandroShip()` currently:

- spends 2 energy
- sets `weaponWait = 17`
- emits `{ type: 'point_defense' }`
- then continues emitting the same immediate spawn every frame while
  `weaponWait > 0`

This is an immediate-effect model, not a spawned lightning-element model.

### 2. Rendering model

Current lightning visuals are produced entirely inside `applySpawn()`.

It:

- computes the wrapped delta to the enemy ship
- computes a base angle toward that ship
- chooses three branch definitions
- builds each branch with `buildLightningBranch()`
- pushes the resulting `LaserFlash[]` into battle state

The three current branches are:

- long branch
- mid branch
- short branch

Each branch gets:

- one coarse angular bias
- one fixed length cap
- one jagged polyline built from noise

### 3. Damage model

Current damage is driven by `lightningDamageReachForWait()`.

Right now the port only allows damage on three fixed `weaponWait` values:

- `17`
- `11`
- `5`

On those frames:

- the branch associated with that wait value is chosen
- `lightningImpactPoint()` checks whether the enemy ship overlaps any segment
  in that one branch
- if so, 1 damage is applied and one generic `blast` is spawned

Important implication:

- current hit timing is scheduled in advance
- collisions do not shorten the remaining weapon cycle

### 4. Battle-system integration

The current port does not create dedicated lightning battle objects.

Instead:

- `Battle.tsx` passes `addLaser()` and `addExplosion()` into `applySpawn()`
- Slylandro uses those callbacks immediately
- no lightning state survives in `BattleState`

This means current lightning has no per-segment lifecycle outside the one
`applySpawn()` call for that frame.

### 5. Current collision scope

Current Slylandro lightning only checks the enemy ship.

It does not currently:

- collide with missiles
- collide with the planet
- collide with other temporary battle objects through the generic weapon path

## Key Differences

### 1. Original weapon is recursive; current port is prebuilt

Original:

- one segment can spawn a child
- that child can steer again
- that child can collide independently

Current:

- three whole branches are synthesized up front every frame

This is the biggest structural mismatch.

### 2. Original range is chain length; current range is branch length

Original:

- `LASER_LENGTH` is the length of one segment
- a full root chain can be many segments long

Current:

- branch length is a single tuned constant

This is why "just make it longer" has kept feeling imprecise. We have been
tuning one branch length where the original weapon grows by segment count.

### 3. Original steering happens per segment

Original:

- every child segment calls `TrackShip()` again
- every child gets a fresh random deviation

Current:

- branch angle is decided once up front
- later segments only wiggle around that branch

So our branches can look jagged, but they do not reproduce the original's
segment-by-segment retargeting.

### 4. Original damage count is collision-driven

Original:

- there is no hard-coded "three damage moments"
- hit count depends on which segments collide, in what order, and how that
  collision truncates `weapon_counter`

Current:

- damage windows are explicitly scheduled at waits `17`, `11`, and `5`

This is a major behavioral simplification.

### 5. Original hits can shorten later lightning

Original:

- collisions mutate `weapon_counter`
- hits can prevent later children or later roots from happening

Current:

- later branches always keep their scheduled opportunity unless the shot timer
  naturally expires

### 6. Original collision scope is broader

Original:

- lightning is a real weapon element, so it participates in generic battle
  collisions

Current:

- only the enemy ship is considered

### 7. Original color choice is random per root chain

Original:

- root picks one of four colors from the random value
- descendants inherit that color

Current:

- color comes from a deterministic cycle stored on the ship

This is lower importance than the structural differences above, but it is still
not identical.

## What This Means For The Next Attempt

The current port can be tuned, but it is not built on the same model as the
original weapon.

If we want to get materially closer, the next implementation probably needs one
of these directions:

1. Add transient lightning segment state to battle, so each segment can spawn a
   child, steer, collide, and truncate the shot individually.
2. Keep lightning as an immediate effect, but build it recursively
   segment-by-segment inside one frame, including per-segment hit handling and
   `weaponWait` truncation rules.

Without segment-by-segment recursion and collision-driven shortening, we will
keep approximating surface symptoms instead of matching the original weapon's
actual mechanics.

## Review Questions

Questions worth deciding before the next implementation pass:

1. Do we want to keep lightning out of `BattleState`, or is this one of the
   cases where a tiny dedicated lightning-segment state would actually make the
   port cleaner and more faithful?
2. Do we care about original lightning interacting with missiles and the planet
   in this pass, or should we focus first on ship hits and visual shape?
3. Do we want the next port to reproduce UQM's exact random-call structure as
   closely as practical for lockstep determinism, or just reproduce the same
   observable behavior with a deterministic seeded approximation?
