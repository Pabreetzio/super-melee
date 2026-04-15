import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

interface Props {
  text: string;
  className?: string;
  minFontSize?: number;
  maxFontSize: number;
  lineHeight?: number;
  style?: CSSProperties;
}

export default function RailFitText({
  text,
  className = '',
  minFontSize = 10,
  maxFontSize,
  lineHeight = 1,
  style,
}: Props) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(maxFontSize);
  const lines = text.split('\n');

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const measure = measureRef.current;
    if (!wrapper || !measure) return;

    let frame = 0;
    let fontReadyFrame = 0;
    let resizeObserver: ResizeObserver | null = null;

    const recalc = () => {
      const availableWidth = wrapper.clientWidth;
      const measuredWidth = measure.scrollWidth;
      if (!availableWidth || !measuredWidth) {
        setFontSize(maxFontSize);
        return;
      }

      const nextFontSize = Math.max(
        minFontSize,
        Math.min(maxFontSize, Math.floor((maxFontSize * availableWidth) / measuredWidth)),
      );
      setFontSize(current => (Math.abs(current - nextFontSize) < 0.5 ? current : nextFontSize));
    };

    const queueRecalc = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(recalc);
    };

    queueRecalc();

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(queueRecalc);
      resizeObserver.observe(wrapper);
    }

    const fontSet = document.fonts;
    if (fontSet?.ready) {
      void fontSet.ready.then(() => {
        cancelAnimationFrame(fontReadyFrame);
        fontReadyFrame = requestAnimationFrame(recalc);
      }).catch(() => {});
    }

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(fontReadyFrame);
      resizeObserver?.disconnect();
    };
  }, [maxFontSize, minFontSize, text]);

  return (
    <span
      ref={wrapperRef}
      className={`rail-fit-text ${className}`.trim()}
      style={{
        '--rail-fit-font-size': `${fontSize}px`,
        '--rail-fit-line-height': lineHeight,
        '--rail-fit-measure-size': `${maxFontSize}px`,
        ...style,
      } as CSSProperties}
    >
      <span ref={measureRef} className="rail-fit-text__measure" aria-hidden="true">
        {lines.map((line, index) => (
          <span key={index} className="rail-fit-text__line">
            {line}
          </span>
        ))}
      </span>
      <span className="rail-fit-text__visible">
        {lines.map((line, index) => (
          <span key={index} className="rail-fit-text__line">
            {line}
          </span>
        ))}
      </span>
    </span>
  );
}
