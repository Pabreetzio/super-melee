/**
 * StarfieldBG — renders a StarfieldConfig as an absolutely-positioned
 * full-page background layer (z-index 0).
 *
 * Import DEFAULT_CONFIG or loadConfig() from lib/starfield to get a config.
 */

import { useMemo } from 'react';
import type { StarfieldConfig } from '../lib/starfield';
import { buildStarLayers, buildNebulaCSS, buildSpikeShadow } from '../lib/starfield';

// ─── Shared base styles ───────────────────────────────────────────────────────

const wrapStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 0,
  pointerEvents: 'none',
  overflow: 'hidden',
};

const dotStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: 1,
  height: 1,
  borderRadius: '50%',
  background: 'transparent',
  pointerEvents: 'none',
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  config: StarfieldConfig;
}

export default function StarfieldBG({ config }: Props) {
  // Recompute only when relevant config fields change
  const layers = useMemo(
    () => buildStarLayers(config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.seed, config.tinyCount, config.smallCount, config.medCount,
     config.brightCount, config.brightBlur, config.colorTemp]
  );

  const nebulaCss = useMemo(
    () => buildNebulaCSS(config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.baseBlueness, JSON.stringify(config.nebulae)]
  );

  return (
    <div style={{ ...wrapStyle, background: nebulaCss }}>
      {/* Regular star field layers */}
      {layers.map((layer, i) => (
        <div
          key={i}
          style={{
            ...dotStyle,
            boxShadow: layer.shadow,
            ...(layer.blur > 0 ? { filter: `blur(${layer.blur}px)` } : {}),
          }}
        />
      ))}

      {/* Diffraction-spike stars */}
      {config.spikeStars.map((star, i) => (
        <div
          key={`spike-${i}`}
          style={{
            position: 'absolute',
            left: `${star.x}%`,
            top:  `${star.y}%`,
            width: 1,
            height: 1,
            // Center pixel = element background
            background: `rgba(255,255,255,${star.brightness.toFixed(2)})`,
            // Spike pixels = box-shadow
            boxShadow: buildSpikeShadow(star.type, star.brightness),
            pointerEvents: 'none',
            imageRendering: 'pixelated',
          }}
        />
      ))}
    </div>
  );
}
