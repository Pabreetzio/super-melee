# AGENTS.md — Project Context for AI Assistants

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

UQM assets are extracted from the UQM content package and copied into `/assets/` in this repo. Do **not** load assets directly from the content package or source tree.

To set up the content package locally:
1. Download `uqm-0.8.0-content.uqm` from https://sourceforge.net/projects/sc2/files/UQM/0.8.0/
2. Place it at the repo root: `uqm-0.8.0-content.uqm` (it is gitignored)
3. It's a standard zip. To extract ship and battle assets:
   ```bash
   unzip uqm-0.8.0-content.uqm "base/ships/*" -d uqm-content/
   unzip uqm-0.8.0-content.uqm "base/battle/*" -d uqm-content/
   ```
4. Copy relevant files from `uqm-content/` into `/assets/`

See `docs/assets.md` for the full asset catalog.

Assets are used under the non-commercial fan license with Toys for Bob's blessing. This project is non-commercial.

## Docs Structure

```
docs/
├── physics.md       # gravity, thrust, collision — read this before touching engine/physics.ts
├── netplay.md       # sync model analysis — read before touching net/
├── assets.md        # asset catalog and extraction notes
├── architecture.md  # planned web stack and module structure
├── battle-architecture.md # current battle-loop ownership and extension points
├── weapon-porting.md # repeatable checklist for implementing/fixing weapons
├── porting-ships.md # broader ship-porting notes
├── survey.md        # broad source survey — start here for orientation
└── ships/           # one file per ship with stats, weapons, specials
```

## Battle / Weapon Workflow

When working on weapons or battle behavior:

1. Read `docs/battle-architecture.md` for current module boundaries.
2. Read `docs/weapon-porting.md` for the implementation checklist.
3. Read the relevant `docs/ships/<ship>.md` file if present.
4. Check the matching UQM ship source before changing logic.

## Commits

When an AI agent creates a commit, use a conventional commit message.

Add a `Co-Authored-By` footer that identifies the agent and, when known, the model/tier and reasoning level.

For Codex in this repo, use:

```text
Co-Authored-By: Codex GPT-5.4 (medium reasoning) <codex@openai.com>
```

If another agent is creating the commit, follow the same pattern with that agent's own name/model details and configured email rather than pretending the work was co-authored by Codex.

## Stack

TypeScript + React + Canvas, Node/Socket.io for netplay relay, Vite for build. See `docs/architecture.md`.
