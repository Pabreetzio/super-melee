import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage } from 'http';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { rooms } from './rooms';
import { sessions } from './session';
import type { ClientMsg, ServerMsg } from '../../shared/types';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Serve client in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(process.cwd(), 'client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Active connections: sessionId → WebSocket
const connections = new Map<string, WebSocket>();

// Per-battle state: roomCode → {hostActive, oppActive}
const battleState = new Map<string, { hostActive: number | null; oppActive: number | null }>();

// Pending checksums: roomCode → frame → {s0?, s1?}
const pendingChecksums = new Map<string, Map<number, { s0?: number; s1?: number }>>();

// Battle-over acks: roomCode → { acks, winners }
const battleOverAcks = new Map<string, { acks: Set<string>; winners: (0 | 1 | null)[] }>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendTo(sessionId: string, msg: ServerMsg) {
  const ws = connections.get(sessionId);
  if (ws) send(ws, msg);
}

function broadcastRoomList() {
  const list = rooms.getPublicRooms();
  const msg: ServerMsg = { type: 'room_list_update', rooms: list };
  for (const [sid, ws] of connections) {
    if (!rooms.getRoomBySession(sid)) {
      send(ws, msg);
    }
  }
}

function cleanupBattleState(roomCode: string) {
  battleState.delete(roomCode);
  pendingChecksums.delete(roomCode);
  battleOverAcks.delete(roomCode);
}

function sessionIdFromReq(req: IncomingMessage): string {
  const url = new URL(req.url ?? '/ws', 'http://localhost');
  const token = url.searchParams.get('token') ?? '';
  return token || uuidv4();
}

// ─── Connection handler ───────────────────────────────────────────────────────

wss.on('connection', (ws, req) => {
  const sessionId = sessionIdFromReq(req);
  const session = sessions.getOrCreate(sessionId);

  // Close stale connection for this session
  const existing = connections.get(sessionId);
  if (existing && existing.readyState === WebSocket.OPEN) {
    existing.close(4001, 'Replaced by new connection');
  }
  connections.set(sessionId, ws);

  // Greet client with session info
  send(ws, { type: 'session', sessionId, commanderName: session.commanderName });

  // If already in a room, restore state
  const existingRoom = rooms.getRoomBySession(sessionId);
  if (existingRoom) {
    const yourSide = rooms.getSide(existingRoom, sessionId) ?? 0;
    send(ws, { type: 'room_joined', room: rooms.toFullState(existingRoom), yourSide });
  } else {
    send(ws, { type: 'room_list', rooms: rooms.getPublicRooms() });
  }

  ws.on('message', (data) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(data.toString()) as ClientMsg; }
    catch { return; }
    handleMessage(sessionId, msg, ws);
  });

  ws.on('close', () => {
    if (connections.get(sessionId) === ws) {
      connections.delete(sessionId);
    }
  });
});

// ─── Message handler ──────────────────────────────────────────────────────────

function handleMessage(sessionId: string, msg: ClientMsg, ws: WebSocket) {
  switch (msg.type) {

    case 'set_name': {
      const name = msg.name.trim().slice(0, 30);
      if (!name) return;
      sessions.setName(sessionId, name);
      break;
    }

    case 'create_room': {
      if (rooms.getRoomBySession(sessionId)) return; // already in a room
      const session = sessions.getOrCreate(sessionId);
      if (!session.commanderName) {
        send(ws, { type: 'error', message: 'Set your commander name first.' });
        return;
      }
      const room = rooms.create(sessionId, session.commanderName, msg.visibility, msg.password);
      send(ws, { type: 'room_created', room: rooms.toFullState(room) });
      broadcastRoomList();
      break;
    }

    case 'join_room': {
      if (rooms.getRoomBySession(sessionId)) return;
      const session = sessions.getOrCreate(sessionId);
      const result = rooms.join(sessionId, session.commanderName, msg.code, msg.password);
      if ('error' in result) {
        send(ws, { type: 'join_error', reason: result.error });
        return;
      }
      const room = result;
      send(ws, { type: 'room_joined', room: rooms.toFullState(room), yourSide: 1 });
      sendTo(room.host.sessionId, {
        type: 'opponent_joined',
        name: room.opponent!.commanderName,
        fleet: room.opponent!.fleet,
        teamName: room.opponent!.teamName,
      });
      broadcastRoomList();
      break;
    }

    case 'leave_room': {
      const result = rooms.leave(sessionId);
      if (!result) return;
      const { room, wasHost } = result;
      if (wasHost) {
        if (room.opponent) sendTo(room.opponent.sessionId, { type: 'opponent_left' });
      } else {
        sendTo(room.host.sessionId, { type: 'opponent_left' });
      }
      cleanupBattleState(room.code);
      broadcastRoomList();
      break;
    }

    case 'fleet_update': {
      const room = rooms.updateFleet(sessionId, msg.slot, msg.ship);
      if (!room) return;
      const opSid = rooms.getOpponentSession(room, sessionId);
      if (opSid) sendTo(opSid, { type: 'opponent_fleet', slot: msg.slot, ship: msg.ship });
      break;
    }

    case 'team_name': {
      const room = rooms.updateTeamName(sessionId, msg.name);
      if (!room) return;
      const opSid = rooms.getOpponentSession(room, sessionId);
      if (opSid) sendTo(opSid, { type: 'opponent_team_name', name: msg.name.slice(0, 20) });
      break;
    }

    case 'rematch_reset': {
      const room = rooms.setRematchReset(sessionId, msg.value);
      if (!room) return;
      sendTo(room.host.sessionId, { type: 'rematch_reset', value: msg.value });
      if (room.opponent) sendTo(room.opponent.sessionId, { type: 'rematch_reset', value: msg.value });
      break;
    }

    case 'confirm': {
      const room = rooms.confirm(sessionId);
      if (!room) return;
      const opSid = rooms.getOpponentSession(room, sessionId);
      if (opSid) sendTo(opSid, { type: 'opponent_confirmed' });

      if (rooms.bothConfirmed(room)) {
        const seed = rooms.startBattle(room);
        battleState.set(room.code, { hostActive: null, oppActive: null });
        const hostFleet = [...room.host.fleet];
        const oppFleet  = room.opponent ? [...room.opponent.fleet] : [];
        sendTo(room.host.sessionId, {
          type: 'battle_start', seed, inputDelay: room.inputDelay, yourSide: 0,
          hostFleet, oppFleet,
        });
        if (room.opponent) {
          sendTo(room.opponent.sessionId, {
            type: 'battle_start', seed, inputDelay: room.inputDelay, yourSide: 1,
            hostFleet, oppFleet,
          });
        }
        broadcastRoomList();
      }
      break;
    }

    case 'cancel_confirm': {
      const room = rooms.cancelConfirm(sessionId);
      if (!room) return;
      const opSid = rooms.getOpponentSession(room, sessionId);
      if (opSid) sendTo(opSid, { type: 'opponent_cancelled' });
      break;
    }

    case 'ship_select': {
      const room = rooms.getRoomBySession(sessionId);
      if (!room || room.state !== 'in_battle') return;
      const side = rooms.getSide(room, sessionId);
      if (side === null) return;

      const bs = battleState.get(room.code);
      if (!bs) return;

      // Kill the player's previously active ship — it just died
      const prevActive = side === 0 ? bs.hostActive : bs.oppActive;
      if (prevActive !== null) {
        rooms.shipKilled(room, side, prevActive);
      }

      // Validate the new selection is still in shipsAlive
      if (!rooms.selectShip(sessionId, msg.slot)) return;

      // Record active ship
      if (side === 0) bs.hostActive = msg.slot;
      else bs.oppActive = msg.slot;

      // Relay to opponent
      const opSid = rooms.getOpponentSession(room, sessionId);
      if (opSid) sendTo(opSid, { type: 'opponent_ship_select', slot: msg.slot });

      // Confirm to sender
      sendTo(sessionId, { type: 'ship_select_prompt' });
      break;
    }

    case 'battle_input': {
      const room = rooms.getRoomBySession(sessionId);
      if (!room || room.state !== 'in_battle') return;
      const opSid = rooms.getOpponentSession(room, sessionId);
      if (opSid) sendTo(opSid, { type: 'battle_input', frame: msg.frame, input: msg.input });
      break;
    }

    case 'checksum': {
      handleChecksum(sessionId, msg.frame, msg.crc);
      break;
    }

    case 'battle_over_ack': {
      handleBattleOverAck(sessionId, msg.winner);
      break;
    }

    case 'rematch': {
      const room = rooms.getRoomBySession(sessionId);
      if (!room || room.state !== 'post_battle') return;
      if (room.host.sessionId !== sessionId) return; // host initiates
      rooms.rematch(room);
      const fullState = rooms.toFullState(room);
      sendTo(room.host.sessionId, { type: 'room_joined', room: fullState, yourSide: 0 });
      if (room.opponent) {
        sendTo(room.opponent.sessionId, { type: 'room_joined', room: fullState, yourSide: 1 });
      }
      break;
    }
  }
}

// ─── Checksum arbitration ─────────────────────────────────────────────────────

function handleChecksum(sessionId: string, frame: number, crc: number) {
  const room = rooms.getRoomBySession(sessionId);
  if (!room || room.state !== 'in_battle') return;
  const side = rooms.getSide(room, sessionId);
  if (side === null) return;

  let roomChecks = pendingChecksums.get(room.code);
  if (!roomChecks) {
    roomChecks = new Map();
    pendingChecksums.set(room.code, roomChecks);
  }
  let check = roomChecks.get(frame);
  if (!check) {
    check = {};
    roomChecks.set(frame, check);
  }

  if (side === 0) check.s0 = crc;
  else check.s1 = crc;

  if (check.s0 !== undefined && check.s1 !== undefined) {
    roomChecks.delete(frame);
    if (check.s0 !== check.s1) {
      sendTo(room.host.sessionId, { type: 'checksum_mismatch', frame });
      if (room.opponent) sendTo(room.opponent.sessionId, { type: 'checksum_mismatch', frame });
    }
  }
}

// ─── Battle-over coordination ─────────────────────────────────────────────────

function handleBattleOverAck(sessionId: string, winner: 0 | 1 | null) {
  const room = rooms.getRoomBySession(sessionId);
  if (!room || room.state !== 'in_battle') return;

  let entry = battleOverAcks.get(room.code);
  if (!entry) {
    entry = { acks: new Set(), winners: [] };
    battleOverAcks.set(room.code, entry);
  }
  if (entry.acks.has(sessionId)) return; // ignore duplicate acks
  entry.acks.add(sessionId);
  entry.winners.push(winner);

  const bothAcked = entry.acks.has(room.host.sessionId) &&
    (!room.opponent || entry.acks.has(room.opponent.sessionId));

  if (bothAcked) {
    // Both clients agree on winner; if they disagree it's a desync → null
    const w0 = entry.winners[0];
    const w1 = entry.winners[1] ?? w0;
    const agreedWinner: 0 | 1 | null = (w0 === w1) ? w0 : null;
    cleanupBattleState(room.code);
    rooms.endBattle(room);
    const overMsg: ServerMsg = { type: 'battle_over', winner: agreedWinner };
    sendTo(room.host.sessionId, overMsg);
    if (room.opponent) sendTo(room.opponent.sessionId, overMsg);
  }
}

// ─── Keepalive ping (prevents Railway/proxy idle-connection timeout) ──────────

const PING_INTERVAL_MS = 30_000;
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  });
}, PING_INTERVAL_MS);

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`Super Melee server listening on :${PORT}`);
});
