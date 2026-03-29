/**
 * BGBuilder — live background configuration tool.
 *
 * The generated starfield IS the page background (no separate preview pane).
 * Adjust sliders → background updates instantly → config saved to localStorage.
 *
 * Open DevTools → Application → Local Storage → sm_bg_config to copy the
 * current JSON and paste it as DEFAULT_CONFIG in src/lib/starfield.ts.
 */

import { useState, useCallback } from 'react';
import type { NebulaGradient, SpikeStarDef, StarfieldConfig } from '../lib/starfield';
import { DEFAULT_CONFIG, loadConfig, saveConfig } from '../lib/starfield';
import StarfieldBG from './StarfieldBG';

// ─── Slider helper ────────────────────────────────────────────────────────────

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  decimals?: number;
  onChange: (v: number) => void;
}

function Slider({ label, value, min, max, step = 1, decimals = 0, onChange }: SliderProps) {
  const display = decimals > 0 ? value.toFixed(decimals) : String(value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
      <label style={{ width: 100, fontSize: 10, color: '#7799bb', letterSpacing: '0.06em', flexShrink: 0 }}>
        {label}
      </label>
      <input
        type="range" value={value} min={min} max={max} step={step}
        onChange={e => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: '#4488cc', height: 3 }}
      />
      <span style={{ width: 38, textAlign: 'right', fontSize: 10, color: '#99bbdd', fontFamily: 'var(--font)' }}>
        {display}
      </span>
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      color: '#4488cc', fontSize: 10, letterSpacing: '0.15em',
      textTransform: 'uppercase', marginTop: 14, marginBottom: 6,
      borderBottom: '1px solid #1a2840', paddingBottom: 4,
      fontFamily: 'var(--font)',
    }}>
      {children}
    </div>
  );
}

// ─── Nebula editor ────────────────────────────────────────────────────────────

function NebulaCard({
  n, idx, onChange, onRemove,
}: {
  n: NebulaGradient;
  idx: number;
  onChange: (updated: NebulaGradient) => void;
  onRemove: () => void;
}) {
  const upd = (key: keyof NebulaGradient, val: number) =>
    onChange({ ...n, [key]: val });

  // Preview swatch
  const swatchBg = `hsla(${n.hue},${n.sat}%,50%,0.8)`;

  return (
    <div style={{
      background: 'rgba(0,10,30,0.55)', border: '1px solid #1a2840',
      padding: '7px 8px', marginBottom: 6, borderRadius: 2,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontSize: 9, color: '#446', letterSpacing: '0.1em' }}>CLOUD {idx + 1}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 12, background: swatchBg, borderRadius: 2 }} />
          <button onClick={onRemove} style={{
            fontSize: 9, padding: '1px 6px', color: '#664444', borderColor: '#331',
          }}>✕</button>
        </div>
      </div>
      <Slider label="X position"  value={n.x}       min={0}   max={100} onChange={v => upd('x', v)} />
      <Slider label="Y position"  value={n.y}       min={0}   max={100} onChange={v => upd('y', v)} />
      <Slider label="Width %"     value={n.rx}      min={5}   max={120} onChange={v => upd('rx', v)} />
      <Slider label="Height %"    value={n.ry}      min={5}   max={120} onChange={v => upd('ry', v)} />
      <Slider label="Hue"         value={n.hue}     min={0}   max={360} onChange={v => upd('hue', v)} />
      <Slider label="Saturation"  value={n.sat}     min={0}   max={100} onChange={v => upd('sat', v)} />
      <Slider label="Opacity"     value={n.opacity} min={0}   max={1}   step={0.01} decimals={2} onChange={v => upd('opacity', v)} />
    </div>
  );
}

// ─── Spike star editor ────────────────────────────────────────────────────────

function SpikeCard({
  s, idx, onChange, onRemove,
}: {
  s: SpikeStarDef;
  idx: number;
  onChange: (updated: SpikeStarDef) => void;
  onRemove: () => void;
}) {
  return (
    <div style={{
      background: 'rgba(0,10,30,0.55)', border: '1px solid #1a2840',
      padding: '7px 8px', marginBottom: 6, borderRadius: 2,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontSize: 9, color: '#446', letterSpacing: '0.1em' }}>
          STAR {idx + 1} — {s.type}-WAY SPIKE
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => onChange({ ...s, type: s.type === 4 ? 8 : 4 })}
            style={{ fontSize: 9, padding: '1px 8px' }}
          >
            {s.type === 4 ? '✦ → ✧' : '✧ → ✦'}
          </button>
          <button onClick={onRemove} style={{ fontSize: 9, padding: '1px 6px', color: '#664444', borderColor: '#331' }}>
            ✕
          </button>
        </div>
      </div>
      <Slider label="X position"  value={s.x}          min={0}  max={100}  onChange={v => onChange({ ...s, x: v })} />
      <Slider label="Y position"  value={s.y}          min={0}  max={100}  onChange={v => onChange({ ...s, y: v })} />
      <Slider label="Brightness"  value={s.brightness} min={0}  max={1}    step={0.01} decimals={2} onChange={v => onChange({ ...s, brightness: v })} />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
}

export default function BGBuilder({ onBack }: Props) {
  const [cfg, setCfgRaw] = useState<StarfieldConfig>(loadConfig);

  // Save to localStorage on every change
  const setCfg = useCallback((next: StarfieldConfig) => {
    setCfgRaw(next);
    saveConfig(next);
  }, []);

  // Helpers
  function setField<K extends keyof StarfieldConfig>(key: K, val: StarfieldConfig[K]) {
    setCfg({ ...cfg, [key]: val });
  }

  function updateNebula(i: number, updated: NebulaGradient) {
    const nebulae = [...cfg.nebulae];
    nebulae[i] = updated;
    setCfg({ ...cfg, nebulae });
  }
  function removeNebula(i: number) {
    setCfg({ ...cfg, nebulae: cfg.nebulae.filter((_, j) => j !== i) });
  }
  function addNebula() {
    if (cfg.nebulae.length >= 5) return;
    setCfg({
      ...cfg, nebulae: [...cfg.nebulae,
        { x: 50, y: 50, rx: 50, ry: 40, hue: 220, sat: 70, opacity: 0.40 },
      ],
    });
  }

  function updateSpike(i: number, updated: SpikeStarDef) {
    const spikeStars = [...cfg.spikeStars];
    spikeStars[i] = updated;
    setCfg({ ...cfg, spikeStars });
  }
  function removeSpike(i: number) {
    setCfg({ ...cfg, spikeStars: cfg.spikeStars.filter((_, j) => j !== i) });
  }
  function addSpike() {
    if (cfg.spikeStars.length >= 5) return;
    setCfg({
      ...cfg, spikeStars: [...cfg.spikeStars,
        { x: 50, y: 50, type: 4, brightness: 0.90 },
      ],
    });
  }

  function copyJSON() {
    const json = JSON.stringify(cfg, null, 2);
    navigator.clipboard?.writeText(json).catch(() => {});
    // Also log to console as fallback
    console.log('[BGBuilder] Current config JSON:\n', json);
  }

  function resetDefault() {
    setCfg({ ...DEFAULT_CONFIG });
  }

  function randomizeSeed() {
    setField('seed', Math.floor(Math.random() * 99999));
  }

  // ─── Panel styles ──────────────────────────────────────────────────────────

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    right: 0, top: 0,
    width: 280,
    height: '100vh',
    background: 'rgba(0, 5, 18, 0.88)',
    backdropFilter: 'blur(6px)',
    borderLeft: '1px solid #1a2840',
    overflowY: 'auto',
    zIndex: 10,
    padding: '12px 14px 40px',
    fontFamily: 'var(--font)',
    boxSizing: 'border-box',
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* Live background preview — fills the whole page */}
      <StarfieldBG config={cfg} />

      {/* Control panel */}
      <div style={panelStyle}>

        {/* Top actions */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button onClick={onBack} style={{ flex: 1, fontSize: 11, padding: '5px 0' }}>
            ← Back
          </button>
          <button onClick={copyJSON} style={{ fontSize: 11, padding: '5px 8px', color: '#4af', borderColor: '#4af' }}
            title="Copy JSON to clipboard (also logged to browser console)">
            📋 Copy JSON
          </button>
          <button onClick={resetDefault} style={{ fontSize: 10, padding: '5px 6px', color: '#f84', borderColor: '#f84' }}
            title="Reset to default config">
            ↺
          </button>
        </div>

        <div style={{ color: '#4488cc', fontSize: 12, letterSpacing: '0.2em', marginBottom: 10 }}>
          BACKGROUND BUILDER
        </div>
        <div style={{ color: '#334', fontSize: 9, marginBottom: 6, lineHeight: 1.5 }}>
          Changes auto-save. Open DevTools → Local Storage →<br />
          <span style={{ color: '#446' }}>sm_bg_config</span> to copy JSON.
        </div>

        {/* ── Stars ── */}
        <SectionHeader>Stars</SectionHeader>
        <Slider label="Tiny count"   value={cfg.tinyCount}   min={0} max={1000} onChange={v => setField('tinyCount', v)} />
        <Slider label="Small count"  value={cfg.smallCount}  min={0} max={400}  onChange={v => setField('smallCount', v)} />
        <Slider label="Medium count" value={cfg.medCount}    min={0} max={100}  onChange={v => setField('medCount', v)} />
        <Slider label="Bright count" value={cfg.brightCount} min={0} max={50}   onChange={v => setField('brightCount', v)} />
        <Slider label="Glow radius"  value={cfg.brightBlur}  min={0} max={6}    step={0.1} decimals={1} onChange={v => setField('brightBlur', v)} />
        <Slider label="Color temp"   value={cfg.colorTemp}   min={0} max={100}  onChange={v => setField('colorTemp', v)} />
        <div style={{ fontSize: 9, color: '#334', marginBottom: 2 }}>0 = warm white · 100 = cold blue</div>

        {/* ── Nebula clouds ── */}
        <SectionHeader>Nebula Clouds  ({cfg.nebulae.length}/5)</SectionHeader>
        {cfg.nebulae.map((n, i) => (
          <NebulaCard key={i} n={n} idx={i}
            onChange={u => updateNebula(i, u)}
            onRemove={() => removeNebula(i)} />
        ))}
        {cfg.nebulae.length < 5 && (
          <button onClick={addNebula} style={{ width: '100%', fontSize: 10, padding: '4px 0', marginBottom: 4 }}>
            + Add Cloud
          </button>
        )}

        {/* ── Spike stars ── */}
        <SectionHeader>Spike Stars  ({cfg.spikeStars.length}/5)</SectionHeader>
        <div style={{ fontSize: 9, color: '#334', marginBottom: 6, lineHeight: 1.5 }}>
          JWST-style diffraction spikes, 9px across.<br />
          ✦ = 4-way cross · ✧ = 8-way star
        </div>
        {cfg.spikeStars.map((s, i) => (
          <SpikeCard key={i} s={s} idx={i}
            onChange={u => updateSpike(i, u)}
            onRemove={() => removeSpike(i)} />
        ))}
        {cfg.spikeStars.length < 5 && (
          <button onClick={addSpike} style={{ width: '100%', fontSize: 10, padding: '4px 0', marginBottom: 4 }}>
            + Add Spike Star
          </button>
        )}

        {/* ── Base ── */}
        <SectionHeader>Base</SectionHeader>
        <Slider label="Base blueness" value={cfg.baseBlueness} min={0} max={100} onChange={v => setField('baseBlueness', v)} />
        <div style={{ fontSize: 9, color: '#334', marginBottom: 8 }}>0 = pure black · 100 = dark navy</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <label style={{ fontSize: 10, color: '#7799bb', width: 40 }}>Seed</label>
          <input
            type="number" value={cfg.seed}
            onChange={e => setField('seed', parseInt(e.target.value) || 0)}
            style={{ flex: 1, fontSize: 11, padding: '3px 6px' }}
          />
          <button onClick={randomizeSeed} style={{ fontSize: 11, padding: '3px 8px' }} title="Random seed">
            🎲
          </button>
        </div>

      </div>
    </div>
  );
}
