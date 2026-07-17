import { ImageSlot } from './controls/ImageSlot';
import type { AdminActivityPhoto } from '../../../api/adminActivities';

export interface PhotosSectionProps {
  /** Used for alt text (cover) / "Photo N of <title>" (gallery). */
  title: string;
  photos: AdminActivityPhoto[];
}

/** Read-only display of `photos[]` — cover = `photos[0]`, gallery =
 * `photos[1..]`. No upload/add tile (out of scope per Non-goals). */
export function PhotosSection({ title, photos }: PhotosSectionProps) {
  const [cover, ...gallery] = photos;

  return (
    <section className="admin-card admin-section">
      <h2 className="admin-section-heading">Cover photo</h2>
      <ImageSlot
        src={cover?.url}
        alt={title}
        className="admin-cover-box"
        emptyHint={cover ? undefined : 'No cover photo'}
      />
      {gallery.length > 0 && (
        <div className="admin-gallery-grid">
          {gallery.map((photo, i) => (
            <ImageSlot
              key={`${photo.url}-${i}`}
              src={photo.url}
              alt={`Photo ${i + 1} of ${title}`}
              className="admin-thumb-box"
              iconSize={16}
            />
          ))}
        </div>
      )}
    </section>
  );
}
