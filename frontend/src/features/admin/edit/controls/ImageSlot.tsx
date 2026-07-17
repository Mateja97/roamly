import { useLayoutEffect, useRef, useState } from 'react';
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
  const imgRef = useRef<HTMLImageElement>(null);

  // One effect, not two: an already-cached image (or a data: URI, which
  // decodes synchronously) can finish loading before React attaches the
  // onLoad listener below — the browser never re-fires `load` for an
  // already-complete <img> — so this has to both reset state for a new
  // `src` *and* catch up on an already-complete one in the same pass. A
  // separate plain `useEffect` that only reset on `src` change used to
  // run after this one and stomp its synchronous result back to false on
  // every mount (including the already-loaded case).
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      setLoaded(true);
      setFailed(false);
    } else if (img?.complete) {
      setLoaded(false);
      setFailed(true);
    } else {
      setLoaded(false);
      setFailed(false);
    }
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
        ref={imgRef}
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
