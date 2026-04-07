# Super Melee UI & Tone Analysis

Deep dive into the original melee setup flow, vocabulary, comedic voice,
and how to carry that into a new web-based UI.

**Sources:**
- `uqm-0.8.0/src/uqm/supermelee/melee.c` — fleet builder, battle loop, all status strings
- `uqm-0.8.0/src/uqm/cnctdlg.c` — netplay connection dialog
- `uqm-0.8.0/src/uqm/supermelee/netplay/netoptions.c` — netplay defaults
- `uqm-0.8.0/src/uqm/comm/spathi/strings.h` — Spathi dialogue tree enum
- `uqm-0.8.0/src/uqm/comm/pkunk/strings.h` — Pkunk dialogue tree enum
- Content package: `base/ships/pkunk/fury.txt`, `base/ships/spathi/eluder.txt` — captain name pools

---

## The Original Setup Flow

### 1. Fleet Builder Screen

Each player has a **2-row × 7-column grid** (14 total ship slots) displayed on their side of the screen. You navigate the grid with the ship-selection controls.

**Grid contents:**
- Occupied slots show a small ship icon
- Empty slots show "Empty Slot" text
- Dead ships from a previous match get a **cross drawn through their icon** (the X remains for the session)
- Bottom of each player's panel: their **team name** (freeform text, player-set)
- Top-right of panel: current fleet **value** (point total, decreases as ships die)

The fleet builder is **completely shared** — both players set up their fleets on the same screen simultaneously. There's no separate lobby or waiting room between players.

### Current Web Port Notes

The current browser implementation intentionally leans harder into the original
Melee composition than the first-pass React layout did:

- The fleet manager is staged as a single scalable composition rather than a
  generic responsive page. The left side mirrors the shared fleet-building area
  and the right side mirrors the classic battle/status sidebar proportions.
- The `SUPER-MELEE` page title now lives inside the left panel and is rendered
  as a real `h1`, using the extracted `slides` bitmap font converted to a web
  font.
- Fleet grids are transparent against the starfield except for occupied slots,
  which use the same deep blue slot background as the in-game setup screen.
- Top and bottom fleet labels are placed relative to the center seam rather
  than treated as ordinary section headers. The lower team name now sits under
  the bottom fleet instead of above it.
- Sidebar buttons are split above and below the battle preview so the overall
  stack reads like the original right-side melee menu.
- Control mode buttons (`HUMAN CONTROL`, `WEAK CYBORG`, etc.) use a distinct
  dark-blue treatment with lighter blue text and halo, but share the same grey
  beveled border language as the rest of the setup UI.

### Current Save / Load Behavior

The original UQM setup screen supported loading prebuilt fleets plus saved team
files. The web port now mirrors that more closely:

- Saved fleets are stored in `localStorage` under `sm_saves`.
- If there are no saved fleets yet, the first load seeds the save list with the
  original UQM prebuilt teams from `src/uqm/supermelee/loadmele.c`.
- `SAVE` is immediate: it saves the active top or bottom fleet using the
  current team name and overwrites by name if a matching entry already exists.
- `LOAD` opens an in-stage popup over the fleet area instead of a browser-style
  dialog. It shows fleet name left, fleet value right, then a 14-slot ship row
  beneath, matching the original `DrawFileString()` layout in `loadmele.c`.
- Keyboard support in the load panel matches the setup screen expectations:
  up/down changes selection, confirm loads the selected fleet into the chosen
  side, cancel closes, and `Delete` opens a compact `Really Delete / Yes / No`
  confirmation.
- Mouse hover updates the highlighted load row, and clicking a row loads it
  immediately for the active side.

**Vocabulary confirmed from source:**
- `"Empty"` + `"Slot"` → "Empty Slot" for an unused fleet position
- `"Team"` + `"Name"` → team name label (displayed as a combined label pair)
- `"fleet"` → the group of ships a player brings (term used throughout code)
- `"value"` → point cost total of fleet
- `"confirmation"` → both players must press FIRE to confirm they're ready before battle starts

### 2. Ship Selection (Between Rounds)

After a ship dies, that player gets the ship-selection screen. The same fleet grid appears with dead ships crossed out. Two extra buttons appear at the end of the grid:

- **Random** — picks a random surviving ship (pre-selected via RNG seeded at round start)
- **Exit** — confirms exit from the match

In netplay, when one player is picking, the other side waits. Their selection cursor flashes slowly. A local player's cursor flashes quickly. Status bar shows `"Waiting for remote confirmation."` while the remote player hasn't picked yet.

### 3. Netplay Connection Dialog (Original)

The original netplay required the players to manually exchange IP addresses and connect directly via TCP. The connection dialog had:

```
[ Connect to remote host ]
[ Wait for incoming connection ]
[ Cancel ]

Host: [text field, default: localhost]
Port: [text field, default: 21837]
Net Delay: [slider, 0-9, default: 2]
```

Status messages that appeared in the main melee screen's status bar:

| State | Message |
|---|---|
| Not connected | `"Unconnected. Press LEFT to connect."` |
| Waiting for someone to connect in | `"Awaiting incoming connection...\nPress RIGHT to cancel."` |
| Trying to connect out | `"Attempting outgoing connection...\nPress RIGHT to cancel."` |
| Connected | `"Connected. Press RIGHT to disconnect."` |
| Waiting for other player to confirm fleet | `"Waiting for remote confirmation."` |
| Fleet changed after confirming | `"Bottom player changed something -- need to reconfirm."` |

Error messages:
- `"Connection for bottom player not established."`
- `"Connection aborted due to version mismatch."`
- `"Connection aborted due to loss of synchronisation."` [British spelling]
- `"Game aborted by the remote player."`

**Key observation:** The default port is `21837` which is `0x554D` = `"UM"` (Ur-Quan Masters). That's a small easter egg baked into the networking defaults.

**Notable UX shortcomings in the original:**
- Players must know each other's IP addresses
- No room codes, no matchmaking, no lobby
- The "Net Delay" slider (input delay frames) is exposed raw to users with no explanation
- Two-player local setup still required managing "bottom player" vs "top player" designations
- No persistent identities — team names are set fresh each session and not saved between launches (the team file can be saved/loaded but isn't automatic)

---

## The Vocabulary

These are the canonical terms from the source. Use them in our UI:

| Concept | Canonical term | Notes |
|---|---|---|
| Your group of ships | **fleet** | Always "fleet", never "deck" or "roster" |
| Named group entity | **team** | "Team Name" is the label in-game |
| One position in fleet | **slot** | "Empty Slot" is the placeholder text |
| Points assigned to a fleet | **value** | Shown numerically; decreases on ship death |
| A single battle | (battle / fight) | No canonical single-word term in UI |
| Confirming ready | **confirmation** | "Confirmation cancelled. Press FIRE to reconfirm." |
| Player positions | **bottom** / **top** | The two sides are "bottom player" and "top player" |
| AI opponent | **computer** | "Computer" not "AI" or "bot" |
| Waiting for opponent | (no canonical message) | Opportunity to add flavor |

**Captain names** (from the content package) show the naming style for the universe. Each ship has a pool of alien-sounding names:
- Spathi captains: Fwiffo, Bwinkin, Snelopy, Nargle, Phlendo, Rupatup, Thintho, Jinkeze, Pkunky, Kwimp, Snurfel, Plibnik, Wiffy, Phwiff, Pwappy, Thwil...
- Pkunk captains: Awwky, Tweety, WudStok, Hooter, Buzzard, Polly, Ernie, Yompin, Fuzzy, Raven, Crow, Jay, Screech, Twitter, Brakky...

The pattern: alien sounds combined with familiar animal/bird references, treated with complete earnestness.

---

## The Comedic Voice

**The melee UI itself has zero personality.** Every string is dry, utilitarian, and functional. The humor in SC2 lives entirely in the alien dialogue and flavor text — not in menus.

But the alien writing gives us a clear voice to draw from. The SC2 style is:

### Core principles of SC2 humor

**1. Sincere absurdity** — The most ridiculous things are treated with total earnestness. The Spathi (cowardly slugs) have elaborate sacred rituals of self-preservation called "WEZZY WEZZAH." They discuss their cowardice like a philosophical position, not a flaw. They "drew the short straw" and ended up guarding Earth's moon alone. One Spathi (`FWIFFO`) is stationed entirely by himself on Pluto and is terrified of everything. The comedy comes from the gap between his gravity-serious tone and his complete cowardice.

**2. Military/bureaucratic language applied to comedy** — The Spathi organize their cowardice like a military operation. They have a "Ritual of Cowardice" with formal names. The Pkunk give battle prophecies that are both earnest and useless.

**3. Alien incomprehension** — Aliens misunderstand human idioms in ways that reveal their culture. The Pkunk are psychic birds who give fortune-cookie prophecies. Their self-certainty about vague spiritual insights is the joke — they're always right about the wrong thing.

**4. The universe is genuinely dark** — Earth is enslaved. Billions have died. The comedy works *because* of this contrast. The silliness is coping. This gives the humor its texture — it's not just jokes, it's the universe's inhabitants being themselves in a horrible situation.

**5. Naming as tone-setting** — "The Ur-Quan Masters" (slavers). "Spathi" (sounds vaguely embarrassed). "Pkunk" (sounds like a sneeze). The ship names carry tone: the Spathi "Eluder" (running away is the whole strategy), the Pkunk "Fury" (ironic — they're birds), the Shofixti "Scout" with a self-destruct called "Glory Device" (kamikaze with dignity).

### Specific humor patterns we can use

**The Spathi template:** Cowardly bureaucratic sincerity.
> "Your fleet has been prepared for tactical withdrawal. Godspeed, courageous commander. (We will be leaving now.)"

**The Pkunk template:** Earnest spiritual certainty about uncertain things.
> "The stars speak your name. They say it is... probably this one."

**The Yehat template:** Honor-obsessed military birds who respect only warriors.
> "Your fleet selection has been CONFIRMED. May it bring glory — or at least not bring shame."

**The Zoq-Fot-Pik template:** Three beings arguing with each other about what to say.
> "Click the ship— NO, first the CONFIRM— I told you, the FLEET—"

---

## New UX Challenges: Login & Matchmaking

The original game had no accounts, no matchmaking, no room codes. Players had to exchange IPs directly. We're building on top of that — which means we're inventing new UX that has no precedent in the original.

### Design constraints

1. **No-install, no friction** — The whole point is to get into a game fast
2. **No mandatory accounts** — Let players play as guests, with accounts as opt-in for persistence
3. **Must feel like the SC2 universe** — A sterile "Sign In" page kills the mood immediately

### Recommended approach: In-universe framing

Rather than presenting generic web app flows, frame everything through the game's fiction.

**Identity:** Players are "commanders" or captains. Their username is their captain name. Ship selection screens already show captain names — lean into that. Rather than "Create Account," it's "Register Your Command." Rather than "Username," it's "Commander Name."

**Room codes:** Rather than "Game ID: abc123," use something that sounds like SC2 — e.g., "Battle Coordinates" or a short code styled like a star designation (`Eta-Vulpeculae-7`, or just a fun 4-char code). Or lean into the humor and make it something like a Spathi safe-word.

**Matchmaking queue:** The wait state is the biggest opportunity. In the original you stared at `"Awaiting incoming connection..."` — we can do better. Show:
- Who's already queued (fleet value as stakes, ship icons as silhouettes)
- A loading state written in the game's voice
- Maybe a short fortune from a "Pkunk oracle" while waiting

**Error messages** should use the same dry/earnest style as the original rather than generic web errors:
- "Connection aborted due to loss of synchronisation." → keep this vibe, don't replace with "Oops! Something went wrong."
- But add a Spathi-style aside: "Connection lost. The remote commander has apparently fled. (A wise decision, perhaps.)"

### What to preserve vs. what to improve

| Original | Keep? | Web replacement |
|---|---|---|
| Team name (freeform text) | YES | Same — players name their fleet |
| Fleet value displayed | YES | Show prominently as "stakes" |
| Ship slot grid (2×7) | YES | Same layout |
| Dead ships crossed out | YES | Same visual treatment |
| Manual IP + port | NO | Room code or matchmaking queue |
| Raw "Net Delay" slider | NO | Auto-configure latency; optionally expose advanced |
| Bottom/Top player positions | MAYBE | Keep concept, rename to something less screen-layout-specific (e.g., Player 1 / Player 2, or let players pick a color/side) |
| No persistent identity | OPTIONAL | Guest play works; accounts add leaderboards/history |
| Per-session team saves | IMPROVE | Auto-save fleet between sessions for returning players |

---

## Writing Guide for New UI Copy

When writing any new text for the web port, check it against these principles:

1. **Functional first** — the original UI is ruthlessly functional. Don't sacrifice clarity for flavor.
2. **Earnest, not winking** — never break the fourth wall or use ironic quotation marks. The Spathi don't know they're funny.
3. **Alien-bureaucratic** — prefer slightly formal/technical language over casual. "Commander" not "player." "Fleet" not "ships." "Confirmation" not "ready check."
4. **Brief** — SC2 status messages are short. One or two lines maximum.
5. **Reserve the jokes** — put humor in wait states, error messages, and loading screens, not in primary action labels.

### Voice test

Write your copy, then ask: could this line have been said by a nervous Spathi bureaucrat who's trying to sound brave? If yes, it's probably right. If it sounds like a SaaS product, it's wrong.

**Wrong:** "Let's get you set up! Choose a username to get started."
**Right:** "Register your command designation. A name by which to be remembered, or at least identified."

**Wrong:** "Waiting for opponent..."
**Right:** "Awaiting the opposing commander's fleet confirmation. (They may be reconsidering.)"

**Wrong:** "Connection error. Please try again."
**Right:** "Connection aborted. The remote side has gone silent. Reestablish contact or retreat."
