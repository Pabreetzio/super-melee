# CLAUDE.md — Project Context for AI Assistants

This project is a browser-based recreation of Star Control 2's Super Melee mode with online multiplayer.

## Core Principle

We are building a faithful recreation, not a guess. Before writing any game logic, consult the analysis docs in `/docs/` which were written by reading the original UQM open source code. The physics quirks, collision behavior, and feel of the original are the goal — not textbook correctness.

## UQM Reference Source

The original Ur-Quan Masters (UQM) open source code is used as a reference only. It is **not** committed to this repo. To set up the reference source locally:

1. Download `uqm-0.8.0-src.tgz` from https://sourceforge.net/projects/sc2/files/UQM/0.8.0/
2. Extract it to the root of this repo so the path is:
   ```
   C:/Projects/super-melee/uqm-0.8.0/
   ```
   (or wherever you cloned this repo, with `uqm-0.8.0/` alongside `src/`, `docs/`, etc.)

The source is gitignored. All analysis notes in `/docs/` reference file paths relative to `uqm-0.8.0/` — e.g., `uqm-0.8.0/src/uqm/collide.c` — so you can find the original source for any documented behavior.

## Game Assets

UQM assets are extracted from the UQM content package and copied into `/assets/` in this repo. Do **not** load assets directly from `uqm-0.8.0/`. The content package (separate from source) can be downloaded from the same SourceForge page.

Assets are used under the non-commercial fan license with Toys for Bob's blessing. This project is non-commercial.

## Docs Structure

```
docs/
├── physics.md       # gravity, thrust, collision — read this before touching engine/physics.ts
├── netplay.md       # sync model analysis — read before touching net/
├── assets.md        # asset catalog and extraction notes
├── architecture.md  # planned web stack and module structure
├── survey.md        # broad source survey — start here for orientation
└── ships/           # one file per ship with stats, weapons, specials
```

## Stack

TypeScript + React + Canvas, Node/Socket.io for netplay relay, Vite for build. See `docs/architecture.md`.
