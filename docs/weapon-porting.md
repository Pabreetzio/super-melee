# Weapon Porting Guide

Use this guide when implementing or fixing a ship weapon.

## Primary Rule

Do not guess. Start from the original UQM behavior and the repo docs, then port the behavior into the current architecture.

## Read Order

For a new weapon task, inspect these in order:

1. `CLAUDE.md`
2. `docs/ships/<ship>.md` if it exists
3. `docs/physics.md` and `docs/rendering.md` if the weapon interacts with movement or visuals
4. `uqm-0.8.0/src/uqm/ships/<ship>/<ship>.c`
5. existing ship controller in `client/src/engine/ships/<ship>.ts`
6. shared battle modules in `client/src/engine/battle/`

Also check assets and sound paths in:
- `docs/assets.md`
- `assets/ships/<ship>/`
- `assets/sounds/ships/<ship>/`

## Weapon Porting Checklist

Every weapon should be checked across all of these areas:

### 1. Spawn

Questions:
- How is the weapon created in UQM?
- Is it a missile, fighter, cloud, laser, or immediate effect?
- Does it spawn from the ship center, nose, rear, or a hotspot offset?
- Does it inherit velocity?
- Does it consume crew, energy, or both?
- Is fire edge-triggered or hold-triggered?

Usually implemented in:
- `update(...)`
- `applySpawn(...)`

### 2. Identity

Questions:
- What fields must survive from spawn into live battle state?
- Does the projectile need a specific `weaponType`, flag, or state marker?
- Will the engine still know what this object is when it collides later?

Important:
- Do not lose weapon identity after spawn.
- If the projectile becomes generic too early, later behavior will silently degrade.

### 3. Movement / Lifetime

Questions:
- Does it track?
- Does it accelerate?
- Does it spin, bounce, orbit, or return?
- Does it change behavior over time?
- Does it expire by life, hits, or state transition?

Usually implemented in:
- `processMissile(...)`
- shared code in `client/src/engine/battle/projectiles.ts` if generic

### 4. Collision / Hit Effects

Questions:
- What happens on ship hit?
- What happens on planet hit?
- Does it do damage, attach, split, spawn effects, drain energy, or change control?
- Is there a special sound on hit?
- Is there a visual overlay or persistent state change after impact?

Usually implemented in:
- `onMissileHit(...)`
- shared collision helpers only if the logic is generic

### 5. Rendering

Questions:
- Is there a projectile sprite?
- Does the weapon use laser flashes?
- Does the hit create a special effect?
- Does the status panel need to reflect the effect?

Usually implemented in:
- `drawMissile(...)`
- `applySpawn(...)`
- `client/src/engine/battle/renderEffects.ts`
- `client/src/components/StatusPanel.tsx`

### 6. Audio

Questions:
- Is there a primary, secondary, hit, dock, bite, or special voice cue?
- Should the sound happen on spawn, during projectile life, or on hit?

Usually implemented in:
- spawn audio dispatch in `Battle.tsx`
- effect audio through shared effect sound hooks
- `client/src/engine/audio.ts`

### 7. HUD / Status

Questions:
- Does the weapon or its consequence show up on the status panel?
- Does the ship need persistent status state such as attached limpets?

Usually implemented in:
- ship state additions
- `StatusPanel.tsx`

## Best-Fit File Targets

Use these heuristics:

- Ship-specific fire rules: `client/src/engine/ships/<ship>.ts`
- Ship-specific projectile behavior: `client/src/engine/ships/<ship>.ts`
- Generic projectile stepping/collision plumbing: `client/src/engine/battle/projectiles.ts`
- Shared collision behavior: `client/src/engine/battle/collision.ts`
- Shared rendering effects: `client/src/engine/battle/renderEffects.ts`
- React/UI orchestration only: `client/src/components/Battle.tsx`

## Common Pitfalls

- Forgetting to carry projectile identity from spawn into live missile state
- Implementing a hit effect but not the status/HUD consequence
- Using the wrong asset variant or missing sound hookup
- Treating all impact sounds as ship-specific; some weapons reuse generic battle SFX such as asteroid-hit `boom1.wav`
- Letting `skipBlast` suppress a weapon's custom impact animation instead of only suppressing the stock `blast`
- Adding ship-specific branches to `Battle.tsx` when a controller hook would work
- Porting “what it looks like” but not “how it behaves over time”
- Porting damage but missing secondary consequences like slow, attach, drain, or return

## Prompt Template For Future Weapon Tasks

This prompt shape gives the best results:

“Implement `<ship>` `<weapon>` faithfully using the UQM source in the repo and the docs. The current bug is `<what is wrong now>`. Please keep ship-specific behavior out of `Battle.tsx` when possible, and make the smallest shared battle-engine refactor needed if the current architecture cannot express the original behavior cleanly.”

## When To Update Docs

Update docs when:
- the architecture changes
- a new shared hook is introduced
- a recurring weapon pitfall appears
- a ship has unusual behavior worth capturing for future work
