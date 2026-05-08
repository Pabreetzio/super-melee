import { useEffect, useState, type CSSProperties } from 'react';

interface Props {
  hostName: string;
  oppName: string;
  mismatchFrame: number;
  mismatchCount: number;
  debugReport: string;
  onQuit: () => void;
}

export default function DesyncOverlay({
  hostName,
  oppName,
  mismatchFrame,
  mismatchCount,
  debugReport,
  onQuit,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'BUTTON' && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
        return;
      }
      if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        e.stopPropagation();
        onQuit();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onQuit]);

  const copyReport = async () => {
    setCopyError(false);
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(debugReport);
      } else if (!copyWithTextareaFallback(debugReport)) {
        throw new Error('Clipboard copy failed');
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      console.log('--- DESYNC DEBUG REPORT ---');
      console.log(debugReport);
      setCopied(false);
      setCopyError(true);
    }
  };

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
          <button type="button" onClick={copyReport} style={quitButtonStyle}>
            {copied ? 'Copied Report' : 'Copy Debug Report'}
          </button>
          <div style={{
            color: '#66728f',
            fontSize: 11,
            lineHeight: 1.6,
          }}>
            {copyError
              ? 'Clipboard was blocked by the browser. The report was printed to the console.'
              : 'Press Enter or Escape to leave this engagement and return to the Netplay screen.'}
          </div>
        </div>
      </div>
    </div>
  );
}

function copyWithTextareaFallback(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}
