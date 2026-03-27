// Shared types used by both client and server.
// Server imports from '../../shared/types', client from '../../../shared/types'.

export const FLEET_SIZE = 14; // 2 rows × 7 columns

export type ShipId =
  | 'androsynth' | 'arilou'   | 'chenjesu' | 'chmmr'     | 'druuge'
  | 'human'      | 'ilwrath'  | 'melnorme' | 'mmrnmhrm'  | 'mycon'
  | 'orz'        | 'pkunk'    | 'shofixti' | 'slylandro' | 'spathi'
  | 'supox'      | 'syreen'   | 'thraddash'| 'umgah'     | 'urquan'
  | 'utwig'      | 'vux'      | 'yehat'    | 'zoqfotpik'
  | 'blackurq'   | 'kohrah'   | 'samatra';

export type FleetSlot = ShipId | null;

export type RoomVisibility = 'public' | 'private';

export type RoomState =
  | 'waiting'     // host alone, no opponent
  | 'building'    // both present, editing fleets
  | 'confirmed'   // both confirmed, pre-battle negotiation
  | 'in_battle'   // server is relay-only
  | 'post_battle';// results, rematch prompt

export interface RoomSummary {
  code: string;
  visibility: RoomVisibility;
  hostName: string;
  hostFleet: FleetSlot[];
  hostTeamName: string;
  hostFleetValue: number;
  opponentName?: string;
  state: RoomState;
}

export interface PlayerState {
  sessionId: string;
  commanderName: string;
  teamName: string;
  fleet: FleetSlot[];         // length = FLEET_SIZE
  confirmed: boolean;
  shipsAlive: number[];       // slot indices still alive
}

export interface FullRoomState {
  code: string;
  visibility: RoomVisibility;
  state: RoomState;
  rematchReset: boolean;      // true = reset to original fleets (default)
  host: PlayerState;
  opponent?: PlayerState;
  inputDelay: number;
}

// ─── Lobby WebSocket Messages (JSON) ─────────────────────────────────────────

// Client → Server
export type ClientMsg =
  | { type: 'set_name';        name: string }
  | { type: 'create_room';     visibility: RoomVisibility; password?: string }
  | { type: 'join_room';       code: string; password?: string }
  | { type: 'leave_room' }
  | { type: 'fleet_update';    slot: number; ship: FleetSlot }
  | { type: 'team_name';       name: string }
  | { type: 'rematch_reset';   value: boolean }
  | { type: 'confirm' }
  | { type: 'cancel_confirm' }
  | { type: 'ship_select';     slot: number }   // between rounds
  | { type: 'battle_input';    frame: number; input: number }
  | { type: 'checksum';        frame: number; crc: number }
  | { type: 'battle_over_ack'; winner: 0 | 1 | null }
  | { type: 'rematch' };

// Server → Client
export type ServerMsg =
  | { type: 'session';             sessionId: string; commanderName: string }
  | { type: 'room_list';           rooms: RoomSummary[] }
  | { type: 'room_created';        room: FullRoomState }
  | { type: 'room_joined';         room: FullRoomState; yourSide: 0 | 1 }
  | { type: 'join_error';          reason: string }
  | { type: 'opponent_joined';     name: string; fleet: FleetSlot[]; teamName: string }
  | { type: 'opponent_left' }
  | { type: 'opponent_fleet';      slot: number; ship: FleetSlot }
  | { type: 'opponent_team_name';  name: string }
  | { type: 'opponent_confirmed' }
  | { type: 'opponent_cancelled' }
  | { type: 'rematch_reset';       value: boolean }
  | { type: 'battle_start';        seed: number; inputDelay: number; yourSide: 0 | 1; hostFleet: FleetSlot[]; oppFleet: FleetSlot[] }
  | { type: 'battle_input';        frame: number; input: number }
  | { type: 'checksum_mismatch';   frame: number }
  | { type: 'ship_select_prompt' }
  | { type: 'opponent_ship_select';slot: number }
  | { type: 'battle_over';         winner: 0 | 1 | null }
  | { type: 'room_list_update';    rooms: RoomSummary[] }
  | { type: 'error';               message: string };
