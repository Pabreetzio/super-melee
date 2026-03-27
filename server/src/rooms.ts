import { v4 as uuidv4 } from 'uuid';
import {
  FLEET_SIZE, FleetSlot, FullRoomState, PlayerState,
  RoomState, RoomSummary, RoomVisibility, ShipId
} from '../../shared/types';

// Ship point costs — stubs until ship deep-dives are done
const SHIP_COST: Record<ShipId, number> = {
  androsynth: 22, arilou: 18,   chenjesu: 24, chmmr: 26,   druuge: 14,
  human: 16,      ilwrath: 14,  melnorme: 20, mmrnmhrm: 20, mycon: 18,
  orz: 22,        pkunk: 12,    shofixti: 8,  slylandro: 14, spathi: 16,
  supox: 18,      syreen: 18,   thraddash: 16, umgah: 14,   urquan: 28,
  utwig: 22,      vux: 20,      yehat: 20,    zoqfotpik: 16,
  blackurq: 28,   kohrah: 10,   samatra: 0,
};

export function getShipCost(ship: ShipId): number {
  return SHIP_COST[ship] ?? 0;
}

function fleetValue(fleet: FleetSlot[]): number {
  return fleet.reduce((sum, s) => sum + (s ? (SHIP_COST[s] ?? 0) : 0), 0);
}

function makePlayer(sessionId: string, name: string): PlayerState {
  return {
    sessionId,
    commanderName: name,
    teamName: 'Unnamed Fleet',
    fleet: Array(FLEET_SIZE).fill(null),
    confirmed: false,
    shipsAlive: [],
  };
}

// Room codes: 4 uppercase letters, avoiding ambiguous chars
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function genCode(): string {
  return Array.from({ length: 4 }, () =>
    CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  ).join('');
}

interface Room {
  code: string;
  visibility: RoomVisibility;
  passwordHash: string | null;  // simple plaintext for now (friends-only game)
  state: RoomState;
  rematchReset: boolean;
  host: PlayerState;
  opponent?: PlayerState;
  inputDelay: number;
  createdAt: number;
  lastActivityAt: number;
  // Original fleet snapshots for rematch reset
  hostOrigFleet: FleetSlot[];
  hostOrigTeamName: string;
  oppOrigFleet?: FleetSlot[];
  oppOrigTeamName?: string;
}

class RoomManager {
  private rooms = new Map<string, Room>();
  // sessionId → room code
  private sessionRoom = new Map<string, string>();

  private pruneIdle() {
    const IDLE_MS = 30 * 60 * 1000;
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivityAt > IDLE_MS) {
        this.rooms.delete(code);
        this.sessionRoom.delete(room.host.sessionId);
        if (room.opponent) this.sessionRoom.delete(room.opponent.sessionId);
      }
    }
  }

  create(sessionId: string, name: string, visibility: RoomVisibility, password?: string): Room {
    this.pruneIdle();
    // Generate unique code
    let code: string;
    do { code = genCode(); } while (this.rooms.has(code));

    const room: Room = {
      code,
      visibility,
      passwordHash: password ?? null,
      state: 'waiting',
      rematchReset: true,
      host: makePlayer(sessionId, name),
      inputDelay: 2,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      hostOrigFleet: Array(FLEET_SIZE).fill(null),
      hostOrigTeamName: 'Unnamed Fleet',
    };
    this.rooms.set(code, room);
    this.sessionRoom.set(sessionId, code);
    return room;
  }

  join(sessionId: string, name: string, code: string, password?: string): Room | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: 'No engagement found with that code.' };
    if (room.state !== 'waiting') return { error: 'This engagement already has a commander.' };
    if (room.passwordHash && room.passwordHash !== password)
      return { error: 'Access denied. Reconsider your approach.' };

    room.opponent = makePlayer(sessionId, name);
    room.state = 'building';
    room.lastActivityAt = Date.now();
    this.sessionRoom.set(sessionId, code);
    return room;
  }

  leave(sessionId: string): { room: Room; wasHost: boolean } | null {
    const code = this.sessionRoom.get(sessionId);
    if (!code) return null;
    const room = this.rooms.get(code);
    if (!room) return null;

    const wasHost = room.host.sessionId === sessionId;
    this.sessionRoom.delete(sessionId);

    if (wasHost) {
      // If opponent exists, promote or just close
      if (room.opponent) {
        // Close room - could promote opponent but simpler to close
        this.sessionRoom.delete(room.opponent.sessionId);
      }
      this.rooms.delete(code);
    } else {
      room.opponent = undefined;
      room.state = 'waiting';
      room.lastActivityAt = Date.now();
    }
    return { room, wasHost };
  }

  getRoomBySession(sessionId: string): Room | null {
    const code = this.sessionRoom.get(sessionId);
    return code ? (this.rooms.get(code) ?? null) : null;
  }

  getRoom(code: string): Room | null {
    return this.rooms.get(code) ?? null;
  }

  updateFleet(sessionId: string, slot: number, ship: FleetSlot): Room | null {
    const room = this.getRoomBySession(sessionId);
    if (!room || room.state === 'in_battle') return null;
    const player = this.getPlayer(room, sessionId);
    if (!player || slot < 0 || slot >= FLEET_SIZE) return null;
    player.fleet[slot] = ship;
    // Cancel confirmation if they had confirmed
    if (player.confirmed) player.confirmed = false;
    room.lastActivityAt = Date.now();
    return room;
  }

  updateTeamName(sessionId: string, name: string): Room | null {
    const room = this.getRoomBySession(sessionId);
    if (!room) return null;
    const player = this.getPlayer(room, sessionId);
    if (!player) return null;
    player.teamName = name.slice(0, 20);
    room.lastActivityAt = Date.now();
    return room;
  }

  confirm(sessionId: string): Room | null {
    const room = this.getRoomBySession(sessionId);
    if (!room || !room.opponent) return null;
    const player = this.getPlayer(room, sessionId);
    if (!player) return null;
    player.confirmed = true;
    room.lastActivityAt = Date.now();
    return room;
  }

  cancelConfirm(sessionId: string): Room | null {
    const room = this.getRoomBySession(sessionId);
    if (!room) return null;
    const player = this.getPlayer(room, sessionId);
    if (!player) return null;
    player.confirmed = false;
    return room;
  }

  bothConfirmed(room: Room): boolean {
    return !!(room.host.confirmed && room.opponent?.confirmed);
  }

  startBattle(room: Room): number {
    // Save original fleets for rematch
    room.hostOrigFleet = [...room.host.fleet];
    room.hostOrigTeamName = room.host.teamName;
    if (room.opponent) {
      room.oppOrigFleet = [...room.opponent.fleet];
      room.oppOrigTeamName = room.opponent.teamName;
    }
    // Init shipsAlive from fleet
    room.host.shipsAlive = room.host.fleet
      .map((s, i) => (s ? i : -1)).filter(i => i >= 0);
    if (room.opponent) {
      room.opponent.shipsAlive = room.opponent.fleet
        .map((s, i) => (s ? i : -1)).filter(i => i >= 0);
    }
    room.state = 'in_battle';
    room.host.confirmed = false;
    if (room.opponent) room.opponent.confirmed = false;

    // Generate seed server-side — neither client controls it
    const seed = Math.floor(Math.random() * 0x7FFFFFFF) + 1;
    return seed;
  }

  selectShip(sessionId: string, slot: number): boolean {
    const room = this.getRoomBySession(sessionId);
    if (!room) return false;
    const player = this.getPlayer(room, sessionId);
    if (!player) return false;
    // Validate slot is still alive
    if (!player.shipsAlive.includes(slot)) return false;
    return true;
  }

  shipKilled(room: Room, side: 0 | 1, slot: number) {
    const player = side === 0 ? room.host : room.opponent;
    if (!player) return;
    player.shipsAlive = player.shipsAlive.filter(i => i !== slot);
  }

  endBattle(room: Room): void {
    room.state = 'post_battle';
  }

  rematch(room: Room) {
    room.state = 'building';
    room.host.confirmed = false;
    if (room.opponent) room.opponent.confirmed = false;
    if (room.rematchReset) {
      room.host.fleet = [...room.hostOrigFleet];
      room.host.teamName = room.hostOrigTeamName;
      if (room.opponent && room.oppOrigFleet) {
        room.opponent.fleet = [...room.oppOrigFleet];
        room.opponent.teamName = room.oppOrigTeamName ?? 'Unnamed Fleet';
      }
    }
  }

  setRematchReset(sessionId: string, value: boolean): Room | null {
    const room = this.getRoomBySession(sessionId);
    if (!room || room.host.sessionId !== sessionId) return null;
    room.rematchReset = value;
    return room;
  }

  getPublicRooms(): RoomSummary[] {
    return Array.from(this.rooms.values())
      .filter(r => r.state === 'waiting' || r.state === 'building')
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(r => this.toSummary(r));
  }

  toSummary(room: Room): RoomSummary {
    return {
      code: room.code,
      visibility: room.visibility,
      hostName: room.host.commanderName,
      hostFleet: room.host.fleet,
      hostTeamName: room.host.teamName,
      hostFleetValue: fleetValue(room.host.fleet),
      opponentName: room.opponent?.commanderName,
      state: room.state,
    };
  }

  toFullState(room: Room): FullRoomState {
    return {
      code: room.code,
      visibility: room.visibility,
      state: room.state,
      rematchReset: room.rematchReset,
      host: { ...room.host },
      opponent: room.opponent ? { ...room.opponent } : undefined,
      inputDelay: room.inputDelay,
    };
  }

  private getPlayer(room: Room, sessionId: string): PlayerState | null {
    if (room.host.sessionId === sessionId) return room.host;
    if (room.opponent?.sessionId === sessionId) return room.opponent;
    return null;
  }

  getSide(room: Room, sessionId: string): 0 | 1 | null {
    if (room.host.sessionId === sessionId) return 0;
    if (room.opponent?.sessionId === sessionId) return 1;
    return null;
  }

  getOpponentSession(room: Room, sessionId: string): string | null {
    if (room.host.sessionId === sessionId) return room.opponent?.sessionId ?? null;
    if (room.opponent?.sessionId === sessionId) return room.host.sessionId;
    return null;
  }
}

export const rooms = new RoomManager();
