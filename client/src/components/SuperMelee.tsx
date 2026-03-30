import { useState, useEffect, useRef } from 'react';
import type { FleetSlot, ShipId } from 'shared/types';
import { SHIP_ICON } from './ShipPicker';
import ShipPicker from './ShipPicker';
import StarfieldBG from './StarfieldBG';
import { loadConfig } from '../lib/starfield';

// ─── Ship cost table ──────────────────────────────────────────────────────────

export const SHIP_COSTS: Partial<Record<ShipId, number>> = {
  androsynth: 22, arilou: 18, chenjesu: 24, chmmr: 26, druuge: 14,
  human: 16, ilwrath: 14, melnorme: 20, mmrnmhrm: 20, mycon: 18,
  orz: 22, pkunk: 12, shofixti: 8, slylandro: 14, spathi: 16,
  supox: 18, syreen: 18, thraddash: 16, umgah: 14, urquan: 28,
  utwig: 22, vux: 20, yehat: 20, zoqfotpik: 16,
  kohrah: 28, samatra: 0,
};

function fleetValue(fleet: FleetSlot[]): number {
  return fleet.reduce((sum, s) => sum + (s ? (SHIP_COSTS[s] ?? 0) : 0), 0);
}

// ─── Balanced team presets (from UQM src/uqm/supermelee/loadmele.c) ──────────

export const BALANCED_TEAM_1: FleetSlot[] = [
  'androsynth', 'chmmr', 'druuge', 'urquan', 'melnorme', 'orz', 'spathi', 'syreen', 'utwig',
  null, null, null, null, null,
];

export const BALANCED_TEAM_2: FleetSlot[] = [
  'arilou', 'chenjesu', 'human', 'kohrah', 'mycon', 'yehat', 'pkunk', 'supox', 'thraddash', 'zoqfotpik', 'shofixti',
  null, null, null,
];

// ─── Control types ────────────────────────────────────────────────────────────

export type ControlType = 'cyborg_weak' | 'cyborg_good' | 'cyborg_awesome' | 'human';
const CONTROL_CYCLE: ControlType[] = ['cyborg_weak', 'cyborg_good', 'cyborg_awesome', 'human'];
const CONTROL_LABEL: Record<ControlType, string> = {
  cyborg_weak:    'WEAK CYBORG',
  cyborg_good:    'GOOD CYBORG',
  cyborg_awesome: 'AWESOME CYBORG',
  human:          'HUMAN CONTROL',
};

// ─── Menu ─────────────────────────────────────────────────────────────────────

const MENU = ['NET_P1', 'CONTROL_P1', 'SAVE', 'LOAD', 'BATTLE', 'CONTROL_P2', 'NET_P2', 'QUIT'] as const;
type MenuItem = typeof MENU[number];

// ─── LocalStorage persistence ─────────────────────────────────────────────────

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

// ─── Public types ─────────────────────────────────────────────────────────────

export interface BattleStartParams {
  fleet1: FleetSlot[];
  fleet2: FleetSlot[];
  teamName1: string;
  teamName2: string;
  p1Control: ControlType;
  p2Control: ControlType;
}

interface Props {
  onBattle: (params: BattleStartParams) => void;
  onNet: () => void;
  onBGBuilder: () => void;
}

// ─── Small Modal wrapper ──────────────────────────────────────────────────────

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

// ─── Main component ───────────────────────────────────────────────────────────

export default function SuperMelee({ onBattle, onNet, onBGBuilder }: Props) {
  const last = loadLastState();

  const [fleet1, setFleet1]       = useState<FleetSlot[]>(last?.fleet1    ?? [...BALANCED_TEAM_1]);
  const [fleet2, setFleet2]       = useState<FleetSlot[]>(last?.fleet2    ?? [...BALANCED_TEAM_2]);
  const [teamName1, setTeamName1] = useState(last?.teamName1 ?? 'Balanced Team 1');
  const [teamName2, setTeamName2] = useState(last?.teamName2 ?? 'Balanced Team 2');
  const [p1Control, setP1Control] = useState<ControlType>('human');
  const [p2Control, setP2Control] = useState<ControlType>('cyborg_weak');

  // Load background config from localStorage (shared with BGBuilder)
  const [bgConfig] = useState(loadConfig);

  const [selectedIdx, setSelectedIdx] = useState(4); // BATTLE! pre-selected
  const [blink, setBlink]             = useState(false);

  const [picker, setPicker]         = useState<{ fleet: 1 | 2; slot: number } | null>(null);
  const [saveModal, setSaveModal]   = useState<{ mode: 'save' | 'load' } | null>(null);
  const [editingTeam, setEditingTeam] = useState<1 | 2 | null>(null);
  const [teamDraft, setTeamDraft]   = useState('');

  // Auto-save fleet state
  useEffect(() => {
    writeLastState({ fleet1, fleet2, teamName1, teamName2 });
  }, [fleet1, fleet2, teamName1, teamName2]);

  // Blink timer for the selected menu item
  useEffect(() => {
    const t = setInterval(() => setBlink(b => !b), 440);
    return () => clearInterval(t);
  }, []);

  const hasModal = picker !== null || saveModal !== null || editingTeam !== null;

  function cycleControl(c: ControlType): ControlType {
    return CONTROL_CYCLE[(CONTROL_CYCLE.indexOf(c) + 1) % CONTROL_CYCLE.length];
  }

  // Use ref so the keyboard handler always sees current values
  const activateRef = useRef<(idx: number) => void>(null!);
  activateRef.current = (idx: number) => {
    switch (MENU[idx]) {
      case 'NET_P1':
      case 'NET_P2':
        onNet();
        break;
      case 'CONTROL_P1':
        setP1Control(c => cycleControl(c));
        break;
      case 'CONTROL_P2':
        setP2Control(c => cycleControl(c));
        break;
      case 'SAVE':
        setSaveModal({ mode: 'save' });
        break;
      case 'LOAD':
        setSaveModal({ mode: 'load' });
        break;
      case 'BATTLE':
        onBattle({ fleet1, fleet2, teamName1, teamName2, p1Control, p2Control });
        break;
      case 'QUIT':
        window.location.reload();
        break;
    }
  };

  // Keyboard navigation
  useEffect(() => {
    if (hasModal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx(i => (i - 1 + MENU.length) % MENU.length);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx(i => (i + 1) % MENU.length);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setSelectedIdx(i => { activateRef.current(i); return i; });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hasModal]);

  // ─── Fleet grid ──────────────────────────────────────────────────────────────

  function renderFleetGrid(fleet: FleetSlot[], fleetNum: 1 | 2) {
    const cells = Array.from({ length: 14 }, (_, i) => {
      const ship = fleet[i] ?? null;
      const icon = ship ? SHIP_ICON[ship] : null;
      return (
        <div
          key={i}
          onClick={() => setPicker({ fleet: fleetNum, slot: i })}
          title={ship ?? 'Empty Slot'}
          style={{
            width: 72, height: 60,
            background: '#03030d',
            border: '1px solid #181836',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            boxSizing: 'border-box',
            flexShrink: 0,
          }}
        >
          {icon && (
            <img
              src={icon} alt={ship!}
              style={{ width: 44, height: 44, imageRendering: 'pixelated', objectFit: 'contain' }}
            />
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

  // ─── Right panel button ───────────────────────────────────────────────────────

  function renderMenuItem(item: MenuItem, idx: number) {
    const sel    = selectedIdx === idx;
    const isBattle  = item === 'BATTLE';
    const isControl = item === 'CONTROL_P1' || item === 'CONTROL_P2';

    const label =
      item === 'NET_P1' || item === 'NET_P2' ? 'NET ...' :
      item === 'CONTROL_P1' ? CONTROL_LABEL[p1Control] :
      item === 'CONTROL_P2' ? CONTROL_LABEL[p2Control] :
      item === 'BATTLE' ? 'BATTLE!' : item;

    // Blink when selected: alternate between two dark backgrounds
    const selBg  = blink ? '#0d2878' : '#06061a';
    const idleBg = isBattle ? '#060616' : '#09091e';
    const bg     = sel ? selBg : idleBg;

    const textColor =
      isBattle  ? (sel ? '#ff99ff' : '#8844aa') :
      isControl ? '#77ccff' :
      '#9090b8';

    const fontSize = isBattle ? 22 : isControl ? 14 : 13;
    const paddingV = isBattle ? 22 : isControl ? 13 : 9;

    return (
      <div
        key={item + idx}
        onClick={() => { setSelectedIdx(idx); activateRef.current(idx); }}
        onMouseEnter={() => setSelectedIdx(idx)}
        style={{
          background: bg,
          border: `1px solid ${sel ? '#335' : '#171730'}`,
          color: textColor,
          fontSize, fontWeight: isBattle || isControl ? 'bold' : 'normal',
          padding: `${paddingV}px 12px`,
          cursor: 'pointer', textAlign: 'center',
          fontFamily: 'var(--font)', letterSpacing: '0.08em',
          textTransform: 'uppercase', userSelect: 'none',
          boxSizing: 'border-box', width: '100%',
          transition: 'none',
        }}
      >
        {label}
      </div>
    );
  }

  // ─── Team name label (click to edit inline) ───────────────────────────────────

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
        borderTop: side === 1 ? 'none' : 'none',
      }}>
        {editingTeam === side ? (
          <input
            value={teamDraft}
            onChange={e => setTeamDraft(e.target.value)}
            autoFocus maxLength={20}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditingTeam(null); }}
            style={{
              width: 260, background: '#000', color: '#fff',
              border: '1px solid #446', fontFamily: 'var(--font)',
              fontSize: 16, padding: '2px 6px', letterSpacing: '0.05em',
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

  // ─── Save / Load modal ────────────────────────────────────────────────────────

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
              autoFocus maxLength={20} placeholder="Fleet name"
              onKeyDown={e => { if (e.key === 'Enter') doSave(); if (e.key === 'Escape') setSaveModal(null); }}
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

    // Load modal
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

  // ─── Render ───────────────────────────────────────────────────────────────────

  const val1 = fleetValue(fleet1);
  const val2 = fleetValue(fleet2);

  return (
    <div style={{
      width: '100vw', height: '100vh',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'flex-start',
      paddingTop: 18,
      overflow: 'hidden',
      userSelect: 'none',
    }}>
      {/* Starfield background layer */}
      <StarfieldBG config={bgConfig} />

      {/* All content above the starfield */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>

      {/* ── SUPER-MELEE title ── */}
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

      {/* ── Main row: fleet area + right panel ── */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>

        {/* Fleet area */}
        <div style={{
          background: 'rgba(1, 2, 18, 0.93)',
          border: '2px solid #181836',
          padding: 6,
          display: 'flex', flexDirection: 'column', gap: 0,
        }}>
          {renderFleetGrid(fleet1, 1)}
          <TeamLabel name={teamName1} pts={val1} side={1} />

          {/* Divider between the two fleets */}
          <div style={{ height: 10, background: 'rgba(0,0,20,0.7)', margin: '0 -6px', borderTop: '1px solid #111128', borderBottom: '1px solid #111128' }} />

          {renderFleetGrid(fleet2, 2)}
          <TeamLabel name={teamName2} pts={val2} side={2} />
        </div>

        {/* Right panel */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 3,
          width: 186, minWidth: 186,
        }}>
          {MENU.map((item, idx) => renderMenuItem(item, idx))}
        </div>
      </div>

      {/* Footer row: nav hint + BG cycle button */}
      <div style={{
        marginTop: 10,
        display: 'flex', alignItems: 'center', gap: 20,
        fontFamily: 'var(--font)',
      }}>
        <span style={{ color: '#2a2a44', fontSize: 11, letterSpacing: '0.1em' }}>
          ↑↓ NAVIGATE &nbsp;·&nbsp; ENTER SELECT &nbsp;·&nbsp; CLICK SLOT TO CHANGE SHIP
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

      </div>{/* end content wrapper */}

      {/* ── Modals ── */}

      {picker && (
        <ShipPicker
          onPick={ship => {
            if (picker.fleet === 1) {
              setFleet1(prev => { const f = [...prev]; f[picker.slot] = ship; return f; });
            } else {
              setFleet2(prev => { const f = [...prev]; f[picker.slot] = ship; return f; });
            }
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
          currentFleet={picker.fleet === 1 ? fleet1 : fleet2}
        />
      )}

      {saveModal && <SaveLoadModal />}
    </div>
  );
}
