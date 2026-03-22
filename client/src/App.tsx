import { useState, useEffect, useReducer } from 'react';
import { client } from './net/client';
import type { FullRoomState, RoomSummary, ServerMsg } from 'shared/types';
import Landing from './components/Landing';
import GameBrowser from './components/GameBrowser';
import FleetBuilder from './components/FleetBuilder';
import Battle from './components/Battle';

// ─── App state ────────────────────────────────────────────────────────────────

type Screen = 'landing' | 'browser' | 'fleet_builder' | 'battle' | 'post_battle';

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
  | { type: 'go_browser' };

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

    case 'battle_over':
      return { ...state, screen: 'post_battle', winner: action.winner };

    case 'go_browser':
      return { ...state, screen: 'browser', room: null, joinError: '' };

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

      // Handle incremental fleet/confirmation patches
      setRoomPatch(prev => {
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
          case 'room_joined':
          case 'room_created':
            return msg.room;
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
          <GameBrowser commanderName={state.commanderName} rooms={state.rooms} />
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

    case 'fleet_builder':
      return roomPatch ? (
        <FleetBuilder
          room={roomPatch}
          yourSide={state.yourSide}
          onLeave={() => dispatch({ type: 'go_browser' })}
        />
      ) : null;

    case 'battle':
      return roomPatch ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
          <Battle
            room={roomPatch}
            yourSide={state.yourSide}
            seed={state.battleSeed}
            inputDelay={state.inputDelay}
            onBattleEnd={winner => dispatch({ type: 'battle_over', winner })}
          />
        </div>
      ) : null;

    case 'post_battle':
      return (
        <PostBattle
          winner={state.winner}
          yourSide={state.yourSide}
          isHost={state.yourSide === 0}
          onRematch={() => {
            client.send({ type: 'rematch' });
          }}
          onLeave={() => {
            client.send({ type: 'leave_room' });
            dispatch({ type: 'go_browser' });
          }}
        />
      );
  }
}


// ─── Post-battle screen ───────────────────────────────────────────────────────

interface PostBattleProps {
  winner:   0 | 1 | null | undefined;
  yourSide: 0 | 1;
  isHost:   boolean;
  onRematch: () => void;
  onLeave:   () => void;
}

function PostBattle({ winner, yourSide, isHost, onRematch, onLeave }: PostBattleProps) {
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
          {isHost && (
            <button className="success" onClick={onRematch}>
              Rematch
            </button>
          )}
          <button onClick={onLeave}>Return to Roster</button>
        </div>
        {!isHost && (
          <p style={{ color: 'var(--text-dim)', fontSize: 11 }}>
            Awaiting host to initiate rematch.
          </p>
        )}
      </div>
    </div>
  );
}
