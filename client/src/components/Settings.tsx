// Settings screen — hosts control bindings and audio settings.
// Presets mirror the six templates from UQM's base/uqm.key exactly.
// Single-ship play accepts either player's bindings; local 2P keeps one set per side.

import { useState, useEffect } from 'react';
import type { ControlPreset, PlayerControlConfig } from '../lib/controls';
import {
  getControls, setControls,
  PRESET_BINDINGS, PRESET_LABELS, codeDisplay,
  type BindingField, BINDING_FIELDS, FIELD_LABELS,
} from '../lib/controls';
import { getAudioConfig, setAudioConfig, type AudioConfig } from '../engine/audio';
import { getBattleViewConfig, setBattleViewConfig, type BattleViewConfig } from '../lib/battleView';
import StarfieldBG from './StarfieldBG';
import { loadConfig } from '../lib/starfield';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'controls' | 'audio' | 'battle';

interface RebindTarget {
  player: 1 | 2;
  field: BindingField;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KEYBOARD_PRESETS: ControlPreset[] = ['arrows', 'wasd', 'esdf', 'arrows2'];
const GAMEPAD_PRESETS:  ControlPreset[] = ['joystick1', 'joystick2'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isJoystickPreset(p: ControlPreset): boolean {
  return p === 'joystick1' || p === 'joystick2';
}

// ─── Settings component ───────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
}

export default function Settings({ onBack }: Props) {
  const [bgConfig]     = useState(loadConfig);
  const [tab, setTab]  = useState<Tab>('controls');
  const initial        = getControls();
  const [p1, setP1]    = useState<PlayerControlConfig>(initial.p1);
  const [p2, setP2]    = useState<PlayerControlConfig>(initial.p2);
  const [rebinding, setRebinding] = useState<RebindTarget | null>(null);
  const [audio, setAudioState]    = useState<AudioConfig>(getAudioConfig);
  const [battleView, setBattleViewState] = useState<BattleViewConfig>(getBattleViewConfig);

  // Persist on every change
  useEffect(() => { setControls({ p1, p2 }); }, [p1, p2]);

  function patchAudio(patch: Partial<AudioConfig>) {
    const next = { ...audio, ...patch };
    setAudioState(next);
    setAudioConfig(next);
  }

  function patchBattleView(patch: Partial<BattleViewConfig>) {
    const next = { ...battleView, ...patch };
    setBattleViewState(next);
    setBattleViewConfig(next);
  }

  // Key capture when a rebind is active
  useEffect(() => {
    if (!rebinding) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') { setRebinding(null); return; }
      const code = e.code;
      const setter = rebinding.player === 1 ? setP1 : setP2;
      setter(prev => ({
        preset: 'custom',
        bindings: { ...prev.bindings, [rebinding.field]: code },
      }));
      setRebinding(null);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [rebinding]);

  function applyPreset(player: 1 | 2, preset: Exclude<ControlPreset, 'custom'>) {
    const cfg: PlayerControlConfig = { preset, bindings: { ...PRESET_BINDINGS[preset] } };
    (player === 1 ? setP1 : setP2)(cfg);
    setRebinding(null);
  }

  // ─── Panel ─────────────────────────────────────────────────────────────────

  function PlayerPanel({ player }: { player: 1 | 2 }) {
    const config   = player === 1 ? p1 : p2;
    const isJoy    = isJoystickPreset(config.preset);
    const accent   = player === 1 ? '#ff88ff' : '#88ccff';
    const dimAccent = player === 1 ? '#441144' : '#112244';

    return (
      <div style={{
        flex: 1,
        background: 'rgba(2, 3, 20, 0.96)',
        border: '1px solid #1e1e40',
        padding: '16px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}>

        {/* ── Header ── */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          borderBottom: `1px solid ${dimAccent}`, paddingBottom: 8,
        }}>
          <span style={{ color: accent, fontSize: 15, fontWeight: 'bold', letterSpacing: '0.15em' }}>
            PLAYER {player}
          </span>
          <span style={{ color: '#445', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {PRESET_LABELS[config.preset]}
          </span>
        </div>

        {/* ── Preset selector ── */}
        <div>
          <div style={{ color: '#334', fontSize: 10, letterSpacing: '0.12em', marginBottom: 6 }}>
            PRESET
          </div>

          {/* Keyboard presets */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            {KEYBOARD_PRESETS.map(preset => (
              <PresetButton
                key={preset}
                label={PRESET_LABELS[preset]}
                selected={config.preset === preset}
                accent={accent}
                onClick={() => applyPreset(player, preset as Exclude<ControlPreset, 'custom'>)}
              />
            ))}
          </div>

          {/* Gamepad presets */}
          <div style={{ display: 'flex', gap: 4 }}>
            {GAMEPAD_PRESETS.map(preset => (
              <PresetButton
                key={preset}
                label={PRESET_LABELS[preset]}
                selected={config.preset === preset}
                accent={accent}
                onClick={() => applyPreset(player, preset as Exclude<ControlPreset, 'custom'>)}
              />
            ))}
          </div>
        </div>

        {/* ── Bindings ── */}
        {isJoy ? (
          <GamepadInfo gamepadIndex={config.bindings.gamepadIndex} accent={accent} />
        ) : (
          <BindingTable
            config={config}
            player={player}
            rebinding={rebinding}
            onRebind={field => setRebinding({ player, field })}
          />
        )}
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      width: '100vw', height: '100vh',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'flex-start',
      paddingTop: 28,
      overflow: 'hidden',
      userSelect: 'none',
      fontFamily: 'var(--font)',
    }}>
      <StarfieldBG config={bgConfig} />

      <div style={{
        position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        width: '100%', maxWidth: 800,
      }}>

        {/* Title */}
        <div style={{
          fontSize: 40, fontWeight: 'bold', letterSpacing: '0.25em',
          color: '#ff44ff',
          textShadow: '0 0 18px #ff00ff60, 0 2px 0 #660066, 2px 2px 0 #330033',
          marginBottom: 6,
          textTransform: 'uppercase',
        }}>
          SETTINGS
        </div>

        {/* Tab bar */}
        <div style={{
          display: 'flex', gap: 2, marginBottom: 14,
        }}>
          {(['controls', 'audio', 'battle'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              fontSize: 11, padding: '6px 22px',
              background: tab === t ? '#111130' : '#07070f',
              color: tab === t ? '#ff88ff' : '#445',
              border: `1px solid ${tab === t ? '#ff88ff44' : '#181830'}`,
              fontFamily: 'var(--font)', letterSpacing: '0.14em',
              cursor: 'pointer', textTransform: 'uppercase',
            }}>
              {t}
            </button>
          ))}
        </div>

        {/* Controls tab */}
        {tab === 'controls' && <>
          {/* Two-player panels */}
          <div style={{
            display: 'flex', gap: 8, width: '100%',
            padding: '0 16px', boxSizing: 'border-box',
          }}>
            <PlayerPanel player={1} />
            <PlayerPanel player={2} />
          </div>

          {/* Footer hint */}
          <div style={{
            width: '100%', padding: '8px 18px', boxSizing: 'border-box',
            color: '#3a3a5a', fontSize: 11, letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            Single-ship battles accept either player's bindings. Player 1 wins overlapping keys.
          </div>
        </>}

        {/* Audio tab */}
        {tab === 'audio' && (
          <div style={{
            width: '100%', padding: '0 16px', boxSizing: 'border-box',
          }}>
            <AudioPanel audio={audio} onChange={patchAudio} />
          </div>
        )}

        {tab === 'battle' && (
          <div style={{
            width: '100%', padding: '0 16px', boxSizing: 'border-box',
          }}>
            <BattleViewPanel battleView={battleView} onChange={patchBattleView} />
          </div>
        )}

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
          width: '100%', padding: '12px 18px', boxSizing: 'border-box', marginTop: 4,
        }}>
          <button
            onClick={onBack}
            style={{
              fontSize: 13, padding: '8px 28px',
              background: '#07071a', color: '#8888aa',
              border: '1px solid #1e1e40',
              fontFamily: 'var(--font)', letterSpacing: '0.12em',
              cursor: 'pointer', textTransform: 'uppercase',
            }}
          >
            ← BACK
          </button>
        </div>

        {/* Global rebind hint */}
        {rebinding && (
          <div style={{
            position: 'fixed', bottom: 24, left: '50%',
            transform: 'translateX(-50%)',
            background: '#0a0a2a', border: '1px solid #3344aa',
            padding: '8px 20px', color: '#aabbff',
            fontSize: 12, letterSpacing: '0.1em',
            textTransform: 'uppercase', zIndex: 200,
          }}>
            Press any key to bind &nbsp;·&nbsp; Esc to cancel
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function BattleViewPanel({ battleView, onChange }: {
  battleView: BattleViewConfig;
  onChange: (patch: Partial<BattleViewConfig>) => void;
}) {
  const is3do = battleView.meleeZoom === '3do';
  return (
    <div style={{
      background: 'rgba(2, 3, 20, 0.96)',
      border: '1px solid #1e1e40',
      padding: '20px 20px 24px',
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      <div style={{ color: '#778', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Battle Zoom Style
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <PresetButton
          label="Step"
          selected={!is3do}
          accent="#ff88ff"
          onClick={() => onChange({ meleeZoom: 'step' })}
        />
        <PresetButton
          label="3DO"
          selected={is3do}
          accent="#ff88ff"
          onClick={() => onChange({ meleeZoom: '3do' })}
        />
      </div>
      <div style={{ color: '#556', fontSize: 12, lineHeight: 1.7 }}>
        <div><span style={{ color: '#889' }}>Step:</span> discrete 1x / 2x / 4x zoom levels, matching the current PC-style view.</div>
        <div><span style={{ color: '#889' }}>3DO:</span> gradual zoom using UQM&apos;s continuous melee reduction math, with smooth sprite scaling.</div>
      </div>
    </div>
  );
}

function PresetButton({
  label, selected, accent, onClick,
}: {
  label: string; selected: boolean; accent: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 10, padding: '4px 7px',
        background: selected ? '#111130' : '#07070f',
        color: selected ? accent : '#445',
        border: `1px solid ${selected ? accent + '55' : '#181830'}`,
        fontFamily: 'var(--font)', letterSpacing: '0.08em',
        cursor: 'pointer', textTransform: 'uppercase',
        transition: 'none',
      }}
    >
      {label}
    </button>
  );
}

function GamepadInfo({ gamepadIndex, accent }: { gamepadIndex: number; accent: string }) {
  return (
    <div style={{ fontSize: 12, lineHeight: 1.8 }}>
      <div style={{ color: accent, fontSize: 13, marginBottom: 8, letterSpacing: '0.08em' }}>
        Gamepad {gamepadIndex + 1}
      </div>
      <div style={{ color: '#556' }}>Left stick axis Y (−) → Thrust</div>
      <div style={{ color: '#556' }}>Left stick axis X → Turn Left / Right</div>
      <div style={{ color: '#556' }}>D-pad → Turn / Thrust (alt)</div>
      <div style={{ color: '#556' }}>Button 0 (A / ✕) → Weapon</div>
      <div style={{ color: '#556' }}>Button 1 (B / ○) → Special</div>
      <div style={{ color: '#334', fontSize: 10, marginTop: 10, letterSpacing: '0.08em' }}>
        Connect gamepad before starting a battle.
      </div>
    </div>
  );
}

function BindingTable({
  config, player, rebinding, onRebind,
}: {
  config: PlayerControlConfig;
  player: 1 | 2;
  rebinding: RebindTarget | null;
  onRebind: (field: BindingField) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        color: '#334', fontSize: 10, letterSpacing: '0.12em',
        marginBottom: 4, paddingBottom: 4,
        borderBottom: '1px solid #111125',
      }}>
        <span>ACTION</span>
        <span>KEY &nbsp;(CLICK TO REBIND)</span>
      </div>

      {BINDING_FIELDS.map(field => {
        const keyCode   = config.bindings[field];
        const isActive  = rebinding?.player === player && rebinding?.field === field;
        const isAlt     = field === 'weaponAlt' || field === 'specialAlt';

        // Hide empty alt-binding rows when not actively rebinding them
        if (isAlt && !keyCode && !isActive) return null;

        return (
          <BindingRow
            key={field}
            label={FIELD_LABELS[field]}
            keyCode={keyCode}
            isAlt={isAlt}
            isActive={isActive}
            onClick={() => onRebind(field)}
          />
        );
      })}

      <div style={{
        marginTop: 6, color: '#2a2a44', fontSize: 10, letterSpacing: '0.08em',
        fontStyle: 'italic',
      }}>
        Changing any binding switches to Custom preset.
      </div>
    </div>
  );
}

function BindingRow({
  label, keyCode, isAlt, isActive, onClick,
}: {
  label: string;
  keyCode: string;
  isAlt: boolean;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '5px 6px',
        background: isActive ? '#08082a' : 'transparent',
        border: `1px solid ${isActive ? '#334499' : 'transparent'}`,
        cursor: 'pointer',
        borderRadius: 2,
      }}
    >
      <span style={{
        color: isAlt ? '#445' : '#778',
        fontSize: isAlt ? 11 : 12,
        letterSpacing: '0.06em',
        paddingLeft: isAlt ? 12 : 0,
      }}>
        {label}
      </span>
      <span style={{
        color: isActive ? '#aabbff' : keyCode ? '#bbccee' : '#2a2a44',
        fontSize: 11,
        background: isActive ? '#111140' : '#040410',
        padding: '3px 10px',
        border: `1px solid ${isActive ? '#4455bb' : '#121220'}`,
        minWidth: 80,
        textAlign: 'center',
        letterSpacing: '0.05em',
      }}>
        {isActive ? 'Press a key…' : codeDisplay(keyCode) || '—'}
      </span>
    </div>
  );
}

// ─── Audio panel ──────────────────────────────────────────────────────────────

function AudioPanel({ audio, onChange }: {
  audio: AudioConfig;
  onChange: (patch: Partial<AudioConfig>) => void;
}) {
  return (
    <div style={{
      background: 'rgba(2, 3, 20, 0.96)',
      border: '1px solid #1e1e40',
      padding: '20px 20px 24px',
      display: 'flex', flexDirection: 'column', gap: 22,
    }}>
      {/* Mute toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#778', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Mute All
        </span>
        <button
          onClick={() => onChange({ muted: !audio.muted })}
          style={{
            fontSize: 11, padding: '5px 18px',
            background: audio.muted ? '#220a22' : '#07070f',
            color: audio.muted ? '#ff88ff' : '#556',
            border: `1px solid ${audio.muted ? '#ff44ff55' : '#1e1e40'}`,
            fontFamily: 'var(--font)', letterSpacing: '0.12em',
            cursor: 'pointer', textTransform: 'uppercase',
          }}
        >
          {audio.muted ? 'MUTED' : 'MUTE'}
        </button>
      </div>

      <VolumeSlider
        label="Sound Effects"
        value={audio.sfxVolume}
        disabled={audio.muted}
        onChange={v => onChange({ sfxVolume: v })}
      />

      <VolumeSlider
        label="Music"
        value={audio.musicVolume}
        disabled={audio.muted}
        note="(victory ditties)"
        onChange={v => onChange({ musicVolume: v })}
      />
    </div>
  );
}

function VolumeSlider({ label, value, disabled, note, onChange }: {
  label: string;
  value: number;
  disabled?: boolean;
  note?: string;
  onChange: (v: number) => void;
}) {
  const pct = Math.round(value * 100);
  const accent = '#ff88ff';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: disabled ? 0.4 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ color: '#778', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {label}
          {note && <span style={{ color: '#334', fontSize: 10, marginLeft: 8, textTransform: 'none', letterSpacing: '0.05em' }}>{note}</span>}
        </span>
        <span style={{ color: accent, fontSize: 12, minWidth: 36, textAlign: 'right', letterSpacing: '0.05em' }}>
          {pct}%
        </span>
      </div>
      <input
        type="range"
        min={0} max={100} step={1}
        value={pct}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value) / 100)}
        style={{
          width: '100%', accentColor: accent,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      />
    </div>
  );
}
