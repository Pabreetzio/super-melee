export type MeleeZoomStyle = 'step' | '3do';

export interface BattleViewConfig {
  meleeZoom: MeleeZoomStyle;
}

const STORAGE_KEY = 'sm_battle_view';

const DEFAULT_CONFIG: BattleViewConfig = {
  meleeZoom: '3do',
};

function isBattleViewConfig(value: unknown): value is Partial<BattleViewConfig> {
  return !!value && typeof value === 'object';
}

let _config: BattleViewConfig = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as unknown;
    if (!isBattleViewConfig(parsed)) return DEFAULT_CONFIG;
    return {
      meleeZoom: parsed.meleeZoom === '3do' ? '3do' : 'step',
    };
  } catch {
    return DEFAULT_CONFIG;
  }
})();

export function getBattleViewConfig(): BattleViewConfig {
  return { ..._config };
}

export function setBattleViewConfig(patch: Partial<BattleViewConfig>): void {
  _config = {
    ..._config,
    ...patch,
    meleeZoom: patch.meleeZoom === '3do' ? '3do' : patch.meleeZoom === 'step' ? 'step' : _config.meleeZoom,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_config));
  } catch {
    // Ignore persistence failures; battle view settings are non-critical.
  }
}
