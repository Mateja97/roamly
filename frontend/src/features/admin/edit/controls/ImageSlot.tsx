import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';

export interface ImageSlotProps {
  /** `undefined` renders the empty state (no URL to try at all). */
  src: string | undefined;
  alt: string;
  className: string;
  iconSize?: number;
  /** Shown under the icon only in the empty (no `src`) state. */
  emptyHint?: string;
}

/** Shared cover/gallery/map image treatment: loading skeleton while the
 * image loads, `ImageOff` icon on a broken URL, `ImageOff` (+ optional
 * hint) when there's no URL at all — reused by `PhotosSection` and
 * `LocationSection`'s static map preview. */
export function ImageSlot({
  src,
  alt,
  className,
  iconSize = 20,
  emptyHint,
}: ImageSlotProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  if (!src) {
    return (
      <div className={`${className} admin-image-placeholder`}>
        <ImageOff size={iconSize} aria-hidden="true" />
        {emptyHint && <span className="admin-image-hint">{emptyHint}</span>}
      </div>
    );
  }

  if (failed) {
    return (
      <div className={`${className} admin-image-placeholder`}>
        <ImageOff size={iconSize} aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className={`${className} admin-image-slot`}>
      {!loaded && (
        <span
          className="admin-skeleton admin-image-skeleton"
          aria-hidden="true"
        />
      )}
      <img
        src={src}
        alt={alt}
        className="admin-image-img"
        style={{ display: loaded ? 'block' : 'none' }}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
