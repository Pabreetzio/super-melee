# Browser Super Melee

A faithful browser-based recreation of Star Control 2's Super Melee mode with online multiplayer — no install required.

## Goal

Recreate the *feel* of SC2 Super Melee exactly, including the physics quirks that make combat fun, by studying the original UQM open source code and translating it faithfully to the modern web.

## Stack (planned)
- **Game**: Canvas/WebGL renderer, physics rewritten in TypeScript faithful to UQM source
- **UI/Lobby**: React
- **Netplay**: WebSockets (Node + Socket.io or similar)
- **Assets**: UQM content package (non-commercial fan use)

## Project Phases

1. **Source Archaeology** — read UQM C source, document each subsystem in `/docs`
2. **Asset Audit** — catalog sprites, sounds, music from UQM content package
3. **Architecture Design** — design the web stack based on findings
4. **Implementation** — ship by ship, subsystem by subsystem

## Structure

```
/
├── docs/
│   ├── physics.md          # gravity, thrust, momentum, collision quirks
│   ├── netplay.md          # UQM TCP/IP sync model analysis
│   ├── assets.md           # asset catalog and license notes
│   ├── architecture.md     # planned web architecture
│   └── ships/              # one file per ship
├── src/                    # game code (Phase 4)
├── assets/                 # extracted UQM assets
└── README.md
```

## References
- [The Ur-Quan Masters source](https://github.com/UQM-mirror/UQM) (or SourceForge)
- [uqm-wasm](https://github.com/intgr/uqm-wasm) — Emscripten/WASM port for reference
- UQM content package — ships, sounds, music
