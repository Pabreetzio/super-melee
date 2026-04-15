import { useState, useEffect, useReducer, useRef } from 'react';
import { client } from './net/client';
import type { AIDifficulty, FullRoomState, FleetSlot, RoomSummary, ServerMsg } from 'shared/types';
import GameBrowser from './components/GameBrowser';
import FleetBuilder from './components/FleetBuilder';
import Battle from './components/Battle';
import type { WinnerShipState } from './engine/battle/types';
import { SHIP_ICON } from './components/shipSelectionData';
import SuperMelee from './components/SuperMelee';
import type { BattleStartParams, ControlType } from './components/SuperMelee';
import { SHIP_COSTS } from './components/shipSelectionData';
import BGBuilder from './components/BGBuilder';
import SettingsScreen from './components/Settings';
import StyleLab from './components/StyleLab';
import TypographyLab from './components/TypographyLab';
import { getControls, codeDisplay, buildMenuBindingSet } from './lib/controls';
import { roomCodeFromPathname, roomPath } from './lib/netplayRoutes';
import ShipMenuImage from './components/ShipMenuImage';
import StatusPanel, { type SideStatus } from './components/StatusPanel';
import { pickRandomCaptainName } from './engine/ships/statusData';

// ─── App state ────────────────────────────────────────────────────────────────

// 58 regular planet types from UQM cons_res.c planet_types[] (samatra/slaveshield excluded).
// A new type is picked once per game (new game or rematch), kept stable across ship fights.
const PLANET_TYPES = [
  'oolite', 'yttric', 'quasidegenerate', 'lanthanide', 'treasure',
  'urea', 'metal', 'radioactive', 'opalescent', 'cyanic',
  'acid', 'alkali', 'halide', 'green', 'copper',
  'carbide', 'ultramarine', 'noble', 'azure', 'chondrite',
  'purple', 'superdense', 'pellucid', 'dust', 'crimson',
  'cimmerian', 'infrared', 'selenic', 'auric', 'fluorescent',
  'plutonic', 'rainbow', 'shattered', 'sapphire',
  'organic', 'xenolithic', 'redux', 'primordial', 'emerald',
  'chlorine', 'magnetic', 'water', 'telluric', 'hydrocarbon',
  'iodine', 'vinylogous', 'ruby', 'magma', 'maroon',
  'bluegas', 'cyangas', 'greengas', 'greygas',
  'purplegas', 'redgas', 'violetgas', 'yellowgas',
];
function randomPlanetType() { return PLANET_TYPES[Math.floor(Math.random() * PLANET_TYPES.length)]; }
function planetTypeFromSeed(seed: number): string {
  return PLANET_TYPES[((seed % PLANET_TYPES.length) + PLANET_TYPES.length) % PLANET_TYPES.length] ?? PLANET_TYPES[0];
}

type Screen = 'supermelee' | 'bgbuilder' | 'typography_lab' | 'settings' | 'style_lab' | 'browser' | 'fleet_builder' | 'battle' | 'battle_recovery' | 'post_battle' | 'ship_select' | 'final_selector';
type UtilityReturnScreen = 'supermelee' | 'style_lab' | 'typography_lab';

const UTILITY_SCREEN_PATHS: Partial<Record<Screen, string>> = {
  browser: '/net',
  style_lab: '/styles',
  bgbuilder: '/bg-builder',
  typography_lab: '/typography',
  settings: '/settings',
};

function screenFromPathname(pathname: string): Screen {
  if (roomCodeFromPathname(pathname)) return 'browser';
  switch (pathname) {
    case '/net':
      return 'browser';
    case '/styles':
      return 'style_lab';
    case '/bg-builder':
      return 'bgbuilder';
    case '/typography':
      return 'typography_lab';
    case '/settings':
      return 'settings';
    default:
      return 'supermelee';
  }
}

function pathFromScreen(screen: Screen): string {
  return UTILITY_SCREEN_PATHS[screen] ?? '/';
}

function pathFromState(state: AppState, currentPathname: string, preserveRouteRoomCode: boolean): string {
  if (state.room && !isOfflineRoomCode(state.room.code)) {
    return roomPath(state.room.code);
  }
  if (state.screen === 'browser') {
    const routeCode = roomCodeFromPathname(currentPathname);
    return routeCode && preserveRouteRoomCode ? roomPath(routeCode) : '/net';
  }
  return pathFromScreen(state.screen);
}

const COMMANDER_NAME_STORAGE_KEY = 'sm_commander_name';

function loadStoredCommanderName(): string {
  try {
    const stored = localStorage.getItem(COMMANDER_NAME_STORAGE_KEY)?.trim() ?? '';
    if (stored) return stored.slice(0, 30);
  } catch {}

  const generated = pickRandomCaptainName();
  try { localStorage.setItem(COMMANDER_NAME_STORAGE_KEY, generated); } catch {}
  return generated;
}

function storeCommanderName(name: string) {
  try { localStorage.setItem(COMMANDER_NAME_STORAGE_KEY, name.slice(0, 30)); } catch {}
}

interface AppState {
  screen:        Screen;
  connected:     boolean;
  sessionId:     string;
  commanderName: string;
  rooms:         RoomSummary[];
  room:          FullRoomState | null;
  yourSide:      0 | 1;
  battleSeed:    number;
  planetType:    string; // chosen once per game, stable across ship fights within same game
  inputDelay:    number;
  aiDifficulty:  AIDifficulty;
  offlineControls: [ControlType, ControlType];
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
  finalStatus: [SideStatus | null, SideStatus | null];
  deferredOnlineRoom: { room: FullRoomState; side?: 0 | 1 } | null;
  onlineBattleOutcomeCaptured: boolean;
  leavingRoomCode: string | null;
  // Where to go after post_battle "leave"
  battleOrigin:  'supermelee' | 'browser';
  utilityReturnScreen: UtilityReturnScreen;
}

type Action =
  | { type: 'connected' }
  | { type: 'session';        sessionId: string; commanderName: string }
  | { type: 'name_set';       name: string }
  | { type: 'room_list';      rooms: RoomSummary[] }
  | { type: 'room_entered';   room: FullRoomState; side: 0 | 1; restored?: boolean }
  | { type: 'room_updated';   room: FullRoomState; side?: 0 | 1 }
  | { type: 'join_error';     reason: string }
  | { type: 'opponent_left' }
  | { type: 'battle_over';    winner: 0 | 1 | null; nextSeed?: number; winnerState?: WinnerShipState; finalStatus?: [SideStatus | null, SideStatus | null] }
  | { type: 'leave_room_local'; code: string }
  | { type: 'ship_chosen';    side: 0 | 1; slot: number }
  | { type: 'go_browser' }
  | { type: 'go_supermelee' }
  | { type: 'go_settings' }
  | { type: 'start_solo';     commanderName: string }
  | { type: 'solo_engage';    fleet: FleetSlot[] }
  | { type: 'start_local2p';  commanderName: string }
  | { type: 'local2p_engage'; fleet0: FleetSlot[]; fleet1: FleetSlot[] }
  | { type: 'supermelee_start'; params: BattleStartParams }
  | { type: 'forfeit_game';    side: 0 | 1 }
  | { type: 'finish_offline_match' }
  | { type: 'go_bgbuilder'; returnTo?: UtilityReturnScreen }
  | { type: 'go_style_lab' }
  | { type: 'go_typography_lab' };

function init(): AppState {
  return {
    screen:        screenFromPathname(window.location.pathname),
    connected:     false,
    sessionId:     '',
    commanderName: loadStoredCommanderName(),
    rooms:         [],
    room:          null,
    yourSide:      0,
    battleSeed:    1,
    planetType:    randomPlanetType(),
    inputDelay:    2,
    aiDifficulty:  'cyborg_weak',
    offlineControls: ['human', 'cyborg_weak'],
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
    finalStatus: [null, null],
    deferredOnlineRoom: null,
    onlineBattleOutcomeCaptured: false,
    leavingRoomCode: null,
    battleOrigin:  'supermelee',
    utilityReturnScreen: 'supermelee',
  };
}

function isPrivateIpv4(hostname: string): boolean {
  return /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

function isLanOrLocalHost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.local')
    || isPrivateIpv4(hostname);
}

function isOfflineRoomCode(code: string | undefined | null): boolean {
  return code === 'SOLO' || code === 'LOCAL2P';
}

function screenForOnlineRoom(room: FullRoomState): Screen {
  if (room.state === 'waiting' || room.state === 'building' || room.state === 'confirmed') {
    return 'fleet_builder';
  }
  if (room.state === 'post_battle') {
    return 'final_selector';
  }
  return room.round?.phase === 'battle' ? 'battle' : 'ship_select';
}

function isUnrestorableOnlineBattle(room: FullRoomState): boolean {
  return !isOfflineRoomCode(room.code) && room.state === 'in_battle' && room.round?.phase === 'battle';
}

function isLiveOnlineBattleRoom(room: FullRoomState | null | undefined): boolean {
  return !!room && !isOfflineRoomCode(room.code) && room.state === 'in_battle' && room.round?.phase === 'battle';
}

function shouldKeepWinnerStateForRoom(room: FullRoomState): boolean {
  return room.state === 'in_battle';
}

function nextOnlineOriginalFleets(state: AppState, room: FullRoomState): AppState['originalFleets'] {
  if (room.state === 'waiting' || room.state === 'building' || room.state === 'confirmed') {
    return null;
  }

  if (
    !state.originalFleets &&
    room.state === 'in_battle' &&
    room.opponent &&
    state.room &&
    (state.room.state === 'waiting' || state.room.state === 'building' || state.room.state === 'confirmed')
  ) {
    return {
      host: [...room.host.fleet],
      opponent: [...room.opponent.fleet],
    };
  }

  return state.originalFleets;
}

function applyResolvedOnlineRoom(
  state: AppState,
  room: FullRoomState,
  side?: 0 | 1,
): AppState {
  return {
    ...state,
    room,
    yourSide: side ?? state.yourSide,
    screen: screenForOnlineRoom(room),
    inputDelay: room.inputDelay,
    battleSeed: room.round?.seed ?? state.battleSeed,
    planetType: room.presentationSeed !== null
      ? planetTypeFromSeed(room.presentationSeed)
      : state.planetType,
    battleOrigin: 'browser',
    winnerState: shouldKeepWinnerStateForRoom(room) ? state.winnerState : null,
    originalFleets: nextOnlineOriginalFleets(state, room),
    deferredOnlineRoom: null,
    onlineBattleOutcomeCaptured: false,
    leavingRoomCode: null,
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
        commanderName: action.commanderName || state.commanderName,
        // Always start (or stay) on supermelee; the net browser is accessed via NET button
        screen: state.screen === 'supermelee' ? 'supermelee' : state.screen,
      };

    case 'name_set':
      return { ...state, commanderName: action.name, screen: 'browser' };

    case 'room_list':
      return { ...state, rooms: action.rooms, leavingRoomCode: null };

    case 'room_entered':
      {
        if (state.leavingRoomCode && action.room.code === state.leavingRoomCode) {
          return state;
        }
        const isOfflineRoom = isOfflineRoomCode(action.room.code);
        const blockedRestore = !isOfflineRoom && !!action.restored && isUnrestorableOnlineBattle(action.room);
        return {
          ...state,
          room:     action.room,
          yourSide: action.side,
          screen:   isOfflineRoom ? 'fleet_builder' : blockedRestore ? 'battle_recovery' : screenForOnlineRoom(action.room),
          joinError: '',
          inputDelay: action.room.inputDelay,
          battleSeed: action.room.round?.seed ?? state.battleSeed,
          planetType: !isOfflineRoom && action.room.presentationSeed !== null
            ? planetTypeFromSeed(action.room.presentationSeed)
            : state.planetType,
          battleOrigin: isOfflineRoom ? state.battleOrigin : 'browser',
          winnerState: isOfflineRoom || shouldKeepWinnerStateForRoom(action.room) ? state.winnerState : null,
          deferredOnlineRoom: null,
          onlineBattleOutcomeCaptured: false,
          leavingRoomCode: null,
        };
      }

    case 'room_updated': {
      if (state.leavingRoomCode && action.room.code === state.leavingRoomCode) {
        return state;
      }
      const isOfflineRoom = isOfflineRoomCode(action.room.code);
      if (!isOfflineRoom && state.screen === 'battle' && isLiveOnlineBattleRoom(state.room) && !isLiveOnlineBattleRoom(action.room)) {
        if (state.onlineBattleOutcomeCaptured) {
          return applyResolvedOnlineRoom(state, action.room, action.side);
        }
        return {
          ...state,
          yourSide: action.side ?? state.yourSide,
          deferredOnlineRoom: { room: action.room, side: action.side },
        };
      }
      const keepRecoveryScreen = !isOfflineRoom && state.screen === 'battle_recovery' && isUnrestorableOnlineBattle(action.room);
      if (!isOfflineRoom && !keepRecoveryScreen) {
        return applyResolvedOnlineRoom(state, action.room, action.side);
      }
      return {
        ...state,
        room: action.room,
        yourSide: action.side ?? state.yourSide,
        screen: isOfflineRoom ? state.screen : keepRecoveryScreen ? 'battle_recovery' : screenForOnlineRoom(action.room),
        inputDelay: action.room.inputDelay,
        battleSeed: action.room.round?.seed ?? state.battleSeed,
        planetType: !isOfflineRoom && action.room.presentationSeed !== null
          ? planetTypeFromSeed(action.room.presentationSeed)
          : state.planetType,
        battleOrigin: isOfflineRoom ? state.battleOrigin : 'browser',
        winnerState: isOfflineRoom || shouldKeepWinnerStateForRoom(action.room) ? state.winnerState : null,
        deferredOnlineRoom: null,
        onlineBattleOutcomeCaptured: false,
        leavingRoomCode: null,
      };
    }

    case 'join_error':
      return { ...state, joinError: action.reason };

    case 'opponent_left': {
      if (state.leavingRoomCode) return state;
      if (!state.room) return state;
      if (state.yourSide === 1) {
        // Host left → room gone → go to browser
        return { ...state, room: null, screen: 'browser', winnerState: null, deferredOnlineRoom: null, onlineBattleOutcomeCaptured: false };
      }
      // Opponent left → stay in fleet builder, update room
      const updated: FullRoomState = { ...state.room, opponent: undefined, state: 'waiting' };
      return { ...state, room: updated, screen: 'fleet_builder', winnerState: null, deferredOnlineRoom: null, onlineBattleOutcomeCaptured: false };
    }

    case 'battle_over': {
      if (state.leavingRoomCode) return state;
      const isSolo    = state.room?.code === 'SOLO';
      const isLocal2P = state.room?.code === 'LOCAL2P';
      const isOnline = !isSolo && !isLocal2P;
      if (!state.room) {
        return {
          ...state,
          screen: 'post_battle',
          winner: action.winner,
          winnerState: null,
          finalStatus: action.finalStatus ?? state.finalStatus,
          deferredOnlineRoom: null,
          onlineBattleOutcomeCaptured: false,
        };
      }

      if (isOnline) {
        const hasLocalOutcome = action.finalStatus !== undefined;
        if (!hasLocalOutcome && state.screen === 'battle') {
          return {
            ...state,
            winner: action.winner,
          };
        }

        const nextState: AppState = {
          ...state,
          winner: action.winner,
          winnerState: action.winner !== null ? (action.winnerState ?? state.winnerState) : null,
          finalStatus: action.finalStatus ?? state.finalStatus,
          battleSeed: hasLocalOutcome ? state.battleSeed : (action.nextSeed ?? state.battleSeed),
          screen: state.room.state === 'post_battle' ? 'final_selector' : state.screen,
        };
        if (!hasLocalOutcome) {
          return nextState;
        }
        if (state.deferredOnlineRoom) {
          return applyResolvedOnlineRoom(nextState, state.deferredOnlineRoom.room, state.deferredOnlineRoom.side);
        }
        return {
          ...nextState,
          onlineBattleOutcomeCaptured: true,
        };
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
        return {
          ...state,
          room: updatedRoom,
          screen: isOnline ? 'post_battle' : 'final_selector',
          winner: finalWinner,
          winnerState: null,
          finalStatus: action.finalStatus ?? state.finalStatus,
          activeSlot0: null,
          activeSlot1: null,
          shipSelectSide: null,
          shipSelectBoth: false,
          shipSelectP0Slot: null,
          shipSelectP1Slot: null,
        };
      }

      // Who needs to pick?  Loser picks; on draw, host picks first.
      const shipSelectSide: 0 | 1 = winner === 0 ? 1 : 0;

      // Reset the loser's active slot; winner's persists for the next round
      const nextActiveSlot0 = winner === 0 ? state.activeSlot0 : null;
      const nextActiveSlot1 = winner === 1 ? state.activeSlot1 : null;
      const shipSelectBoth = winner === null;

      return {
        ...state, room: updatedRoom,
        screen: 'ship_select', shipSelectSide: shipSelectBoth ? null : shipSelectSide,
        battleSeed: action.nextSeed ?? state.battleSeed,
        winner, // keep so ship_chosen knows if it was a draw
        winnerState: nextWinnerState,
        finalStatus: action.finalStatus ?? state.finalStatus,
        activeSlot0: nextActiveSlot0, activeSlot1: nextActiveSlot1,
        shipSelectBoth, shipSelectP0Slot: null, shipSelectP1Slot: null,
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

      // Simultaneous picking: offline LOCAL2P uses two interactive panes;
      // online netplay uses one interactive local pane plus the remote preview.
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
            finalStatus: [null, null],
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
        screen: 'battle',
        battleSeed: state.room.code === 'SOLO' || state.room.code === 'LOCAL2P'
          ? (Date.now() & 0x7FFFFFFF)
          : state.battleSeed,
        winner: undefined, shipSelectSide: null,
        finalStatus: [null, null],
      };
    }

    case 'forfeit_game': {
      const winner: 0 | 1 = action.side === 0 ? 1 : 0;
      return { ...state, screen: 'post_battle', winner, winnerState: null, finalStatus: [null, null] };
    }

    case 'finish_offline_match': {
      if (state.battleOrigin === 'supermelee') {
        return {
          ...state,
          screen: 'supermelee',
          room: null,
          winner: undefined,
          winnerState: null,
          originalFleets: null,
          finalStatus: [null, null],
          activeSlot0: null,
          activeSlot1: null,
          shipSelectSide: null,
          shipSelectBoth: false,
          shipSelectP0Slot: null,
          shipSelectP1Slot: null,
        };
      }
      if (!state.room) return state;

      const hostFleet = [...(state.originalFleets?.host ?? state.room.host.fleet)];
      const oppFleet = [...(state.originalFleets?.opponent ?? (state.room.opponent?.fleet ?? []))];
      const getAliveSlots = (fleet: FleetSlot[]) =>
        fleet.map((ship, idx) => ship !== null ? idx : -1).filter(idx => idx >= 0);

      return {
        ...state,
        screen: 'fleet_builder',
        room: {
          ...state.room,
          state: 'building',
          host: {
            ...state.room.host,
            fleet: hostFleet,
            confirmed: false,
            shipsAlive: getAliveSlots(hostFleet),
          },
          opponent: state.room.opponent ? {
            ...state.room.opponent,
            fleet: oppFleet,
            confirmed: state.offlineControls[1] !== 'human',
            shipsAlive: getAliveSlots(oppFleet),
          } : state.room.opponent,
        },
        winner: undefined,
        winnerState: null,
        finalStatus: [null, null],
        activeSlot0: null,
        activeSlot1: null,
        shipSelectSide: null,
        shipSelectBoth: false,
        shipSelectP0Slot: null,
        shipSelectP1Slot: null,
      };
    }

    case 'go_browser':
      return { ...state, screen: 'browser', room: null, joinError: '', originalFleets: null, activeSlot0: null, activeSlot1: null, winnerState: null, deferredOnlineRoom: null, onlineBattleOutcomeCaptured: false, leavingRoomCode: null };

    case 'leave_room_local':
      return {
        ...state,
        screen: 'browser',
        room: null,
        joinError: '',
        originalFleets: null,
        activeSlot0: null,
        activeSlot1: null,
        winnerState: null,
        deferredOnlineRoom: null,
        onlineBattleOutcomeCaptured: false,
        leavingRoomCode: action.code,
      };

    case 'go_supermelee':
      return { ...state, screen: 'supermelee', room: null, joinError: '', originalFleets: null, activeSlot0: null, activeSlot1: null, winnerState: null, deferredOnlineRoom: null, onlineBattleOutcomeCaptured: false, leavingRoomCode: null };

    case 'go_bgbuilder':
      return { ...state, screen: 'bgbuilder', utilityReturnScreen: action.returnTo ?? 'supermelee' };

    case 'go_settings':
      return { ...state, screen: 'settings' };

    case 'go_style_lab':
      return { ...state, screen: 'style_lab' };

    case 'go_typography_lab':
      return { ...state, screen: 'typography_lab' };

    case 'supermelee_start': {
      const { params } = action;
      const humanSides = [params.p1Control, params.p2Control].filter(control => control === 'human').length;
      const isLocal2P = humanSides === 2;
      const code = isLocal2P ? 'LOCAL2P' : 'SOLO';
      const yourSide: 0 | 1 =
        params.p1Control === 'human' ? 0
        : params.p2Control === 'human' ? 1
        : 0;

      // Calculate actual alive ship slots (all non-null slots initially)
      const getAliveSlots = (fleet: FleetSlot[]) =>
        fleet.map((ship, idx) => ship !== null ? idx : -1).filter(idx => idx >= 0);

      const room: FullRoomState = {
        code,
        visibility: 'public',
        state: 'in_battle',
        rematchReset: false,
        presentationSeed: null,
        inputDelay: 0,
        round: null,
        host: {
          sessionId: 'p1',
          commanderName: state.commanderName || 'Commander',
          teamName: params.teamName1,
          fleet: params.fleet1,
          confirmed: true,
          shipsAlive: getAliveSlots(params.fleet1),
        },
        opponent: {
          sessionId: isLocal2P ? 'p2' : (params.p2Control === 'human' ? 'player2' : 'ai'),
          commanderName: isLocal2P ? 'Commander 2' : (params.p2Control === 'human' ? (state.commanderName || 'Commander') : 'AI Commander'),
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
        planetType:       randomPlanetType(),
        inputDelay:       0,
        aiDifficulty:     params.p2Control === 'human' ? 'cyborg_weak' : params.p2Control,
        offlineControls:  [params.p1Control, params.p2Control],
        yourSide,
        winner:           undefined,
        winnerState:      null,
        originalFleets:   { host: params.fleet1, opponent: params.fleet2 },
        battleOrigin:     'supermelee',
        // SuperMelee always starts with both pick panes visible; cyborg sides auto-pick.
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
        presentationSeed: null,
        inputDelay: 0,
        round: null,
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
      return {
        ...state,
        screen: 'fleet_builder',
        room: localRoom,
        yourSide: 0,
        offlineControls: ['human', 'human'],
        winner: undefined,
        originalFleets: null,
      };
    }

    case 'local2p_engage': {
      if (!state.room) return state;

      const getAliveSlots = (fleet: FleetSlot[]) =>
        fleet.map((ship, idx) => ship !== null ? idx : -1).filter(idx => idx >= 0);

      const updatedRoom: FullRoomState = {
        ...state.room,
        state: 'in_battle',
        round: null,
        host:     { ...state.room.host,      fleet: action.fleet0, confirmed: true, shipsAlive: getAliveSlots(action.fleet0) },
        opponent: { ...state.room.opponent!, fleet: action.fleet1, confirmed: true, shipsAlive: getAliveSlots(action.fleet1) },
      };
      const newOriginal = state.originalFleets ?? { host: action.fleet0, opponent: action.fleet1 };
      const seed = Date.now() & 0x7FFFFFFF;
      const newPlanetL = randomPlanetType();
      // Supermelee rematch: show ship picker before each match
      if (state.battleOrigin === 'supermelee') {
        return {
          ...state,
          screen: 'ship_select',
          room: updatedRoom,
          battleSeed: seed,
          planetType: newPlanetL,
          inputDelay: 0,
          yourSide: 0,
          winner: undefined,
          winnerState: null,
          finalStatus: [null, null],
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
        planetType: newPlanetL,
        inputDelay: 0,
        yourSide: 0,
        winner: undefined,
        winnerState: null,
        finalStatus: [null, null],
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
        presentationSeed: null,
        inputDelay: 0,
        round: null,
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
        offlineControls: ['human', 'cyborg_weak'],
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
        round: null,
        host: { ...state.room.host, fleet: action.fleet, confirmed: true, shipsAlive: getAliveSlots(action.fleet) },
        opponent: { ...state.room.opponent!, shipsAlive: getAliveSlots(state.room.opponent!.fleet) },
      };
      const newOriginal = state.originalFleets ?? {
        host:     action.fleet,
        opponent: state.room.opponent!.fleet,
      };
      const seed = Date.now() & 0x7FFFFFFF;
      const newPlanet = randomPlanetType();
      // Supermelee rematch: show ship picker before each match
      if (state.battleOrigin === 'supermelee') {
        return {
          ...state,
          screen: 'ship_select',
          room: updatedRoom,
          battleSeed: seed,
          planetType: newPlanet,
          inputDelay: 0,
          yourSide: 0,
          winner: undefined,
          winnerState: null,
          finalStatus: [null, null],
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
        planetType: newPlanet,
        inputDelay: 0,
        yourSide: 0,
        winner: undefined,
        winnerState: null,
        finalStatus: [null, null],
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
      dispatch({ type: 'room_entered', room: msg.room, side: msg.yourSide, restored: msg.restored });
      break;
    case 'room_state':
      dispatch({ type: 'room_updated', room: msg.room, side: msg.yourSide });
      break;
    case 'join_error':
      dispatch({ type: 'join_error', reason: msg.reason });
      break;
    case 'opponent_left':
      dispatch({ type: 'opponent_left' });
      break;
    case 'battle_over':
      dispatch({ type: 'battle_over', winner: msg.winner, nextSeed: msg.nextSeed });
      break;

    default:
      break;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, init);
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [routeJoinReady, setRouteJoinReady] = useState(false);
  const showLocalDevLink = isLanOrLocalHost(window.location.hostname);
  const routeRoomCode = roomCodeFromPathname(pathname);
  const autoJoinRouteCodeRef = useRef<string | null>(null);
  const pendingRouteJoinCodeRef = useRef<string | null>(null);
  const preserveRouteRoomCode =
    !!routeRoomCode
    && !state.room
    && !state.leavingRoomCode
    && state.screen === 'browser'
    && (
      autoJoinRouteCodeRef.current !== routeRoomCode
      || pendingRouteJoinCodeRef.current === routeRoomCode
      || state.joinError !== ''
    );

  useEffect(() => {
    const unsubMsg = client.onMessage((msg: ServerMsg) => {
      if (msg.type === 'room_list' || msg.type === 'room_joined') {
        setRouteJoinReady(true);
      }
      applyServerMsg(msg, dispatch);
    });

    const unsubConnect = client.onConnect(() => {
      setRouteJoinReady(false);
      dispatch({ type: 'connected' });
    });
    client.connect();

    return () => {
      unsubMsg();
      unsubConnect();
      client.disconnect();
    };
  }, []);

  useEffect(() => {
    storeCommanderName(state.commanderName);
  }, [state.commanderName]);

  useEffect(() => {
    if (!state.connected || !state.sessionId || !state.commanderName) return;
    client.send({ type: 'set_name', name: state.commanderName });
  }, [state.connected, state.sessionId, state.commanderName]);

  // Sync pathname for SPA-friendly utility routes and shareable room links.
  useEffect(() => {
    const nextPath = pathFromState(state, pathname, preserveRouteRoomCode);
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, '', nextPath);
      setPathname(nextPath);
    }
  }, [pathname, preserveRouteRoomCode, state]);

  useEffect(() => {
    if (!routeRoomCode) {
      autoJoinRouteCodeRef.current = null;
      pendingRouteJoinCodeRef.current = null;
      return;
    }
    if (!routeJoinReady || !state.connected || !state.sessionId || state.screen !== 'browser' || state.leavingRoomCode) return;
    if (state.room && !isOfflineRoomCode(state.room.code)) {
      autoJoinRouteCodeRef.current = state.room.code === routeRoomCode ? routeRoomCode : autoJoinRouteCodeRef.current;
      return;
    }
    if (autoJoinRouteCodeRef.current === routeRoomCode) return;
    autoJoinRouteCodeRef.current = routeRoomCode;
    pendingRouteJoinCodeRef.current = routeRoomCode;
    client.send({ type: 'join_room', code: routeRoomCode });
  }, [routeJoinReady, routeRoomCode, state.connected, state.leavingRoomCode, state.room, state.screen, state.sessionId]);

  useEffect(() => {
    if (!routeRoomCode) {
      pendingRouteJoinCodeRef.current = null;
      return;
    }
    if (
      state.joinError !== ''
      || (state.room && !isOfflineRoomCode(state.room.code) && state.room.code === routeRoomCode)
    ) {
      pendingRouteJoinCodeRef.current = null;
    }
  }, [routeRoomCode, state.joinError, state.room]);

  useEffect(() => {
    const onPopState = () => {
      const nextPath = window.location.pathname;
      const nextScreen = screenFromPathname(nextPath);
      const nextRouteRoomCode = roomCodeFromPathname(nextPath);
      const currentOnlineRoomCode = state.room && !isOfflineRoomCode(state.room.code)
        ? state.room.code
        : null;

      setPathname(nextPath);

      if (nextScreen === state.screen && nextRouteRoomCode === currentOnlineRoomCode) return;
      switch (nextScreen) {
        case 'style_lab':
          dispatch({ type: 'go_style_lab' });
          break;
        case 'browser':
          dispatch({ type: 'go_browser' });
          break;
        case 'bgbuilder':
          dispatch({ type: 'go_bgbuilder' });
          break;
        case 'typography_lab':
          dispatch({ type: 'go_typography_lab' });
          break;
        case 'settings':
          dispatch({ type: 'go_settings' });
          break;
        default:
          dispatch({ type: 'go_supermelee' });
          break;
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [state.room, state.screen]);

  // Join error — pass down to browser
  const { joinError } = state;

  switch (state.screen) {
    case 'supermelee':
      return (
        <>
          <SuperMelee
            onBattle={params => dispatch({ type: 'supermelee_start', params })}
            onNet={() => {
              dispatch({ type: 'go_browser' });
            }}
            onSettings={() => dispatch({ type: 'go_settings' })}
            onStyles={showLocalDevLink ? () => dispatch({ type: 'go_style_lab' }) : undefined}
            showStyles={showLocalDevLink}
          />
        </>
      );

    case 'bgbuilder':
      return <BGBuilder onBack={() => dispatch({ type: state.utilityReturnScreen === 'typography_lab' ? 'go_typography_lab' : state.utilityReturnScreen === 'style_lab' ? 'go_style_lab' : 'go_supermelee' })} />;

    case 'settings':
      return <SettingsScreen onBack={() => dispatch({ type: 'go_supermelee' })} />;

    case 'style_lab':
      return (
        <StyleLab
          onBack={() => dispatch({ type: 'go_supermelee' })}
          onBGBuilder={() => dispatch({ type: 'go_bgbuilder', returnTo: 'style_lab' })}
          onTypography={() => dispatch({ type: 'go_typography_lab' })}
        />
      );

    case 'typography_lab':
      return (
        <TypographyLab
          onBack={() => dispatch({ type: 'go_style_lab' })}
        />
      );

    case 'browser':
      return (
        <GameBrowser
          commanderName={state.commanderName}
          rooms={state.rooms}
          joinError={joinError}
          onCommanderNameChange={name => {
            const trimmed = name.trim();
            if (!trimmed) return;
            client.send({ type: 'set_name', name: trimmed });
            dispatch({ type: 'name_set', name: trimmed.slice(0, 30) });
          }}
          onBack={() => dispatch({ type: 'go_supermelee' })}
        />
      );

    case 'fleet_builder': {
      const isOfflineRoom = isOfflineRoomCode(state.room?.code);
      return state.room ? (
        <FleetBuilder
          room={state.room}
          yourSide={state.yourSide}
          onLeave={() => {
            if (!isOfflineRoom) {
              client.send({ type: 'leave_room' });
              dispatch({ type: 'leave_room_local', code: state.room!.code });
              return;
            }
            dispatch({ type: 'go_browser' });
          }}
          onSoloEngage={state.room.code === 'SOLO'
            ? (fleet) => dispatch({ type: 'solo_engage', fleet })
            : undefined}
          onLocal2PEngage={state.room.code === 'LOCAL2P'
            ? (fleet0, fleet1) => dispatch({ type: 'local2p_engage', fleet0, fleet1 })
            : undefined}
        />
      ) : null;
    }

    case 'battle': {
      const isOfflineBattle = isOfflineRoomCode(state.room?.code);
      const onlineRound = !isOfflineBattle ? state.room?.round : null;
      const battleSeed = !isOfflineBattle ? (onlineRound?.seed ?? state.battleSeed) : state.battleSeed;
      const battlePlanetType = !isOfflineBattle && state.room?.presentationSeed !== null && state.room?.presentationSeed !== undefined
        ? planetTypeFromSeed(state.room.presentationSeed)
        : state.planetType;
      return state.room ? (
        <Battle
          key={battleSeed}
          room={state.room}
          yourSide={state.yourSide}
          seed={battleSeed}
          planetType={battlePlanetType}
          inputDelay={state.inputDelay}
          aiSides={state.room.code === 'SOLO'
            ? [
                state.offlineControls[0] === 'human' ? null : state.offlineControls[0],
                state.offlineControls[1] === 'human' ? null : state.offlineControls[1],
              ]
            : [null, null]}
          isLocal2P={state.room.code === 'LOCAL2P'}
          winnerState={state.winnerState}
          activeSlot0={isOfflineBattle ? state.activeSlot0 : (onlineRound?.hostActiveSlot ?? null)}
          activeSlot1={isOfflineBattle ? state.activeSlot1 : (onlineRound?.oppActiveSlot ?? null)}
          onBattleEnd={(winner, ws, finalStatus) => dispatch({ type: 'battle_over', winner, winnerState: ws, finalStatus })}
          onQuitBattle={!isOfflineBattle
            ? () => {
                client.send({ type: 'leave_room' });
                dispatch({ type: 'leave_room_local', code: state.room!.code });
              }
            : undefined}
          onDesyncQuit={!isOfflineBattle
            ? () => {
                client.send({ type: 'leave_room' });
                dispatch({ type: 'leave_room_local', code: state.room!.code });
              }
            : undefined}
        />
      ) : null;
    }

    case 'battle_recovery':
      return state.room ? (
        <BattleRecoveryScreen
          room={state.room}
          onLeave={() => {
            client.send({ type: 'leave_room' });
            dispatch({ type: 'leave_room_local', code: state.room!.code });
          }}
        />
      ) : null;

    case 'ship_select': {
      if (!state.room) return null;
      const isSolo = state.room.code === 'SOLO';
      const isOnline = !isOfflineRoomCode(state.room.code);
      const onlineRound = isOnline ? state.room.round : null;
      const origHost = state.originalFleets?.host ?? state.room.host.fleet;
      const origOpp  = state.originalFleets?.opponent ?? (state.room.opponent?.fleet ?? []);
      const showStatus = state.finalStatus[0] !== null || state.finalStatus[1] !== null;

      const interactive0 = isOnline
        ? (((onlineRound?.selectionMode === 'both') || (onlineRound?.selectionMode === 'host')) && state.yourSide === 0)
        : (state.shipSelectBoth ? true : state.shipSelectSide === 0);
      const interactive1 = isOnline
        ? (((onlineRound?.selectionMode === 'both') || (onlineRound?.selectionMode === 'opp')) && state.yourSide === 1)
        : (state.shipSelectBoth ? true : state.shipSelectSide === 1);
      const showPane0 = isOnline ? true : (state.shipSelectBoth || interactive0);
      const showPane1 = isOnline ? true : (state.shipSelectBoth || interactive1);
      const pick0 = isOnline
        ? (onlineRound?.hostPendingSlot ?? onlineRound?.hostActiveSlot ?? null)
        : (state.shipSelectBoth ? state.shipSelectP0Slot : (interactive0 ? state.shipSelectP0Slot : state.activeSlot0));
      const pick1 = isOnline
        ? (onlineRound?.oppPendingSlot ?? onlineRound?.oppActiveSlot ?? null)
        : (state.shipSelectBoth ? state.shipSelectP1Slot : (interactive1 ? state.shipSelectP1Slot : state.activeSlot1));
      const handleSelect0 = (slot: number) => {
        if (isOnline) {
          client.send({ type: 'ship_select', slot });
          return;
        }
        dispatch({ type: 'ship_chosen', side: 0, slot });
      };
      const handleSelect1 = (slot: number) => {
        if (isOnline) {
          client.send({ type: 'ship_select', slot });
          return;
        }
        dispatch({ type: 'ship_chosen', side: 1, slot });
      };
      return (
        <SplitShipSelect
          fleet0={state.room.host.fleet}
          origFleet0={origHost}
          label0={state.room.host.teamName || 'Player 1'}
          pick0={pick0}
          fleet1={state.room.opponent?.fleet ?? []}
          origFleet1={origOpp}
          label1={state.room.opponent?.teamName || 'Player 2'}
          pick1={pick1}
          isAI0={interactive0 && isSolo && state.offlineControls[0] !== 'human'}
          isAI1={interactive1 && isSolo && state.offlineControls[1] !== 'human'}
          interactive0={interactive0}
          interactive1={interactive1}
          showPane0={showPane0}
          showPane1={showPane1}
          showActionCells0={interactive0}
          showActionCells1={interactive1}
          showStatus={showStatus}
          statusSides={state.finalStatus}
          onSelect0={handleSelect0}
          onSelect1={handleSelect1}
          onForfeit0={() => dispatch({ type: 'forfeit_game', side: 0 })}
          onForfeit1={() => dispatch({ type: 'forfeit_game', side: 1 })}
        />
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
            if (!isOffline) {
              client.send({ type: 'leave_room' });
              dispatch({ type: 'leave_room_local', code: state.room!.code });
              return;
            }
            if (fromSupermelee) {
              dispatch({ type: 'go_supermelee' });
            } else {
              dispatch({ type: 'go_browser' });
            }
          }}
        />
      );
    }

    case 'final_selector': {
      if (!state.room) return null;
      const isOnline = !isOfflineRoomCode(state.room.code);
      const isOnlineHost = isOnline && state.yourSide === 0;
      const origHost = state.originalFleets?.host ?? state.room.host.fleet;
      const origOpp  = state.originalFleets?.opponent ?? (state.room.opponent?.fleet ?? []);
      const allCyborgs = state.room.code === 'SOLO'
        && state.offlineControls[0] !== 'human'
        && state.offlineControls[1] !== 'human';

      return (
        <FinalFleetResult
          fleet0={state.room.host.fleet}
          origFleet0={origHost}
          label0={state.room.host.teamName || 'Player 1'}
          fleet1={state.room.opponent?.fleet ?? []}
          origFleet1={origOpp}
          label1={state.room.opponent?.teamName || 'Player 2'}
          winner={state.winner}
          finalStatus={state.finalStatus}
          autoAdvanceMs={isOnline
            ? (isOnlineHost ? 3500 : undefined)
            : (allCyborgs ? 6000 : undefined)}
          subtitle={isOnline
            ? (isOnlineHost ? 'Returning to multiplayer setup...' : 'Awaiting return to multiplayer setup...')
            : undefined}
          allowManualAdvance={!isOnline}
          onDone={isOnline
            ? (isOnlineHost ? () => client.send({ type: 'rematch' }) : undefined)
            : () => dispatch({ type: 'finish_offline_match' })}
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
  interactive?:  boolean;
  showActionCells?: boolean;
  stretch?:      boolean;
  maxWidth?:     number;
  // Navigation keys — derived from the player's saved control bindings so the
  // same keys used in battle work for ship selection too.
  navLeft:       string[]; // turnLeft  → move cursor left
  navRight:      string[]; // turnRight → move cursor right
  navUp:         string[]; // thrust    → move cursor up (row 0)
  navDown:       string[]; // down      → move cursor down (row 1)
  navFire:       string[]; // weapon(s) → confirm selection
  navSpecial:    string[]; // special   — shown in controls hint
  isAI?:         boolean;           // AI-controlled: auto-picks random, no cursor shown
  onSelect:      (slot: number) => void;
  onForfeit:     () => void;
}

function ShipSelectorPane({
  fleet, originalFleet, label, pick, position,
  interactive = true,
  showActionCells = true,
  stretch = true,
  maxWidth,
  navLeft, navRight, navUp, navDown, navFire, navSpecial,
  isAI = false, onSelect, onForfeit,
}: ShipSelectorPaneProps) {
  const [viewportSize, setViewportSize] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));

  // Start cursor on first available ship
  const [cursor, setCursor] = useState(() => {
    const first = fleet.findIndex(s => s !== null);
    return first >= 0 ? first : 0;
  });
  const [blink, setBlink] = useState(true);
  const [showForfeit, setShowForfeit] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const chosen = pick !== null;
  const displayCodes = (codes: string[]) => codes.length > 0 ? codes.map(codeDisplay).join(' / ') : '—';

  // AI: immediately pick a random ship on mount (silently)
  useEffect(() => {
    if (!interactive || !isAI) return;
    const slots = fleet.map((s: FleetSlot, i: number) => s !== null ? i : -1).filter((i: number) => i >= 0);
    if (slots.length > 0) onSelect(slots[Math.floor(Math.random() * slots.length)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, isAI]);

  // Blink timer — stops once a ship has been chosen
  useEffect(() => {
    if (chosen) return;
    const id = setInterval(() => setBlink(b => !b), 500);
    return () => clearInterval(id);
  }, [chosen]);

  useEffect(() => {
    const updateViewport = () => setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  // Keep a ref so the keydown closure always reads the latest cursor/fleet
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const fleetRef = useRef(fleet);
  fleetRef.current = fleet;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // navFire in a ref so the nav effect closure stays stable across re-renders
  const navFireRef = useRef(navFire);
  navFireRef.current = navFire;

  // ESC → toggle controls hint overlay (active even after a ship is chosen)
  useEffect(() => {
    if (!interactive || isAI) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.preventDefault();
      setShowControls(c => !c);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [interactive, isAI]);

  // Keyboard navigation — uses the player's configured ship controls
  useEffect(() => {
    if (!interactive || chosen || isAI) return;
    const allKeys = [...navLeft, ...navRight, ...navUp, ...navDown, ...navFireRef.current];

    const onKey = (e: KeyboardEvent) => {
      if (!allKeys.includes(e.code)) return;
      e.preventDefault();
      e.stopImmediatePropagation(); // prevent the other player's pane from also handling this key
      if (navLeft.includes(e.code))  setCursor(c => selectorNav(c, 'left'));
      else if (navRight.includes(e.code)) setCursor(c => selectorNav(c, 'right'));
      else if (navUp.includes(e.code))   setCursor(c => selectorNav(c, 'up'));
      else if (navDown.includes(e.code)) setCursor(c => selectorNav(c, 'down'));
      else if (navFireRef.current.includes(e.code)) {
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
  }, [chosen, interactive, isAI, navLeft, navRight, navUp, navDown]);

  const totalValue  = originalFleet.reduce((sum, s) => sum + (s ? (SHIP_COSTS[s] ?? 0) : 0), 0);
  const remainValue = fleet.reduce((sum, s) => sum + (s ? (SHIP_COSTS[s] ?? 0) : 0), 0);

  const accent    = position === 'bottom' ? 'var(--accent)' : 'var(--accent2)';
  const bgColor   = '#000063';
  const isSplit = position !== 'solo';
  const outerPad = isSplit ? 20 : 32;
  const gap = viewportSize.w <= 700 ? 3 : 4;
  const panelHeight = isSplit ? Math.max(220, Math.floor(viewportSize.h / 2)) : viewportSize.h;
  const availableWidth = Math.max(260, Math.min(maxWidth ?? Number.MAX_SAFE_INTEGER, viewportSize.w - outerPad * 2));
  const reservedHeight = isSplit ? 68 : 96;
  const columns = showActionCells ? 8 : 7;
  const maxCellFromWidth = Math.floor((availableWidth - gap * (columns - 1)) / columns);
  const maxCellFromHeight = Math.floor((panelHeight - reservedHeight - gap) / 2) - 12;
  const CELL = Math.max(26, Math.min(62, maxCellFromWidth, maxCellFromHeight));
  const gridWidth = CELL * columns + gap * (columns - 1);
  const headerFont = CELL <= 34 ? 9 : CELL <= 44 ? 10 : 11;
  const footerFont = CELL <= 34 ? 10 : 11;
  const titleWidth = Math.min(gridWidth, availableWidth);

  function renderShipCell(slot: number) {
    const orig      = originalFleet[slot] ?? null;
    const cur       = fleet[slot] ?? null;
    const isEmpty   = orig === null;
    const defeated  = orig !== null && cur === null;
    const available = cur !== null;
    const cursorOn  = interactive && cursor === slot && !chosen && !isAI;
    const glowing   = cursorOn && blink;
    const icon      = orig ? SHIP_ICON[orig] : null;

    return (
      <div
        key={`s${slot}`}
        onClick={() => interactive && available && onSelect(slot)}
        style={{
          position: 'relative', width: CELL, height: CELL + 12,
          background:   isEmpty   ? 'transparent'
                      : glowing   ? 'rgba(255,220,80,0.22)'
                      : cursorOn  ? '#11106f'
                      : '#000063',
          border:       isEmpty   ? '2px solid transparent'
                      : glowing   ? '2px solid #ffe040'
                      : cursorOn  ? '2px solid var(--accent2)'
                      : '2px solid var(--border)',
          borderRadius: 4, boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
          cursor:  interactive && available ? 'pointer' : 'default',
          opacity: defeated ? 0.6 : 1,
          boxShadow: glowing ? '0 0 8px 2px rgba(255,220,80,0.5)' : undefined,
          }}
        >
          {!isEmpty && icon && (
            <ShipMenuImage src={icon} alt={orig!} scale={3} maxFill="98%" />
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
    const cursorOn = interactive && cursor === 14 && !chosen && !isAI;
    const glowing  = cursorOn && blink;
    return (
      <div
        key="random"
        onClick={() => {
          if (!interactive) return;
          const slots = fleet.map((s, i) => s !== null ? i : -1).filter(i => i >= 0);
          if (slots.length > 0) onSelect(slots[Math.floor(Math.random() * slots.length)]);
        }}
        style={{
          width: CELL, height: CELL + 12, borderRadius: 4, boxSizing: 'border-box',
          background: glowing  ? 'rgba(160,0,255,0.35)' : cursorOn ? 'rgba(120,0,200,0.2)' : 'rgba(60,0,120,0.2)',
          border:     glowing  ? '2px solid #dd55ff'    : cursorOn ? '2px solid #8800cc'    : '2px solid #440077',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: interactive && avail ? 'pointer' : 'default', opacity: interactive ? (avail ? 1 : 0.35) : 0.18,
          fontSize: Math.max(16, Math.floor(CELL * 0.42)), color: glowing ? '#ee88ff' : '#aa33dd', fontWeight: 'bold', userSelect: 'none',
          boxShadow: glowing ? '0 0 8px 2px rgba(180,0,255,0.5)' : undefined,
        }}
      >?</div>
    );
  }

  function renderForfeitCell() {
    const cursorOn = interactive && cursor === 15 && !chosen && !isAI;
    const glowing  = cursorOn && blink;
    return (
      <div
        key="forfeit"
        onClick={() => interactive && !isAI && setShowForfeit(true)}
        style={{
          width: CELL, height: CELL + 10, borderRadius: 4, boxSizing: 'border-box',
          background: glowing  ? 'rgba(200,0,0,0.35)' : cursorOn ? 'rgba(150,0,0,0.2)' : 'rgba(60,0,0,0.2)',
          border:     glowing  ? '2px solid #ff5555'  : cursorOn ? '2px solid #cc0000'  : '2px solid #440000',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: interactive ? 'pointer' : 'default',
          opacity: interactive ? 1 : 0.18,
          boxShadow: glowing ? '0 0 8px 2px rgba(200,0,0,0.5)' : undefined,
        }}
      >
        <svg viewBox="0 0 24 24" width={Math.max(14, CELL - 10)} height={Math.max(14, CELL - 10)}>
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
      flex: stretch && position !== 'solo' ? 1 : undefined,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      width: Math.min(availableWidth, gridWidth + (viewportSize.w <= 700 ? 20 : 32)),
      maxWidth: '100%',
      padding: position === 'solo'
        ? `${viewportSize.w <= 700 ? 18 : 32}px ${viewportSize.w <= 700 ? 10 : 16}px`
        : `${viewportSize.w <= 700 ? 6 : 8}px ${viewportSize.w <= 700 ? 6 : 12}px`,
      background: bgColor,
      borderBottom: position === 'top' ? '2px solid var(--border)' : undefined,
      gap: 3, position: 'relative',
      minHeight: 0,
    }}>
      {/* Header: total and remaining fleet value */}
      <div style={{ display: 'flex', justifyContent: 'space-between', width: titleWidth, fontSize: headerFont, gap: 8 }}>
        <span style={{ color: 'var(--text-dim)' }}>
          Fleet: <strong style={{ color: accent }}>{totalValue}</strong>
        </span>
        <span style={{ color: 'var(--text-dim)' }}>
          Remaining: <strong style={{ color: remainValue > 0 ? 'var(--success)' : '#cc2222' }}>{remainValue}</strong>
        </span>
      </div>

      {/* Row 0: ship slots 0–6 + random button */}
      <div style={{ display: 'flex', gap }}>
        {row0Slots.map(s => renderShipCell(s))}
        {showActionCells ? renderRandomCell() : null}
      </div>

      {/* Row 1: ship slots 7–13 + forfeit button */}
      <div style={{ display: 'flex', gap }}>
        {row1Slots.map(s => renderShipCell(s))}
        {showActionCells ? renderForfeitCell() : null}
      </div>

      {/* Footer: fleet name or chosen ship */}
      <div style={{ fontSize: footerFont, color: chosenShip ? 'var(--success)' : accent, letterSpacing: '0.06em', marginTop: 1, maxWidth: titleWidth, textAlign: 'center' }}>
        {label}
      </div>

      {/* Forfeit confirmation overlay */}
      {interactive && showForfeit && (
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

      {/* Controls hint overlay (ESC to toggle) */}
      {interactive && showControls && (
        <div
          onClick={() => setShowControls(false)}
          style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.88)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 10, zIndex: 10, fontFamily: 'var(--font)',
          }}
        >
          <div style={{ color: accent, fontSize: 13, fontWeight: 'bold', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 4 }}>
            Controls
          </div>
          {([
            ['Left',    displayCodes(navLeft)],
            ['Right',   displayCodes(navRight)],
            ['Up',      displayCodes(navUp)],
            ['Down',    displayCodes(navDown)],
            ['Weapon',  displayCodes(navFire)],
            ['Special', displayCodes(navSpecial)],
            ['Escape',  'Escape'],
          ] as [string, string][]).map(([label, key]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', width: 200, gap: 12 }}>
              <span style={{ color: '#778', fontSize: 11, letterSpacing: '0.06em', flex: 1 }}>{label}</span>
              <span style={{
                background: '#111130', border: '1px solid #2a2a50',
                padding: '2px 10px', color: '#aabbff', fontSize: 11,
                letterSpacing: '0.05em', minWidth: 70, textAlign: 'center',
              }}>
                {key}
              </span>
            </div>
          ))}
          <div style={{ color: '#334', fontSize: 10, letterSpacing: '0.1em', marginTop: 6, textTransform: 'uppercase' }}>
            ESC or click to close
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
  isAI0?: boolean;
  isAI1?: boolean;
  interactive0?: boolean;
  interactive1?: boolean;
  showPane0?: boolean;
  showPane1?: boolean;
  showStatus?: boolean;
  statusSides?: [SideStatus | null, SideStatus | null];
  showActionCells0?: boolean;
  showActionCells1?: boolean;
  overlayTitle?: string;
  overlaySubtitle?: string;
  onSelect0: (slot: number) => void;
  onSelect1: (slot: number) => void;
  onForfeit0: () => void;
  onForfeit1: () => void;
}

function SplitShipSelect({
  fleet0, origFleet0, label0, pick0, onSelect0, onForfeit0,
  fleet1, origFleet1, label1, pick1, onSelect1, onForfeit1,
  isAI0 = false, isAI1 = false,
  interactive0 = true, interactive1 = true,
  showPane0 = true, showPane1 = true,
  showStatus = false, statusSides = [null, null],
  showActionCells0 = interactive0, showActionCells1 = interactive1,
  overlayTitle,
  overlaySubtitle,
}: SplitShipSelectProps) {
  const { p1, p2 } = getControls();
  const p1Nav = buildMenuBindingSet(p1.bindings);
  const p2Nav = buildMenuBindingSet(p2.bindings);
  const eitherNav = buildMenuBindingSet(p1.bindings, p2.bindings);
  const humanInteractiveCount =
    (interactive0 && !isAI0 ? 1 : 0) +
    (interactive1 && !isAI1 ? 1 : 0);
  const nav0 = humanInteractiveCount === 1 && interactive0 && !isAI0 ? eitherNav : p1Nav;
  const nav1 = humanInteractiveCount === 1 && interactive1 && !isAI1 ? eitherNav : p2Nav;
  const statusRef = useRef<[SideStatus | null, SideStatus | null]>(statusSides);
  statusRef.current = statusSides;
  const [viewportSize, setViewportSize] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));

  useEffect(() => {
    const updateViewport = () => setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  const outerPad = viewportSize.w <= 700 ? 12 : 20;
  const stageH = viewportSize.h - outerPad * 2;
  const stageW = viewportSize.w - outerPad * 2;
  const statusWidth = showStatus ? Math.round(stageH * (128 / 480)) : 0;
  const gap = showStatus ? 14 : 0;
  const fleetAreaW = Math.max(280, stageW - statusWidth - gap);
  const fleetColumnW = Math.min(fleetAreaW, Math.max(viewportSize.w <= 700 ? 360 : 440, Math.round(stageH * 0.78)));
  const fleetBlockHalf = fleetColumnW / 2;
  const visiblePaneCount = (showPane0 ? 1 : 0) + (showPane1 ? 1 : 0);
  const paneGap = visiblePaneCount > 1 ? 12 : 0;

  return (
    <div style={{
      width: '100vw',
      height: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#000',
      padding: outerPad,
    }}>
      <div style={{
        position: 'relative',
        width: stageW,
        height: stageH,
      }}>
        {overlayTitle && (
          <div style={{
            position: 'absolute',
            left: '50%',
            top: 18,
            width: fleetColumnW,
            transform: 'translateX(-50%)',
            zIndex: 2,
            pointerEvents: 'none',
          }}>
            <div style={{
              color: '#ff44ff',
              fontSize: 32,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              textAlign: 'center',
              textShadow: '0 0 18px #ff00ff60, 0 2px 0 #660066, 2px 2px 0 #330033',
            }}>
              {overlayTitle}
            </div>
            {overlaySubtitle && (
              <div style={{ color: '#2a2a44', fontSize: 11, letterSpacing: '0.1em', textAlign: 'center', textTransform: 'uppercase' }}>
                {overlaySubtitle}
              </div>
            )}
          </div>
        )}
        <div style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: fleetColumnW,
          transform: 'translate(-50%, -50%)',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: paneGap,
        }}>
          {showPane0 && (
            <ShipSelectorPane fleet={fleet0} originalFleet={origFleet0} label={label0} pick={pick0}
              position={visiblePaneCount === 1 ? 'solo' : 'top'}
              interactive={interactive0}
              showActionCells={showActionCells0}
              stretch={false}
              maxWidth={fleetColumnW}
              navLeft={nav0.left}   navRight={nav0.right}
              navUp={nav0.up}       navDown={nav0.down}
              navFire={nav0.confirm}
              navSpecial={nav0.cancel}
              isAI={isAI0} onSelect={onSelect0} onForfeit={onForfeit0} />
          )}
          {showPane1 && (
            <ShipSelectorPane fleet={fleet1} originalFleet={origFleet1} label={label1} pick={pick1}
              position={visiblePaneCount === 1 ? 'solo' : 'bottom'}
              interactive={interactive1}
              showActionCells={showActionCells1}
              stretch={false}
              maxWidth={fleetColumnW}
              navLeft={nav1.left}   navRight={nav1.right}
              navUp={nav1.up}       navDown={nav1.down}
              navFire={nav1.confirm}
              navSpecial={nav1.cancel}
              isAI={isAI1} onSelect={onSelect1} onForfeit={onForfeit1} />
          )}
        </div>
        {showStatus && (
          <div style={{
            position: 'absolute',
            left: `calc(50% + ${fleetBlockHalf + gap}px)`,
            top: '50%',
            width: statusWidth,
            minWidth: statusWidth,
            height: stageH,
            transform: 'translateY(-50%)',
            display: 'flex',
            background: '#000',
          }}>
            <StatusPanel sidesRef={statusRef} />
          </div>
        )}
      </div>
    </div>
  );
}

interface FinalFleetResultProps {
  fleet0: FleetSlot[];
  origFleet0: FleetSlot[];
  label0: string;
  fleet1: FleetSlot[];
  origFleet1: FleetSlot[];
  label1: string;
  winner: 0 | 1 | null | undefined;
  finalStatus: [SideStatus | null, SideStatus | null];
  autoAdvanceMs?: number;
  subtitle?: string;
  allowManualAdvance?: boolean;
  onDone?: () => void;
}

function FinalFleetResult({
  fleet0, origFleet0, label0,
  fleet1, origFleet1, label1,
  winner,
  finalStatus,
  autoAdvanceMs,
  subtitle,
  allowManualAdvance = true,
  onDone,
}: FinalFleetResultProps) {
  const [fading, setFading] = useState(false);
  const finishingRef = useRef(false);

  useEffect(() => {
    if (!onDone && autoAdvanceMs == null) return;

    const finish = () => {
      if (finishingRef.current) return;
      finishingRef.current = true;
      if (!onDone) return;
      setFading(true);
      window.setTimeout(onDone, 450);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      finish();
    };
    const onMouse = () => finish();
    const onTouch = () => finish();

    if (allowManualAdvance) {
      window.addEventListener('keydown', onKey);
      window.addEventListener('mousedown', onMouse);
      window.addEventListener('touchstart', onTouch, { passive: true });
    }

    const timer = autoAdvanceMs != null ? window.setTimeout(finish, autoAdvanceMs) : null;

    return () => {
      if (allowManualAdvance) {
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('mousedown', onMouse);
        window.removeEventListener('touchstart', onTouch);
      }
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [allowManualAdvance, autoAdvanceMs, onDone]);

  const title = winner === null ? 'Mutual Annihilation' : winner === 0 ? `${label0} Wins` : `${label1} Wins`;
  const footerSubtitle = subtitle ?? (autoAdvanceMs != null
    ? 'Returning to fleet setup...'
    : 'Press any key to return to fleet setup');

  return (
    <div style={{
      width: '100vw',
      height: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#000',
      opacity: fading ? 0 : 1,
      transition: 'opacity 0.45s linear',
    }}>
      <SplitShipSelect
        fleet0={fleet0}
        origFleet0={origFleet0}
        label0={label0}
        pick0={null}
        fleet1={fleet1}
        origFleet1={origFleet1}
        label1={label1}
        pick1={null}
        interactive0={false}
        interactive1={false}
        showActionCells0={false}
        showActionCells1={false}
        showStatus={true}
        statusSides={finalStatus}
        overlayTitle={title}
        overlaySubtitle={footerSubtitle}
        onSelect0={() => {}}
        onSelect1={() => {}}
        onForfeit0={() => {}}
        onForfeit1={() => {}}
      />
    </div>
  );
}

// ─── Post-battle screen ───────────────────────────────────────────────────────

interface BattleRecoveryScreenProps {
  room: FullRoomState;
  onLeave: () => void;
}

function BattleRecoveryScreen({ room, onLeave }: BattleRecoveryScreenProps) {
  return (
    <div className="screen">
      <div className="panel col" style={{ width: 440, gap: 18, textAlign: 'center' }}>
        <h2 style={{ color: 'var(--danger)' }}>Transmission Interrupted</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.5 }}>
          This client rejoined room <strong>{room.code}</strong> after the round had already started.
          The server tracks the room and relays lockstep inputs, but it does not store the live battle state or the
          early input queue needed to resume a round safely.
        </p>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.5 }}>
          Mounting the battle again here would invent a fresh fight from partial data and can stall forever on missing frames.
          Leave the match from here. A safe mid-round reconnect or abandon-round recovery flow is not wired yet.
        </p>
        <div className="row" style={{ justifyContent: 'center', gap: 12 }}>
          <button className="danger" onClick={onLeave}>Leave Match</button>
        </div>
      </div>
    </div>
  );
}

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
