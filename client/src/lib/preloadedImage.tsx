import { useEffect, useState } from 'react';

const imagePromises = new Map<string, Promise<void>>();
const liveImages = new Map<string, HTMLImageElement>();

export function preloadImage(src: string): Promise<void> {
  if (!imagePromises.has(src)) {
    imagePromises.set(src, new Promise((resolve, reject) => {
      const existing = liveImages.get(src);
      if (existing?.complete) {
        resolve();
        return;
      }

      const img = existing ?? new Image();
      liveImages.set(src, img);

      img.onload = async () => {
        try { await img.decode(); } catch { /* ignore */ }
        resolve();
      };
      img.onerror = () => reject(new Error(`Failed to preload ${src}`));
      if (img.src !== src) img.src = src;
    }));
  }
  return imagePromises.get(src)!;
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
  return (
    <img
      {...props}
      src={src}
      style={{
        ...style,
        visibility: ready ? style?.visibility ?? 'visible' : 'hidden',
      }}
    />
  );
}
