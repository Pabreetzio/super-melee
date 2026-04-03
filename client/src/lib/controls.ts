// Control bindings for both players.
// Matches UQM's six built-in templates from base/uqm.key in the content package.
//
// Preset 1 "Arrows"    — Up/Down/Left/Right + RCtrl/RShift (alts: Enter/Num0)
// Preset 2 "WASD"      — W/S/A/D + V/B
// Preset 3 "Arrows (2)"— Same movement as Arrows, but ] / [ for weapon/special
// Preset 4 "ESDF"      — E/D/S/F + Q/A
// Preset 5 "Joystick 1"— Gamepad index 0 (axis+buttons, polled via Gamepad API)
// Preset 6 "Joystick 2"— Gamepad index 1

export type ControlPreset =
  | 'arrows' | 'wasd' | 'esdf' | 'arrows2'
  | 'joystick1' | 'joystick2'
  | 'custom';

export interface KeyBindings {
  thrust:     string; // Up   — also used as "up" in menus / ship select
  down:       string; // Down — menu navigation; not used during combat
  turnLeft:   string; // Left
  turnRight:  string; // Right
  weapon:     string; // Weapon / Confirm
  weaponAlt:  string; // empty = no alt
  special:    string; // Special
  specialAlt: string;
  gamepadIndex: number; // -1 = keyboard; 0 or 1 for joystick presets
}

// ─── Presets ──────────────────────────────────────────────────────────────────

export const PRESET_BINDINGS: Record<Exclude<ControlPreset, 'custom'>, KeyBindings> = {
  arrows: {
    thrust: 'ArrowUp', down: 'ArrowDown',
    turnLeft: 'ArrowLeft', turnRight: 'ArrowRight',
    weapon: 'ControlRight', weaponAlt: 'Enter',
    special: 'ShiftRight', specialAlt: 'Numpad0',
    gamepadIndex: -1,
  },
  wasd: {
    thrust: 'KeyW', down: 'KeyS',
    turnLeft: 'KeyA', turnRight: 'KeyD',
    weapon: 'KeyV', weaponAlt: '',
    special: 'KeyB', specialAlt: '',
    gamepadIndex: -1,
  },
  // Same movement as Arrows but ] / [ for weapon/special (UQM template 3)
  arrows2: {
    thrust: 'ArrowUp', down: 'Numpad2',
    turnLeft: 'ArrowLeft', turnRight: 'ArrowRight',
    weapon: 'BracketRight', weaponAlt: '',
    special: 'BracketLeft', specialAlt: '',
    gamepadIndex: -1,
  },
  esdf: {
    thrust: 'KeyE', down: 'KeyD',
    turnLeft: 'KeyS', turnRight: 'KeyF',
    weapon: 'KeyQ', weaponAlt: '',
    special: 'KeyA', specialAlt: '',
    gamepadIndex: -1,
  },
  joystick1: {
    thrust: '', down: '', turnLeft: '', turnRight: '',
    weapon: '', weaponAlt: '', special: '', specialAlt: '',
    gamepadIndex: 0,
  },
  joystick2: {
    thrust: '', down: '', turnLeft: '', turnRight: '',
    weapon: '', weaponAlt: '', special: '', specialAlt: '',
    gamepadIndex: 1,
  },
};

export const PRESET_LABELS: Record<ControlPreset, string> = {
  arrows:    'Arrows',
  wasd:      'WASD',
  esdf:      'ESDF',
  arrows2:   'Arrows (2)',
  joystick1: 'Joystick 1',
  joystick2: 'Joystick 2',
  custom:    'Custom',
};

// ─── Human-readable key names ─────────────────────────────────────────────────

export const CODE_DISPLAY: Record<string, string> = {
  // Arrows
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  // Letters
  KeyA: 'A', KeyB: 'B', KeyC: 'C', KeyD: 'D', KeyE: 'E', KeyF: 'F',
  KeyG: 'G', KeyH: 'H', KeyI: 'I', KeyJ: 'J', KeyK: 'K', KeyL: 'L',
  KeyM: 'M', KeyN: 'N', KeyO: 'O', KeyP: 'P', KeyQ: 'Q', KeyR: 'R',
  KeyS: 'S', KeyT: 'T', KeyU: 'U', KeyV: 'V', KeyW: 'W', KeyX: 'X',
  KeyY: 'Y', KeyZ: 'Z',
  // Modifiers
  ControlLeft: 'L.Ctrl', ControlRight: 'R.Ctrl',
  ShiftLeft: 'L.Shift', ShiftRight: 'R.Shift',
  AltLeft: 'L.Alt', AltRight: 'R.Alt',
  MetaLeft: 'L.Meta', MetaRight: 'R.Meta',
  // Special
  Enter: 'Enter', Space: 'Space', Tab: 'Tab',
  Backspace: 'Bksp', Delete: 'Del', Insert: 'Ins',
  Escape: 'Esc',
  Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  // Punctuation
  BracketLeft: '[', BracketRight: ']',
  Semicolon: ';', Quote: "'", Backslash: '\\',
  Comma: ',', Period: '.', Slash: '/',
  Minus: '-', Equal: '=', Backquote: '`',
  // Digits
  Digit0: '0', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4',
  Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9',
  // Numpad
  Numpad0: 'Num 0', Numpad1: 'Num 1', Numpad2: 'Num 2', Numpad3: 'Num 3',
  Numpad4: 'Num 4', Numpad5: 'Num 5', Numpad6: 'Num 6', Numpad7: 'Num 7',
  Numpad8: 'Num 8', Numpad9: 'Num 9',
  NumpadEnter: 'Num ↵', NumpadAdd: 'Num +', NumpadSubtract: 'Num −',
  NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .',
  // F-keys
  F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
  F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
};

export function codeDisplay(code: string): string {
  return CODE_DISPLAY[code] ?? code;
}

// ─── Config type & persistence ────────────────────────────────────────────────

export interface PlayerControlConfig {
  preset: ControlPreset;
  bindings: KeyBindings;
}

export interface ControlsConfig {
  p1: PlayerControlConfig;
  p2: PlayerControlConfig;
}

const DEFAULTS: ControlsConfig = {
  p1: { preset: 'arrows', bindings: { ...PRESET_BINDINGS.arrows } },
  p2: { preset: 'wasd',   bindings: { ...PRESET_BINDINGS.wasd   } },
};

function loadFromStorage(): ControlsConfig {
  try {
    const raw = localStorage.getItem('sm_controls');
    if (raw) {
      const parsed = JSON.parse(raw) as ControlsConfig;
      // Spread defaults first so new fields (e.g. `down`) are always present
      return {
        p1: { ...DEFAULTS.p1, ...parsed.p1, bindings: { ...DEFAULTS.p1.bindings, ...parsed.p1?.bindings } },
        p2: { ...DEFAULTS.p2, ...parsed.p2, bindings: { ...DEFAULTS.p2.bindings, ...parsed.p2?.bindings } },
      };
    }
  } catch { /* ignore */ }
  return { p1: { ...DEFAULTS.p1, bindings: { ...DEFAULTS.p1.bindings } }, p2: { ...DEFAULTS.p2, bindings: { ...DEFAULTS.p2.bindings } } };
}

// Module-level singleton — loaded once, shared everywhere
let _cfg: ControlsConfig = loadFromStorage();

export function getControls(): ControlsConfig { return _cfg; }

export function setControls(cfg: ControlsConfig): void {
  _cfg = cfg;
  try { localStorage.setItem('sm_controls', JSON.stringify(cfg)); } catch { /* ignore */ }
}

// ─── Binding field metadata (shared between Settings and pause menu) ──────────

export type BindingField = keyof Omit<KeyBindings, 'gamepadIndex'>;

export const BINDING_FIELDS: BindingField[] = [
  'thrust', 'down', 'turnLeft', 'turnRight', 'weapon', 'weaponAlt', 'special', 'specialAlt',
];

// Universal labels — match how these keys are referred to across menus,
// ship select, and battle so there's one consistent vocabulary everywhere.
export const FIELD_LABELS: Record<BindingField, string> = {
  thrust:     'Up',
  down:       'Down',
  turnLeft:   'Left',
  turnRight:  'Right',
  weapon:     'Weapon',
  weaponAlt:  'Weapon (alt)',
  special:    'Special',
  specialAlt: 'Special (alt)',
};

// ─── Utility ─────────────────────────────────────────────────────────────────

/** Build a { event.code → inputBit } map from a KeyBindings for use in Battle. */
export function buildKeyMap(
  b: KeyBindings,
  INPUT_THRUST: number,
  INPUT_LEFT: number,
  INPUT_RIGHT: number,
  INPUT_FIRE1: number,
  INPUT_FIRE2: number,
): Record<string, number> {
  const map: Record<string, number> = {};
  if (b.thrust)     map[b.thrust]     = INPUT_THRUST;
  if (b.turnLeft)   map[b.turnLeft]   = INPUT_LEFT;
  if (b.turnRight)  map[b.turnRight]  = INPUT_RIGHT;
  if (b.weapon)     map[b.weapon]     = INPUT_FIRE1;
  if (b.weaponAlt)  map[b.weaponAlt]  = INPUT_FIRE1;
  if (b.special)    map[b.special]    = INPUT_FIRE2;
  if (b.specialAlt) map[b.specialAlt] = INPUT_FIRE2;
  // `down` is intentionally excluded — it's navigation-only, not a combat input
  return map;
}
