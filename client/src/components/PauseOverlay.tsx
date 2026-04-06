// Pause menu overlay: audio settings, key rebinding, resume / quit buttons.
// Owns all pause-specific state so Battle.tsx only tracks isPaused (show/hide).

import { useState, useEffect } from 'react';
import type { ControlsConfig } from '../lib/controls';
import {
  getControls, setControls, codeDisplay,
  type BindingField, BINDING_FIELDS, FIELD_LABELS,
} from '../lib/controls';
import { getAudioConfig, setAudioConfig, type AudioConfig } from '../engine/audio';

interface Props {
  isLocal2P:  boolean;
  onResume:   () => void;
  onQuit:     () => void;
  /** Called whenever the user saves a new key binding so Battle can refresh its key maps. */
  onBindingsChanged: (controls: ControlsConfig) => void;
}

export default function PauseOverlay({ isLocal2P, onResume, onQuit, onBindingsChanged }: Props) {
  const [audio,      setAudio]      = useState<AudioConfig>(getAudioConfig);
  const [tab,        setTab]        = useState<'audio' | 'controls'>('audio');
  const [controls,   setControlsState] = useState<ControlsConfig>(getControls);
  const [rebinding,  setRebinding]  = useState<{ player: 1 | 2; field: BindingField } | null>(null);

  // Key capture for rebinding — runs in the capture phase so ESC cancels the
  // rebind instead of propagating to the Battle keydown handler.
  useEffect(() => {
    if (!rebinding) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') {
        const pKey = rebinding.player === 1 ? 'p1' : 'p2';
        const next: ControlsConfig = {
          ...controls,
          [pKey]: {
            preset: 'custom',
            bindings: { ...controls[pKey].bindings, [rebinding.field]: e.code },
          },
        };
        setControlsState(next);
        setControls(next);
        onBindingsChanged(next);
      }
      setRebinding(null);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [rebinding, controls, onBindingsChanged]);

  function patchAudio(patch: Partial<AudioConfig>) {
    const next = { ...audio, ...patch };
    setAudio(next);
    setAudioConfig(next);
  }

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(0,0,0,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font)',
    }}>
      <div style={{
        background: 'rgba(2,3,20,0.97)',
        border: '1px solid #2a2a50',
        padding: '24px 28px',
        display: 'flex', flexDirection: 'column', gap: 16,
        minWidth: 320, maxWidth: 480,
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        {/* Title */}
        <div style={{
          fontSize: 22, fontWeight: 'bold', letterSpacing: '0.3em',
          color: '#ff44ff', textShadow: '0 0 12px #ff00ff50',
          textTransform: 'uppercase', textAlign: 'center',
        }}>
          PAUSED
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 2 }}>
          {(['audio', 'controls'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setRebinding(null); }} style={{
              flex: 1, fontSize: 10, padding: '5px',
              background: tab === t ? '#111130' : '#07070f',
              color: tab === t ? '#ff88ff' : '#445',
              border: `1px solid ${tab === t ? '#ff88ff44' : '#181830'}`,
              fontFamily: 'var(--font)', letterSpacing: '0.12em',
              cursor: 'pointer', textTransform: 'uppercase',
            }}>{t}</button>
          ))}
        </div>

        {/* Audio tab */}
        {tab === 'audio' && <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#778', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Mute All</span>
            <button
              onClick={() => patchAudio({ muted: !audio.muted })}
              style={{
                fontSize: 10, padding: '4px 14px',
                background: audio.muted ? '#220a22' : '#07070f',
                color: audio.muted ? '#ff88ff' : '#556',
                border: `1px solid ${audio.muted ? '#ff44ff55' : '#1e1e40'}`,
                fontFamily: 'var(--font)', letterSpacing: '0.1em',
                cursor: 'pointer', textTransform: 'uppercase',
              }}
            >
              {audio.muted ? 'MUTED' : 'MUTE'}
            </button>
          </div>
          <PauseVolumeSlider label="Sound Effects" value={audio.sfxVolume}   disabled={audio.muted} onChange={v => patchAudio({ sfxVolume: v })} />
          <PauseVolumeSlider label="Music"         value={audio.musicVolume} disabled={audio.muted} note="(victory ditties)" onChange={v => patchAudio({ musicVolume: v })} />
        </>}

        {/* Controls tab */}
        {tab === 'controls' && (
          <PauseControlsPanel
            controls={controls}
            rebinding={rebinding}
            isLocal2P={isLocal2P}
            onRebind={target => setRebinding(target)}
          />
        )}

        {/* Divider */}
        <div style={{ borderTop: '1px solid #1a1a30' }} />

        {/* Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={onResume}
            style={{
              fontSize: 12, padding: '9px',
              background: '#0d0d2a', color: '#ff88ff',
              border: '1px solid #ff44ff44',
              fontFamily: 'var(--font)', letterSpacing: '0.18em',
              cursor: 'pointer', textTransform: 'uppercase',
            }}
          >
            RESUME  (Esc)
          </button>
          <button
            onClick={onQuit}
            style={{
              fontSize: 12, padding: '9px',
              background: '#07070f', color: '#556',
              border: '1px solid #1e1e40',
              fontFamily: 'var(--font)', letterSpacing: '0.18em',
              cursor: 'pointer', textTransform: 'uppercase',
            }}
          >
            QUIT BATTLE
          </button>
        </div>

        <div style={{ color: '#2a2a44', fontSize: 10, letterSpacing: '0.08em', textAlign: 'center' }}>
          {rebinding ? 'Press any key to bind · Esc to cancel' : 'ESC to resume · changes saved automatically'}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PauseControlsPanel({ controls, rebinding, isLocal2P, onRebind }: {
  controls:  ControlsConfig;
  rebinding: { player: 1 | 2; field: BindingField } | null;
  isLocal2P: boolean;
  onRebind:  (target: { player: 1 | 2; field: BindingField }) => void;
}) {
  const players: Array<1 | 2> = isLocal2P ? [1, 2] : [1];
  const accents: Record<1 | 2, string> = { 1: '#ff88ff', 2: '#88ccff' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {players.map(player => {
        const cfg    = player === 1 ? controls.p1 : controls.p2;
        const isJoy  = cfg.bindings.gamepadIndex >= 0;
        const accent = accents[player];
        return (
          <div key={player}>
            {isLocal2P && (
              <div style={{
                color: accent, fontSize: 10, letterSpacing: '0.15em',
                textTransform: 'uppercase', marginBottom: 6,
                borderBottom: '1px solid #181830', paddingBottom: 4,
              }}>
                Player {player}
              </div>
            )}
            {isJoy ? (
              <div style={{ color: '#556', fontSize: 11, lineHeight: 1.7 }}>
                <div>Gamepad {cfg.bindings.gamepadIndex + 1} — axis / buttons</div>
                <div style={{ color: '#334', fontSize: 10, marginTop: 4 }}>Switch preset in Settings to use keyboard.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  color: '#334', fontSize: 10, letterSpacing: '0.1em',
                  marginBottom: 3, paddingBottom: 3, borderBottom: '1px solid #111125',
                }}>
                  <span>ACTION</span>
                  <span>KEY (CLICK TO REBIND)</span>
                </div>
                {BINDING_FIELDS.map(field => {
                  const keyCode  = cfg.bindings[field as keyof typeof cfg.bindings] as string;
                  const isAlt    = field === 'weaponAlt' || field === 'specialAlt';
                  const isActive = rebinding?.player === player && rebinding?.field === field;
                  if (isAlt && !keyCode && !isActive) return null;
                  return (
                    <div
                      key={field}
                      onClick={() => onRebind({ player, field })}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '4px 5px',
                        background: isActive ? '#08082a' : 'transparent',
                        border: `1px solid ${isActive ? '#334499' : 'transparent'}`,
                        cursor: 'pointer', borderRadius: 2,
                      }}
                    >
                      <span style={{
                        color: isAlt ? '#445' : '#778', fontSize: isAlt ? 10 : 11,
                        letterSpacing: '0.05em', paddingLeft: isAlt ? 10 : 0,
                      }}>
                        {FIELD_LABELS[field]}
                      </span>
                      <span style={{
                        color: isActive ? '#aabbff' : keyCode ? accent : '#2a2a44',
                        fontSize: 10,
                        background: isActive ? '#111140' : '#040410',
                        padding: '2px 8px',
                        border: `1px solid ${isActive ? '#4455bb' : '#121220'}`,
                        minWidth: 72, textAlign: 'center', letterSpacing: '0.04em',
                      }}>
                        {isActive ? 'Press a key…' : codeDisplay(keyCode) || '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {!isLocal2P && (
        <div style={{ color: '#2a2a44', fontSize: 10, letterSpacing: '0.07em' }}>
          Online play uses Player 1 controls.
        </div>
      )}
    </div>
  );
}

function PauseVolumeSlider({ label, value, disabled, note, onChange }: {
  label:     string;
  value:     number;
  disabled?: boolean;
  note?:     string;
  onChange:  (v: number) => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, opacity: disabled ? 0.4 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ color: '#778', fontSize: 11, letterSpacing: '0.09em', textTransform: 'uppercase' }}>
          {label}
          {note && <span style={{ color: '#334', fontSize: 10, marginLeft: 8 }}>{note}</span>}
        </span>
        <span style={{ color: '#ff88ff', fontSize: 11, minWidth: 32, textAlign: 'right' }}>{pct}%</span>
      </div>
      <input
        type="range" min={0} max={100} step={1}
        value={pct}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value) / 100)}
        style={{ width: '100%', accentColor: '#ff44ff', cursor: disabled ? 'not-allowed' : 'pointer' }}
      />
    </div>
  );
}

