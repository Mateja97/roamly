import { Check, GripVertical, Loader2, X } from 'lucide-react';
import { ImageSlot } from '../edit/controls/ImageSlot';

export type PhotoTileStatus = 'idle' | 'uploading' | 'error';

export interface PhotoTileProps {
  /** 0-based position in the staged array — index 0 is always the cover. */
  index: number;
  isCover: boolean;
  /** Object URL (staged, not yet uploaded) or the server's `url`. */
  src: string;
  caption: string;
  status: PhotoTileStatus;
  errorMessage?: string;
  /** True while this tile is the keyboard reorder's "picked up" item. */
  pickedUp: boolean;
  /** True while a pointer drag is hovering this tile as the drop target. */
  isDropTarget: boolean;
  /** True during the page-level Save — freezes every per-tile control so a
   * mutation can't race the in-flight upload/patch. */
  disabled: boolean;
  onRemove: () => void;
  onSetCover: () => void;
  onCaptionChange: (value: string) => void;
  onRetry: () => void;
  onDragStart: (e: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onHandleKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
}

/** One tile of the Manage-photos grid — image + Cover pill/Remove overlay,
 * a footer (drag handle + "Photo N" / Cover check or Set-as-cover), and an
 * always-visible caption input. Purely presentational: reorder, cover, and
 * removal all live in the array `ManagePhotosPage` owns. */
export function PhotoTile({
  index,
  isCover,
  src,
  caption,
  status,
  errorMessage,
  pickedUp,
  isDropTarget,
  disabled,
  onRemove,
  onSetCover,
  onCaptionChange,
  onRetry,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onHandleKeyDown,
}: PhotoTileProps) {
  const n = index + 1;
  const classes = [
    'admin-photo-tile',
    status === 'error' && 'admin-photo-tile-error',
    status === 'uploading' && 'admin-photo-tile-uploading',
    pickedUp && 'admin-photo-tile-picked-up',
    isDropTarget && 'admin-photo-tile-drop-target',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} onDragOver={onDragOver} onDrop={onDrop}>
      <div className="admin-photo-tile-image">
        <ImageSlot
          src={src}
          alt={`Photo ${n}`}
          className="admin-photo-image-box"
        />
        {isCover && <span className="admin-photo-cover-pill">Cover</span>}
        <button
          type="button"
          className="admin-photo-remove"
          aria-label={`Remove photo ${n}`}
          onClick={onRemove}
          disabled={disabled}
        >
          <X size={16} aria-hidden="true" />
        </button>
        {status === 'uploading' && (
          <div className="admin-photo-uploading" aria-hidden="true">
            <Loader2 size={20} className="admin-spin" />
            <span>Uploading…</span>
          </div>
        )}
      </div>

      <div className="admin-photo-tile-footer">
        <span
          className="admin-photo-handle"
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-label={`Reorder photo ${n}`}
          aria-pressed={pickedUp}
          draggable={!disabled}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onKeyDown={onHandleKeyDown}
        >
          <GripVertical size={16} aria-hidden="true" />
          <span className="admin-photo-n">Photo {n}</span>
        </span>
        {isCover ? (
          <span className="admin-photo-cover-check">
            <Check size={16} aria-hidden="true" />
            Cover
          </span>
        ) : (
          <button
            type="button"
            className="admin-control-button admin-photo-set-cover"
            onClick={onSetCover}
            disabled={disabled}
          >
            Set as cover
          </button>
        )}
      </div>

      {status === 'error' && (
        <div className="admin-photo-tile-error-row" role="alert">
          <span>{errorMessage ?? 'Upload failed'}</span>
          <button
            type="button"
            className="admin-control-button"
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      )}

      <label className="admin-field admin-photo-caption">
        <span className="admin-field-label">
          Caption <span className="admin-photo-caption-optional">(optional)</span>
        </span>
        <input
          type="text"
          className="admin-field-input"
          placeholder="Add a caption"
          aria-label={`Caption for photo ${n}`}
          value={caption}
          onChange={(e) => onCaptionChange(e.target.value)}
          disabled={disabled}
        />
      </label>
    </div>
  );
}
