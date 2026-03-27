import { useState, useEffect, useReducer } from 'react';
import { client } from './net/client';
import type { FullRoomState, FleetSlot, RoomSummary, ServerMsg, ShipId } from 'shared/types';
import Landing from './components/Landing';
import GameBrowser from './components/GameBrowser';
import FleetBuilder from './components/FleetBuilder';
import Battle from './components/Battle';
import { SHIP_ICON } from './components/ShipPicker';

// ─── App state ────────────────────────────────────────────────────────────────

type Screen = 'landing' | 'browser' | 'fleet_builder' | 'battle' | 'post_battle' | 'ship_select';

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
  // Original fleets captured at first engage; used to restore on rematch
  originalFleets: { host: FleetSlot[]; opponent: FleetSlot[] } | null;
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
  | { type: 'battle_start';   seed: number; inputDelay: number; yourSide: 0 | 1 }
  | { type: 'battle_over';    winner: 0 | 1 | null }
  | { type: 'ship_chosen';    side: 0 | 1; slot: number }
  | { type: 'go_browser' }
  | { type: 'start_solo';     commanderName: string }
  | { type: 'solo_engage';    fleet: FleetSlot[] }
  | { type: 'start_local2p';  commanderName: string }
  | { type: 'local2p_engage'; fleet0: FleetSlot[]; fleet1: FleetSlot[] };

function init(): AppState {
  return {
    screen:        'landing',
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
    originalFleets: null,
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
        screen:        action.commanderName ? 'browser' : 'landing',
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

    case 'battle_start':
      return {
        ...state,
        screen:     'battle',
        battleSeed: action.seed,
        inputDelay: action.inputDelay,
        yourSide:   action.yourSide,
        winner:     undefined,
      };

    case 'battle_over': {
      const isSolo    = state.room?.code === 'SOLO';
      const isLocal2P = state.room?.code === 'LOCAL2P';
      if ((!isSolo && !isLocal2P) || !state.room) {
        // Online: server handles the multi-ship flow; go straight to post_battle
        return { ...state, screen: 'post_battle', winner: action.winner };
      }

      const winner = action.winner;
      const hostFleet = [...state.room.host.fleet] as FleetSlot[];
      const oppFleet  = [...(state.room.opponent?.fleet ?? [])] as FleetSlot[];

      // Consume the losing (or both-on-draw) active ships
      const hostIdx = hostFleet.findIndex(s => s !== null);
      const oppIdx  = oppFleet.findIndex(s => s !== null);
      if (winner !== 0 && hostIdx >= 0) hostFleet[hostIdx] = null; // host lost or draw
      if (winner !== 1 && oppIdx  >= 0) oppFleet[oppIdx]  = null; // opp lost or draw

      const updatedRoom: FullRoomState = {
        ...state.room,
        host:     { ...state.room.host,      fleet: hostFleet },
        opponent: state.room.opponent ? { ...state.room.opponent, fleet: oppFleet } : undefined,
      };

      const hostHasShips = hostFleet.some(Boolean);
      const oppHasShips  = oppFleet.some(Boolean);

      // True game over — at least one side exhausted
      if (!hostHasShips || !oppHasShips) {
        const finalWinner: 0 | 1 | null =
          !hostHasShips && !oppHasShips ? null
          : !hostHasShips ? 1 : 0;
        return { ...state, room: updatedRoom, screen: 'post_battle', winner: finalWinner };
      }

      // Who needs to pick?  Loser picks; on draw, host picks first.
      // In SOLO mode, the AI (side 1) never needs the picker — it auto-picks
      // by virtue of having the next non-null ship already at the front.
      let shipSelectSide: 0 | 1;
      if (winner === 0) {
        // Host won → opponent (side 1) lost
        if (isSolo) {
          // AI auto-picks: no UI needed, just restart
          return {
            ...state, room: updatedRoom,
            screen: 'battle', battleSeed: Date.now() & 0x7FFFFFFF,
            winner: undefined, shipSelectSide: null,
          };
        }
        shipSelectSide = 1;
      } else {
        // Opponent won, or draw → host (side 0) lost and must pick
        shipSelectSide = 0;
      }

      return {
        ...state, room: updatedRoom,
        screen: 'ship_select', shipSelectSide,
        winner, // keep so ship_chosen knows if it was a draw
      };
    }

    case 'ship_chosen': {
      if (!state.room) return state;
      const { side, slot } = action;
      const isSolo = state.room.code === 'SOLO';

      // Move chosen slot to be the first non-null position so Battle's
      // fleet.find(Boolean) picks it up correctly.
      const swapToFront = (fleet: FleetSlot[], idx: number): FleetSlot[] => {
        const first = fleet.findIndex(s => s !== null);
        if (first < 0 || first === idx) return fleet;
        const f = [...fleet];
        [f[first], f[idx]] = [f[idx], f[first]];
        return f;
      };

      const hostFleet = side === 0
        ? swapToFront([...state.room.host.fleet], slot)
        : [...state.room.host.fleet];
      const oppFleet = side === 1
        ? swapToFront([...(state.room.opponent?.fleet ?? [])], slot)
        : [...(state.room.opponent?.fleet ?? [])];

      const updatedRoom: FullRoomState = {
        ...state.room,
        host:     { ...state.room.host,      fleet: hostFleet },
        opponent: state.room.opponent ? { ...state.room.opponent, fleet: oppFleet } : undefined,
      };

      // Draw + LOCAL2P: host just picked, now opponent must pick
      if (state.winner === null && !isSolo && side === 0) {
        return { ...state, room: updatedRoom, screen: 'ship_select', shipSelectSide: 1 };
      }

      // Otherwise start the next battle
      return {
        ...state, room: updatedRoom,
        screen: 'battle', battleSeed: Date.now() & 0x7FFFFFFF,
        winner: undefined, shipSelectSide: null,
      };
    }

    case 'go_browser':
      return { ...state, screen: 'browser', room: null, joinError: '', originalFleets: null };

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
      const updatedRoom: FullRoomState = {
        ...state.room,
        state: 'in_battle',
        host:     { ...state.room.host,      fleet: action.fleet0, confirmed: true, shipsAlive: [0] },
        opponent: { ...state.room.opponent!, fleet: action.fleet1, confirmed: true, shipsAlive: [0] },
      };
      return {
        ...state,
        screen: 'battle',
        room: updatedRoom,
        battleSeed: Date.now() & 0x7FFFFFFF,
        inputDelay: 0,
        yourSide: 0,
        winner: undefined,
        // Capture original fleets on first engage only; rematch restores from these
        originalFleets: state.originalFleets ?? { host: action.fleet0, opponent: action.fleet1 },
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
      const updatedRoom: FullRoomState = {
        ...state.room,
        state: 'in_battle',
        host: { ...state.room.host, fleet: action.fleet, confirmed: true, shipsAlive: [0] },
        opponent: { ...state.room.opponent!, shipsAlive: [0] },
      };
      return {
        ...state,
        screen: 'battle',
        room: updatedRoom,
        battleSeed: Date.now() & 0x7FFFFFFF,
        inputDelay: 0,
        yourSide: 0,
        winner: undefined,
        // Capture original fleets on first engage only; rematch restores from these
        originalFleets: state.originalFleets ?? {
          host:     action.fleet,
          opponent: state.room.opponent!.fleet,
        },
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
      dispatch({ type: 'battle_start', seed: msg.seed, inputDelay: msg.inputDelay, yourSide: msg.yourSide });
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
          onBattleEnd={winner => dispatch({ type: 'battle_over', winner })}
        />
      ) : null;
    }

    case 'ship_select': {
      if (!state.room || state.shipSelectSide === null) return null;
      const side  = state.shipSelectSide;
      const fleet = side === 0 ? state.room.host.fleet : (state.room.opponent?.fleet ?? []);
      const label = side === 0 ? state.room.host.teamName : (state.room.opponent?.teamName ?? 'Opponent');
      return (
        <ShipSelectFromFleet
          fleet={fleet}
          playerLabel={label}
          onSelect={slot => dispatch({ type: 'ship_chosen', side, slot })}
        />
      );
    }

    case 'post_battle': {
      const isSolo    = state.room?.code === 'SOLO';
      const isLocal2P = state.room?.code === 'LOCAL2P';
      const isOffline = isSolo || isLocal2P;
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
            if (!isSolo) client.send({ type: 'leave_room' });
            dispatch({ type: 'go_browser' });
          }}
        />
      );
    }
  }
}


// ─── Between-round ship selection ─────────────────────────────────────────────

interface ShipSelectFromFleetProps {
  fleet:       FleetSlot[];
  playerLabel: string;
  onSelect:    (slot: number) => void;
}

function ShipSelectFromFleet({ fleet, playerLabel, onSelect }: ShipSelectFromFleetProps) {
  const available = fleet
    .map((ship, idx) => ({ ship, idx }))
    .filter((e): e is { ship: ShipId; idx: number } => e.ship !== null);

  return (
    <div className="screen">
      <div className="panel col" style={{ width: 560, gap: 20, textAlign: 'center' }}>
        <h2>{playerLabel}</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: 0 }}>
          Choose your next ship, Commander.
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
        }}>
          {available.map(({ ship, idx }) => {
            const icon = SHIP_ICON[ship];
            return (
              <button
                key={idx}
                onClick={() => onSelect(idx)}
                style={{
                  padding: '10px 6px',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 6,
                  minHeight: 90, background: 'var(--bg2)',
                }}
              >
                {icon && (
                  <img src={icon} alt={ship}
                    style={{ width: 48, height: 48, objectFit: 'contain', imageRendering: 'pixelated' }}
                  />
                )}
                <span style={{ fontSize: 11, color: 'var(--text-hi)', textTransform: 'none' }}>
                  {ship}
                </span>
              </button>
            );
          })}
        </div>
      </div>
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
