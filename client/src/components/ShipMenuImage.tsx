import { useState } from 'react';
import { PreloadedImage } from '../lib/preloadedImage';

interface Props {
  src: string;
  alt: string;
  scale?: number;
  maxFill?: string;
}

export default function ShipMenuImage({ src, alt, scale = 3, maxFill = '100%' }: Props) {
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  return (
    <PreloadedImage
      src={src}
      alt={alt}
      onLoad={e => {
        const img = e.currentTarget;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
        }
      }}
      style={{
        width: naturalSize ? naturalSize.width * scale : 'auto',
        height: naturalSize ? naturalSize.height * scale : 'auto',
        maxWidth: maxFill,
        maxHeight: maxFill,
        objectFit: 'contain',
        imageRendering: 'pixelated',
      }}
    />
  );
}
