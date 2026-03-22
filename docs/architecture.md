# Architecture Design

**Status: Draft — to be revised after Phase 1 source archaeology**

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Game renderer | HTML5 Canvas (2D) | Start here; upgrade to WebGL if perf needed |
| Game logic | TypeScript | Strict types help catch physics bugs |
| UI / Lobby | React | Fleet selection, room codes, scores |
| Netplay transport | WebSockets | Server relays inputs between peers |
| Server | Node.js + Socket.io | Thin relay; no game simulation on server |
| Build | Vite | Fast dev server, easy TS/React setup |
| Hosting | TBD | Vercel/Fly.io for server; static for client |

## Game Loop

```
requestAnimationFrame loop:
  1. Read local inputs
  2. Send inputs to server
  3. Receive remote inputs
  4. Advance simulation one tick (deterministic)
  5. Render current state
```

Fixed timestep at 24 fps (UQM runs at 24 fps — verify from source). Rendering can be 60fps with interpolation, or locked to 24fps to start.

## Determinism Requirements

For lockstep netplay, the physics sim must produce identical results on both clients:
- Use integer math where UQM uses fixed-point
- Seeded PRNG (xoshiro128 or similar), seed exchanged at match start
- No `Date.now()` or `Math.random()` in simulation code
- Careful with JS number precision for large coordinates

## Module Structure (planned)

```
src/
├── engine/
│   ├── physics.ts       # gravity, thrust, collision
│   ├── element.ts       # base class for ships/projectiles
│   ├── game.ts          # game state, loop, tick
│   └── input.ts         # input capture and buffering
├── ships/
│   └── [one file per ship].ts
├── net/
│   ├── client.ts        # WebSocket client, input sync
│   └── server.ts        # Node relay server
├── render/
│   ├── canvas.ts        # canvas drawing utilities
│   └── sprites.ts       # sprite loading, rotation frames
└── ui/
    ├── App.tsx           # React root
    ├── Lobby.tsx         # room code, fleet selection
    └── HUD.tsx           # in-game crew/energy bars
```

## Open Questions (resolve during source archaeology)

- [ ] What is UQM's actual frame rate? (suspect 24fps)
- [ ] Does UQM use fixed-point integers or floats for physics?
- [ ] Lockstep or state sync for netplay?
- [ ] How many rotation frames per ship sprite?
- [ ] Are .uqm assets usable directly or need conversion?
