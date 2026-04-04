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
- projectile-vs-ship handling
- controller effect application
- ion-trail updates
- cosmetic explosion advancement

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
