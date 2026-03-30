import type { ShipId } from 'shared/types';
import { getAllShips } from '../engine/ships';

interface Props {
  onPick: (ship: ShipId | null) => void;
  onClose: () => void;
  currentFleet: (ShipId | null)[];
}

// Maps each ShipId to the path of its portrait sprite (first rotation frame).
// Exported so FleetBuilder can show the same icons in the fleet grid.
// Served from /ships/<folder>/<name>-big-000.png via Vite's publicDir → ../assets.
export const SHIP_ICON: Partial<Record<ShipId, string>> = {
  androsynth: '/ships/androsynth/guardian-big-000.png',
  arilou:     '/ships/arilou/skiff-big-000.png',
  chenjesu:   '/ships/chenjesu/broodhome-big-000.png',
  chmmr:      '/ships/chmmr/avatar-big-000.png',
  druuge:     '/ships/druuge/mauler-big-000.png',
  human:      '/ships/human/cruiser-big-000.png',
  ilwrath:    '/ships/ilwrath/avenger-big-000.png',
  kohrah:     '/ships/kohrah/marauder-big-000.png',
  melnorme:   '/ships/melnorme/trader-big-000.png',
  mmrnmhrm:   '/ships/mmrnmhrm/xform-big-000.png',
  mycon:      '/ships/mycon/podship-big-000.png',
  orz:        '/ships/orz/nemesis-big-000.png',
  pkunk:      '/ships/pkunk/fury-big-000.png',
  shofixti:   '/ships/shofixti/scout-big-000.png',
  slylandro:  '/ships/slylandro/probe-big-000.png',
  spathi:     '/ships/spathi/eluder-big-000.png',
  supox:      '/ships/supox/blade-big-000.png',
  syreen:     '/ships/syreen/penetrator-big-000.png',
  thraddash:  '/ships/thraddash/torch-big-000.png',
  umgah:      '/ships/umgah/drone-big-000.png',
  urquan:     '/ships/urquan/dreadnought-big-000.png',
  utwig:      '/ships/utwig/jugger-big-000.png',
  vux:        '/ships/vux/intruder-big-000.png',
  yehat:      '/ships/yehat/terminator-big-000.png',
  zoqfotpik:  '/ships/zoqfotpik/stinger-big-000.png',
};

export default function ShipPicker({ onPick, onClose, currentFleet }: Props) {
  const ships = getAllShips().filter(s => s.id !== 'samatra'); // Sa-Matra not selectable

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100,
    }}>
      <div className="panel col" style={{ width: 700, maxHeight: '85vh', overflow: 'auto', gap: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>Select Ship</h3>
          <button onClick={onClose}>✕ Close</button>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 8,
        }}>
          {/* Clear slot option */}
          <button
            onClick={() => onPick(null)}
            style={{ padding: 10, textAlign: 'center', background: 'var(--bg)', color: 'var(--text-dim)', minHeight: 90 }}
          >
            (Empty slot)
          </button>

          {ships.map(ship => {
            const count = currentFleet.filter(s => s === ship.id).length;
            const iconUrl = SHIP_ICON[ship.id];
            return (
              <button
                key={ship.id}
                onClick={() => onPick(ship.id)}
                style={{
                  padding: '8px 6px',
                  textAlign: 'center',
                  flexDirection: 'column',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  opacity: count >= 1 ? 0.5 : 1,
                  minHeight: 90,
                  background: 'var(--bg2)',
                }}
                title={`Crew: ${ship.crew}  Speed: ${ship.speed}  Turn: ${ship.turnRate}`}
              >
                {iconUrl ? (
                  <img
                    src={iconUrl}
                    alt={ship.name}
                    style={{
                      width: 48, height: 48,
                      objectFit: 'contain',
                      imageRendering: 'pixelated',
                    }}
                  />
                ) : (
                  <div style={{ width: 48, height: 48, background: 'var(--bg)', borderRadius: 4 }} />
                )}
                <span style={{ fontSize: 10, color: 'var(--text-hi)', textTransform: 'none', lineHeight: 1.2 }}>
                  {ship.name}
                </span>
                {count > 0 && (
                  <span style={{ fontSize: 10, color: 'var(--accent2)' }}>×{count}</span>
                )}
              </button>
            );
          })}
        </div>

        <p style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          Hover for stats. No point cap — field whatever you'd like, Commander.
        </p>
      </div>
    </div>
  );
}
