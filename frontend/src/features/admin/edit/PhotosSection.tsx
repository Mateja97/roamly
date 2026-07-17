import { Link } from 'react-router-dom';
import { ImageIcon } from 'lucide-react';
import { ImageSlot } from './controls/ImageSlot';
import type { AdminActivityPhoto } from '../../../api/adminActivities';

export interface PhotosSectionProps {
  /** Used for alt text (cover) / "Photo N of <title>" (gallery). */
  title: string;
  photos: AdminActivityPhoto[];
  /** Omitted in Create mode — there's no activity yet to manage photos
   * for, so the "Manage photos" link renders only once one exists. */
  activityId?: string;
}

/** Read-only display of `photos[]` — cover = `photos[0]`, gallery =
 * `photos[1..]`. Uploading/reordering/captioning happens on the dedicated
 * Manage-photos page (`/activities/:id/photos`), linked from here. */
export function PhotosSection({
  title,
  photos,
  activityId,
}: PhotosSectionProps) {
  const [cover, ...gallery] = photos;

  return (
    <section className="admin-card admin-section">
      <div className="admin-section-heading-row">
        <h2 className="admin-section-heading">Cover photo</h2>
        {activityId && (
          <Link
            to={`/activities/${activityId}/photos`}
            className="admin-control-button admin-section-heading-action"
          >
            <ImageIcon size={16} aria-hidden="true" />
            Manage photos
          </Link>
        )}
      </div>
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
