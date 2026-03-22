import type { ShipId } from 'shared/types';
import { getAllShips } from '../engine/ships';

interface Props {
  onPick: (ship: ShipId | null) => void;
  onClose: () => void;
  currentFleet: (ShipId | null)[];
}

export default function ShipPicker({ onPick, onClose, currentFleet }: Props) {
  const ships = getAllShips().filter(s => s.id !== 'samatra'); // Sa-Matra not selectable

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100,
    }}>
      <div className="panel col" style={{ width: 640, maxHeight: '85vh', overflow: 'auto', gap: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>Select Ship</h3>
          <button onClick={onClose}>✕ Close</button>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
        }}>
          {/* Clear slot option */}
          <button
            onClick={() => onPick(null)}
            style={{ padding: 10, textAlign: 'center', background: 'var(--bg)', color: 'var(--text-dim)' }}
          >
            (Empty slot)
          </button>

          {ships.map(ship => {
            const count = currentFleet.filter(s => s === ship.id).length;
            return (
              <button
                key={ship.id}
                onClick={() => onPick(ship.id)}
                style={{
                  padding: '10px 6px',
                  textAlign: 'center',
                  flexDirection: 'column',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  opacity: count >= 1 ? 0.55 : 1,
                }}
                title={`Crew: ${ship.crew}  Speed: ${ship.speed}  Turn: ${ship.turnRate}`}
              >
                <span style={{ fontSize: 11, color: 'var(--text-hi)', textTransform: 'none' }}>
                  {ship.name}
                </span>
                <span style={{ fontSize: 10, color: 'var(--accent2)' }}>
                  {count > 0 ? `(×${count} in fleet)` : ''}
                </span>
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
