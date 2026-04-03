# Battle Refactor Plan

Goal: reduce the amount of ship- and weapon-specific context living inside `client/src/components/Battle.tsx` so future weapon work is smaller, safer, and easier to implement faithfully.

## Principles

- `Battle.tsx` should focus on React/UI orchestration plus top-level battle-loop coordination.
- Ship controllers should own ship-specific weapon behavior wherever practical.
- Shared simulation and rendering code should live in engine modules, not the React component.
- Each chunk should be small enough to verify with a normal client build and a focused code review.

## Completed

- [x] Commit `Implement VUX laser and limpet behavior`

## Planned Chunks

### 1. Extract shared battle types and low-risk helpers

Status: Completed

Scope:
- Move battle-only interfaces out of `Battle.tsx` into `client/src/engine/battle/`.
- Move pure helpers that do not depend on React state into shared battle modules.
- Keep behavior unchanged.

Target files:
- `client/src/engine/battle/types.ts`
- `client/src/engine/battle/helpers.ts`
- `client/src/components/Battle.tsx`

Progress notes:
- Created plan file and locked VUX work into its own commit.
- Moved battle-only interfaces into `client/src/engine/battle/types.ts`.
- Moved checksum, gravity, collision, zoom, and limpet penalty helpers into `client/src/engine/battle/helpers.ts`.
- Updated `Battle.tsx` and `App.tsx` imports to use the extracted modules.

### 2. Extract render/effect helpers

Status: Completed

Scope:
- Move canvas-only helpers such as laser/effect rendering helpers out of `Battle.tsx`.
- Keep all draw ordering intact.
- Prepare for ship or weapon specific render effects without growing the component body.

Target files:
- `client/src/engine/battle/renderEffects.ts`
- `client/src/components/Battle.tsx`

Progress notes:
- Moved laser flash, ion trail, and explosion rendering into `client/src/engine/battle/renderEffects.ts`.
- Kept draw ordering in `Battle.tsx` while reducing the size of the render body.

### 3. Extract simulation pipeline pieces

Status: In progress

Scope:
- Move generic frame simulation helpers into engine modules.
- Leave React lifecycle, input collection, and status panel integration in `Battle.tsx`.
- Keep ship controller hooks as the extensibility surface.

Target files:
- `client/src/engine/battle/simulateFrame.ts`
- `client/src/engine/battle/projectiles.ts`
- `client/src/engine/battle/collision.ts`
- `client/src/components/Battle.tsx`

Progress notes:
- Ready to start now that shared types/helpers and render effects live in `client/src/engine/battle/`.
- Extracted ship-vs-ship collision, ship-vs-planet collision, explosion advancement, and ion-trail updates into shared battle modules.
- The central missile update loop still lives in `Battle.tsx`; that remains the next high-value extraction target.

### 4. Expand controller/battle object interfaces for future weapons

Status: Pending

Scope:
- Add richer effect/state hooks only after shared battle code is extracted.
- Prefer small interface additions over putting more weapon branches into `Battle.tsx`.
- Use one ship migration as the proving ground before broad adoption.

Target files:
- `client/src/engine/ships/types.ts`
- `client/src/engine/ships/*.ts`
- `client/src/engine/battle/*.ts`

Progress notes:
- Not started yet.

## Working Rules For Future Weapon Tasks

- Start from `CLAUDE.md`, ship docs in `docs/ships/`, and the matching UQM source file before changing weapon logic.
- Preserve weapon identity from spawn to collision to rendering to HUD.
- When a new weapon needs special behavior, first ask whether it belongs in ship controller hooks or shared battle modules instead of `Battle.tsx`.
- Update this file after each refactor chunk and commit the plan changes alongside the code they describe.
