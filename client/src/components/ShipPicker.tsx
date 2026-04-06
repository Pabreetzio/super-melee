import type { ShipId } from 'shared/types';
import { getAllShips } from '../engine/ships';
import { SHIP_ICON } from './shipSelectionData';
import { PreloadedImage } from '../lib/preloadedImage';

interface Props {
  onPick: (ship: ShipId | null) => void;
  onClose: () => void;
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
}

const SHIP_PICKER_OPTIONS: (ShipId | null)[] = [null, ...getAllShips().filter(s => s.id !== 'samatra').map(s => s.id)];

export function getShipPickerOptions(): (ShipId | null)[] {
  return SHIP_PICKER_OPTIONS;
}

export function canSelectShipPickerOption(option: ShipId | null): boolean {
  return option === null || option !== 'samatra';
}

export default function ShipPicker({ onPick, onClose, activeIndex, onActiveIndexChange }: Props) {
  const ships = getAllShips().filter(s => s.id !== 'samatra'); // Sa-Matra not selectable

  function handlePick(ship: ShipId | null) {
    onPick(ship);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.28)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100,
    }}>
      <div className="panel col" style={{ width: 520, maxHeight: '72vh', overflow: 'auto', gap: 12, padding: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>Select Ship</h3>
          <button onClick={onClose}>✕ Close</button>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 6,
        }}>
          {/* Clear slot option */}
          <button
            onClick={() => onPick(null)}
            onMouseEnter={() => onActiveIndexChange?.(0)}
            style={{
              padding: 8,
              textAlign: 'center',
              background: activeIndex === 0 ? 'rgba(90, 0, 180, 0.3)' : 'var(--bg)',
              border: activeIndex === 0 ? '1px solid #dd55ff' : '1px solid transparent',
              color: 'var(--text-dim)',
              minHeight: 74,
            }}
          >
            Empty Slot
          </button>

          {ships.map((ship, shipIdx) => {
            const iconUrl = SHIP_ICON[ship.id];
            const optionIdx = shipIdx + 1;
            return (
              <button
                key={ship.id}
                onClick={() => handlePick(ship.id)}
                onMouseEnter={() => onActiveIndexChange?.(optionIdx)}
                style={{
                  padding: '6px 5px',
                  textAlign: 'center',
                  flexDirection: 'column',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  minHeight: 74,
                  background: 'var(--bg2)',
                  border: activeIndex === optionIdx ? '1px solid #dd55ff' : '1px solid transparent',
                }}
                title={ship.name}
              >
                {iconUrl ? (
                  <PreloadedImage
                    src={iconUrl}
                    alt={ship.name}
                    style={{
                      width: 40, height: 40,
                      objectFit: 'contain',
                      imageRendering: 'pixelated',
                    }}
                  />
                ) : (
                  <div style={{ width: 40, height: 40, background: 'var(--bg)', borderRadius: 4 }} />
                )}
                <span style={{ fontSize: 9, color: 'var(--text-hi)', textTransform: 'none', lineHeight: 1.15 }}>
                  {ship.name}
                </span>
              </button>
            );
          })}
        </div>

        <p style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          Choose a ship or clear the slot.
        </p>
      </div>
    </div>
  );
}
