// Battle HUD — crew and energy bars for both ships

interface ShipStatus {
  name:      string;
  crew:      number;
  maxCrew:   number;
  energy:    number;
  maxEnergy: number;
}

interface Props {
  left:  ShipStatus | null;
  right: ShipStatus | null;
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div style={{
      width: 120, height: 10,
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      borderRadius: 2,
      overflow: 'hidden',
    }}>
      <div style={{
        width: `${pct * 100}%`,
        height: '100%',
        background: color,
        transition: 'width 0.1s',
      }} />
    </div>
  );
}

function ShipHUD({ status, flip }: { status: ShipStatus; flip: boolean }) {
  const content = (
    <>
      <span style={{ fontSize: 11, color: 'var(--text-hi)', minWidth: 80 }}>
        {status.name}
      </span>
      <div className="col" style={{ gap: 3 }}>
        <div className="row" style={{ gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', width: 36 }}>CREW</span>
          <Bar value={status.crew} max={status.maxCrew} color="#4f4" />
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{status.crew}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', width: 36 }}>BATT</span>
          <Bar value={status.energy} max={status.maxEnergy} color="#48f" />
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{status.energy}</span>
        </div>
      </div>
    </>
  );

  return (
    <div className="row" style={{
      gap: 8,
      flexDirection: flip ? 'row-reverse' : 'row',
      background: 'rgba(0,0,10,0.7)',
      border: '1px solid var(--border)',
      borderRadius: 4,
      padding: '6px 10px',
    }}>
      {content}
    </div>
  );
}

export default function HUD({ left, right }: Props) {
  return (
    <div style={{
      position: 'absolute', bottom: 8, left: 0, right: 0,
      display: 'flex', justifyContent: 'space-between',
      padding: '0 12px',
      pointerEvents: 'none',
    }}>
      {left  ? <ShipHUD status={left}  flip={false} /> : <div />}
      {right ? <ShipHUD status={right} flip={true}  /> : <div />}
    </div>
  );
}
