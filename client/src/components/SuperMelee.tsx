import { useState, useEffect, useRef } from 'react';
import { FLEET_SIZE, type AIDifficulty, type FleetSlot, type ShipId } from 'shared/types';
import ShipPicker, { canSelectShipPickerOption, getShipPickerOptions } from './ShipPicker';
import StatusPanel, { type SideStatus } from './StatusPanel';
import StarfieldBG from './StarfieldBG';
import { loadConfig } from '../lib/starfield';
import { getControls, type KeyBindings } from '../lib/controls';
import { preloadUISounds, playMenuError, playMenuMove, playMenuSelect } from '../engine/audio';
import { SHIP_COSTS, SHIP_ICON, getShipSelectionPreview } from './shipSelectionData';
import { PreloadedImage, prefetchImages } from '../lib/preloadedImage';
import ShipMenuImage from './ShipMenuImage';
import SuperMeleeTitle from './SuperMeleeTitle';

const BATTLE_MENU_FRAMES = ['/meleemenu-025.png', '/meleemenu-026.png'] as const;
const BATTLE_SLOT_W = 128;
const BATTLE_SLOT_H = 134;
const TINY_FONT = '"UQMTiny", var(--font)';
const STARCON_FONT = '"UQMStarCon", var(--font)';
const LOGICAL_STAGE_W = 980;
const LOGICAL_STAGE_H = 760;
const LOGICAL_LEFT_W = 800;
const LOGICAL_SIDEBAR_W = 160;

void Promise.all(
  [
    new FontFace('UQMStarCon', 'url(/fonts/starcon.woff2)'),
    new FontFace('UQMSlides', 'url(/fonts/slides.woff2)'),
    new FontFace('UQMTiny', 'url(/fonts/tiny.woff2)'),
  ].map(face => { document.fonts.add(face); return face.load(); }),
).catch(() => {});

function fleetValue(fleet: FleetSlot[]): number {
  return fleet.reduce((sum, s) => sum + (s ? (SHIP_COSTS[s] ?? 0) : 0), 0);
}

export const BALANCED_TEAM_1: FleetSlot[] = [
  'human', 'spathi', 'urquan', 'pkunk', 'vux', 'kohrah', 'mycon',
  null, null, null, null, null, null, null,
];

export const BALANCED_TEAM_2: FleetSlot[] = [
  'human', 'spathi', 'urquan', 'pkunk', 'vux', 'kohrah', 'mycon',
  null, null, null, null, null, null, null,
];

export type ControlType = AIDifficulty | 'human';
const CONTROL_CYCLE: ControlType[] = ['cyborg_weak', 'cyborg_good', 'cyborg_awesome', 'human'];
const CONTROL_LABEL: Record<ControlType, string> = {
  cyborg_weak:    'WEAK\nCYBORG',
  cyborg_good:    'GOOD\nCYBORG',
  cyborg_awesome: 'AWESOME\nCYBORG',
  human:          'HUMAN\nCONTROL',
};

const MENU = [
  'NET_P1',
  'CONTROL_P1',
  'SAVE_P1',
  'LOAD_P1',
  'BATTLE',
  'LOAD_P2',
  'SAVE_P2',
  'CONTROL_P2',
  'SETTINGS',
  'STYLES',
] as const;
type MenuItem = typeof MENU[number];
type ActiveRegion = 'menu' | 'fleet' | 'picker';

interface SaveSlot {
  id: string;
  name: string;
  fleet: FleetSlot[];
  savedAt: number;
}

function padFleet(ships: ShipId[]): FleetSlot[] {
  return [...ships, ...Array.from({ length: Math.max(0, FLEET_SIZE - ships.length) }, () => null)];
}

const DEFAULT_SAVE_SLOTS: SaveSlot[] = [
  { id: 'builtin-balanced-team-1', name: 'Balanced Team 1', savedAt: 0, fleet: padFleet(['androsynth', 'chmmr', 'druuge', 'urquan', 'melnorme', 'orz', 'spathi', 'syreen', 'utwig']) },
  { id: 'builtin-balanced-team-2', name: 'Balanced Team 2', savedAt: 0, fleet: padFleet(['arilou', 'chenjesu', 'human', 'kohrah', 'mycon', 'yehat', 'pkunk', 'supox', 'thraddash', 'zoqfotpik', 'shofixti']) },
  { id: 'builtin-200-points', name: '200 points', savedAt: 0, fleet: padFleet(['androsynth', 'chmmr', 'druuge', 'melnorme', 'human', 'kohrah', 'supox', 'orz', 'spathi', 'ilwrath', 'vux']) },
  { id: 'builtin-behemoth-zenith', name: 'Behemoth Zenith', savedAt: 0, fleet: padFleet(['chenjesu', 'chenjesu', 'chmmr', 'chmmr', 'kohrah', 'kohrah', 'urquan', 'urquan', 'utwig', 'utwig']) },
  { id: 'builtin-the-peeled-eyes', name: 'The Peeled Eyes', savedAt: 0, fleet: padFleet(['urquan', 'chenjesu', 'mycon', 'syreen', 'zoqfotpik', 'shofixti', 'human', 'kohrah', 'melnorme', 'druuge', 'pkunk', 'orz']) },
  { id: 'builtin-fords-fighters', name: "Ford's Fighters", savedAt: 0, fleet: padFleet(['chmmr', 'zoqfotpik', 'melnorme', 'supox', 'utwig', 'umgah']) },
  { id: 'builtin-leylands-lashers', name: "Leyland's Lashers", savedAt: 0, fleet: padFleet(['androsynth', 'human', 'mycon', 'orz', 'urquan']) },
  { id: 'builtin-gregorizers-200', name: 'The Gregorizers 200', savedAt: 0, fleet: padFleet(['androsynth', 'chmmr', 'druuge', 'melnorme', 'human', 'kohrah', 'supox', 'orz', 'pkunk', 'spathi']) },
  { id: 'builtin-300-point-armada', name: '300 point Armada!', savedAt: 0, fleet: padFleet(['androsynth', 'chmmr', 'chenjesu', 'druuge', 'human', 'kohrah', 'melnorme', 'mycon', 'orz', 'pkunk', 'spathi', 'supox', 'urquan', 'yehat']) },
  { id: 'builtin-little-dudes', name: 'Little Dudes with Attitudes', savedAt: 0, fleet: padFleet(['umgah', 'thraddash', 'shofixti', 'human', 'vux', 'zoqfotpik']) },
  { id: 'builtin-new-alliance', name: 'New Alliance Ships', savedAt: 0, fleet: padFleet(['arilou', 'chmmr', 'human', 'orz', 'pkunk', 'shofixti', 'supox', 'syreen', 'utwig', 'zoqfotpik', 'yehat', 'druuge', 'thraddash', 'spathi']) },
  { id: 'builtin-old-alliance', name: 'Old Alliance Ships', savedAt: 0, fleet: padFleet(['arilou', 'chenjesu', 'human', 'mmrnmhrm', 'shofixti', 'syreen', 'yehat']) },
  { id: 'builtin-old-hierarchy', name: 'Old Hierarchy Ships', savedAt: 0, fleet: padFleet(['androsynth', 'ilwrath', 'mycon', 'spathi', 'umgah', 'urquan', 'vux']) },
  { id: 'builtin-star-control-1', name: 'Star Control 1', savedAt: 0, fleet: padFleet(['androsynth', 'arilou', 'chenjesu', 'human', 'ilwrath', 'mmrnmhrm', 'mycon', 'shofixti', 'spathi', 'syreen', 'umgah', 'urquan', 'vux', 'yehat']) },
  { id: 'builtin-star-control-2', name: 'Star Control 2', savedAt: 0, fleet: padFleet(['chmmr', 'druuge', 'kohrah', 'melnorme', 'orz', 'pkunk', 'slylandro', 'supox', 'thraddash', 'utwig', 'zoqfotpik', 'zoqfotpik', 'zoqfotpik', 'zoqfotpik']) },
];

type FleetSide = 1 | 2;
type SaveModalState = { mode: 'load'; targetSide: FleetSide };

interface LastState {
  fleet1: FleetSlot[];
  fleet2: FleetSlot[];
  teamName1: string;
  teamName2: string;
}

function loadLastState(): LastState | null {
  try {
    const raw = localStorage.getItem('sm_last');
    return raw ? (JSON.parse(raw) as LastState) : null;
  } catch { return null; }
}

function writeLastState(s: LastState) {
  try { localStorage.setItem('sm_last', JSON.stringify(s)); } catch {}
}

function loadSaves(): SaveSlot[] {
  try {
    const raw = localStorage.getItem('sm_saves');
    if (!raw) {
      writeSavesLS(DEFAULT_SAVE_SLOTS);
      return DEFAULT_SAVE_SLOTS.map(slot => ({ ...slot, fleet: [...slot.fleet] }));
    }
    const parsed = JSON.parse(raw) as SaveSlot[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      writeSavesLS(DEFAULT_SAVE_SLOTS);
      return DEFAULT_SAVE_SLOTS.map(slot => ({ ...slot, fleet: [...slot.fleet] }));
    }
    return parsed;
  } catch {
    writeSavesLS(DEFAULT_SAVE_SLOTS);
    return DEFAULT_SAVE_SLOTS.map(slot => ({ ...slot, fleet: [...slot.fleet] }));
  }
}

function writeSavesLS(saves: SaveSlot[]) {
  try { localStorage.setItem('sm_saves', JSON.stringify(saves)); } catch {}
}

function menuLabel(item: MenuItem, p1Control: ControlType, p2Control: ControlType): string {
  switch (item) {
    case 'NET_P1': return 'Net...';
    case 'SETTINGS': return 'Settings';
    case 'STYLES': return 'Styles';
    case 'CONTROL_P1': return CONTROL_LABEL[p1Control];
    case 'CONTROL_P2': return CONTROL_LABEL[p2Control];
    case 'SAVE_P1':
    case 'SAVE_P2':
      return 'Save';
    case 'LOAD_P1':
    case 'LOAD_P2':
      return 'Load';
    case 'BATTLE': return 'BATTLE';
    default: return item;
  }
}

function fleetToRowCol(fleet: 1 | 2, slot: number): [number, number] {
  const localRow = slot < 7 ? 0 : 1;
  return [fleet === 1 ? localRow : localRow + 2, slot % 7];
}

function rowColToFleet(row: number, col: number): { fleet: 1 | 2; slot: number } {
  const fleet = row < 2 ? 1 : 2;
  const localRow = row % 2;
  return { fleet, slot: localRow * 7 + col };
}

function navigateFleetCell(
  fleet: 1 | 2,
  slot: number,
  dir: 'left' | 'right' | 'up' | 'down',
): { fleet: 1 | 2; slot: number; toMenu: boolean } {
  let [row, col] = fleetToRowCol(fleet, slot);
  if (dir === 'right') {
    if (col === 6) return { fleet, slot, toMenu: true };
    col += 1;
  } else if (dir === 'left') {
    col = Math.max(0, col - 1);
  } else if (dir === 'up') {
    row = Math.max(0, row - 1);
  } else {
    row = Math.min(3, row + 1);
  }
  const next = rowColToFleet(row, col);
  return { ...next, toMenu: false };
}

function navigatePickerIndex(index: number, dir: 'left' | 'right' | 'up' | 'down', total: number): number {
  const cols = 5;
  let row = Math.floor(index / cols);
  let col = index % cols;
  if (dir === 'left') col = Math.max(0, col - 1);
  else if (dir === 'right') col = Math.min(cols - 1, col + 1);
  else if (dir === 'up') row = Math.max(0, row - 1);
  else row = Math.min(Math.floor((total - 1) / cols), row + 1);

  const next = row * cols + col;
  return Math.min(next, total - 1);
}

function bindingCodes(bindings: KeyBindings, key: 'left' | 'right' | 'up' | 'down' | 'confirm' | 'cancel'): string[] {
  switch (key) {
    case 'left': return [bindings.turnLeft].filter(Boolean);
    case 'right': return [bindings.turnRight].filter(Boolean);
    case 'up': return [bindings.thrust].filter(Boolean);
    case 'down': return [bindings.down].filter(Boolean);
    case 'confirm': return [bindings.weapon, bindings.weaponAlt].filter(Boolean);
    case 'cancel': return [bindings.special, bindings.specialAlt].filter(Boolean);
  }
}

export interface BattleStartParams {
  fleet1: FleetSlot[];
  fleet2: FleetSlot[];
  teamName1: string;
  teamName2: string;
  p1Control: ControlType;
  p2Control: ControlType;
}

interface Props {
  onBattle:    (params: BattleStartParams) => void;
  onNet:       () => void;
  onSettings:  () => void;
  onStyles?:   () => void;
  stylesHref?: string;
  showStyles?: boolean;
}

export default function SuperMelee({ onBattle, onNet, onSettings, onStyles, stylesHref = '/styles', showStyles = false }: Props) {
  const last = loadLastState();

  const [fleet1, setFleet1]       = useState<FleetSlot[]>(last?.fleet1 ?? [...BALANCED_TEAM_1]);
  const [fleet2, setFleet2]       = useState<FleetSlot[]>(last?.fleet2 ?? [...BALANCED_TEAM_2]);
  const [teamName1, setTeamName1] = useState(last?.teamName1 ?? 'Balanced Team 1');
  const [teamName2, setTeamName2] = useState(last?.teamName2 ?? 'Balanced Team 2');
  const [p1Control, setP1Control] = useState<ControlType>('human');
  const [p2Control, setP2Control] = useState<ControlType>('cyborg_weak');
  const [bgConfig]                = useState(loadConfig);
  const [blink, setBlink]         = useState(false);

  const [menuIndex, setMenuIndex]     = useState(4);
  const [activeRegion, setActiveRegion] = useState<ActiveRegion>('menu');
  const [fleetFocus, setFleetFocus]   = useState<{ fleet: 1 | 2; slot: number }>({ fleet: 1, slot: 13 });
  const [picker, setPicker]           = useState<{ fleet: 1 | 2; slot: number; activeIndex: number } | null>(null);
  const [saveModal, setSaveModal]     = useState<SaveModalState | null>(null);
  const [editingTeam, setEditingTeam] = useState<1 | 2 | null>(null);
  const [teamDraft, setTeamDraft]     = useState('');
  const [stageScale, setStageScale]   = useState(1);
  const [loadSelectionIndex, setLoadSelectionIndex] = useState(0);
  const [loadDeleteConfirm, setLoadDeleteConfirm] = useState<{ id: string; choice: 'yes' | 'no' } | null>(null);
  const statusRef = useRef<[SideStatus | null, SideStatus | null]>([null, null]);
  const loadRowRefs = useRef<Array<HTMLDivElement | null>>([]);

  const pickerOptions = getShipPickerOptions();
  const blockingModal = saveModal !== null || editingTeam !== null;

  useEffect(() => {
    writeLastState({ fleet1, fleet2, teamName1, teamName2 });
  }, [fleet1, fleet2, teamName1, teamName2]);

  useEffect(() => {
    preloadUISounds();
    prefetchImages(BATTLE_MENU_FRAMES);
    prefetchImages(Object.values(SHIP_ICON).filter((value): value is string => Boolean(value)));
    const t = setInterval(() => setBlink(b => !b), 440);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (saveModal?.mode !== 'load') return;
    const row = loadRowRefs.current[loadSelectionIndex];
    row?.scrollIntoView({ block: 'nearest' });
  }, [loadSelectionIndex, saveModal]);

  useEffect(() => {
    function updateScale() {
      const pad = 40;
      const availW = Math.max(320, window.innerWidth - pad);
      const availH = Math.max(320, window.innerHeight - pad);
      setStageScale(Math.min(availW / LOGICAL_STAGE_W, availH / LOGICAL_STAGE_H));
    }

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  function cycleControl(c: ControlType): ControlType {
    return CONTROL_CYCLE[(CONTROL_CYCLE.indexOf(c) + 1) % CONTROL_CYCLE.length];
  }

  function setRegionMenu(nextIdx?: number, withSound = false) {
    if (typeof nextIdx === 'number') setMenuIndex(nextIdx);
    setActiveRegion('menu');
    if (withSound) playMenuMove();
  }

  function setRegionFleet(next: { fleet: 1 | 2; slot: number }, withSound = false) {
    setFleetFocus(next);
    setActiveRegion('fleet');
    if (withSound) playMenuMove();
  }

  function openPicker(fleet: 1 | 2, slot: number) {
    const currentShip = (fleet === 1 ? fleet1 : fleet2)[slot] ?? null;
    const currentIndex = Math.max(0, pickerOptions.findIndex(option => option === currentShip));
    setFleetFocus({ fleet, slot });
    setActiveRegion('picker');
    setPicker({ fleet, slot, activeIndex: currentIndex });
    playMenuSelect();
  }

  function closePicker(playSound = true) {
    setPicker(null);
    setActiveRegion('fleet');
    if (playSound) playMenuSelect();
  }

  function setPickerActiveIndex(nextIndex: number, playSound = false) {
    setPicker(prev => prev ? { ...prev, activeIndex: nextIndex } : prev);
    if (playSound) playMenuMove();
  }

  function saveFleet(side: FleetSide) {
    const fleet = side === 1 ? fleet1 : fleet2;
    const fallbackName = side === 1 ? 'Balanced Team 1' : 'Balanced Team 2';
    const chosenName = (side === 1 ? teamName1 : teamName2).trim() || fallbackName;
    const existing = loadSaves();
    const entry: SaveSlot = {
      id: existing.find(s => s.name === chosenName)?.id ?? Date.now().toString(),
      name: chosenName,
      fleet: [...fleet],
      savedAt: Date.now(),
    };
    const updated = [entry, ...existing.filter(s => s.name !== chosenName)].slice(0, 20);
    writeSavesLS(updated);
  }

  function loadFleet(slot: SaveSlot, side: FleetSide) {
    if (side === 1) {
      setFleet1([...slot.fleet]);
      setTeamName1(slot.name);
    } else {
      setFleet2([...slot.fleet]);
      setTeamName2(slot.name);
    }
    setSaveModal(null);
    playMenuSelect();
  }

  function activateMenu(idx: number) {
    const battleEnabled = fleet1.some(Boolean) && fleet2.some(Boolean);
    switch (MENU[idx]) {
      case 'NET_P1':
        playMenuSelect();
        onNet();
        break;
      case 'SETTINGS':
        playMenuSelect();
        onSettings();
        break;
      case 'CONTROL_P1':
        playMenuSelect();
        setP1Control(c => cycleControl(c));
        break;
      case 'CONTROL_P2':
        playMenuSelect();
        setP2Control(c => cycleControl(c));
        break;
      case 'SAVE_P1':
        playMenuSelect();
        saveFleet(1);
        break;
      case 'SAVE_P2':
        playMenuSelect();
        saveFleet(2);
        break;
      case 'LOAD_P1':
        playMenuSelect();
        setLoadSelectionIndex(0);
        setLoadDeleteConfirm(null);
        setSaveModal({ mode: 'load', targetSide: 1 });
        break;
      case 'LOAD_P2':
        playMenuSelect();
        setLoadSelectionIndex(0);
        setLoadDeleteConfirm(null);
        setSaveModal({ mode: 'load', targetSide: 2 });
        break;
      case 'BATTLE':
        if (!battleEnabled) {
          playMenuError();
          return;
        }
        playMenuSelect();
        onBattle({ fleet1, fleet2, teamName1, teamName2, p1Control, p2Control });
        break;
      case 'STYLES':
        playMenuSelect();
        if (showStyles) onStyles?.();
        else playMenuError();
        break;
    }
  }

  useEffect(() => {
    const controls = getControls();
    const p1 = controls.p1.bindings;
    const p2 = controls.p2.bindings;

    const matchAction = (code: string, action: Parameters<typeof bindingCodes>[1]) =>
      bindingCodes(p1, action).includes(code) || bindingCodes(p2, action).includes(code);

    const onKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      const isUp = matchAction(code, 'up');
      const isDown = matchAction(code, 'down');
      const isLeft = matchAction(code, 'left');
      const isRight = matchAction(code, 'right');
      const isConfirm = matchAction(code, 'confirm') || code === 'Enter' || code === 'NumpadEnter';
      const isCancel = matchAction(code, 'cancel') || code === 'Escape';

      const isDelete = code === 'Delete';
      if (!isUp && !isDown && !isLeft && !isRight && !isConfirm && !isCancel && !isDelete) return;
      if (isDelete) {
        e.preventDefault();
      }

      if (saveModal?.mode === 'load') {
        const saves = loadSaves();
        if (!isUp && !isDown && !isConfirm && !isCancel && !isDelete && !isLeft && !isRight) return;
        e.preventDefault();

        if (loadDeleteConfirm) {
          if (isLeft || isRight) {
            setLoadDeleteConfirm(prev => prev ? { ...prev, choice: prev.choice === 'no' ? 'yes' : 'no' } : prev);
            playMenuMove();
            return;
          }
          if (isCancel) {
            setLoadDeleteConfirm(null);
            playMenuSelect();
            return;
          }
          if (isConfirm) {
            if (loadDeleteConfirm.choice === 'yes') {
              const upd = saves.filter(s => s.id !== loadDeleteConfirm.id);
              writeSavesLS(upd);
              setLoadSelectionIndex(current => Math.max(0, Math.min(current, upd.length - 1)));
            }
            setLoadDeleteConfirm(null);
            playMenuSelect();
            return;
          }
          return;
        }

        if (isCancel) {
          setSaveModal(null);
          playMenuSelect();
          return;
        }

        if (saves.length === 0) {
          if (isConfirm || isDelete) playMenuError();
          return;
        }

        if (isUp) {
          setLoadSelectionIndex(index => {
            const next = Math.max(0, index - 1);
            if (next !== index) playMenuMove();
            return next;
          });
          return;
        }
        if (isDown) {
          setLoadSelectionIndex(index => {
            const next = Math.min(saves.length - 1, index + 1);
            if (next !== index) playMenuMove();
            return next;
          });
          return;
        }
        if (isDelete) {
          const target = saves[loadSelectionIndex];
          if (!target) {
            playMenuError();
            return;
          }
          setLoadDeleteConfirm({ id: target.id, choice: 'no' });
          playMenuSelect();
          return;
        }
        if (isConfirm) {
          const chosen = saves[loadSelectionIndex];
          if (!chosen) {
            playMenuError();
            return;
          }
          loadFleet(chosen, saveModal.targetSide);
          return;
        }
        return;
      }

      if (blockingModal) return;

      e.preventDefault();

      if (picker && activeRegion === 'picker') {
        if (isCancel) {
          closePicker();
          return;
        }
        if (isConfirm) {
          const chosen = pickerOptions[picker.activeIndex] ?? null;
          if (!canSelectShipPickerOption(chosen)) {
            playMenuError();
            return;
          }
          if (picker.fleet === 1) {
            setFleet1(prev => {
              const next = [...prev];
              next[picker.slot] = chosen;
              return next;
            });
          } else {
            setFleet2(prev => {
              const next = [...prev];
              next[picker.slot] = chosen;
              return next;
            });
          }
          setPicker(null);
          setActiveRegion('fleet');
          playMenuSelect();
          return;
        }

        const dir = isLeft ? 'left' : isRight ? 'right' : isUp ? 'up' : 'down';
        const nextIndex = navigatePickerIndex(picker.activeIndex, dir, pickerOptions.length);
        if (nextIndex !== picker.activeIndex) setPickerActiveIndex(nextIndex, true);
        return;
      }

      if (activeRegion === 'menu') {
        if (isUp) {
          setMenuIndex(i => {
            const next = (i - 1 + MENU.length) % MENU.length;
            if (next !== i) playMenuMove();
            return next;
          });
          return;
        }
        if (isDown) {
          setMenuIndex(i => {
            const next = (i + 1) % MENU.length;
            if (next !== i) playMenuMove();
            return next;
          });
          return;
        }
        if (isLeft) {
          setRegionFleet({ fleet: 1, slot: 13 }, true);
          return;
        }
        if (isConfirm) {
          activateMenu(menuIndex);
          return;
        }
        if (isCancel) {
          playMenuError();
        }
        return;
      }

      if (activeRegion === 'fleet') {
        if (isConfirm) {
          openPicker(fleetFocus.fleet, fleetFocus.slot);
          return;
        }
        if (isCancel) {
          setRegionMenu(menuIndex, true);
          return;
        }

        const dir = isLeft ? 'left' : isRight ? 'right' : isUp ? 'up' : 'down';
        const next = navigateFleetCell(fleetFocus.fleet, fleetFocus.slot, dir);
        if (next.toMenu) {
          setRegionMenu(menuIndex, true);
          return;
        }
        if (next.fleet !== fleetFocus.fleet || next.slot !== fleetFocus.slot) {
          setRegionFleet({ fleet: next.fleet, slot: next.slot }, true);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeRegion,
    blockingModal,
    fleet1,
    fleet2,
    fleetFocus,
    loadDeleteConfirm,
    loadSelectionIndex,
    menuIndex,
    onBattle,
    onNet,
    onSettings,
    onStyles,
    p1Control,
    p2Control,
    picker,
    pickerOptions,
    saveModal,
    showStyles,
    teamName1,
    teamName2,
  ]);

  const focusedShip: ShipId | null =
    activeRegion === 'picker' && picker
      ? (pickerOptions[picker.activeIndex] ?? null)
      : activeRegion === 'fleet'
      ? ((fleetFocus.fleet === 1 ? fleet1 : fleet2)[fleetFocus.slot] ?? null)
      : null;

  const preview = getShipSelectionPreview(focusedShip);
  statusRef.current = preview
    ? [{
        shipId: preview.shipId,
        crew: preview.currentCrew,
        maxCrew: preview.maxCrew,
        energy: preview.currentEnergy,
        maxEnergy: preview.maxEnergy,
        inputs: 0,
        captainIdx: 0,
        caption: `${preview.cost}`,
      }, null]
    : [null, null];

  const showPreviewInBattleSlot = activeRegion === 'fleet' || activeRegion === 'picker';
  const showEmptySlotPreview = showPreviewInBattleSlot && focusedShip === null;
  const battleImageSrc = blink ? BATTLE_MENU_FRAMES[0] : BATTLE_MENU_FRAMES[1];

  function renderFleetGrid(fleet: FleetSlot[], fleetNum: 1 | 2) {
    const cells = Array.from({ length: 14 }, (_, i) => {
      const ship = fleet[i] ?? null;
      const icon = ship ? SHIP_ICON[ship] : null;
      const isFocused = activeRegion === 'fleet' && fleetFocus.fleet === fleetNum && fleetFocus.slot === i;

      return (
        <div
          key={i}
          onClick={() => openPicker(fleetNum, i)}
          onMouseEnter={() => {
            setActiveRegion('fleet');
            setFleetFocus({ fleet: fleetNum, slot: i });
          }}
          title={ship ?? 'Empty Slot'}
          style={{
            width: '100%',
            aspectRatio: '1 / 1',
            background: ship ? (isFocused ? '#11106f' : '#000063') : 'transparent',
            border: isFocused ? '2px solid #dd55ff' : '1px solid rgba(90, 90, 140, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxSizing: 'border-box',
            flexShrink: 0,
            color: '#7c7ca4',
            fontSize: 11,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
          >
            {icon ? (
              <ShipMenuImage
                src={icon}
                alt={ship!}
                scale={3}
                maxFill="98%"
              />
            ) : null}
        </div>
      );
    });

    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        gap: 6,
        width: '100%',
      }}>
        {cells}
      </div>
    );
  }

  function renderMenuItem(item: MenuItem, idx: number) {
    const sel = activeRegion === 'menu' && menuIndex === idx;
    const isBattle = item === 'BATTLE';
    const isControl = item.startsWith('CONTROL');
    const usesSharedBevel = item === 'NET_P1'
      || item === 'SAVE_P1'
      || item === 'SAVE_P2'
      || item === 'LOAD_P1'
      || item === 'LOAD_P2'
      || item === 'SETTINGS'
      || item === 'STYLES';
    const label = menuLabel(item, p1Control, p2Control);

    const itemStyle: React.CSSProperties = {
      background: !usesSharedBevel && !isBattle ? (isControl ? '#02043E' : sel ? '#6f6f6f' : '#525252') : undefined,
      borderTop: !usesSharedBevel && !isBattle ? '1px solid #838383' : undefined,
      borderLeft: !usesSharedBevel && !isBattle ? '1px solid #838383' : undefined,
      borderRight: !usesSharedBevel && !isBattle ? '1px solid #414141' : undefined,
      borderBottom: !usesSharedBevel && !isBattle ? '1px solid #414141' : undefined,
      color: !usesSharedBevel && !isBattle ? (isControl ? '#238CD2' : '#000') : undefined,
      padding: isBattle ? '0' : usesSharedBevel ? undefined : isControl ? '13px 12px' : '9px 12px',
      cursor: 'pointer',
      textAlign: !usesSharedBevel ? 'center' : undefined,
      fontFamily: !usesSharedBevel ? 'var(--font)' : undefined,
      letterSpacing: !usesSharedBevel ? '0.08em' : undefined,
      userSelect: !usesSharedBevel ? 'none' : undefined,
      boxSizing: 'border-box',
      width: isBattle ? BATTLE_SLOT_W : 'fit-content',
      minWidth: isBattle ? undefined : 0,
      alignSelf: 'center',
      minHeight: isBattle ? BATTLE_SLOT_H : undefined,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textDecoration: 'none',
    };

    const content = isBattle ? (
          <div style={{ width: BATTLE_SLOT_W, height: BATTLE_SLOT_H, position: 'relative' }}>
            <PreloadedImage
              src={battleImageSrc}
              alt="Battle"
              style={{
                width: BATTLE_SLOT_W,
                height: BATTLE_SLOT_H,
                imageRendering: 'pixelated',
                objectFit: 'contain',
                display: 'block',
                position: 'absolute',
                inset: 0,
                visibility: showPreviewInBattleSlot ? 'hidden' : 'visible',
              }}
            />
            <div
              style={{
                width: BATTLE_SLOT_W,
                height: BATTLE_SLOT_H,
                position: 'absolute',
                inset: 0,
                visibility: showPreviewInBattleSlot ? 'visible' : 'hidden',
              }}
            >
              {showEmptySlotPreview ? (
                <div className="super-melee-battle-empty-slot">
                  Empty Slot
                </div>
              ) : (
                <StatusPanel
                  sidesRef={statusRef}
                  layout="single"
                  singleSideIndex={0}
                  showCaptain={false}
                  showStatLabels={true}
                  compactSingle
                />
              )}
            </div>
          </div>
        ) : usesSharedBevel ? (
          <span className="super-melee-menu-label">
            {label}
          </span>
        ) : (
          <span style={{
            color: isControl ? '#238CD2' : '#000',
            fontSize: isControl ? 15 : 14,
            fontWeight: isControl ? 'bold' : 'normal',
            fontFamily: TINY_FONT,
            lineHeight: isControl ? 0.92 : 1,
            whiteSpace: isControl ? 'pre-line' : 'normal',
            textShadow: isControl ? '0 0 4px #28287C, 1px 1px 0 #28287C' : undefined,
          }}>
            {label}
          </span>
        );

    const handleClick = () => {
      setMenuIndex(idx);
      setActiveRegion('menu');
      activateMenu(idx);
    };

    const buttonClassName = usesSharedBevel ? [
      'ui-button',
      'ui-button--bevel',
      'super-melee-menu-button',
      sel ? 'is-active' : '',
    ].filter(Boolean).join(' ') : undefined;

    if (item === 'STYLES' && showStyles && onStyles) {
      return (
        <a
          key={item + idx}
          href={stylesHref}
          className={buttonClassName}
          onClick={e => {
            if (
              e.button !== 0
              || e.metaKey
              || e.ctrlKey
              || e.shiftKey
              || e.altKey
            ) {
              return;
            }
            e.preventDefault();
            handleClick();
          }}
          onMouseEnter={() => {
            setMenuIndex(idx);
            setActiveRegion('menu');
          }}
          style={itemStyle}
          aria-current={sel ? 'true' : undefined}
        >
          {content}
        </a>
      );
    }

    return (
      <button
        key={item + idx}
        type="button"
        className={buttonClassName}
        onClick={handleClick}
        onMouseEnter={() => {
          setMenuIndex(idx);
          setActiveRegion('menu');
        }}
        style={itemStyle}
        aria-current={sel ? 'true' : undefined}
      >
        {content}
      </button>
    );
  }

  function TeamLabel({ name, pts, side }: { name: string; pts: number; side: 1 | 2 }) {
    function startEdit() {
      setTeamDraft(name);
      setEditingTeam(side);
    }

    function commit() {
      if (side === 1) setTeamName1(teamDraft.trim() || name);
      else setTeamName2(teamDraft.trim() || name);
      setEditingTeam(null);
    }

    return (
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '5px 4px',
      }}>
        {editingTeam === side ? (
          <input
            value={teamDraft}
            onChange={e => setTeamDraft(e.target.value)}
            autoFocus
            maxLength={20}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditingTeam(null);
            }}
            style={{
              width: 260,
              background: '#000',
              color: '#fff',
              border: '1px solid #446',
              fontFamily: 'var(--font)',
              fontSize: 16,
              padding: '2px 6px',
              letterSpacing: '0.05em',
            }}
          />
        ) : (
          <span
            title="Click to rename fleet"
            onClick={startEdit}
            style={{ color: '#fff', fontSize: 16, fontFamily: TINY_FONT, cursor: 'pointer', letterSpacing: '0.05em' }}
          >
            {name}
          </span>
        )}
        <span style={{ color: '#fff', fontSize: 16, fontFamily: TINY_FONT }}>
          {pts}
        </span>
      </div>
    );
  }

  function renderLoadOverlay() {
    if (saveModal?.mode !== 'load') return null;

    const saves = loadSaves();

    return (
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.2)',
        zIndex: 20,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
      }}
      onClick={() => {
        setLoadDeleteConfirm(null);
        setSaveModal(null);
        playMenuSelect();
      }}>
        <div style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          background: '#1E1E5D',
          borderTop: '1px solid #838383',
          borderLeft: '1px solid #838383',
          borderRight: '1px solid #414141',
          borderBottom: '1px solid #414141',
          padding: '14px 12px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}>
          <div style={{
            position: 'sticky',
            top: 0,
            zIndex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            background: '#1E1E5D',
            paddingBottom: 4,
          }}>
            <div style={{
              color: '#ffffff',
              fontFamily: TINY_FONT,
              fontSize: 18,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}>
              Load
            </div>
            <button
              onClick={() => {
                setLoadDeleteConfirm(null);
                setSaveModal(null);
                playMenuSelect();
              }}
              style={{
                appearance: 'none',
                background: 'transparent',
                border: 'none',
                color: '#ffffff',
                fontFamily: TINY_FONT,
                fontSize: 18,
                lineHeight: 1,
                padding: 0,
                cursor: 'pointer',
                textTransform: 'uppercase',
              }}
              aria-label="Close load fleet"
            >
              X
            </button>
          </div>

          {saves.length === 0 ? (
            <div style={{
              color: '#fff',
              fontFamily: TINY_FONT,
              fontSize: 16,
              letterSpacing: '0.04em',
            }}>
              No saved fleets.
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                overflowY: 'auto',
                minHeight: 0,
                paddingRight: 4,
              }}
            >
              {saves.map((s, index) => {
                const selected = index === loadSelectionIndex;
                return (
                  <div
                    key={s.id}
                    ref={el => { loadRowRefs.current[index] = el; }}
                    onMouseEnter={() => {
                      setLoadSelectionIndex(current => {
                        if (current !== index) playMenuMove();
                        return index;
                      });
                    }}
                    onClick={() => loadFleet(s, saveModal.targetSide)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      padding: '4px 6px',
                      cursor: 'pointer',
                      background: selected ? 'rgba(255, 255, 0, 0.12)' : 'transparent',
                      outline: selected ? '1px solid #ffff00' : '1px solid transparent',
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      color: '#fff',
                      fontFamily: TINY_FONT,
                      fontSize: 16,
                      letterSpacing: '0.04em',
                    }}>
                      <span>{s.name}</span>
                      <span>{fleetValue(s.fleet)}</span>
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(14, minmax(0, 1fr))',
                      gap: 3,
                      width: '100%',
                    }}>
                      {Array.from({ length: 14 }, (_, slotIndex) => {
                        const ship = s.fleet[slotIndex] ?? null;
                        const icon = ship ? SHIP_ICON[ship] : null;
                        return (
                          <div
                            key={`${s.id}-${slotIndex}`}
                            style={{
                              aspectRatio: '1 / 1',
                              background: 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              overflow: 'hidden',
                            }}
                          >
                            {icon ? (
                              <PreloadedImage
                                src={icon}
                                alt={ship ?? ''}
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  objectFit: 'contain',
                                  imageRendering: 'pixelated',
                                  display: 'block',
                                }}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {loadDeleteConfirm && (
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0, 0, 0, 0.18)',
            }}>
              <div style={{
                display: 'inline-flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                padding: '10px 14px',
                background: '#1E1E5D',
                borderTop: '1px solid #838383',
                borderLeft: '1px solid #838383',
                borderRight: '1px solid #414141',
                borderBottom: '1px solid #414141',
                width: 'fit-content',
              }}>
                <div style={{
                  fontFamily: STARCON_FONT,
                  fontSize: 22,
                  color: '#ffffff',
                  lineHeight: 1,
                  textTransform: 'uppercase',
                }}>
                  Really Delete
                </div>
                <div style={{
                  display: 'flex',
                  gap: 18,
                  fontFamily: STARCON_FONT,
                  fontSize: 18,
                  lineHeight: 1,
                  textTransform: 'uppercase',
                }}>
                  <span style={{ color: loadDeleteConfirm.choice === 'yes' ? '#ffff00' : '#ffffff' }}>Yes</span>
                  <span style={{ color: loadDeleteConfirm.choice === 'no' ? '#ffff00' : '#ffffff' }}>No</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const val1 = fleetValue(fleet1);
  const val2 = fleetValue(fleet2);
  const topMenuItems: MenuItem[] = ['LOAD_P1', 'SAVE_P1', 'CONTROL_P1', 'NET_P1'];
  const bottomMenuItems: MenuItem[] = showStyles
    ? ['LOAD_P2', 'SAVE_P2', 'CONTROL_P2', 'SETTINGS', 'STYLES']
    : ['LOAD_P2', 'SAVE_P2', 'CONTROL_P2', 'SETTINGS'];

  return (
    <div className="super-melee-screen">
      <StarfieldBG config={bgConfig} />

      <div
        className="super-melee-stage"
        style={{ width: LOGICAL_STAGE_W * stageScale, height: LOGICAL_STAGE_H * stageScale }}
      >
        <div
          className="super-melee-stage__scaled"
          style={{ width: LOGICAL_STAGE_W, height: LOGICAL_STAGE_H, transform: `scale(${stageScale})` }}
        >
        <div className="super-melee-stage__layout" style={{ width: LOGICAL_STAGE_W }}>
          <div className="super-melee-stage__primary" style={{ width: LOGICAL_LEFT_W }}>
            <SuperMeleeTitle />

            <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
              <div style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                gap: 2,
              }}>
                <div>
                  {renderFleetGrid(fleet1, 1)}
                </div>
                <div>
                  <TeamLabel name={teamName1} pts={val1} side={1} />
                </div>
              </div>

              <div style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-start',
                gap: 2,
              }}>
                <div>
                  {renderFleetGrid(fleet2, 2)}
                </div>
                <div>
                  <TeamLabel name={teamName2} pts={val2} side={2} />
                </div>
              </div>

              {renderLoadOverlay()}
            </div>
          </div>

          <div className="super-melee-sidebar" style={{ width: LOGICAL_SIDEBAR_W }}>
            <div className="super-melee-menu-group super-melee-menu-group--top">
              {topMenuItems.map(item => renderMenuItem(item, MENU.indexOf(item)))}
            </div>

            {renderMenuItem('BATTLE', MENU.indexOf('BATTLE'))}

            <div className="super-melee-menu-group super-melee-menu-group--bottom">
              {bottomMenuItems.map(item => renderMenuItem(item, MENU.indexOf(item)))}
            </div>
          </div>
        </div>

        </div>
      </div>

      {picker && (
        <ShipPicker
          onPick={ship => {
            if (picker.fleet === 1) {
              setFleet1(prev => {
                const next = [...prev];
                next[picker.slot] = ship;
                return next;
              });
            } else {
              setFleet2(prev => {
                const next = [...prev];
                next[picker.slot] = ship;
                return next;
              });
            }
            setPicker(null);
            setActiveRegion('fleet');
            playMenuSelect();
          }}
          onClose={() => closePicker()}
          activeIndex={picker.activeIndex}
          onActiveIndexChange={index => {
            setActiveRegion('picker');
            setPickerActiveIndex(index);
          }}
        />
      )}
    </div>
  );
}
