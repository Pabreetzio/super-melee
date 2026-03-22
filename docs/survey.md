# UQM 0.8.0 Source Survey

Broad structural survey of `uqm-0.8.0/` to orient the project before deep dives.
All paths are relative to `uqm-0.8.0/` — see CLAUDE.md for how to obtain the source.

---

## Frame Rate & Timing

**Source:** `src/libs/timelib.h`, `src/uqm/battle.h`

```c
#define ONE_SECOND 840   // LCM of all game frame rates
#define BATTLE_FRAME_RATE (ONE_SECOND / 24)  // = 35 ticks per "second"
```

**Battle runs at 24 FPS.** This is confirmed. `ONE_SECOND = 840` is the internal clock unit — an LCM chosen so all subsystems (battle 24fps, landers 35fps, interplanetary 30fps, etc.) divide evenly into it.

**Implication for our port:** Fixed timestep at 24 ticks/second for the physics sim. Rendering can run at 60fps with interpolation.

---

## Physics: Key Files

| File | Role |
|---|---|
| `src/uqm/gravity.c` | `CalculateGravity()` — gravity well effects on all elements |
| `src/uqm/collide.c` | `collide()` — collision detection and response |
| `src/uqm/velocity.c` | Velocity math — likely where fixed-point arithmetic lives |
| `src/uqm/velocity.h` | Velocity types and macros |
| `src/uqm/element.h` | Base type for all game objects (ships, projectiles, explosions) |
| `src/uqm/weapon.c` | Projectile behavior |
| `src/uqm/ship.c` | Ship movement and thrust |

**Math library:** `src/libs/mathlib.h` provides `square_root(DWORD)` and integer math. No float-based physics — everything is integer/fixed-point. The `src/libs/math/` folder contains `random.c`, `sqrt.c`, and related utilities.

**To do:** Deep dive into `velocity.c` and `velocity.h` to understand the fixed-point representation, then `collide.c` for the collision quirks. See `docs/physics.md`.

---

## The Element System

**Source:** `src/uqm/element.h`

Everything in the battle arena — ships, projectiles, explosions — is an **ELEMENT**. Key flags include `PLAYER_SHIP` and animation state. The element list (`displist.c`) manages all active elements.

`NUM_EXPLOSION_FRAMES = 12` — explosion animations are 12 frames.

This is the core abstraction we'll replicate. Our TypeScript equivalent will be an `Element` base class/interface.

---

## Ship Implementations

**Source:** `src/uqm/ships/`

All 28 ships each have their own directory with:
- `{race}.c` — ship implementation (thrust, weapons, special ability)
- `{race}.h` — header
- `icode.h` or `resinst.h` — AI behavior / resource references

**Full ship list:**
androsyn, arilou, blackurq, chenjesu, chmmr, druuge, human, ilwrath, lastbat, melnorme, mmrnmhrm, mycon, orz, pkunk, probe, shofixti, sis_ship, slylandr, spathi, supox, syreen, thradd, umgah, urquan, utwig, vux, yehat, zoqfot

Shared ship interface is in `src/uqm/ships/ship.h`.

Each ship's `.c` file will be the primary reference when writing that ship's TypeScript implementation. See `docs/ships/` for per-ship analysis.

---

## Battle & Game Loop

**Source:** `src/uqm/battle.c`, `src/uqm/battlecontrols.c`

`battle.c` is the main battle loop. It includes `element.h`, `ship.h`, `process.h`, `tactrans.h`, and `intel.h`.

`battlecontrols.c` handles input mapping during battle.

`src/uqm/process.c` — likely the frame-advance / process-all-elements loop.

**To do:** Read `battle.c` to understand the main loop structure and how elements are processed each tick.

---

## Super Melee UI

**Source:** `src/uqm/supermelee/`

| File | Role |
|---|---|
| `melee.c` / `melee.h` | Core Super Melee mode entry point |
| `meleesetup.c` | Match setup / options |
| `pickmele.c` | Ship picker UI |
| `buildpick.c` | Fleet building |
| `loadmele.c` | Loading melee resources |
| `meleeship.h` | Melee ship data types |

---

## Netplay

**Source:** `src/uqm/supermelee/netplay/`

There's also developer documentation at `doc/devel/netplay/` — read this first before the code.

Key files:

| File | Role |
|---|---|
| `netplay.h` | Top-level types and constants |
| `netmelee.c` | Netplay integration with melee |
| `netinput.c` | Input synchronization |
| `netstate.c` | Connection state machine |
| `netconnection.c` | TCP connection management |
| `checksum.c` / `crc.c` | Checksum verification (implies lockstep / determinism checking) |
| `packet.c`, `packethandlers.c` | Packet format and dispatch |
| `netsend.c`, `netrcv.c` | Send/receive |
| `checkbuf.c` | Check buffer (anti-desync) |

**The presence of `checksum.c` and `checkbuf.c` strongly implies lockstep netplay** — checksums are used to verify both clients are in identical state each tick. This confirms our architecture assumption: input sync, not state sync.

**To do:** Read `doc/devel/netplay/` docs, then `netplay.h` and `netmelee.c`. See `docs/netplay.md`.

---

## What We're NOT Porting

- `src/uqm/planets/` — planet exploration, not relevant to Super Melee
- `src/uqm/comm/` — alien dialogue system
- `src/uqm/galaxy.c`, `hyper.c`, `starmap.c` — full game navigation
- Campaign/story systems

---

## Next Deep Dives (priority order)

1. **`velocity.c` / `velocity.h`** — understand fixed-point representation → `docs/physics.md`
2. **`collide.c`** — collision detection and response quirks → `docs/physics.md`
3. **`gravity.c`** — gravity well math → `docs/physics.md`
4. **`doc/devel/netplay/`** — netplay design docs → `docs/netplay.md`
5. **`ships/human/human.c`** — first ship deep dive → `docs/ships/human.md`
6. **`ships/spathi/spathi.c`** — second ship (BUTT missile special) → `docs/ships/spathi.md`
