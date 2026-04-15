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
├── design-philosophy.md # shared UI / interaction principles for page styling and flow
├── battle-architecture.md # current battle-loop ownership and extension points
├── constants.md     # unit conversion table (display→world→velocity) and timing constants
├── weapon-porting.md # repeatable checklist for implementing/fixing weapons
├── porting-ships.md # broader ship-porting notes
├── survey.md        # broad source survey — start here for orientation
└── ships/           # one file per ship with stats, weapons, specials
```

## UI Terminology And Multiplayer Flow

Use the page names below when discussing UI changes so "fleet builder",
"ship picker", "ship select", and similar terms stay unambiguous.

### Canonical page names

1. `SuperMelee setup screen` (`client/src/components/SuperMelee.tsx`)
   This is the main local setup page shown from app state `supermelee`.
   It contains the `SUPER-MELEE` title, two editable fleet grids, the per-side
   team labels, the top/bottom menu columns (`NET`, `CONTROL`, `LOAD`, `SAVE`,
   `SETTINGS`, `QUIT`), and the central battle preview / ship preview area.
   If someone says "the main page", this is usually what they mean.

2. `Ship picker overlay` (`client/src/components/ShipPicker.tsx`)
   This is the overlay opened from a fleet slot while editing a fleet.
   It is not the between-round ship chooser. It is the roster browser used to
   assign or replace a ship in a fleet slot.

3. `Netplay screen` (`client/src/components/GameBrowser.tsx`)
   This is the online multiplayer entry screen shown from app state `browser`
   and routed at `/net`.
   It contains the page title `Netplay`, the open-games list, the captain name,
   the blue command menu (`Open Games`, `Host Game`, `Change Name`), and the
   back action. It is for browsing / creating / joining multiplayer rooms, not
   for editing fleets.

4. `Multiplayer setup screen` (`client/src/components/MultiplayerSetupScreen.tsx`
   via `client/src/components/FleetBuilder.tsx`)
   This is the online room setup page shown from app state `fleet_builder`
   after creating or joining a room.
   It uses the `SuperMelee`-style stage layout for online setup, with both
   fleets visible, captain names in the command rail, room code / copy-code
   controls, team-name editing, fleet values, confirm controls, and withdraw.
   When discussing online room prep after entering a room, call this page
   `Multiplayer setup screen`.

5. `Battle screen` (`client/src/components/Battle.tsx`)
   This is the live fight shown from app state `battle`.
   It contains the space arena, status panels, and active combat UI.

6. `Ship selection screen` (`ship_select` state in `client/src/App.tsx`)
   This is the between-round ship chooser shown after a ship is destroyed in a
   multi-ship match.
   It renders one or two `ship selector panes` depending on mode and whose turn
   it is to pick.
   If a user says "when a ship is blown up and I pick the next ship", this is
   the screen they mean.

7. `Ship selector pane` (`SplitShipSelect` / `ShipSelectorPane` in `client/src/App.tsx`)
   This is one player's individual panel inside the ship selection screen.
   It shows that side's surviving fleet slots plus the random / forfeit cells.
   Use `ship selector pane` for one side, and `ship selection screen` for the
   whole between-round layout.

8. `Post-battle result screen` (`PostBattle` in `client/src/App.tsx`)
   This is the simple result page shown from app state `post_battle`.
   It shows `Victory`, `Defeat`, or `Mutual Annihilation`, plus rematch / leave
   actions.

9. `Final fleet result screen` (`FinalFleetResult` in `client/src/App.tsx`)
   This is the end-of-match fleet summary shown from app state `final_selector`.
   It reuses the ship selector layout to show both sides' final surviving ships
   before returning to fleet setup.

### Recommended wording for change requests

1. Say `SuperMelee setup screen` for the main menu + local fleet-editing page.
2. Say `Netplay screen` for the multiplayer browser / room list page.
3. Say `Multiplayer setup screen` for the online room page where both players
   build and confirm fleets.
4. Say `ship picker overlay` for the roster browser used to fill a fleet slot.
5. Say `ship selection screen` for the between-round next-ship chooser after a
   ship explodes.
6. Say `ship selector pane` if only one side of that between-round chooser is
   being discussed.

### Current multiplayer setup flow

1. `SuperMelee setup screen`
2. Click `NET`
3. `Netplay screen`
4. Create or join a room
5. `Multiplayer setup screen`
6. Both players confirm
7. `Battle screen`
8. If more ships remain: `Ship selection screen`
9. When the match ends: `Post-battle result screen` or `Final fleet result screen`, depending on mode

## UI Design Rules

Before reworking page layout or styling, read `docs/design-philosophy.md`.

For UI discussions in this repo:

1. `Command deck layout` means the default two-zone page composition:
   a larger left `primary deck` and a narrower right `command rail`.
2. New pages and page reworks should remain keyboard-first.
3. Prefer retro menu treatments over generic rounded web controls.
4. Preserve crisp pixel-art presentation.
5. Keep the starfield backdrop feeling consistent across navigation.
6. Reuse shared theme primitives before inventing page-specific styling.
7. `StyleLab` and `TypographyLab` are reference surfaces for shared app primitives.
   If a style shown there is adopted elsewhere in the app, its default behavior is
   to stay in sync across those usages. Do not make a one-off tweak on only one page
   unless the user explicitly asks for divergence. When a shared primitive changes,
   update the labs and the live app surfaces that use it together. If there is real
   ambiguity about whether something is a shared primitive or a special-case exception,
   pause and clarify before changing only one side.
8. Treat this sync rule as mandatory, not optional. If you change a shared primitive
   on a live page, update the matching `StyleLab`/`TypographyLab` reference in the
   same patch without waiting for the user to remind you. This includes typography,
   spacing, widths, heights, and other presentation details for shared list rows,
   panels, buttons, and menu treatments.

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

## Sound Dispatch — Required Audit Before Editing

Before adding or modifying any sound-related code in `Battle.tsx` or a ship
controller, trace **all paths** that already produce sound for that weapon:

1. Does the controller emit a `{ type: 'sound' }` spawn entry?
2. Does `applySpawn` call the `sound =>` callback?
3. Does `processMissile` return a `sounds` array in its `MissileEffect`?

All three paths are live independently. Adding sound via one path without
checking the others is the primary cause of double-play bugs and speculative
fixes that conflict with existing dispatch. Read `docs/battle-architecture.md`
§ "Sound dispatch — two separate paths" before proceeding.

## Low Sample Rate WAV Fixes

If a ship sound appears to be wired correctly but still does not play in the
browser, inspect the WAV header before changing gameplay code. We already hit
this with Mycon and Thraddash: some extracted UQM WAVs were stored at very low
sample rates such as `1657 Hz`, `2090 Hz`, or `2100 Hz`, which browsers may
fail to decode through `Audio()`.

When this happens:

1. Confirm the sound path is correct across all live dispatch routes listed
   above.
2. Check the WAV header sample rate in `assets/sounds/...`.
3. If the file is one of these low-rate assets, resample it to `8363 Hz`
   while preserving duration, then rebuild so `client/dist/sounds/...` picks
   up the fixed asset.

Do not assume the asset is fine just because the WAV container is valid.

## Stack

TypeScript + React + Canvas, Node/Socket.io for netplay relay, Vite for build. See `docs/architecture.md`.
