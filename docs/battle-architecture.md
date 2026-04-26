# Battle Architecture

This document describes the current division of responsibility between the React battle screen, the shared battle engine modules, and the per-ship controllers.

## Goals

- Keep `client/src/components/Battle.tsx` focused on React lifecycle, input wiring, and top-level orchestration.
- Keep ship-specific behavior inside `client/src/engine/ships/*.ts`.
- Keep reusable simulation and rendering logic inside `client/src/engine/battle/`.
- Preserve faithful UQM behavior without re-adding large ship-specific branches to `Battle.tsx`.

## Current Structure

### `client/src/components/Battle.tsx`

Owns:
- React component lifecycle.
- Canvas setup and resize behavior.
- Input buffering and lockstep integration.
- Match initialization and winner carry-over.
- Top-level frame sequencing.
- Top-level draw ordering.
- Audio dispatch tied to spawn requests at the orchestration layer.
- Status panel ref updates.

Should not grow with:
- Ship-specific weapon collision logic.
- Projectile-specific movement logic.
- HUD effect special cases for one ship if a generic hook can express them.

### `client/src/engine/battle/types.ts`

Owns:
- Battle-only state types shared by simulation and rendering code.

Examples:
- `BattleState`
- `BattleExplosion`
- `IonDot`
- `WinnerShipState`

### `client/src/engine/battle/helpers.ts`

Owns:
- Reusable pure helpers for battle simulation and utility logic.

Examples:
- gravity application
- wrap-aware zoom calculation
- checksum generation
- shared angle/collision helpers
- limpet movement penalty helper

### `client/src/engine/battle/renderEffects.ts`

Owns:
- Shared canvas effect rendering that is not tied to React.

Examples:
- laser flash rendering
- ion trail rendering
- explosion rendering

### `client/src/engine/battle/collision.ts`

Owns:
- Generic ship-vs-ship and ship-vs-planet collision handling.

Examples:
- bounce response
- contact damage
- push-apart correction

### `client/src/engine/battle/projectiles.ts`

Owns:
- Shared projectile pipeline.

Examples:
- per-frame projectile stepping
- generic tracking
- generic velocity update
- projectile wrapping
- projectile-vs-planet handling
- projectile-vs-ship handling, including swept collision tests for fast missiles
- controller effect application
- ion-trail updates
- cosmetic explosion advancement

### `client/src/engine/battle/lightning.ts`

Owns:
- transient battle-state lightning segments for weapons that cannot be modeled
  as normal missiles or one-frame immediate effects
- recursive same-frame segment spawning
- lightning-specific collision resolution and shot truncation

Current user:
- Slylandro Probe primary weapon

## Ship Controller Responsibilities

Per-ship controllers in `client/src/engine/ships/*.ts` should own:
- ship thrust/turn/energy behavior
- weapon spawn requests
- weapon-specific missile lifecycle behavior via `processMissile`
- weapon-specific hit behavior via `onMissileHit`
- immediate non-missile effects via `applySpawn`
- ship and projectile rendering via `drawShip` and `drawMissile`

This is the preferred place for:
- fighter AI
- special projectile visuals
- non-standard damage/effect logic
- ship-specific audio cues tied to hit/effect hooks

## Rules For New Weapon Work

When adding a weapon, prefer this order:

1. Put spawn behavior in the ship controller.
2. Put projectile-specific behavior in controller hooks.
3. Put only generic reusable mechanics in `engine/battle/`.
4. Touch `Battle.tsx` only if the orchestration layer truly needs a new phase or generic capability.

Slylandro lightning is the current example of that exception: it now has a
small shared battle phase because the original UQM weapon is a recursive chain
of short-lived line segments, not a missile and not a simple immediate laser.

## Common Extension Points

Use the ship controller hooks before adding special cases:

- `update(...)`
  Use for ship state and spawn requests.

- `processMissile(...)`
  Use for projectile AI, custom steering, weapon timers, and extra side-effects during projectile life.

- `onMissileHit(...)`
  Use for custom hit consequences such as limpets, splinters, or hit-specific sounds.

- `applySpawn(...)`
  Use for immediate weapons or non-missile effects such as instant lasers.
  It may add immediate laser flashes or cosmetic impact explosions.

- `absorbHit(...)`
  Use for shield-like defenses that need to cancel or convert incoming weapon
  damage before crew is removed.

- `isCrewImmune(...)`
  Use for ships that should ignore crew-theft mechanics such as the Syreen song.

## Subsystem Contracts

These are non-obvious coupling points that are not visible from any single file.
Understanding them is required before touching weapon or sound logic.

### applySpawn vs processMissile — timing

`applySpawn` fires **once at spawn time**, while the missile's `life` is at its
initial maximum. `processMissile` fires **every frame after spawn**, decrementing
`life` on each tick.

- Apply one-shot initialization (e.g. stinger spread bias) in `applySpawn`.
- Apply per-frame behavior (steering, speed curves, decay side-effects) in
  `processMissile`.
- Applying bias in `processMissile` instead of `applySpawn` delays the effect
  by one frame and may apply it redundantly — this is a common porting bug.

### Sound dispatch — two separate paths

Sounds can reach the audio system via two independent paths:

1. **`{ type: 'sound' }` spawn** — the controller emits a dedicated spawn
   entry. `Battle.tsx` catches it in the spawn loop (`s.type === 'sound'`) and
   calls `playPrimary` / `playSecondary`. The entry carries no missile state.
2. **`applySpawn` sound callback** — the controller receives a `sound =>`
   callback from `Battle.tsx` and may call it inside `applySpawn`. This is
   intended for sounds tied to the immediate weapon effect.

These paths are independent. A weapon that already plays sound via
`{ type: 'sound' }` must **not** also call the `applySpawn` callback for the
same sound event — both paths are live on the same frame and the sound will
play twice or conflict. Before adding or modifying sound dispatch for any
weapon, trace which path(s) are already active for that weapon's spawn entries.

Missiles that move via the `bs.missiles` array are **silent by default** —
they do not automatically play sound when spawned. Sound must be explicitly
requested via one of the two paths above.

### skipVelocityUpdate — suppressing the generic velocity step

`processMissile` returns a `MissileEffect`. If the effect includes
`skipVelocityUpdate: true`, the shared projectile pipeline in
`engine/battle/projectiles.ts` skips the generic `m.speed + m.accel` →
`setVelocityVector` step for that missile on that frame.

Use this when the controller has already set velocity directly
(`setVelocityComponents` / `setVelocityVector`) and does not want the generic
step to overwrite it. Not returning it (or returning `{}`) lets the generic
step run. `skipDefaultTracking: true` is a parallel flag for the generic
tracking rotation step.

### absorbHit / isCrewImmune — generic defensive hooks

Some ship defenses need to affect damage before it becomes crew loss:

- `absorbHit(...)` lets the target ship intercept incoming weapon damage from
  both projectile collisions and immediate-effect weapon paths.
- `isCrewImmune(...)` lets the target opt out of crew-steal mechanics without
  reintroducing per-ship checks in battle orchestration.

Current users:

- `utwig.absorbHit(...)` converts blocked weapon hits into battery gain.
- `slylandro.isCrewImmune(...)` prevents Syreen crew theft.
- the fallback registry marks `samatra` as crew-immune.

When porting or fixing a weapon, check whether its damage path goes through one
of these:

1. projectile collision in `engine/battle/projectiles.ts`
2. `MissileEffect.damageEnemy`
3. direct `enemyShip.crew -= ...` logic inside `applySpawn(...)`

If a new weapon bypasses all three, defensive ships will silently stop working.

## Known Caveats

- Neutral asteroids now live in shared battle state and are updated by
  `engine/battle/asteroids.ts`. Keep ship-specific interactions with them in
  controller hooks such as `interactWithEnvironment(...)` rather than adding
  ship branches to `Battle.tsx`.

## Smells To Avoid

These are signs the design is slipping:

- Adding `if (shipType === ...)` branches to `Battle.tsx`
- Adding one-off booleans to shared state when a controller hook can express the behavior
- Mixing React view concerns with simulation code
- Repeating projectile movement/collision code inside ship files instead of using shared engine phases
- Losing weapon identity between spawn, projectile state, collision, and HUD

## Practical Checklist Before Editing `Battle.tsx`

Ask these first:

1. Can this live in a ship controller hook?
2. Can this be expressed as a new field on a shared effect type?
3. Can this be extracted into `client/src/engine/battle/` as generic logic?
4. Is this really orchestration/UI work, or is it weapon logic in disguise?

If the answer to 1–3 is yes, prefer that over editing `Battle.tsx`.
