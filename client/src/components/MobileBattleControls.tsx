import { useCallback, useMemo, useRef, useState } from 'react';

export type MobileBattleControl = 'thrust' | 'left' | 'right' | 'fire1' | 'fire2';

interface Props {
  visible: boolean;
  paused: boolean;
  canFullscreen: boolean;
  isFullscreen: boolean;
  onBitsChange: (bits: number) => void;
  onFullscreen: () => void;
}

const DEADZONE = 0.28;

function clampMagnitude(dx: number, dy: number, max: number) {
  const mag = Math.hypot(dx, dy);
  if (mag <= max || mag === 0) return { dx, dy };
  const scale = max / mag;
  return { dx: dx * scale, dy: dy * scale };
}

export default function MobileBattleControls({
  visible,
  paused,
  canFullscreen,
  isFullscreen,
  onBitsChange,
  onFullscreen,
}: Props) {
  const stickRef = useRef<HTMLDivElement | null>(null);
  const stickPointerIdRef = useRef<number | null>(null);
  const [stickOffset, setStickOffset] = useState({ x: 0, y: 0 });
  const fireBitsRef = useRef(0);

  const updateBits = useCallback((joystickBits: number, fireBits = fireBitsRef.current) => {
    onBitsChange(joystickBits | fireBits);
  }, [onBitsChange]);

  const resetStick = useCallback(() => {
    stickPointerIdRef.current = null;
    setStickOffset({ x: 0, y: 0 });
    updateBits(0);
  }, [updateBits]);

  const applyStickPosition = useCallback((clientX: number, clientY: number) => {
    const root = stickRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxRadius = Math.max(1, rect.width / 2 - 24);
    const clamped = clampMagnitude(clientX - centerX, clientY - centerY, maxRadius);
    setStickOffset({ x: clamped.dx, y: clamped.dy });

    const nx = clamped.dx / maxRadius;
    const ny = clamped.dy / maxRadius;
    let bits = 0;
    if (ny < -DEADZONE) bits |= 0x01;
    if (nx < -DEADZONE) bits |= 0x02;
    if (nx > DEADZONE) bits |= 0x04;
    updateBits(bits);
  }, [updateBits]);

  const handleStickDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    stickPointerIdRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    applyStickPosition(e.clientX, e.clientY);
  }, [applyStickPosition]);

  const handleStickMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (stickPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    applyStickPosition(e.clientX, e.clientY);
  }, [applyStickPosition]);

  const handleFire = useCallback((bit: number, pressed: boolean) => {
    if (pressed) fireBitsRef.current |= bit;
    else fireBitsRef.current &= ~bit;
    let joystickBits = 0;
    const root = stickRef.current;
    const maxRadius = root ? Math.max(1, root.getBoundingClientRect().width / 2 - 24) : 1;
    const nx = stickOffset.x / maxRadius;
    const ny = stickOffset.y / maxRadius;
    if (ny < -DEADZONE) joystickBits |= 0x01;
    if (nx < -DEADZONE) joystickBits |= 0x02;
    if (nx > DEADZONE) joystickBits |= 0x04;
    updateBits(joystickBits, fireBitsRef.current);
  }, [stickOffset.x, stickOffset.y, updateBits]);

  const fireHandlers = useCallback((bit: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      handleFire(bit, true);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      handleFire(bit, false);
    },
    onPointerCancel: () => handleFire(bit, false),
    onLostPointerCapture: () => handleFire(bit, false),
    onContextMenu: (e: React.MouseEvent<HTMLButtonElement>) => e.preventDefault(),
  }), [handleFire]);

  const knobStyle = useMemo(() => ({
    transform: `translate(${stickOffset.x}px, ${stickOffset.y}px)`,
  }), [stickOffset.x, stickOffset.y]);

  if (!visible || paused) return null;

  return (
    <div className="mobile-controls" aria-hidden="true">
      <div
        ref={stickRef}
        className="mobile-controls__stick"
        onPointerDown={handleStickDown}
        onPointerMove={handleStickMove}
        onPointerUp={resetStick}
        onPointerCancel={resetStick}
        onLostPointerCapture={resetStick}
      >
        <div className="mobile-controls__stick-knob" style={knobStyle} />
      </div>

      <div className="mobile-controls__fire">
        <button type="button" className="mobile-controls__fire-button mobile-controls__fire-button--secondary" {...fireHandlers(0x10)} />
        <button type="button" className="mobile-controls__fire-button mobile-controls__fire-button--primary" {...fireHandlers(0x08)} />
      </div>

      {canFullscreen && !isFullscreen && (
        <button
          type="button"
          className="mobile-controls__fullscreen"
          aria-label="Enter fullscreen"
          onClick={onFullscreen}
        >
          <svg viewBox="0 0 24 24" className="mobile-controls__fullscreen-icon" aria-hidden="true">
            <path d="M8 3H3v5" />
            <path d="M16 3h5v5" />
            <path d="M21 16v5h-5" />
            <path d="M3 16v5h5" />
            <path d="M3 8l6-5" />
            <path d="M21 8l-6-5" />
            <path d="M21 16l-6 5" />
            <path d="M3 16l6 5" />
          </svg>
        </button>
      )}
    </div>
  );
}
