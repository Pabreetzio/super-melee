# Netplay Analysis

**Status: Pending UQM source review**

## UQM Netplay Model

UQM added TCP/IP Super Melee in a later release. Key questions to answer from the source:

- [ ] Is it lockstep (input sync) or state sync?
- [ ] What's the tick rate / input packet rate?
- [ ] How is latency handled — rollback, delay-based, or none?
- [ ] What data is transmitted per frame?
- [ ] How is fleet selection synced?
- [ ] How is RNG seeded and synced (critical for determinism)?

## UQM source files to examine

- `sc2/src/uqm/supermelee/netplay/` — netplay subsystem
- Look for: connection handshake, input packet format, game state sync

## Web Implementation Plan (preliminary)

For browser-based play, we'll use WebSockets instead of raw TCP.

Options:
1. **Input sync (lockstep)** — each client sends inputs, both simulate identically. Requires deterministic physics. Simpler server (relay only). Sensitive to packet loss.
2. **State sync** — server (or one peer) is authoritative, broadcasts state. Easier to handle lag but more bandwidth.

Given that UQM likely uses lockstep (common for 90s/00s game netplay), we'll probably mirror that approach. Our JS physics must be 100% deterministic for this to work — no `Math.random()`, use a seeded PRNG, no floating-point unless both browsers produce identical results (risky — consider integer simulation).

## Room/Lobby Plan

- Generate short room codes (e.g. 6 chars)
- Share link: `https://[host]/room/ABCDEF`
- No accounts required
- Fleet selection happens in lobby before match starts
