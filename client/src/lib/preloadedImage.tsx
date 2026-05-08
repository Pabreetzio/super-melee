import { useEffect, useState } from 'react';
import { publicUrl } from './publicUrl';

const imagePromises = new Map<string, Promise<void>>();
const liveImages = new Map<string, HTMLImageElement>();

export function preloadImage(src: string): Promise<void> {
  const resolvedSrc = publicUrl(src);
  if (!imagePromises.has(resolvedSrc)) {
    imagePromises.set(resolvedSrc, new Promise((resolve, reject) => {
      const existing = liveImages.get(resolvedSrc);
      if (existing?.complete) {
        resolve();
        return;
      }

      const img = existing ?? new Image();
      liveImages.set(resolvedSrc, img);

      img.onload = async () => {
        try { await img.decode(); } catch { /* ignore */ }
        resolve();
      };
      img.onerror = () => reject(new Error(`Failed to preload ${resolvedSrc}`));
      if (img.src !== resolvedSrc) img.src = resolvedSrc;
    }));
  }
  return imagePromises.get(resolvedSrc)!;
}

export function prefetchImages(urls: readonly string[]): void {
  for (const url of urls) {
    void preloadImage(url).catch(() => {});
  }
}

export function usePreloadedImage(src: string | null | undefined): boolean {
  const [ready, setReady] = useState(() => !src);

  useEffect(() => {
    let cancelled = false;

    if (!src) {
      setReady(true);
      return;
    }

    setReady(false);
    void preloadImage(src)
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return ready;
}

interface PreloadedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
}

export function PreloadedImage({ src, style, ...props }: PreloadedImageProps) {
  const ready = usePreloadedImage(src);
  const resolvedSrc = publicUrl(src);
  return (
    <img
      {...props}
      src={resolvedSrc}
      style={{
        ...style,
        visibility: ready ? style?.visibility ?? 'visible' : 'hidden',
      }}
    />
  );
}
