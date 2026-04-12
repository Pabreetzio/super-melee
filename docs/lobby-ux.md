# Lobby & Netplay UX

This document tracks the current multiplayer entry and setup flow in the live
client. It should stay aligned with the actual routed screens in `client/src`.

---

## Current Flow

```
SuperMelee setup screen
    │
    └─→ NET
         │
         └─→ /net (`Netplay screen`)
              │
              ├─→ Host Game
              │    └─→ Multiplayer setup screen (host waiting / editing)
              │
              └─→ Join open game
                   └─→ Multiplayer setup screen (guest editing)
                        │
                        └─→ Both captains confirm
                             └─→ Battle
```

---

## Netplay Screen

Route: `/net`

Component: `client/src/components/GameBrowser.tsx`

The netplay screen is the room browser and room-creation entry point. It uses
the shared `primary deck` / `command rail` framework established in the style
lab rather than a generic web table layout.

### Primary deck

- `SUPER-MELEE` title
- `Netplay` page heading
- `Open Games` list
- private-room password prompt when needed
- inline error / join-failure messaging

Each open game row shows:

- room code
- host captain name
- whether the room is public or private
- whether the room is open or already in progress
- opponent name when present

### Command rail

- `Captain` heading
- the local captain name
- blue menu with:
  - `Open Games`
  - `Host Game`
  - `Change Name`
- beveled `Back` button at the bottom

### Captain name behavior

- A random captain name is generated once for a new local player.
- That name is stored in local storage and reused on future loads.
- `Change Name` unlocks inline editing on the captain field.
- Blur, `Enter`, or `Tab` save the name and lock the field again.
- `Escape` cancels editing.

---

## Multiplayer Setup Screen

Component: `client/src/components/MultiplayerSetupScreen.tsx`

This replaces the older generic `Fleet Assembly` layout for online rooms.
Multiplayer setup now uses a `SuperMelee`-style stage rather than a separate
panel-based screen.

### Primary deck

- shared `SUPER-MELEE` title treatment
- both fleets visible at once
- local fleet is editable
- remote fleet updates live as the other captain edits
- team names are editable by the owning captain
- fleet value and confirmation state are visible per side

### Command rail

- host captain name on blue background
- `Copy Code`
- room-code card with copy feedback / waiting state
- opponent captain name on blue background
- `Confirm Fleet` / `Un-confirm`
- `Withdraw`

### Rematch behavior

- After battle, fleets reset to the state they had when the battle began.
- The old `Reset fleets on rematch` toggle has been removed.
- Rematches should always restore the original pre-battle fleets for that room.

---

## Notes

- `SOLO` and `LOCAL2P` still use the older `FleetBuilder.tsx` fallback layout.
- Online multiplayer setup should be discussed as `Multiplayer setup screen`,
  not `Fleet Assembly`, unless docs are specifically describing historical UI.
