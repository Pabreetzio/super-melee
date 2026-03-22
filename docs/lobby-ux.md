# Lobby & Pre-Game UX Design

This document defines the full user journey from first landing on the site
to the moment a battle begins. All copy should pass the voice test in
`docs/melee-ui.md` — earnest, terse, bureaucratic alien humor where appropriate.

---

## The Complete Flow

```
Landing Page
    │
    ├─→ [Enter commander name] → Game Browser
    │                               │
    │                               ├─→ Join Public Game ──→ Fleet Builder → Battle
    │                               ├─→ Join Private Game (password) ──→ Fleet Builder → Battle
    │                               └─→ Create Game ──→ Fleet Builder (waiting) → Battle
    │
    └─→ [Already have session] → Game Browser (skip name step)
```

---

## Screen 1: Landing / Identity

### What they see

A single screen. No sign-up wall. The minimum to get started is one thing: **a commander name**.

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│          ★ SUPER MELEE ★                           │
│     Ur-Quan Masters — Browser Edition               │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  Commander designation:                      │   │
│  │  [ Fwiffo                                 ] │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│         [ ENTER THE BATTLEFIELD ]                   │
│                                                     │
│  ─────────────────────────────────────────────     │
│  Want your fleet saved between sessions?            │
│  [ Create account ] or [ Sign in ]                  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Design decisions

**Commander name is enough to play.** Stored in localStorage for returning guests. No email required. No password required. A returning guest gets their name pre-filled and skips straight to the game browser.

**Accounts are opt-in.** Accounts add: fleet persistence, match history, commander profile. Not required to play. We don't block anything behind an account.

**Name validation:** 2–20 characters. No profanity filter initially (friends). Names don't need to be globally unique — they're display names, not identifiers. Backend identifies users by session token, not name.

**Pre-filled name suggestions:** On first visit, randomly generate an alien-sounding name from a pool (pull from the ship captain name lists in the content package — Fwiffo, Nargle, Snelopy, Awwky, etc.) as a placeholder. Sets the tone immediately. Player can overwrite it.

**Copy notes:**
- "Commander designation" not "username"
- "Enter the battlefield" not "Continue" or "Let's go!"
- Account section: keep it small, below the fold visually — not the primary call to action

---

## Screen 2: Game Browser

The main lobby. Shows all open games. Refreshes in real-time via WebSocket connection that's established when they enter the browser.

```
┌─────────────────────────────────────────────────────────────────┐
│  SUPER MELEE          Commander: Fwiffo          [ + New Game ] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  OPEN ENGAGEMENTS                                               │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🔓 The Fearful Nine          Nargle          Value: 127 │   │
│  │    [⚡][🚀][💀][ ][ ][ ][ ]   vs   [waiting...]         │   │
│  │                                          [ JOIN ]        │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ 🔒 Death Squadron            Pwappy         Value: 203  │   │
│  │    [⚡][⚡][🚀][💀][💀][ ][ ]   vs   [waiting...]        │   │
│  │                              Password required [ JOIN ]  │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ 🔓 Unnamed Fleet             Snurfel         Value:  48 │   │
│  │    [⚡][ ][ ][ ][ ][ ][ ]    vs   [waiting...]          │   │
│  │                                          [ JOIN ]        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  No games match your interest? Create one and wait.             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### What each game listing shows

- **Lock icon** — 🔓 public / 🔒 private (visible but password-required)
- **Team name** — whatever the host named their fleet, or "Unnamed Fleet" as default
- **Host commander name**
- **Fleet value** — the total point cost of their fleet. Signals how big/dangerous their lineup is. Gives potential opponents something to weigh before joining.
- **Ship icons** — small silhouettes of each ship in the fleet, in slot order. Empty slots shown as dim boxes. Opponents can see what they're up against. This is information that exists in the original (you can see the opponent's fleet during setup) — no reason to hide it.
- **Opponent slot** — shows `[waiting...]` when no opponent has joined yet. Shows the opponent's commander name once someone has joined (and they're in the fleet builder).
- **Join button** — immediately present on public games. Private games show "Password required" and a join button that prompts for password.

### Sorting / filtering

Default sort: **newest first** (most recently created at top). No need for complex filtering at launch. If the list gets long enough to warrant it, add a "value range" filter later.

### Real-time updates

The WebSocket connection opened at login keeps the game browser live. When a game is created, updated, or filled — the browser list updates without a page refresh. No polling.

### Empty state

If no games exist:
> "No engagements currently underway. The battlefield is quiet — perhaps suspiciously so. Create one."

---

## Screen 3: Create Game

A lightweight modal/overlay over the game browser.

```
┌───────────────────────────────────┐
│  NEW ENGAGEMENT                   │
│                                   │
│  Visibility:                      │
│  ( ) Open to all commanders       │
│  (●) Restricted — password below  │
│                                   │
│  Password: [ ______________ ]     │
│                                   │
│  [ CREATE ]   [ CANCEL ]          │
└───────────────────────────────────┘
```

Two choices only: public or private. If private, set a password. That's the entire create-game form.

No game title field — the team name (set in the fleet builder) becomes the game title. No need to name it twice.

On create: immediately enter the Fleet Builder as the host, in a waiting state.

---

## Screen 4: Fleet Builder (waiting for opponent)

This is the pre-game lobby proper — the equivalent of the original melee setup screen. Both players build their fleets here before confirming battle.

The host sees the screen immediately after creating a game. The opponent sees it as soon as they join.

```
┌─────────────────────────────────────────────────────────────────┐
│  FLEET CONFIGURATION                                            │
├──────────────────────────────┬──────────────────────────────────┤
│  YOUR FLEET                  │  OPPONENT                        │
│  Commander: Fwiffo           │  Commander: Nargle               │
│  Team: The Fearful Nine      │  Team: Death Squadron            │
│                              │                                  │
│  [Spathi][Human ][     ]     │  [UrQuan][Yehat ][Pkunk ]        │
│  [Arilou][     ][     ]      │  [Chmmr ][     ][     ]         │
│                              │                                  │
│  Value: 89                   │  Value: 127                      │
│                              │                                  │
│  [ ADD SHIP ]                │  (opponent is building...)       │
│  [ RENAME FLEET ]            │                                  │
│                              │                                  │
│  [ ✓ READY TO FIGHT ]        │  ✓ Nargle has confirmed          │
│                              │                                  │
├─────────────────────────────────────────────────────────────────┤
│  Room code: XKCD-7           [ Copy link ]    [ Leave ]         │
└─────────────────────────────────────────────────────────────────┘
```

### Key design decisions

**Both fleets are visible to each other in real-time.** The original game does this — you both build on the same screen simultaneously. Maintain that. There's no hidden fleet phase. Part of the metagame is seeing what your opponent is building and responding.

**Fleet changes sync live.** As you add/remove ships, the opponent sees your fleet update immediately. This uses the `FLEET` and `TEAMNAME` packet equivalents from the protocol (lobby WebSocket messages, not the binary battle format).

**"Ready to fight" = the original HANDSHAKE.** When both players click confirm, battle begins. If either changes their fleet after confirming, confirmation is automatically cancelled (matching the original protocol's HANDSHAKECANCEL behavior). The UI shows this explicitly:
> "Fleet changed — confirmation cancelled."

**Room code** is always visible and copyable. Format: 4-character code (`XKCD`, `MRVL`, `SPTH`...) — short enough to read over voice chat. Clicking "Copy link" copies `https://[host]/join/XKCD`. The link works even for password-protected rooms (the password prompt appears after following the link).

**Fleet value balance:** Not enforced. The original doesn't enforce it either. Players can build whatever fleet they want. Value is displayed for both sides so they can self-balance if they choose.

**"Add ship" UI:** Clicking ADD SHIP opens the ship picker — the same 2×7 grid from the original. Clicking a ship in your fleet removes it (returns to available pool). Ships are added to the next empty slot.

### Waiting state (host alone)

Before an opponent joins, the host sees the opponent panel as:
```
│  OPPONENT                        │
│  [waiting for opponent...]       │
│                                  │
│  Room code: XKCD-7               │
│  [ Copy link ]                   │
│                                  │
│  Or share: super-melee.com/XKCD-7│
```

The host can still build their fleet while waiting. When an opponent joins, the opponent panel populates and a subtle notification appears:
> "Nargle has entered the battlefield."

---

## Ship Picker (overlay within Fleet Builder)

When "Add ship" is clicked, an overlay shows the available ships.

```
┌──────────────────────────────────────────────────────┐
│  SELECT A SHIP                                       │
│                                                      │
│  [Spathi][Human ][UrQuan][Pkunk ][Yehat ][Chmmr ][Orz   ]  │
│  [Arilou][VUX   ][Thrdd ][Umgah ][Supox ][Mycon ][Syreen]  │
│  [Mmrnm ][Andrsn][Chenj ][Druug ][Utwig ][Shfxti][ZqFPik]  │
│  [Slyldr][Ilwrth][Melnrm][  ✗  ][  ✗  ][  ✗  ][  ✗  ]  │
│                     ↑ already in fleet                │
│                                                       │
│  [ RANDOM ]                        [ CANCEL ]         │
└──────────────────────────────────────────────────────┘
```

Ships already in your fleet are marked/dimmed (matching the original's cross-out). You can have duplicates (original allows this). Hovering a ship icon shows the ship name and cost.

---

## Private Game: Join Flow

When a player clicks JOIN on a private game, or follows a private room link:

```
┌──────────────────────────────────┐
│  RESTRICTED ENGAGEMENT           │
│                                  │
│  "Death Squadron" is waiting.    │
│  Commander: Pwappy               │
│  Fleet value: 203                │
│                                  │
│  Access code: [ __________ ]     │
│                                  │
│  [ ATTEMPT ENTRY ]  [ RETREAT ]  │
└──────────────────────────────────┘
```

Wrong password: "Access denied. Reconsider your approach."
Correct password: enter the fleet builder normally.

Passwords are hashed on the server. They're not transmitted in plaintext. This is just a light social gate — not cryptographic security.

---

## Shareability

Every game gets a short URL: `super-melee.com/XKCD`

- Public game: link takes you directly to the join confirmation
- Private game: link takes you to the password prompt
- Game that's already started (in battle): "This engagement is already underway. You may spectate or return to the game browser." (spectator mode is a future feature — for now, just redirect to browser)
- Game that no longer exists: "This engagement has concluded. Return to the battlefield."

---

## State Machine: Server-side per Room

```
created (host only, building fleet)
    ↓ opponent joins
building (both players present, building fleets)
    ↓ both confirm
confirmed (both have hit "ready")
    ↓ server sends seed + input delay
in_battle (relay mode — server forwards binary input packets)
    ↓ fleet exhausted or disconnect
post_battle (results displayed, rematch prompt)
    ↓ rematch or leave
building (loop) / closed
```

Room is cleaned up if:
- Host leaves before opponent joins (30 second grace)
- Either player disconnects during battle (configurable timeout)
- Both players leave post-battle
- Room is idle > 30 minutes

---

## Data the Server Tracks Per Room

```typescript
interface Room {
  code: string;           // "XKCD"
  visibility: "public" | "private";
  passwordHash?: string;

  players: {
    host: Player;
    opponent?: Player;
  };

  state: "waiting" | "building" | "confirmed" | "in_battle" | "post_battle";
  seed?: number;          // generated at preBattle, not before
  inputDelay: number;     // default 2
  createdAt: Date;
  lastActivityAt: Date;
}

interface Player {
  sessionId: string;
  commanderName: string;
  fleet: FleetSlot[];     // 14 slots (2 rows × 7 cols)
  teamName: string;
  confirmed: boolean;
  shipsAlive: Set<number>; // server tracks for ship selection validation
}

interface FleetSlot {
  ship: ShipId | null;
}
```

---

## What We're Not Building Yet

- **Matchmaking** — random opponent pairing. Noted as future feature.
- **Spectator mode** — watching a game in progress.
- **Leaderboards** — requires accounts + match history storage.
- **Reconnect during battle** — if you disconnect mid-battle, the game ends. Reconnect logic is complex (need to resync state). Future.
- **Multiple games per session** — after post-battle, you can rematch or return to browser. No persistent "tournament" structure yet.

---

## Open Questions

- [ ] Should fleet value be capped for public games? (Original has no cap — some ships cost much more than others.)
- [ ] Password UX: should private games be hidden from the browser entirely, or visible with a lock? Currently spec'd as visible-but-locked. Hidden would mean sharing the room code directly instead.
- [ ] How long should a room stay open if the host is idle in the fleet builder with no opponent?
- [ ] Rematch flow: after battle, should both players' fleets reset to what they started with, or keep current state? (Original resets — fleet restoration is not a thing, the winner is whoever still has ships.)
- [ ] Should we show opponent's ship icons in the fleet builder, or keep them hidden until battle? Currently spec'd as visible (faithful to original).
