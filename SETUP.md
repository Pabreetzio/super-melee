# Super Melee — Dev Setup

## Prerequisites

- **Node.js 20+** (LTS recommended)
- **npm 10+** (comes with Node 20)
- A modern browser (Chrome/Firefox/Edge)

## First-time setup

```bash
cd C:/Projects/super-melee

# Install all dependencies (root + server + client)
npm run install:all
```

## Development

Start both server (port 3001) and client (port 5173) with hot-reload:

```bash
npm run dev
```

Open **http://localhost:5173** in two browser tabs to play against yourself.

The Vite dev server proxies `/ws` and `/api` requests to the backend, so no CORS
issues in dev. In production, the server serves the built client directly.

## Project structure

```
super-melee/
  shared/types.ts          # Types shared between server and client
  server/
    src/
      server.ts            # Express + WebSocket server (entry point)
      rooms.ts             # Room/lobby state machine
      session.ts           # Session management
  client/
    index.html
    src/
      App.tsx              # Root component + state machine
      net/client.ts        # WebSocket client wrapper
      engine/
        sinetab.ts         # 64-entry UQM sine table (deterministic)
        rng.ts             # Park-Miller LCG (deterministic, matches UQM)
        velocity.ts        # Bresenham velocity accumulator
        element.ts         # Game object model
        physics.ts         # Gravity + collision stubs
        game.ts            # 24fps lockstep game loop
        ships/index.ts     # Ship definitions (placeholder stats)
      components/
        Landing.tsx        # Commander name entry
        GameBrowser.tsx    # Room list + create/join
        FleetBuilder.tsx   # Fleet editor (2×7 grid)
        ShipPicker.tsx     # Ship selection modal
        Battle.tsx         # Canvas game shell
        HUD.tsx            # Crew/energy bars
  docs/
    physics.md             # UQM physics analysis
    netplay.md             # UQM netplay analysis
    melee-ui.md            # UQM UI/voice analysis
    lobby-ux.md            # Lobby design decisions
    assets.md              # Asset catalog
    survey.md              # UQM source structure map
  uqm-0.8.0/              # UQM source (gitignored) — extract here
  assets/                  # Extracted UQM game assets (gitignored)
```

## UQM source reference

Extract the UQM source tarball to `uqm-0.8.0/` at the repo root (gitignored).
The source is used as a reference only — all code in this repo is original.

```bash
# From repo root:
tar -xzf uqm-0.8.0-src.tgz
```

## UQM content assets

Place `uqm-0.8.0-content.uqm` at the repo root (gitignored), then extract:

```bash
# Ships:
unzip uqm-0.8.0-content.uqm "base/ships/*" -d assets/

# Music:
unzip uqm-0.8.0-content.uqm "base/addons/3domusic/*" -d assets/
```

## Production build

```bash
npm run build
# Server: server/dist/server.js
# Client: client/dist/

# Run:
NODE_ENV=production node server/dist/server.js
```

The production server serves the client from `client/dist/` on the same port.
Set `PORT` environment variable to change from default 3001.

## Network architecture

- **Lobby**: JSON WebSocket messages — room creation, fleet sync, confirmation
- **Battle**: JSON WebSocket relay — inputs only (1 byte/frame), checksums
- **Physics**: Fully deterministic on both clients — server never simulates
- **Seed**: Generated server-side at battle start (prevents host from cheating)
- **Checksum**: Both clients send CRC32 of game state every frame; server
  compares and disconnects on mismatch

## Open questions / future work

See `docs/lobby-ux.md` → Deferred Features section.

Key items for Phase 2:
- Per-ship physics from UQM source (one ship at a time, starting with `human`)
- UQM sprite rendering from extracted assets
- Sound effects
- Spectator mode
- Matchmaking queue
