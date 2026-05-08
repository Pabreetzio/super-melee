# Netplay Desync Debugging Plan

This is the working plan for making online multiplayer desyncs diagnosable and
then fixing the actual deterministic mismatch. Read this before changing
netplay, checksums, battle frame sequencing, or collision behavior.

## Goal

When online battle desyncs, both players should be able to copy a compact debug
report and paste it into a future session. The report should explain whether the
failure came from bad input relay/frame ordering or from deterministic
simulation drift.

## Immediate Instrumentation

1. Extend checksum mismatch messages with:
   - mismatch frame
   - host and opponent CRCs
   - room code
   - server-side input trace around the mismatch
2. Keep a bounded client-side frame snapshot ring buffer.
3. Capture enough frame state to compare:
   - applied inputs
   - checksum
   - RNG seed
   - ship types and ship state
   - missiles
   - asteroids
   - lightning segments
   - crew pods
   - warp-in, rebirth, ship death state, pending end state
4. Add a visible `Copy Debug Report` action to the desync overlay.
5. Keep copied reports small enough to paste into a chat:
   - compact timeline for the recent frames
   - full snapshots only for a small window around the mismatch frame
   - server input trace around the mismatch
6. Make the copied report self-contained JSON so it can be compared manually or
   by a later script.

## Follow-Up Tooling

Create a local compare script, for example:

```bash
npm run compare-desync -- host-report.json opponent-report.json
```

The script should print:

- first frame where checksums differ
- first field that differs inside the captured state
- applied inputs around that frame
- RNG seed before and after divergence
- server relay trace around that frame

## Likely Root Causes To Audit

The first suspect is any simulation branch that depends on browser-local
presentation state. In particular, collision paths currently receive sprite
objects / masks loaded asynchronously by the client:

- `client/src/engine/battle/collision.ts`
- `client/src/engine/battle/projectiles.ts`
- `client/src/engine/battle/maskCollision.ts`
- ship-controller collision frame hooks

If one client has sprite masks loaded and the other is still on a fallback, both
clients can process identical inputs and still diverge.

Other audit targets:

- controller fallbacks that use `Math.random()`
- gameplay state mutated after checksum submission
- object or map iteration whose ordering is not explicit
- visual/cosmetic state that accidentally influences gameplay
- audio or browser APIs called inside simulation phases

## Fix Strategy

1. Reproduce with the new reports.
2. Compare the two client reports at the first mismatch frame.
3. If inputs differ, fix relay sequencing / duplicate / gap handling.
4. If inputs match but state differs, fix the first differing simulation field.
5. Add or extend a deterministic local harness for the failing ship pair and
   input sequence.
6. Repeat until a zero-input and scripted-input online match can run without
   mismatch.

## Determinism Rule

The battle simulation must depend only on the initial room/round data, the
server seed, deterministic assets/data that are ready before the first frame,
and the two input streams. Rendering, audio, asset load timing, wall-clock time,
and browser-local presentation state must not change simulation outcomes.
