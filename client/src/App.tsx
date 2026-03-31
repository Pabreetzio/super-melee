import { useState, useEffect, useReducer, useRef } from 'react';
import { client } from './net/client';
import type { FullRoomState, FleetSlot, RoomSummary, ServerMsg } from 'shared/types';
import Landing from './components/Landing';
import GameBrowser from './components/GameBrowser';
import FleetBuilder from './components/FleetBuilder';
import Battle from './components/Battle';
import type { WinnerShipState } from './components/Battle';
import { SHIP_ICON } from './components/ShipPicker';
import SuperMelee from './components/SuperMelee';
import type { BattleStartParams } from './components/SuperMelee';
import { SHIP_COSTS } from './components/SuperMelee';
import BGBuilder from './components/BGBuilder';

// ─── App state ────────────────────────────────────────────────────────────────

type Screen = 'supermelee' | 'bgbuilder' | 'landing' | 'browser' | 'fleet_builder' | 'battle' | 'post_battle' | 'ship_select';

interface AppState {
  screen:        Screen;
  connected:     boolean;
  sessionId:     string;
  commanderName: string;
  rooms:         RoomSummary[];
  room:          FullRoomState | null;
  yourSide:      0 | 1;
  battleSeed:    number;
  inputDelay:    number;
  winner:        0 | 1 | null | undefined; // undefined = not yet
  joinError:     string;
  shipSelectSide: 0 | 1 | null;
  // Simultaneous pick mode (LOCAL2P): both pickers visible at once
  shipSelectBoth:   boolean;
  shipSelectP0Slot: number | null; // P1's pending pick slot while waiting for P2
  shipSelectP1Slot: number | null; // P2's pending pick slot while waiting for P1
  // Active battle slot for each side (offline modes); null = use fleet.find(Boolean) fallback
  activeSlot0: number | null;
  activeSlot1: number | null;
  // Winner's ship state preserved between rounds (offline modes only)
  winnerState:   WinnerShipState | null;
  // Original fleets captured at first engage; used to restore on rematch
  originalFleets: { host: FleetSlot[]; opponent: FleetSlot[] } | null;
  // Where to go after post_battle "leave"
  battleOrigin:  'supermelee' | 'browser';
}

type Action =
  | { type: 'connected' }
  | { type: 'session';        sessionId: string; commanderName: string }
  | { type: 'name_set';       name: string }
  | { type: 'room_list';      rooms: RoomSummary[] }
  | { type: 'room_entered';   room: FullRoomState; side: 0 | 1 }
  | { type: 'room_updated';   room: FullRoomState }
  | { type: 'join_error';     reason: string }
  | { type: 'opponent_left' }
  | { type: 'battle_start';   seed: number; inputDelay: number; yourSide: 0 | 1; hostFleet: FleetSlot[]; oppFleet: FleetSlot[] }
  | { type: 'battle_over';    winner: 0 | 1 | null; winnerState?: WinnerShipState }
  | { type: 'ship_chosen';    side: 0 | 1; slot: number }
  | { type: 'go_browser' }
  | { type: 'go_supermelee' }
  | { type: 'go_landing' }
  | { type: 'start_solo';     commanderName: string }
  | { type: 'solo_engage';    fleet: FleetSlot[] }
  | { type: 'start_local2p';  commanderName: string }
  | { type: 'local2p_engage'; fleet0: FleetSlot[]; fleet1: FleetSlot[] }
  | { type: 'supermelee_start'; params: BattleStartParams }
  | { type: 'forfeit_game';    side: 0 | 1 }
  | { type: 'go_bgbuilder' };

function init(): AppState {
  return {
    screen:        'supermelee',
    connected:     false,
    sessionId:     '',
    commanderName: '',
    rooms:         [],
    room:          null,
    yourSide:      0,
    battleSeed:    1,
    inputDelay:    2,
    winner:        undefined,
    joinError:     '',
    shipSelectSide: null,
    shipSelectBoth:   false,
    shipSelectP0Slot: null,
    shipSelectP1Slot: null,
    activeSlot0: null,
    activeSlot1: null,
    winnerState:   null,
    originalFleets: null,
    battleOrigin:  'supermelee',
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'connected':
      return { ...state, connected: true };

    case 'session':
      return {
        ...state,
        sessionId:     action.sessionId,
        commanderName: action.commanderName,
        // Always start (or stay) on supermelee; the net browser is accessed via NET button
        screen: state.screen === 'supermelee' || state.screen === 'landing' ? 'supermelee' : state.screen,
      };

    case 'name_set':
      return { ...state, commanderName: action.name, screen: 'browser' };

    case 'room_list':
      return { ...state, rooms: action.rooms };

    case 'room_entered':
      return {
        ...state,
        room:     action.room,
        yourSide: action.side,
        screen:   'fleet_builder',
        joinError: '',
      };

    case 'room_updated':
      return { ...state, room: action.room };

    case 'join_error':
      return { ...state, joinError: action.reason };

    case 'opponent_left': {
      if (!state.room) return state;
      if (state.yourSide === 1) {
        // Host left → room gone → go to browser
        return { ...state, room: null, screen: 'browser' };
      }
      // Opponent left → stay in fleet builder, update room
      const updated: FullRoomState = { ...state.room, opponent: undefined, state: 'waiting' };
      return { ...state, room: updated };
    }

    case 'battle_start': {
      // Patch room with authoritative fleet from server so Battle.tsx sees
      // the correct ship types on both sides (roomPatch only tracks opponent
      // incremental updates; local fleet changes never echo back to roomPatch).
      const patchedRoom = state.room ? {
        ...state.room,
        host:     { ...state.room.host,     fleet: action.hostFleet },
        opponent: state.room.opponent
          ? { ...state.room.opponent, fleet: action.oppFleet }
          : state.room.opponent,
      } : state.room;
      return {
        ...state,
        screen:       'battle',
        battleSeed:   action.seed,
        inputDelay:   action.inputDelay,
        yourSide:     action.yourSide,
        winner:       undefined,
        room:         patchedRoom,
        battleOrigin: 'browser',
      };
    }

    case 'battle_over': {
      const isSolo    = state.room?.code === 'SOLO';
      const isLocal2P = state.room?.code === 'LOCAL2P';
      if ((!isSolo && !isLocal2P) || !state.room) {
        // Online: server handles the multi-ship flow; go straight to post_battle
        return { ...state, screen: 'post_battle', winner: action.winner, winnerState: null };
      }

      const winner = action.winner;
      // Preserve the winner's ship state for the next battle (offline modes only).
      // On draw, clear winner state.
      const nextWinnerState = winner !== null ? (action.winnerState ?? null) : null;
      const hostFleet = [...state.room.host.fleet] as FleetSlot[];
      const oppFleet  = [...(state.room.opponent?.fleet ?? [])] as FleetSlot[];

      // Consume the losing (or both-on-draw) active ships.
      // Use tracked activeSlot when available; fall back to first non-null for
      // robustness (online mode / SOLO AI auto-pick).
      const hostIdx = state.activeSlot0 ?? hostFleet.findIndex(s => s !== null);
      const oppIdx  = state.activeSlot1 ?? oppFleet.findIndex(s => s !== null);
      if (winner !== 0 && hostIdx >= 0) hostFleet[hostIdx] = null; // host lost or draw
      if (winner !== 1 && oppIdx  >= 0) oppFleet[oppIdx]  = null; // opp lost or draw

      // Recalculate shipsAlive after removing dead ships
      const getAliveSlots = (fleet: FleetSlot[]) =>
        fleet.map((ship, idx) => ship !== null ? idx : -1).filter(idx => idx >= 0);

      const updatedRoom: FullRoomState = {
        ...state.room,
        host:     { ...state.room.host,      fleet: hostFleet, shipsAlive: getAliveSlots(hostFleet) },
        opponent: state.room.opponent ? { ...state.room.opponent, fleet: oppFleet, shipsAlive: getAliveSlots(oppFleet) } : undefined,
      };

      const hostHasShips = hostFleet.some(Boolean);
      const oppHasShips  = oppFleet.some(Boolean);

      // True game over — at least one side exhausted
      if (!hostHasShips || !oppHasShips) {
        const finalWinner: 0 | 1 | null =
          !hostHasShips && !oppHasShips ? null
          : !hostHasShips ? 1 : 0;
        return { ...state, room: updatedRoom, screen: 'post_battle', winner: finalWinner, winnerState: null, activeSlot0: null, activeSlot1: null };
      }

      // Who needs to pick?  Loser picks; on draw, host picks first.
      const shipSelectSide: 0 | 1 = winner === 0 ? 1 : 0;

      // Reset the loser's active slot; winner's persists for the next round
      const nextActiveSlot0 = winner === 0 ? state.activeSlot0 : null;
      const nextActiveSlot1 = winner === 1 ? state.activeSlot1 : null;

      return {
        ...state, room: updatedRoom,
        screen: 'ship_select', shipSelectSide,
        winner, // keep so ship_chosen knows if it was a draw
        winnerState: nextWinnerState,
        activeSlot0: nextActiveSlot0, activeSlot1: nextActiveSlot1,
        shipSelectBoth: false, shipSelectP0Slot: null, shipSelectP1Slot: null,
      };
    }

    case 'ship_chosen': {
      if (!state.room) return state;
      const { side, slot } = action;
      const isSolo = state.room.code === 'SOLO';

      // Record which slot each side is fighting with. Fleets are NOT reordered;
      // ships stay in their original grid positions. The active slot is used by
      // Battle.tsx to look up the ship type and by battle_over to null the right slot.
      const newActiveSlot0 = side === 0 ? slot : state.activeSlot0;
      const newActiveSlot1 = side === 1 ? slot : state.activeSlot1;

      // Simultaneous picking (LOCAL2P split-screen): wait for both sides before starting
      if (state.shipSelectBoth) {
        const p0 = side === 0 ? slot : state.shipSelectP0Slot;
        const p1 = side === 1 ? slot : state.shipSelectP1Slot;
        if (p0 !== null && p1 !== null) {
          // Both picked — start battle
          return {
            ...state,
            activeSlot0: newActiveSlot0, activeSlot1: newActiveSlot1,
            screen: 'battle', battleSeed: state.battleSeed,
            winner: undefined, shipSelectSide: null,
            shipSelectBoth: false, shipSelectP0Slot: null, shipSelectP1Slot: null,
          };
        }
        // One side picked; wait for the other
        return { ...state, activeSlot0: newActiveSlot0, activeSlot1: newActiveSlot1, shipSelectP0Slot: p0, shipSelectP1Slot: p1 };
      }

      // Draw + LOCAL2P sequential: host just picked, now opponent must pick
      if (state.winner === null && !isSolo && side === 0) {
        return { ...state, activeSlot0: newActiveSlot0, screen: 'ship_select', shipSelectSide: 1 };
      }

      // Otherwise start the next battle
      return {
        ...state,
        activeSlot0: newActiveSlot0, activeSlot1: newActiveSlot1,
        screen: 'battle', battleSeed: Date.now() & 0x7FFFFFFF,
        winner: undefined, shipSelectSide: null,
      };
    }

    case 'forfeit_game': {
      const winner: 0 | 1 = action.side === 0 ? 1 : 0;
      return { ...state, screen: 'post_battle', winner, winnerState: null };
    }

    case 'go_browser':
      return { ...state, screen: 'browser', room: null, joinError: '', originalFleets: null, activeSlot0: null, activeSlot1: null };

    case 'go_supermelee':
      return { ...state, screen: 'supermelee', room: null, joinError: '', originalFleets: null, activeSlot0: null, activeSlot1: null };

    case 'go_landing':
      return { ...state, screen: 'landing' };

    case 'go_bgbuilder':
      return { ...state, screen: 'bgbuilder' };

    case 'supermelee_start': {
      const { params } = action;
      const isLocal2P = params.p2Control === 'human';
      const code = isLocal2P ? 'LOCAL2P' : 'SOLO';

      // Calculate actual alive ship slots (all non-null slots initially)
      const getAliveSlots = (fleet: FleetSlot[]) =>
        fleet.map((ship, idx) => ship !== null ? idx : -1).filter(idx => idx >= 0);

      const room: FullRoomState = {
        code,
        visibility: 'public',
        state: 'in_battle',
        rematchReset: false,
        inputDelay: 0,
        host: {
          sessionId: 'p1',
          commanderName: state.commanderName || 'Commander',
          teamName: params.teamName1,
          fleet: params.fleet1,
          confirmed: true,
          shipsAlive: getAliveSlots(params.fleet1),
        },
        opponent: {
          sessionId: isLocal2P ? 'p2' : 'ai',
          commanderName: isLocal2P ? 'Commander 2' : 'AI Commander',
          teamName: params.teamName2,
          fleet: params.fleet2,
          confirmed: true,
          shipsAlive: getAliveSlots(params.fleet2),
        },
      };
      const seed = Date.now() & 0x7FFFFFFF;
      return {
        ...state,
        screen:           'ship_select',
        room,
        battleSeed:       seed,
        inputDelay:       0,
        yourSide:         0,
        winner:           undefined,
        winnerState:      null,
        originalFleets:   { host: params.fleet1, opponent: params.fleet2 },
        battleOrigin:     'supermelee',
        // LOCAL2P: both players pick simultaneously; SOLO: only human (side 0) picks
        shipSelectSide:   0,
        shipSelectBoth:   true, // always show both sides at game start
        shipSelectP0Slot: null,
        shipSelectP1Slot: null,
      };
    }

    case 'start_local2p': {
      const localRoom: FullRoomState = {
        code: 'LOCAL2P',
        visibility: 'public',
        state: 'building',
        rematchReset: false,
        inputDelay: 0,
        host: {
          sessionId: 'p1',
          commanderName: action.commanderName,
          teamName: 'Player 1',
          fleet: Array(14).fill(null) as FleetSlot[],
          confirmed: false,
          shipsAlive: [],
        },
        opponent: {
          sessionId: 'p2',
          commanderName: 'Player 2',
          teamName: 'Player 2',
          fleet: Array(14).fill(null) as FleetSlot[],
          confirmed: false,
          shipsAlive: [],
        },
      };
      return { ...state, screen: 'fleet_builder', room: localRoom, yourSide: 0, winner: undefined, originalFleets: null };
    }

    case 'local2p_engage': {
      if (!state.room) return state;

      const getAliveSlots = (fleet: FleetSlot[]) =>
        fleet.map((ship, idx) => ship !== null ? idx : -1).filter(idx => idx >= 0);

      const updatedRoom: FullRoomState = {
        ...state.room,
        state: 'in_battle',
        host:     { ...state.room.host,      fleet: action.fleet0, confirmed: true, shipsAlive: getAliveSlots(action.fleet0) },
        opponent: { ...state.room.opponent!, fleet: action.fleet1, confirmed: true, shipsAlive: getAliveSlots(action.fleet1) },
      };
      const newOriginal = state.originalFleets ?? { host: action.fleet0, opponent: action.fleet1 };
      const seed = Date.now() & 0x7FFFFFFF;
      // Supermelee rematch: show ship picker before each match
      if (state.battleOrigin === 'supermelee') {
        return {
          ...state,
          screen: 'ship_select',
          room: updatedRoom,
          battleSeed: seed,
          inputDelay: 0,
          yourSide: 0,
          winner: undefined,
          winnerState: null,
          originalFleets: newOriginal,
          shipSelectSide:   0,
          shipSelectBoth:   true,
          shipSelectP0Slot: null,
          shipSelectP1Slot: null,
        };
      }
      return {
        ...state,
        screen: 'battle',
        room: updatedRoom,
        battleSeed: seed,
        inputDelay: 0,
        yourSide: 0,
        winner: undefined,
        winnerState: null,
        originalFleets: newOriginal,
      };
    }

    case 'start_solo': {
      // AI gets a varied preset fleet.
      const aiFleet: FleetSlot[] = [
        'urquan',    'chmmr',    'orz',       'androsynth',
        'yehat',     'mycon',    'spathi',     'thraddash',
        'ilwrath',   'pkunk',    'druuge',     'vux',
        'arilou',    'umgah',
      ];
      const soloRoom: FullRoomState = {
        code: 'SOLO',
        visibility: 'public',
        state: 'building',
        rematchReset: false,
        inputDelay: 0,
        host: {
          sessionId: 'player',
          commanderName: action.commanderName,
          teamName: 'Your Fleet',
          fleet: Array(14).fill(null) as FleetSlot[],
          confirmed: false,
          shipsAlive: [],
        },
        opponent: {
          sessionId: 'ai',
          commanderName: 'AI Commander',
          teamName: 'AI Fleet',
          fleet: aiFleet,
          confirmed: true,  // AI is always ready
          shipsAlive: [],
        },
      };
      return {
        ...state,
        screen: 'fleet_builder',
        room: soloRoom,
        yourSide: 0,
        winner: undefined,
        originalFleets: null,
      };
    }

    case 'solo_engage': {
      // Player confirmed their fleet — start battle locally, no server
      if (!state.room) return state;

      const getAliveSlots = (fleet: FleetSlot[]) =>
        fleet.map((ship, idx) => ship !== null ? idx : -1).filter(idx => idx >= 0);

      const updatedRoom: FullRoomState = {
        ...state.room,
        state: 'in_battle',
        host: { ...state.room.host, fleet: action.fleet, confirmed: true, shipsAlive: getAliveSlots(action.fleet) },
        opponent: { ...state.room.opponent!, shipsAlive: getAliveSlots(state.room.opponent!.fleet) },
      };
      const newOriginal = state.originalFleets ?? {
        host:     action.fleet,
        opponent: state.room.opponent!.fleet,
      };
      const seed = Date.now() & 0x7FFFFFFF;
      // Supermelee rematch: show ship picker before each match
      if (state.battleOrigin === 'supermelee') {
        return {
          ...state,
          screen: 'ship_select',
          room: updatedRoom,
          battleSeed: seed,
          inputDelay: 0,
          yourSide: 0,
          winner: undefined,
          winnerState: null,
          originalFleets: newOriginal,
          shipSelectSide:   0,
          shipSelectBoth:   false,
          shipSelectP0Slot: null,
          shipSelectP1Slot: null,
        };
      }
      return {
        ...state,
        screen: 'battle',
        room: updatedRoom,
        battleSeed: seed,
        inputDelay: 0,
        yourSide: 0,
        winner: undefined,
        winnerState: null,
        originalFleets: newOriginal,
      };
    }

    default:
      return state;
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

function applyServerMsg(msg: ServerMsg, dispatch: React.Dispatch<Action>): void {
  switch (msg.type) {
    case 'session':
      dispatch({ type: 'session', sessionId: msg.sessionId, commanderName: msg.commanderName });
      break;
    case 'room_list':
    case 'room_list_update':
      dispatch({ type: 'room_list', rooms: msg.rooms });
      break;
    case 'room_created':
      dispatch({ type: 'room_entered', room: msg.room, side: 0 });
      break;
    case 'room_joined':
      dispatch({ type: 'room_entered', room: msg.room, side: msg.yourSide });
      break;
    case 'join_error':
      dispatch({ type: 'join_error', reason: msg.reason });
      break;
    case 'opponent_left':
      dispatch({ type: 'opponent_left' });
      break;
    case 'battle_start':
      dispatch({ type: 'battle_start', seed: msg.seed, inputDelay: msg.inputDelay, yourSide: msg.yourSide, hostFleet: msg.hostFleet, oppFleet: msg.oppFleet });
      break;
    case 'battle_over':
      dispatch({ type: 'battle_over', winner: msg.winner });
      break;

    // Fleet/room updates — we rebuild FullRoomState from incremental patches
    // For simplicity, we dispatch room_updated when we have the full state.
    // Incremental patches (opponent_fleet, opponent_team_name, etc.) are handled
    // by the FleetBuilder component reading state from a ref updated here.
    default:
      break;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, init);

  // We use a separate room ref so FleetBuilder can apply incremental patches
  const [roomPatch, setRoomPatch] = useState<FullRoomState | null>(null);

  useEffect(() => {
    const unsubMsg = client.onMessage((msg: ServerMsg) => {
      applyServerMsg(msg, dispatch);

      // Handle incremental fleet/confirmation patches (server messages only)
      setRoomPatch(prev => {
        // These always replace roomPatch — must be before the null guard
        if (msg.type === 'room_joined' || msg.type === 'room_created') return msg.room;
        if (!prev) return prev;
        switch (msg.type) {
          case 'opponent_joined': {
            const opp = {
              sessionId: '__opp__',
              commanderName: msg.name,
              teamName: msg.teamName,
              fleet: msg.fleet,
              confirmed: false,
              shipsAlive: [],
            };
            return { ...prev, opponent: opp, state: 'building' };
          }
          case 'opponent_fleet': {
            if (!prev.opponent) return prev;
            const fleet = [...prev.opponent.fleet];
            fleet[msg.slot] = msg.ship;
            return { ...prev, opponent: { ...prev.opponent, fleet } };
          }
          case 'opponent_team_name': {
            if (!prev.opponent) return prev;
            return { ...prev, opponent: { ...prev.opponent, teamName: msg.name } };
          }
          case 'opponent_confirmed': {
            if (!prev.opponent) return prev;
            return { ...prev, opponent: { ...prev.opponent, confirmed: true } };
          }
          case 'opponent_cancelled': {
            if (!prev.opponent) return prev;
            return { ...prev, opponent: { ...prev.opponent, confirmed: false } };
          }
          case 'rematch_reset':
            return { ...prev, rematchReset: msg.value };
          case 'battle_start':
            // Stamp authoritative fleet onto roomPatch so Battle.tsx reads the
            // correct ship types — local fleet changes never echo back via ws.
            return {
              ...prev,
              host:     { ...prev.host,     fleet: msg.hostFleet },
              opponent: prev.opponent
                ? { ...prev.opponent, fleet: msg.oppFleet }
                : prev.opponent,
            };
          default:
            return prev;
        }
      });
    });

    const unsubConnect = client.onConnect(() => dispatch({ type: 'connected' }));
    client.connect();

    return () => {
      unsubMsg();
      unsubConnect();
      client.disconnect();
    };
  }, []);

  // Sync roomPatch when room_entered fires
  useEffect(() => {
    if (state.room) setRoomPatch(state.room);
    else setRoomPatch(null);
  }, [state.room]);

  // Join error — pass down to browser
  const { joinError } = state;

  switch (state.screen) {
    case 'supermelee':
      return (
        <SuperMelee
          onBattle={params => dispatch({ type: 'supermelee_start', params })}
          onNet={() => {
            // Need a commander name for online play; prompt via landing if missing
            if (!state.commanderName) {
              dispatch({ type: 'go_landing' });
            } else {
              dispatch({ type: 'go_browser' });
            }
          }}
          onBGBuilder={() => dispatch({ type: 'go_bgbuilder' })}
        />
      );

    case 'bgbuilder':
      return <BGBuilder onBack={() => dispatch({ type: 'go_supermelee' })} />;

    case 'landing':
      return (
        <Landing
          initialName={state.commanderName}
          onNameSet={name => dispatch({ type: 'name_set', name })}
        />
      );

    case 'browser':
      return (
        <>
          <GameBrowser
            commanderName={state.commanderName}
            rooms={state.rooms}
            onSolo={() => dispatch({ type: 'start_solo', commanderName: state.commanderName })}
            onLocal2P={() => dispatch({ type: 'start_local2p', commanderName: state.commanderName })}
            onBack={() => dispatch({ type: 'go_supermelee' })}
          />
          {joinError && (
            <div style={{
              position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
              background: 'var(--bg1)', border: '1px solid var(--danger)',
              borderRadius: 4, padding: '10px 20px', color: 'var(--danger)',
            }}>
              {joinError}
            </div>
          )}
        </>
      );

    case 'fleet_builder': {
      const isOfflineRoom = roomPatch?.code === 'SOLO' || roomPatch?.code === 'LOCAL2P';
      return roomPatch ? (
        <FleetBuilder
          room={roomPatch}
          yourSide={state.yourSide}
          onLeave={() => {
            if (!isOfflineRoom) client.send({ type: 'leave_room' });
            dispatch({ type: 'go_browser' });
          }}
          onSoloEngage={roomPatch.code === 'SOLO'
            ? (fleet) => dispatch({ type: 'solo_engage', fleet })
            : undefined}
          onLocal2PEngage={roomPatch.code === 'LOCAL2P'
            ? (fleet0, fleet1) => dispatch({ type: 'local2p_engage', fleet0, fleet1 })
            : undefined}
        />
      ) : null;
    }

    case 'battle': {
      // Offline modes: use state.room directly — roomPatch lags one render
      // behind and would supply stale null fleets on the first battle frame.
      // Online modes: use roomPatch which carries incremental fleet patches
      // applied by the server message handler.
      const isOfflineBattle = state.room?.code === 'SOLO' || state.room?.code === 'LOCAL2P';
      const battleRoom = isOfflineBattle ? state.room : (roomPatch ?? state.room);
      return battleRoom ? (
        <Battle
          key={state.battleSeed}
          room={battleRoom}
          yourSide={state.yourSide}
          seed={state.battleSeed}
          inputDelay={state.inputDelay}
          isAI={battleRoom.code === 'SOLO'}
          isLocal2P={battleRoom.code === 'LOCAL2P'}
          winnerState={state.winnerState}
          activeSlot0={state.activeSlot0}
          activeSlot1={state.activeSlot1}
          onBattleEnd={(winner, ws) => dispatch({ type: 'battle_over', winner, winnerState: ws })}
        />
      ) : null;
    }

    case 'ship_select': {
      if (!state.room) return null;
      const isSolo = state.room.code === 'SOLO';
      const origHost = state.originalFleets?.host ?? state.room.host.fleet;
      const origOpp  = state.originalFleets?.opponent ?? (state.room.opponent?.fleet ?? []);

      // Simultaneous pick: split-screen (both SOLO and LOCAL2P at game start)
      if (state.shipSelectBoth) {
        return (
          <SplitShipSelect
            fleet0={state.room.host.fleet}          origFleet0={origHost}
            label0={state.room.host.teamName || 'Player 1'}
            pick0={state.shipSelectP0Slot}
            fleet1={state.room.opponent?.fleet ?? []} origFleet1={origOpp}
            label1={state.room.opponent?.teamName || 'Player 2'}
            pick1={state.shipSelectP1Slot}
            isAI1={isSolo}
            onSelect0={slot => dispatch({ type: 'ship_chosen', side: 0, slot })}
            onSelect1={slot => dispatch({ type: 'ship_chosen', side: 1, slot })}
            onForfeit0={() => dispatch({ type: 'forfeit_game', side: 0 })}
            onForfeit1={() => dispatch({ type: 'forfeit_game', side: 1 })}
          />
        );
      }

      // Normal single-side picker (mid-game: only the losing side picks)
      if (state.shipSelectSide === null) return null;
      const side  = state.shipSelectSide;
      const fleet = side === 0 ? state.room.host.fleet : (state.room.opponent?.fleet ?? []);
      const origF = side === 0 ? origHost : origOpp;
      const label = side === 0 ? state.room.host.teamName : (state.room.opponent?.teamName ?? 'Opponent');
      return (
        <div className="screen">
          <ShipSelectorPane
            fleet={fleet}
            originalFleet={origF}
            label={label}
            pick={null}
            position="solo"
            navKeys="arrows"
            isAI={isSolo && side === 1}
            onSelect={slot => dispatch({ type: 'ship_chosen', side, slot })}
            onForfeit={() => dispatch({ type: 'forfeit_game', side })}
          />
        </div>
      );
    }

    case 'post_battle': {
      const isSolo    = state.room?.code === 'SOLO';
      const isLocal2P = state.room?.code === 'LOCAL2P';
      const isOffline = isSolo || isLocal2P;
      const fromSupermelee = state.battleOrigin === 'supermelee';
      return (
        <PostBattle
          winner={state.winner}
          yourSide={state.yourSide}
          isHost={state.yourSide === 0}
          isSolo={isOffline}
          onRematch={() => {
            if (isSolo) {
              // Restore original fleet so rematch starts fresh, not from consumed state
              const orig = state.originalFleets;
              dispatch({ type: 'solo_engage', fleet: orig?.host ?? state.room!.host.fleet });
            } else if (isLocal2P) {
              const orig = state.originalFleets;
              dispatch({ type: 'local2p_engage',
                fleet0: orig?.host     ?? state.room!.host.fleet,
                fleet1: orig?.opponent ?? state.room!.opponent!.fleet,
              });
            } else {
              client.send({ type: 'rematch' });
            }
          }}
          onLeave={() => {
            if (!isOffline) client.send({ type: 'leave_room' });
            if (fromSupermelee) {
              dispatch({ type: 'go_supermelee' });
            } else {
              dispatch({ type: 'go_browser' });
            }
          }}
        />
      );
    }
  }
}


// ─── Ship selector pane (shared by SOLO and LOCAL2P split-screen) ──────────────

// Grid layout: 7 columns × 2 rows of ship slots, plus an 8th column with
// random (?) and forfeit (✕) buttons. Cursor index 0–13 = ship slots,
// 14 = random, 15 = forfeit.

const GRID_COLS = 7;

function selectorGetRowCol(idx: number): [number, number] {
  if (idx === 14) return [0, GRID_COLS];
  if (idx === 15) return [1, GRID_COLS];
  return [Math.floor(idx / GRID_COLS), idx % GRID_COLS];
}
function selectorGetIdx(row: number, col: number): number {
  if (col === GRID_COLS) return row === 0 ? 14 : 15;
  return row * GRID_COLS + col;
}
function selectorNav(idx: number, dir: 'left' | 'right' | 'up' | 'down'): number {
  let [row, col] = selectorGetRowCol(idx);
  if (dir === 'right') col = (col + 1) % (GRID_COLS + 1);
  else if (dir === 'left') col = (col + GRID_COLS) % (GRID_COLS + 1);
  else if (dir === 'down') row = Math.min(1, row + 1);
  else row = Math.max(0, row - 1);
  return selectorGetIdx(row, col);
}

interface ShipSelectorPaneProps {
  fleet:         FleetSlot[];       // current fleet (null = dead or never placed)
  originalFleet: FleetSlot[];       // original fleet — null slots = never placed; non-null + current null = defeated
  label:         string;            // fleet/team name shown at bottom
  pick:          number | null;     // slot already chosen (null = still picking)
  position:      'top' | 'bottom' | 'solo';
  navKeys:       'arrows' | 'wasd';
  isAI?:         boolean;           // AI-controlled: auto-picks random, no cursor shown
  onSelect:      (slot: number) => void;
  onForfeit:     () => void;
}

function ShipSelectorPane({
  fleet, originalFleet, label, pick, position, navKeys, isAI = false, onSelect, onForfeit,
}: ShipSelectorPaneProps) {
  // Start cursor on first available ship
  const [cursor, setCursor] = useState(() => {
    const first = fleet.findIndex(s => s !== null);
    return first >= 0 ? first : 0;
  });
  const [blink, setBlink] = useState(true);
  const [showForfeit, setShowForfeit] = useState(false);
  const chosen = pick !== null;

  // AI: immediately pick a random ship on mount (silently)
  useEffect(() => {
    if (!isAI) return;
    const slots = fleet.map((s: FleetSlot, i: number) => s !== null ? i : -1).filter((i: number) => i >= 0);
    if (slots.length > 0) onSelect(slots[Math.floor(Math.random() * slots.length)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Blink timer — stops once a ship has been chosen
  useEffect(() => {
    if (chosen) return;
    const id = setInterval(() => setBlink(b => !b), 500);
    return () => clearInterval(id);
  }, [chosen]);

  // Keep a ref so the keydown closure always reads the latest cursor/fleet
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const fleetRef = useRef(fleet);
  fleetRef.current = fleet;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Keyboard navigation
  useEffect(() => {
    if (chosen) return;

    const L     = navKeys === 'arrows' ? 'ArrowLeft'  : 'KeyA';
    const R     = navKeys === 'arrows' ? 'ArrowRight' : 'KeyD';
    const U     = navKeys === 'arrows' ? 'ArrowUp'    : 'KeyW';
    const D     = navKeys === 'arrows' ? 'ArrowDown'  : 'KeyS';
    const fires = navKeys === 'arrows' ? ['Enter', 'ControlRight'] : ['KeyV'];
    const allKeys = [L, R, U, D, ...fires];

    const onKey = (e: KeyboardEvent) => {
      if (!allKeys.includes(e.code)) return;
      e.preventDefault();
      if (e.code === L) setCursor(c => selectorNav(c, 'left'));
      else if (e.code === R) setCursor(c => selectorNav(c, 'right'));
      else if (e.code === U) setCursor(c => selectorNav(c, 'up'));
      else if (e.code === D) setCursor(c => selectorNav(c, 'down'));
      else if (fires.includes(e.code)) {
        const cur = cursorRef.current;
        const fl  = fleetRef.current;
        if (cur === 14) {
          // Random: pick a random available slot
          const avail = fl.map((s: FleetSlot, i: number) => s !== null ? i : -1).filter((i: number) => i >= 0);
          if (avail.length > 0) onSelectRef.current(avail[Math.floor(Math.random() * avail.length)]);
        } else if (cur === 15) {
          setShowForfeit(true);
        } else if (fl[cur] !== null) {
          onSelectRef.current(cur);
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chosen, navKeys]);

  const totalValue  = originalFleet.reduce((sum, s) => sum + (s ? (SHIP_COSTS[s] ?? 0) : 0), 0);
  const remainValue = fleet.reduce((sum, s) => sum + (s ? (SHIP_COSTS[s] ?? 0) : 0), 0);

  const accent    = position === 'bottom' ? 'var(--accent)' : 'var(--accent2)';
  const bgColor   = position === 'bottom' ? '#050510'       : 'var(--bg0)';
  const CELL = 62; // px — cell width (height = CELL + 12)

  function renderShipCell(slot: number) {
    const orig      = originalFleet[slot] ?? null;
    const cur       = fleet[slot] ?? null;
    const isEmpty   = orig === null;
    const defeated  = orig !== null && cur === null;
    const available = cur !== null;
    const cursorOn  = cursor === slot && !chosen && !isAI;
    const glowing   = cursorOn && blink;
    const icon      = orig ? SHIP_ICON[orig] : null;

    return (
      <div
        key={`s${slot}`}
        onClick={() => available && onSelect(slot)}
        style={{
          position: 'relative', width: CELL, height: CELL + 12,
          background:   isEmpty   ? 'transparent'
                      : glowing   ? 'rgba(255,220,80,0.22)'
                      : cursorOn  ? 'var(--bg2)'
                      : 'var(--bg2)',
          border:       isEmpty   ? '2px solid transparent'
                      : glowing   ? '2px solid #ffe040'
                      : cursorOn  ? '2px solid var(--accent2)'
                      : '2px solid var(--border)',
          borderRadius: 4, boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
          cursor:  available ? 'pointer' : 'default',
          opacity: defeated ? 0.6 : 1,
          boxShadow: glowing ? '0 0 8px 2px rgba(255,220,80,0.5)' : undefined,
        }}
      >
        {!isEmpty && icon && (
          <img src={icon} alt={orig!} style={{ width: 40, height: 40, objectFit: 'contain', imageRendering: 'pixelated' }} />
        )}
        {!isEmpty && !icon && orig && (
          <span style={{ fontSize: 8, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1 }}>{orig.slice(0, 4)}</span>
        )}
        {defeated && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 12 12" width={CELL - 6} height={CELL - 6}>
              <line x1="1" y1="1" x2="11" y2="11" stroke="#cc0000" strokeWidth="2.5" strokeLinecap="round" />
              <line x1="11" y1="1" x2="1"  y2="11" stroke="#cc0000" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>
        )}
      </div>
    );
  }

  function renderRandomCell() {
    const avail   = fleet.some(s => s !== null);
    const cursorOn = cursor === 14 && !chosen && !isAI;
    const glowing  = cursorOn && blink;
    return (
      <div
        key="random"
        onClick={() => {
          const slots = fleet.map((s, i) => s !== null ? i : -1).filter(i => i >= 0);
          if (slots.length > 0) onSelect(slots[Math.floor(Math.random() * slots.length)]);
        }}
        style={{
          width: CELL, height: CELL + 12, borderRadius: 4, boxSizing: 'border-box',
          background: glowing  ? 'rgba(160,0,255,0.35)' : cursorOn ? 'rgba(120,0,200,0.2)' : 'rgba(60,0,120,0.2)',
          border:     glowing  ? '2px solid #dd55ff'    : cursorOn ? '2px solid #8800cc'    : '2px solid #440077',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: avail ? 'pointer' : 'default', opacity: avail ? 1 : 0.35,
          fontSize: 26, color: glowing ? '#ee88ff' : '#aa33dd', fontWeight: 'bold', userSelect: 'none',
          boxShadow: glowing ? '0 0 8px 2px rgba(180,0,255,0.5)' : undefined,
        }}
      >?</div>
    );
  }

  function renderForfeitCell() {
    const cursorOn = cursor === 15 && !chosen && !isAI;
    const glowing  = cursorOn && blink;
    return (
      <div
        key="forfeit"
        onClick={() => !isAI && setShowForfeit(true)}
        style={{
          width: CELL, height: CELL + 10, borderRadius: 4, boxSizing: 'border-box',
          background: glowing  ? 'rgba(200,0,0,0.35)' : cursorOn ? 'rgba(150,0,0,0.2)' : 'rgba(60,0,0,0.2)',
          border:     glowing  ? '2px solid #ff5555'  : cursorOn ? '2px solid #cc0000'  : '2px solid #440000',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          boxShadow: glowing ? '0 0 8px 2px rgba(200,0,0,0.5)' : undefined,
        }}
      >
        <svg viewBox="0 0 24 24" width={CELL - 10} height={CELL - 10}>
          <circle cx="12" cy="12" r="9" fill="none" stroke={glowing ? '#ff6666' : '#cc0000'} strokeWidth="2.5" />
          <line x1="7.5" y1="7.5" x2="16.5" y2="16.5" stroke={glowing ? '#ff6666' : '#cc0000'} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="16.5" y1="7.5" x2="7.5" y2="16.5" stroke={glowing ? '#ff6666' : '#cc0000'} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  // Map fleet slots to display cells: row 0 = slots 0–6, row 1 = slots 7–13
  const row0Slots = [0,1,2,3,4,5,6];
  const row1Slots = [7,8,9,10,11,12,13];

  const chosenShip = pick !== null ? fleet[pick] : null;

  return (
    <div style={{
      flex: position !== 'solo' ? 1 : undefined,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: position === 'solo' ? '32px 16px' : '8px 12px',
      background: bgColor,
      borderBottom: position === 'top' ? '2px solid var(--border)' : undefined,
      gap: 3, position: 'relative',
    }}>
      {/* Header: total and remaining fleet value */}
      <div style={{ display: 'flex', justifyContent: 'space-between', width: (CELL + 4) * 8 - 4, fontSize: 11 }}>
        <span style={{ color: 'var(--text-dim)' }}>
          Fleet: <strong style={{ color: accent }}>{totalValue}</strong>
        </span>
        <span style={{ color: 'var(--text-dim)' }}>
          Remaining: <strong style={{ color: remainValue > 0 ? 'var(--success)' : '#cc2222' }}>{remainValue}</strong>
        </span>
      </div>

      {/* Row 0: ship slots 0–6 + random button */}
      <div style={{ display: 'flex', gap: 4 }}>
        {row0Slots.map(s => renderShipCell(s))}
        {renderRandomCell()}
      </div>

      {/* Row 1: ship slots 7–13 + forfeit button */}
      <div style={{ display: 'flex', gap: 4 }}>
        {row1Slots.map(s => renderShipCell(s))}
        {renderForfeitCell()}
      </div>

      {/* Footer: fleet name or chosen ship */}
      <div style={{ fontSize: 11, color: chosenShip ? 'var(--success)' : accent, letterSpacing: '0.06em', marginTop: 1 }}>
        {label}
      </div>

      {/* Forfeit confirmation overlay */}
      {showForfeit && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.88)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 14, zIndex: 10, borderRadius: 4,
        }}>
          <div style={{ color: '#ff5555', fontSize: 15, fontWeight: 'bold', letterSpacing: '0.1em' }}>Really quit?</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => { onForfeit(); setShowForfeit(false); }}
              style={{ background: '#550000', borderColor: '#cc0000', color: '#ff9999' }}>
              Yes, forfeit
            </button>
            <button onClick={() => setShowForfeit(false)}>No, continue</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Split-screen ship selection (LOCAL2P) ─────────────────────────────────────

interface SplitShipSelectProps {
  fleet0: FleetSlot[]; origFleet0: FleetSlot[]; label0: string; pick0: number | null;
  fleet1: FleetSlot[]; origFleet1: FleetSlot[]; label1: string; pick1: number | null;
  isAI1?: boolean;
  onSelect0: (slot: number) => void;
  onSelect1: (slot: number) => void;
  onForfeit0: () => void;
  onForfeit1: () => void;
}

function SplitShipSelect({
  fleet0, origFleet0, label0, pick0, onSelect0, onForfeit0,
  fleet1, origFleet1, label1, pick1, onSelect1, onForfeit1, isAI1 = false,
}: SplitShipSelectProps) {
  return (
    <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ShipSelectorPane fleet={fleet0} originalFleet={origFleet0} label={label0} pick={pick0}
        position="top"    navKeys="arrows" isAI={false} onSelect={onSelect0} onForfeit={onForfeit0} />
      <ShipSelectorPane fleet={fleet1} originalFleet={origFleet1} label={label1} pick={pick1}
        position="bottom" navKeys="wasd"   isAI={isAI1} onSelect={onSelect1} onForfeit={onForfeit1} />
    </div>
  );
}

// ─── Post-battle screen ───────────────────────────────────────────────────────

interface PostBattleProps {
  winner:    0 | 1 | null | undefined;
  yourSide:  0 | 1;
  isHost:    boolean;
  isSolo:    boolean;
  onRematch: () => void;
  onLeave:   () => void;
}

function PostBattle({ winner, yourSide, isHost, isSolo, onRematch, onLeave }: PostBattleProps) {
  const youWon = winner === yourSide;
  const draw   = winner === null;

  return (
    <div className="screen">
      <div className="panel col" style={{ width: 400, gap: 20, textAlign: 'center' }}>
        <h2 style={{ color: draw ? 'var(--accent2)' : youWon ? 'var(--success)' : 'var(--danger)' }}>
          {draw ? 'Mutual Annihilation' : youWon ? 'Victory' : 'Defeat'}
        </h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          {draw
            ? 'Both fleets have been reduced to debris. A draw, Commander. Neither of us can claim that was intentional.'
            : youWon
            ? 'Outstanding. Your tactical genius is matched only by your opponent\'s willingness to participate.'
            : 'A regrettable outcome. The Spathi high command would like a word.'
          }
        </p>
        <div className="row" style={{ justifyContent: 'center', gap: 12 }}>
          {(isHost || isSolo) && (
            <button className="success" onClick={onRematch}>
              {isSolo ? 'Again' : 'Rematch'}
            </button>
          )}
          <button onClick={onLeave}>Return to Roster</button>
        </div>
        {!isHost && !isSolo && (
          <p style={{ color: 'var(--text-dim)', fontSize: 11 }}>
            Awaiting host to initiate rematch.
          </p>
        )}
      </div>
    </div>
  );
}
