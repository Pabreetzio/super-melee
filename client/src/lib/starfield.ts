/**
 * starfield.ts — Configurable starfield background system.
 *
 * The StarfieldConfig object is stored as pretty-printed JSON in localStorage
 * under the key "sm_bg_config". You can read it in DevTools → Application →
 * Local Storage, copy it, and paste it as DEFAULT_CONFIG to lock in a look.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NebulaGradient {
  x: number;       // 0–100  left→right viewport %
  y: number;       // 0–100  top→bottom viewport %
  rx: number;      // x-radius as viewport %
  ry: number;      // y-radius as viewport %
  hue: number;     // 0–360  CSS hue
  sat: number;     // 0–100  CSS saturation %
  opacity: number; // 0–1
}

export interface SpikeStarDef {
  x: number;           // 0–100  left→right viewport %
  y: number;           // 0–100  top→bottom viewport %
  type: 4 | 8;         // 4-way cross or 8-way star
  brightness: number;  // 0–1   overall brightness
}

export interface StarfieldConfig {
  version: 1;
  seed: number;
  baseBlueness: number;   // 0–100  → #00000{0..28}   (0 = pure black, 100 = dark navy)

  // Star layers
  tinyCount:   number;    // 0–1000  dim background field
  smallCount:  number;    // 0–400   mid-brightness stars
  medCount:    number;    // 0–100   bright stars
  brightCount: number;    // 0–50    glowing accent stars
  brightBlur:  number;    // 0–6 px  glow radius for bright layer
  colorTemp:   number;    // 0=warm white  100=cold blue-white

  // Nebula cloud gradients (0–4)
  nebulae: NebulaGradient[];

  // Diffraction-spike stars (0–4)
  spikeStars: SpikeStarDef[];
}

// ─── Default config  (matches the "Nebula" mode + new spike stars) ────────────

export const DEFAULT_CONFIG: StarfieldConfig = {
  version: 1,
  seed: 42,
  baseBlueness: 55,

  tinyCount:   240,
  smallCount:  45,
  medCount:    8,
  brightCount: 0,
  brightBlur:  2,
  colorTemp:   78,

  nebulae: [
    { x: 75, y: 30, rx: 70, ry: 45, hue: 220, sat: 80, opacity: 0.65 },
    { x: 20, y: 70, rx: 50, ry: 35, hue: 275, sat: 70, opacity: 0.50 },
    { x: 62, y: 28, rx: 25, ry: 20, hue: 210, sat: 90, opacity: 0.30 },
  ],

  spikeStars: [
    { x: 72, y: 18, type: 4, brightness: 0.95 },
    { x: 25, y: 62, type: 8, brightness: 0.90 },
  ],
};

// ─── LocalStorage ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'sm_bg_config';

export function loadConfig(): StarfieldConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as StarfieldConfig;
    if (parsed.version !== 1) return DEFAULT_CONFIG;
    return parsed;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg: StarfieldConfig): void {
  try {
    // Pretty-print so it's readable in DevTools Application → Local Storage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg, null, 2));
  } catch { /* storage full or unavailable */ }
}

// ─── Rendering helpers ────────────────────────────────────────────────────────

// Deterministic LCG — same seed → same star layout every time
function makeLCG(seed: number) {
  let s = (seed >>> 0) | 1;
  return (): number => {
    s = Math.imul(s, 1664525) + 1013904223 | 0;
    return (s >>> 0) / 0x100000000;
  };
}

// Star RGB from color temperature (0 = warm, 100 = cold blue-white)
function starRGB(colorTemp: number): [number, number, number] {
  const t = colorTemp / 100;
  return [
    Math.round(255 - t * 85),   // R: 255 → 170
    Math.round(240 - t * 45),   // G: 240 → 195
    Math.round(215 + t * 40),   // B: 215 → 255
  ];
}

// Build CSS box-shadow strings for each star layer.
// Using seed offsets so each layer is independent (changing one doesn't shift others).
export interface StarLayer {
  shadow: string;
  blur: number;
}

export function buildStarLayers(cfg: StarfieldConfig): StarLayer[] {
  const [r, g, b] = starRGB(cfg.colorTemp);
  const W = 3200, H = 2000; // larger than any typical viewport

  function makeLayer(count: number, aMin: number, aMax: number, seedOff: number): string {
    if (count <= 0) return '';
    const rng = makeLCG(cfg.seed * 4 + seedOff);
    return Array.from({ length: count }, () => {
      const x = Math.floor(rng() * W);
      const y = Math.floor(rng() * H);
      const a = (aMin + rng() * (aMax - aMin)).toFixed(2);
      return `${x}px ${y}px rgba(${r},${g},${b},${a})`;
    }).join(',');
  }

  const layers: StarLayer[] = [];
  const t = makeLayer(cfg.tinyCount,   0.10, 0.50, 0);
  const s = makeLayer(cfg.smallCount,  0.45, 0.85, 1);
  const m = makeLayer(cfg.medCount,    0.75, 1.00, 2);
  const bk = makeLayer(cfg.brightCount, 0.85, 1.00, 3);
  if (t)  layers.push({ shadow: t,  blur: 0 });
  if (s)  layers.push({ shadow: s,  blur: 0 });
  if (m)  layers.push({ shadow: m,  blur: 0 });
  if (bk) layers.push({ shadow: bk, blur: cfg.brightBlur });
  return layers;
}

// Build the CSS `background` string from nebulae + base color.
export function buildNebulaCSS(cfg: StarfieldConfig): string {
  const blueHex = Math.round(cfg.baseBlueness / 100 * 28).toString(16).padStart(2, '0');
  const base = `#0000${blueHex}`;

  const gradients = cfg.nebulae.map(n =>
    `radial-gradient(ellipse ${n.rx}% ${n.ry}% at ${n.x}% ${n.y}%, ` +
    `hsla(${n.hue},${n.sat}%,22%,${n.opacity}) 0%, transparent 70%)`
  );
  gradients.push(base); // last entry = background-color
  return gradients.join(', ');
}

// ─── Diffraction spike stars ───────────────────────────────────────────────────
//
// Spikes are pixel-art CSS box-shadows relative to a 1×1 element placed at
// (x%, y%) with `position: absolute`.  Center = the element itself (white).
// Spike pixels fade in both brightness AND blue-shift outward:
//
//   dist 1: rgba(240,245,255, 0.85 × brightness)
//   dist 2: rgba(210,225,255, 0.55 × brightness)
//   dist 3: rgba(180,200,255, 0.28 × brightness)
//   dist 4: rgba(150,175,240, 0.10 × brightness)

const DIRS_4 = [[0,-1],[0,1],[-1,0],[1,0]] as const;
const DIRS_8 = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]] as const;

const SPIKE_COLORS: [number,number,number][] = [
  [240, 245, 255],  // dist 1 — nearly white
  [210, 225, 255],  // dist 2 — slight blue
  [180, 200, 255],  // dist 3 — blue
  [150, 175, 240],  // dist 4 — cool blue tip
];
const SPIKE_FADE = [0.85, 0.55, 0.28, 0.10] as const;

export function buildSpikeShadow(type: 4 | 8, brightness: number): string {
  const dirs = type === 4 ? DIRS_4 : DIRS_8;
  const parts: string[] = [];
  for (const [dx, dy] of dirs) {
    for (let i = 0; i < 4; i++) {
      const [r, g, b] = SPIKE_COLORS[i];
      const alpha = (SPIKE_FADE[i] * brightness).toFixed(2);
      parts.push(`${dx * (i + 1)}px ${dy * (i + 1)}px rgba(${r},${g},${b},${alpha})`);
    }
  }
  return parts.join(',');
}
