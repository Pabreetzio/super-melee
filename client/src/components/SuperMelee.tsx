import { useState, useEffect, useRef } from 'react';
import type { FleetSlot, ShipId } from 'shared/types';
import ShipPicker, { getShipPickerOptions } from './ShipPicker';
import StatusPanel, { type SideStatus } from './StatusPanel';
import StarfieldBG from './StarfieldBG';
import { loadConfig } from '../lib/starfield';
import { getControls, type KeyBindings } from '../lib/controls';
import { preloadUISounds, playMenuError, playMenuMove, playMenuSelect } from '../engine/audio';
import { SHIP_COSTS, SHIP_ICON, getShipSelectionPreview } from './shipSelectionData';
import { PreloadedImage, prefetchImages } from '../lib/preloadedImage';

const BATTLE_MENU_FRAMES = ['/meleemenu-025.png', '/meleemenu-026.png'] as const;
const BATTLE_SLOT_W = 128;
const BATTLE_SLOT_H = 134;

function fleetValue(fleet: FleetSlot[]): number {
  return fleet.reduce((sum, s) => sum + (s ? (SHIP_COSTS[s] ?? 0) : 0), 0);
}

export const BALANCED_TEAM_1: FleetSlot[] = [
  'androsynth', 'chmmr', 'druuge', 'urquan', 'melnorme', 'orz', 'spathi', 'syreen', 'utwig',
  null, null, null, null, null,
];

export const BALANCED_TEAM_2: FleetSlot[] = [
  'arilou', 'chenjesu', 'human', 'kohrah', 'mycon', 'yehat', 'pkunk', 'supox', 'thraddash', 'zoqfotpik', 'shofixti',
  null, null, null,
];

export type ControlType = 'cyborg_weak' | 'cyborg_good' | 'cyborg_awesome' | 'human';
const CONTROL_CYCLE: ControlType[] = ['cyborg_weak', 'cyborg_good', 'cyborg_awesome', 'human'];
const CONTROL_LABEL: Record<ControlType, string> = {
  cyborg_weak:    'WEAK CYBORG',
  cyborg_good:    'GOOD CYBORG',
  cyborg_awesome: 'AWESOME CYBORG',
  human:          'HUMAN CONTROL',
};

const MENU = ['NET_P1', 'CONTROL_P1', 'SAVE', 'LOAD', 'BATTLE', 'CONTROL_P2', 'SETTINGS', 'QUIT'] as const;
type MenuItem = typeof MENU[number];
type ActiveRegion = 'menu' | 'fleet' | 'picker';

interface SaveSlot {
  id: string;
  name: string;
  fleet: FleetSlot[];
  savedAt: number;
}

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
    return raw ? (JSON.parse(raw) as SaveSlot[]) : [];
  } catch { return []; }
}

function writeSavesLS(saves: SaveSlot[]) {
  try { localStorage.setItem('sm_saves', JSON.stringify(saves)); } catch {}
}

function menuLabel(item: MenuItem, p1Control: ControlType, p2Control: ControlType): string {
  switch (item) {
    case 'NET_P1': return 'NET ...';
    case 'SETTINGS': return 'SETTINGS';
    case 'CONTROL_P1': return CONTROL_LABEL[p1Control];
    case 'CONTROL_P2': return CONTROL_LABEL[p2Control];
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

function Modal({ children, title, onClose }: { children: React.ReactNode; title: string; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.82)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 300,
    }}>
      <div style={{
        background: '#07071a',
        border: '2px solid #334',
        padding: 20,
        width: 340,
        maxHeight: '70vh',
        overflow: 'auto',
        fontFamily: 'var(--font)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ color: '#a0a0c0', fontSize: 13, letterSpacing: '0.12em' }}>{title}</span>
          <button onClick={onClose} style={{ padding: '2px 9px', fontSize: 13 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
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
  onBGBuilder: () => void;
  onSettings:  () => void;
}

export default function SuperMelee({ onBattle, onNet, onBGBuilder, onSettings }: Props) {
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
  const [saveModal, setSaveModal]     = useState<{ mode: 'save' | 'load' } | null>(null);
  const [editingTeam, setEditingTeam] = useState<1 | 2 | null>(null);
  const [teamDraft, setTeamDraft]     = useState('');
  const statusRef = useRef<[SideStatus | null, SideStatus | null]>([null, null]);

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
      case 'SAVE':
        playMenuSelect();
        setSaveModal({ mode: 'save' });
        break;
      case 'LOAD':
        playMenuSelect();
        setSaveModal({ mode: 'load' });
        break;
      case 'BATTLE':
        if (!battleEnabled) {
          playMenuError();
          return;
        }
        playMenuSelect();
        onBattle({ fleet1, fleet2, teamName1, teamName2, p1Control, p2Control });
        break;
      case 'QUIT':
        playMenuSelect();
        window.location.reload();
        break;
    }
  }

  useEffect(() => {
    if (blockingModal) return;

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
      const isConfirm = matchAction(code, 'confirm');
      const isCancel = matchAction(code, 'cancel') || code === 'Escape';

      if (!isUp && !isDown && !isLeft && !isRight && !isConfirm && !isCancel) return;
      e.preventDefault();

      if (picker && activeRegion === 'picker') {
        if (isCancel) {
          closePicker();
          return;
        }
        if (isConfirm) {
          const chosen = pickerOptions[picker.activeIndex] ?? null;
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
  }, [activeRegion, blockingModal, fleet1, fleet2, fleetFocus, menuIndex, onBattle, onNet, onSettings, p1Control, p2Control, picker, pickerOptions, teamName1, teamName2]);

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
            width: 72,
            height: 60,
            background: isFocused ? 'rgba(90, 0, 180, 0.22)' : '#03030d',
            border: isFocused ? '2px solid #dd55ff' : '1px solid #181836',
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
            <PreloadedImage
              src={icon}
              alt={ship!}
              style={{ width: 44, height: 44, imageRendering: 'pixelated', objectFit: 'contain' }}
            />
          ) : (
            <span>Empty</span>
          )}
        </div>
      );
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', gap: 2 }}>{cells.slice(0, 7)}</div>
        <div style={{ display: 'flex', gap: 2 }}>{cells.slice(7)}</div>
      </div>
    );
  }

  function renderMenuItem(item: MenuItem, idx: number) {
    const sel = activeRegion === 'menu' && menuIndex === idx;
    const isBattle = item === 'BATTLE';
    const label = menuLabel(item, p1Control, p2Control);

    return (
      <div
        key={item + idx}
        onClick={() => {
          setMenuIndex(idx);
          setActiveRegion('menu');
          activateMenu(idx);
        }}
        onMouseEnter={() => {
          setMenuIndex(idx);
          setActiveRegion('menu');
        }}
        style={{
          background: sel ? '#6f6f6f' : '#525252',
          borderTop: '1px solid #838383',
          borderLeft: '1px solid #838383',
          borderRight: '1px solid #414141',
          borderBottom: '1px solid #414141',
          color: '#000',
          padding: isBattle ? '0' : item.startsWith('CONTROL') ? '13px 12px' : '9px 12px',
          cursor: 'pointer',
          textAlign: 'center',
          fontFamily: 'var(--font)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          userSelect: 'none',
          boxSizing: 'border-box',
          width: '100%',
          minHeight: isBattle ? BATTLE_SLOT_H : undefined,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isBattle ? (
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
              <StatusPanel
                sidesRef={statusRef}
                layout="single"
                singleSideIndex={0}
                showCaptain={false}
                showStatLabels={true}
                compactSingle
              />
            </div>
          </div>
        ) : (
          <span style={{
            color: '#000',
            fontSize: item.startsWith('CONTROL') ? 14 : 13,
            fontWeight: item.startsWith('CONTROL') ? 'bold' : 'normal',
          }}>
            {label}
          </span>
        )}
      </div>
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
            style={{ color: '#fff', fontSize: 16, fontFamily: 'var(--font)', cursor: 'pointer', letterSpacing: '0.05em' }}
          >
            {name}
          </span>
        )}
        <span style={{ color: '#fff', fontSize: 16, fontFamily: 'var(--font)' }}>
          {pts}
        </span>
      </div>
    );
  }

  function SaveLoadModal() {
    const [saves, setSaves] = useState<SaveSlot[]>(loadSaves);
    const [draftName, setDraftName] = useState(teamName1);

    function doSave() {
      const entry: SaveSlot = {
        id: Date.now().toString(),
        name: draftName.trim() || teamName1,
        fleet: [...fleet1],
        savedAt: Date.now(),
      };
      const updated = [entry, ...saves.filter(s => s.name !== entry.name)].slice(0, 20);
      writeSavesLS(updated);
      setSaveModal(null);
    }

    function doLoad(s: SaveSlot) {
      setFleet1([...s.fleet]);
      setTeamName1(s.name);
      setSaveModal(null);
    }

    function doDelete(id: string) {
      const upd = saves.filter(s => s.id !== id);
      writeSavesLS(upd);
      setSaves(upd);
    }

    if (saveModal?.mode === 'save') {
      return (
        <Modal title="SAVE FLEET" onClose={() => setSaveModal(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              autoFocus
              maxLength={20}
              placeholder="Fleet name"
              onKeyDown={e => {
                if (e.key === 'Enter') doSave();
                if (e.key === 'Escape') setSaveModal(null);
              }}
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="success" onClick={doSave}>Save</button>
              <button onClick={() => setSaveModal(null)}>Cancel</button>
            </div>
            {saves.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ color: '#445', fontSize: 11, marginBottom: 6, letterSpacing: '0.08em' }}>OVERWRITE EXISTING</div>
                {saves.slice(0, 12).map(s => (
                  <div key={s.id} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                    <button style={{ flex: 1, textAlign: 'left' }} onClick={() => setDraftName(s.name)}>
                      {s.name}
                    </button>
                    <button className="danger" style={{ padding: '4px 9px' }} onClick={() => doDelete(s.id)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      );
    }

    return (
      <Modal title="LOAD FLEET" onClose={() => setSaveModal(null)}>
        {saves.length === 0 ? (
          <p style={{ color: '#446', fontSize: 12 }}>No saved fleets. Save a fleet first, Commander.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {saves.map(s => (
              <div key={s.id} style={{ display: 'flex', gap: 4 }}>
                <button style={{ flex: 1, textAlign: 'left' }} onClick={() => doLoad(s)}>
                  {s.name}
                </button>
                <button className="danger" style={{ padding: '4px 9px' }} onClick={() => doDelete(s.id)}>×</button>
              </div>
            ))}
          </div>
        )}
        <button style={{ marginTop: 12 }} onClick={() => setSaveModal(null)}>Cancel</button>
      </Modal>
    );
  }

  const val1 = fleetValue(fleet1);
  const val2 = fleetValue(fleet2);

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingTop: 18,
      overflow: 'hidden',
      userSelect: 'none',
    }}>
      <StarfieldBG config={bgConfig} />

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
        <div style={{
          fontSize: 50,
          fontWeight: 'bold',
          letterSpacing: '0.25em',
          color: '#ff44ff',
          textShadow: '0 0 18px #ff00ff60, 0 2px 0 #660066, 2px 2px 0 #330033',
          fontFamily: 'var(--font)',
          marginBottom: 14,
          textTransform: 'uppercase',
        }}>
          SUPER-MELEE
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{
            background: 'rgba(1, 2, 18, 0.93)',
            border: '2px solid #181836',
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
          }}>
            {renderFleetGrid(fleet1, 1)}
            <TeamLabel name={teamName1} pts={val1} side={1} />

            <div style={{ height: 10, background: 'rgba(0,0,20,0.7)', margin: '0 -6px', borderTop: '1px solid #111128', borderBottom: '1px solid #111128' }} />

            {renderFleetGrid(fleet2, 2)}
            <TeamLabel name={teamName2} pts={val2} side={2} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 128, minWidth: 128 }}>
            {MENU.map((item, idx) => renderMenuItem(item, idx))}
          </div>
        </div>

        <div style={{
          marginTop: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          fontFamily: 'var(--font)',
        }}>
          <span style={{ color: '#2a2a44', fontSize: 11, letterSpacing: '0.1em' }}>
            P1 OR P2 CONTROLS NAVIGATE · LEFT FROM MENU ENTERS FLEET · RIGHT EDGE RETURNS
          </span>
          <button
            onClick={onBGBuilder}
            title="Open background builder"
            style={{
              fontSize: 10,
              padding: '3px 10px',
              background: 'rgba(0,0,30,0.6)',
              color: '#3a3a60',
              border: '1px solid #1e1e3c',
              fontFamily: 'var(--font)',
              letterSpacing: '0.08em',
              cursor: 'pointer',
              textTransform: 'uppercase',
            }}
          >
            BG Builder ▸
          </button>
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
          currentFleet={picker.fleet === 1 ? fleet1 : fleet2}
          activeIndex={picker.activeIndex}
          onActiveIndexChange={index => {
            setActiveRegion('picker');
            setPickerActiveIndex(index);
          }}
        />
      )}

      {saveModal && <SaveLoadModal />}
    </div>
  );
}
