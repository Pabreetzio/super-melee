import { useEffect, type CSSProperties } from 'react';

interface Props {
  hostName: string;
  oppName: string;
  mismatchFrame: number;
  mismatchCount: number;
  onQuit: () => void;
}

export default function DesyncOverlay({
  hostName,
  oppName,
  mismatchFrame,
  mismatchCount,
  onQuit,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        e.stopPropagation();
        onQuit();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onQuit]);

  const disabledButtonStyle: CSSProperties = {
    fontSize: 12,
    padding: '9px 10px',
    background: '#07070f',
    color: '#445',
    border: '1px solid #1b1b34',
    fontFamily: 'var(--font)',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    cursor: 'not-allowed',
    opacity: 0.7,
  };

  const quitButtonStyle: CSSProperties = {
    fontSize: 12,
    padding: '9px 10px',
    background: '#10182f',
    color: '#9fd0ff',
    border: '1px solid #3f6da0',
    fontFamily: 'var(--font)',
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    cursor: 'pointer',
  };

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      background: 'rgba(0,0,0,0.78)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font)',
      zIndex: 25,
    }}>
      <div style={{
        width: 'min(640px, calc(100% - 32px))',
        background: 'rgba(2,3,20,0.97)',
        border: '1px solid #2a2a50',
        boxShadow: '0 0 0 1px rgba(120, 180, 255, 0.08) inset',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.7fr) minmax(220px, 0.9fr)',
      }}>
        <div style={{ padding: '22px 24px 20px 24px', borderRight: '1px solid #1a1a30' }}>
          <div style={{
            color: '#ff88ff',
            fontSize: 22,
            fontWeight: 'bold',
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            textAlign: 'center',
            marginBottom: 12,
          }}>
            Sync Lost
          </div>
          <div style={{
            color: '#8fc4ff',
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            marginBottom: 14,
            textAlign: 'center',
          }}>
            Desync #{mismatchCount} at frame {mismatchFrame}
          </div>
          <div style={{
            color: '#aeb9d6',
            fontSize: 12,
            lineHeight: 1.65,
            marginBottom: 18,
          }}>
            Both clients reported different battle state. The fight is paused so neither side keeps playing a corrupted simulation.
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <button type="button" disabled style={disabledButtonStyle}>
              Continue With {hostName} State
            </button>
            <button type="button" disabled style={disabledButtonStyle}>
              Continue With {oppName} State
            </button>
          </div>
          <div style={{
            marginTop: 14,
            color: '#6d7b9a',
            fontSize: 11,
            lineHeight: 1.6,
          }}>
            Live-state recovery is not wired yet. To continue safely, netplay needs a full battle snapshot sync plus a new battle epoch so stale inputs from the broken simulation cannot leak into the recovered one.
          </div>
        </div>
        <div style={{ padding: '22px 20px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            color: '#8fc4ff',
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            borderBottom: '1px solid #1a1a30',
            paddingBottom: 8,
          }}>
            Available Now
          </div>
          <button type="button" onClick={onQuit} style={quitButtonStyle}>
            Quit Match
          </button>
          <div style={{
            color: '#66728f',
            fontSize: 11,
            lineHeight: 1.6,
          }}>
            Press Enter or Escape to leave this engagement and return to the Netplay screen.
          </div>
        </div>
      </div>
    </div>
  );
}
