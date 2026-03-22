# Netplay Architecture Analysis

Deep dive based on:
- `uqm-0.8.0/doc/devel/netplay/protocol` — protocol design docs
- `uqm-0.8.0/doc/devel/netplay/states` — connection state machine
- `uqm-0.8.0/src/uqm/supermelee/netplay/packet.h` — every packet type defined
- `uqm-0.8.0/src/uqm/supermelee/netplay/netinput.c` — input delay buffer
- `uqm-0.8.0/src/uqm/supermelee/netplay/checksum.c` — what gets checksummed

---

## How UQM's Netplay Actually Works

### The core idea: lockstep with input delay

UQM uses **delay-based lockstep netplay**. There is no authoritative server. Both clients run the exact same physics simulation and must stay perfectly synchronized.

The key insight: **nothing about game state is transmitted over the network. Only inputs are.**

Every frame, each client sends one byte — their button state — to the other. Both clients run the same deterministic simulation from the same starting seed, processing the same inputs, and therefore always arrive at the same state. If they ever diverge, it's a bug (or cheating), and it's detected immediately.

### Input delay

Default input delay = **2 frames**.

When you press thrust on frame N, that input is applied at frame N+2. This gives the remote client time to receive your frame-N input before it needs to simulate frame N+2.

```
Frame:    1    2    3    4    5    6
You send: i1   i2   i3   i4   i5   i6
Applied:       i1   i2   i3   i4   i5   (2-frame delay)
```

The buffer is pre-filled with 2 zero-inputs so both sides can simulate the first 2 frames immediately without waiting. Buffer size is `delay * 2 + 2` to handle worst-case catch-up.

If a client is waiting for the remote's input and it hasn't arrived yet — it **stalls**. No prediction, no extrapolation. The simulation stops until both sides have the input for the next frame. This is the tradeoff of delay-based vs. rollback: deterministic, simple, but input delay is always felt.

### What actually goes over the wire

Every packet has a 4-byte header: `uint16 length` + `uint16 type`. The full packet type list:

| Packet | Contents | When |
|---|---|---|
| `INIT` | Protocol version, UQM version | Connection established |
| `PING` / `ACK` | uint32 id | Keepalive / latency measurement |
| `READY` | (empty) | Synchronization barrier — "I'm done with this phase" |
| `FLEET` | side + ship array (index + type pairs) | Fleet setup changes |
| `TEAMNAME` | side + name string | Team name changes |
| `HANDSHAKE0` / `HANDSHAKE1` | (empty) | Fleet confirmation protocol |
| `HANDSHAKECANCEL` / `HANDSHAKECANCELACK` | (empty) | Cancel confirmation |
| `SEEDRANDOM` | uint32 seed | **One side sends the RNG seed to the other** |
| `INPUTDELAY` | uint32 delay | Negotiated input delay |
| `SELECTSHIP` | uint16 ship index | Ship selection between rounds |
| `BATTLEINPUT` | **uint8 button state** | **Every frame during battle** |
| `FRAMECOUNT` | uint32 frameCount | At battle end, for catch-up |
| `CHECKSUM` | uint32 frameNr + uint32 checksum | Every frame, for desync detection |
| `ABORT` | uint16 reason | Protocol-level abort |
| `RESET` | uint16 reason | Game reset (return to setup) |

**The battle input packet is one byte.** That's it. The entire physics simulation — ship positions, velocities, projectiles, gravity effects, collision responses — flows deterministically from that single byte per frame per player.

At 24fps, that's **24 bytes/second of game input** per player. The netplay bandwidth is essentially zero.

### What the checksum covers

Every frame, each side computes a CRC over the entire game state and sends it as `PACKET_CHECKSUM`. The checksum covers every element in the simulation queue (ships, projectiles, explosions):

For each element (excluding `BACKGROUND_OBJECT` elements which don't affect state):
- `state_flags` — collision flags, death state, etc.
- `life_span` — ticks remaining
- `crew_level` — current HP
- `mass_points` — mass (affects collision)
- `turn_wait` + `thrust_wait` — control lockout counters
- `velocity` — all five fields of the Bresenham accumulator
- `current` and `next` positions

Plus: the **current RNG state** (seed). This catches any divergence in random number generation.

If the checksums from both sides don't match, it's `ResetReason_syncLoss` — the game aborts.

### The state machine

```
unconnected
    ↓ (TCP connect)
connecting
    ↓ (connection established)
init  ←→ INIT packets exchanged
    ↓
inSetup  ←→ FLEET, TEAMNAME, HANDSHAKE* packets
    ↓ (both confirm)
preBattle  ←→ SEEDRANDOM, INPUTDELAY, READY
    ↓ (both ready)
interBattle  ←→ READY
    ↓
selectShip  ←→ SELECTSHIP             ←── after each round
    ↓
interBattle  ←→ READY
    ↓
inBattle  ←→ BATTLEINPUT, READY      ←── each frame
    ↓ (ship dies / battle ends)
endingBattle  ←→ BATTLEINPUT, FRAMECOUNT
    ↓
endingBattle2  ←→ BATTLEINPUT, READY  (slower side catches up)
    ↓
interBattle  (loop for next ship)
    ↓ (fleet empty)
inSetup  (game over, show results, optionally rematch)
```

### The Update negotiation (fleet setup)

During `inSetup`, both sides can change their fleet simultaneously. The protocol resolves conflicts with an "Update" turn-based negotiation with a tie-breaker (the player who "owns" a property wins conflicts over it). This is how both players can edit their fleet at the same time without locking each other out.

### The Confirm negotiation (starting battle)

Before battle starts, both players must press FIRE. This is a two-phase commit:
- `HANDSHAKE0` = "I confirm" (can still cancel)
- `HANDSHAKE1` = "acknowledging your confirm, my config is unchanged since I confirmed"
- `HANDSHAKECANCEL` = "forget my earlier confirm"
- `HANDSHAKECANCELACK` = "received your cancel"

If either side changes their fleet after sending HANDSHAKE0, they automatically cancel. Battle only starts when both sides have sent and received HANDSHAKE1.

---

## Modernizing for the Web

### Your questions answered directly

**"I thought we would have a web server each user connects to via WebSocket while playing."**

Yes, exactly right. Browsers can't open TCP server sockets, so direct P2P isn't possible without WebRTC. A WebSocket relay server is the right call. The server's job during battle is simple: receive input from Player A, forward it to Player B, and vice versa. No game simulation on the server.

**"I don't know how modern web games handle multiplayer."**

There are three main approaches:

1. **Server-authoritative** — server runs all physics, clients are just renderers. Used by most AAA online games. Cheat-proof but expensive (server CPU), and adds latency.

2. **Delay-based lockstep** — what UQM uses. Clients simulate identically, only inputs travel. Works well for low-latency connections and deterministic simulations. Simple server (relay only). This is what we're doing.

3. **Rollback netcode** (GGPO, used by modern fighting games like Street Fighter 6, Guilty Gear Strive) — no input delay, clients immediately apply local input and predict remote input, roll back and re-simulate when predictions are wrong. Feels best at high latency but much more complex — requires reversible state snapshots every frame.

For SC2 Super Melee, **delay-based lockstep is the right choice**. The game already uses it, the physics is designed around it, and for friends playing over the internet with reasonable latency it works well. Rolling back a physics simulation as complex as UQM's would require significant additional work.

**"Modern games don't let host decide state because that allows them to make new rules, right?"**

Exactly right. In a "host-authoritative" model, the host's game state is truth — so a cheating host can teleport, never die, have infinite energy, etc. UQM avoids this by having NO authoritative host: both clients are peers, each simulating the same state. Neither can lie about physics results because neither sends state — they only send inputs, and the other side computes the results independently.

Our web server doesn't need to be authoritative over physics either. The server's security role is narrower and more targeted (see below).

**"I don't want servers running everything, but it shouldn't allow cheating."**

The lockstep model gives us exactly this. Here's the complete cheat-resistance picture:

---

## Security Model

### What each party controls

| Party | Controls | Cannot control |
|---|---|---|
| Server | RNG seed, room routing, fleet validation, checksum arbitration | Physics simulation |
| Client | Their own inputs | Remote player's inputs, physics outcomes |
| Neither | Game state — it flows from inputs + seed deterministically | — |

### Cheat vectors and mitigations

**1. Manipulating the RNG seed**

In UQM, one player sends the seed to the other (`PACKET_SEEDRANDOM`). If that player is malicious, they could pre-compute which random outcomes they want and choose a seed accordingly.

**Mitigation:** The server generates the RNG seed and sends it to both clients simultaneously. Neither client ever sets the seed. This is a direct improvement over UQM's P2P model.

**2. Sending fake inputs**

A client could try to send inputs they didn't actually press, or modify inputs mid-stream. They can only affect their own ship — the remote client simulates both ships identically using both input streams. Sending fake inputs for yourself doesn't give you physics control you don't already have through legitimate play.

Edge case: could a client send more inputs per tick than allowed, effectively playing at higher speed? Mitigation: the server validates that input packet sequence numbers advance exactly 1 per frame per player. Out-of-sequence or duplicate inputs are dropped.

**3. Lying about game state (desync)**

In UQM, each side sends checksums to each other. A cheating client could lie about their checksum to avoid being caught after manipulating state.

**Mitigation:** Both clients send checksums to the **server**, not to each other. The server compares them. A cheating client would have to know their opponent's checksum to craft a matching fake — impossible without breaking the CRC. If checksums disagree, the server disconnects both with `syncLoss`.

(Note: a sophisticated attacker who has modified their client could potentially compute a correct CRC of tampered state and send it — but this requires reversing the physics, not just setting a health value. For a game among friends this threat doesn't exist. For public matchmaking you'd need more sophisticated anti-cheat, which is a whole different problem.)

**4. Invalid ship selection**

Between rounds, a player reports which ship to deploy next (`PACKET_SELECTSHIP`). A modified client could claim to use a ship they've already lost.

**Mitigation:** The server tracks fleet state independently. It knows which ships each player started with and which have died (based on the `SELECTSHIP` messages it has relayed). It validates each selection against its own fleet record before forwarding to the opponent.

**5. Connection/timing manipulation (lag abuse)**

A player could deliberately introduce lag at critical moments (kill their own connection, pause input). In UQM's lockstep model, if your input stops arriving the opponent's simulation stalls — effectively pausing the game.

**Mitigation:** Server-side timeout. If a player's input hasn't arrived within N milliseconds of when it was due, the server drops the connection for both players (or in a less strict mode, flags the game as having a connectivity issue). The default UQM input delay of 2 frames at 24fps means input must arrive within ~83ms. We can be more lenient for friends.

---

## Proposed Architecture

### Server responsibilities

```
[Player A browser] ←WebSocket→ [Relay Server] ←WebSocket→ [Player B browser]

Server does:
  - Room creation and room codes
  - WebSocket connection management
  - Input packet relay (A→B, B→A)
  - RNG seed generation (sent to both clients at preBattle)
  - Input sequence validation (reject duplicate/out-of-order inputs)
  - Checksum arbitration (receive from both, compare, disconnect on mismatch)
  - Fleet state tracking (validate ship selections)
  - Lobby/matchmaking state (fleet, team names, confirmation status)
  - Timeout enforcement
```

### Client responsibilities

```
Each browser client:
  - Renders the game
  - Captures local input
  - Runs the complete physics simulation (both ships, all projectiles)
  - Sends 1 byte of input per frame to server
  - Receives 1 byte of remote input per frame from server
  - Computes CRC of game state each frame, sends to server
  - Waits if remote input hasn't arrived (lockstep stall)
```

### Message shape (WebSocket, JSON or binary)

For the web port, we'll use JSON for lobby messages (low frequency, human-readable debugging) and a compact binary format for battle messages (high frequency).

**Lobby messages (JSON over WebSocket):**

```jsonc
// Client → Server
{ "type": "fleet_update", "slot": 3, "ship": "spathi" }
{ "type": "team_name", "name": "The Fearful Nine" }
{ "type": "confirm" }
{ "type": "cancel_confirm" }

// Server → Client
{ "type": "opponent_fleet_update", "slot": 3, "ship": "spathi" }
{ "type": "opponent_team_name", "name": "Death Squadron" }
{ "type": "opponent_confirmed" }
{ "type": "battle_start", "seed": 2847392847, "input_delay": 2 }
{ "type": "ship_select_prompt" }  // your turn to pick next ship
```

**Battle messages (binary over WebSocket, 5 bytes each):**

```
[1 byte type][4 bytes payload]

type 0x01 = BATTLE_INPUT:   [frame_lo][frame_hi][input_byte][0x00]
type 0x02 = CHECKSUM:       [frame_lo][frame_hi][crc_lo][crc_hi]  (16-bit frame, 16-bit crc sufficient)
type 0x03 = SHIP_SELECT:    [slot][0x00][0x00][0x00]
type 0x04 = BATTLE_END:     [frame_lo][frame_hi][0x00][0x00]
```

The battle input byte layout (mirrors UQM's `BATTLE_INPUT_STATE`):
```
bit 0: thrust (up)
bit 1: down
bit 2: rotate left
bit 3: rotate right
bit 4: fire (weapon)
bit 5: special ability
```

### The input delay parameter

In UQM, this is exposed raw to the user (0-9). Don't do that. Instead:

- Default to 2 frames (faithful to UQM default, works for most connections)
- Optionally: measure round-trip latency during the PING/ACK phase before battle and auto-set: `delay = ceil((rtt_ms / 1000) * 24) + 1` (one frame per ~42ms of latency, plus one for safety)
- Expose only as "Connection quality" in UI, not as a raw number

### Server load

For a 2-player game at 24fps:
- **Incoming:** 2 players × 5 bytes × 24fps = **240 bytes/second**
- **Outgoing:** same bytes forwarded to the other player = **240 bytes/second**
- Plus checksums: 2 × 5 bytes × 24fps = **240 bytes/second in**

Total per active game: ~720 bytes/second bidirectional. A single server can handle thousands of concurrent games. The server's CPU is essentially idle during battle — it's just copying bytes.

Lobby state is even lighter — only changes when a player modifies their fleet.

---

## Determinism Requirements for the TypeScript Port

This is the critical implementation constraint. The checksum system only works if both browsers produce byte-for-byte identical physics results. Sources of non-determinism to eliminate:

| Risk | Mitigation |
|---|---|
| `Math.random()` | Never call this in sim code. Use a seeded integer PRNG (xoshiro128) |
| `Math.sin()` / `Math.cos()` | Never call these in sim code. Use the 64-entry integer sine table from UQM |
| Floating-point arithmetic | All physics math in 32-bit integers. No floats in the sim loop. |
| JavaScript `number` precision | JS numbers are float64. Integer arithmetic up to 2^53 is exact — fine for our values. |
| Object iteration order | If you ever iterate `Map`, `Set`, or object keys in sim code, order must be deterministic. Use arrays. |
| Async operations in sim loop | The sim loop must be synchronous and pure. No async/await, no Promises. |
| Date/time functions | Never call `Date.now()` or `performance.now()` inside sim tick. Frame counter only. |
| Browser-specific behavior | No APIs in the sim. Ship the sim as a pure TypeScript module with zero browser imports. |

**The element queue must be ordered deterministically.** In UQM, elements are processed in linked-list order (insertion order). Our TypeScript equivalent must maintain the same ordering. New elements (projectiles fired, explosion fragments) must be inserted in exactly the same position in the queue on both clients, which flows naturally from processing the same inputs in the same order.

---

## Open Questions

- [ ] WebRTC data channels as an alternative to WebSocket relay? (Would allow true P2P, reduce server load, but adds implementation complexity and STUN/TURN infrastructure)
- [ ] What input delay feels right for typical internet play? Measure in testing.
- [ ] Should ship selection validation happen on server (safest) or trust client? (For friends, trust is fine — document the choice.)
- [ ] How do we handle one player losing connection mid-battle? Pause and retry, or declare forfeit after timeout?
- [ ] Frame rate: lock to 24fps in the browser or allow higher with interpolated rendering?
