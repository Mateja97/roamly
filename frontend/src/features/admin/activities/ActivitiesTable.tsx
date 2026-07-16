import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ImageOff, Inbox, Pencil, Star, X } from 'lucide-react';
import type { AdminActivitySummary } from '../../../api/adminActivities';
import type { ActivitiesQueryState } from '../hooks/useAdminActivities';

const SKELETON_ROWS = 7;

const STATUS_PILL: Record<string, { label: string; className: string }> = {
  published: { label: 'Published', className: 'admin-pill-published' },
  draft: { label: 'Draft', className: 'admin-pill-draft' },
  pending: { label: 'Pending', className: 'admin-pill-pending' },
};

export interface ActivitiesTableProps {
  result: ActivitiesQueryState;
  onClearFilters: () => void;
}

/** The table region: renders whichever of the five required states the
 * current result union member calls for — loading skeleton, populated
 * rows, empty (zero matches), a dismissible error banner (400/404/409/500),
 * or the blocking 403 "admin access rejected" panel (which replaces the
 * table entirely rather than banner-and-continue, since a misconfigured
 * token can't be retried away). */
export function ActivitiesTable({
  result,
  onClearFilters,
}: ActivitiesTableProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
  }, [result]);

  if (result.status === 403) {
    return (
      <div className="admin-table-container admin-blocked-panel">
        <AlertCircle
          size={20}
          className="admin-error-icon"
          aria-hidden="true"
        />
        <p className="admin-blocked-title">Admin access rejected</p>
        <p className="admin-blocked-hint">
          The admin token is missing or incorrect — check{' '}
          <code>VITE_ADMIN_TOKEN</code>.
        </p>
      </div>
    );
  }

  const isBannerError =
    result.status !== 'loading' && result.status !== 'success';
  const isEmpty =
    result.status === 'success' && result.data.activities.length === 0;

  return (
    <div className="admin-table-container">
      {isBannerError && (
        // Slot itself always mounts for the lifetime of an error result
        // (min-height reserved in CSS) — only the banner *inside* it toggles
        // on dismiss, so dismissing never shifts the table below it.
        <div className="admin-error-slot">
          {!dismissed && (
            <div className="admin-error-banner" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{result.message}</span>
              <button
                type="button"
                className="admin-banner-dismiss"
                aria-label="Dismiss"
                onClick={() => setDismissed(true)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}

      <table className="admin-table">
        {/* Edit column is a real 76px (44px button + 2x --space-3 td
            padding), not a %, so it can never be squeezed below the
            button's touch target. The other five columns split
            `100% - 76px` by the design spec's fr-ratio (2.6:1.2:1:1:0.9,
            sum 6.7) — calc() keeps that reservation exact at any table
            width, unlike five flat %s that summed to 100% *plus* a fixed
            column (the previous bug: table rendered 76px wider than its
            container, clipping the Edit button). */}
        <colgroup>
          <col style={{ width: 'calc((100% - 76px) * 0.388)' }} />
          <col style={{ width: 'calc((100% - 76px) * 0.179)' }} />
          <col style={{ width: 'calc((100% - 76px) * 0.149)' }} />
          <col style={{ width: 'calc((100% - 76px) * 0.149)' }} />
          <col style={{ width: 'calc((100% - 76px) * 0.135)' }} />
          <col style={{ width: '76px' }} />
        </colgroup>
        <thead>
          <tr>
            <th>Activity</th>
            <th>Category</th>
            <th>City</th>
            <th>Status</th>
            <th>Rating</th>
            <th>
              <span className="sr-only">Edit</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {result.status === 'loading' &&
            Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <SkeletonRow key={i} />
            ))}
          {result.status === 'success' &&
            result.data.activities.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
          {isEmpty && (
            <tr>
              <td colSpan={6}>
                <EmptyState onClearFilters={onClearFilters} />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr aria-hidden="true">
      <td>
        <div className="admin-row-activity">
          <span className="admin-skeleton admin-thumb-skeleton" />
          <span
            className="admin-skeleton admin-text-skeleton"
            style={{ width: '60%' }}
          />
        </div>
      </td>
      <td>
        <span
          className="admin-skeleton admin-text-skeleton"
          style={{ width: '70%' }}
        />
      </td>
      <td>
        <span
          className="admin-skeleton admin-text-skeleton"
          style={{ width: '70%' }}
        />
      </td>
      <td>
        <span className="admin-skeleton admin-pill-skeleton" />
      </td>
      <td>
        <span
          className="admin-skeleton admin-text-skeleton"
          style={{ width: '50%' }}
        />
      </td>
      <td>
        <span className="admin-skeleton admin-thumb-skeleton" />
      </td>
    </tr>
  );
}

function ActivityRow({ activity }: { activity: AdminActivitySummary }) {
  const [imgFailed, setImgFailed] = useState(false);
  const photoUrl = activity.photos[0]?.url;

  return (
    <tr>
      <td>
        <div className="admin-row-activity">
          {photoUrl && !imgFailed ? (
            <img
              src={photoUrl}
              alt=""
              className="admin-thumb"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <span className="admin-thumb admin-thumb-placeholder">
              <ImageOff size={16} aria-hidden="true" />
            </span>
          )}
          <span className="admin-row-title" title={activity.title}>
            {activity.title}
          </span>
        </div>
      </td>
      <td className="admin-row-muted">{activity.category}</td>
      <td className="admin-row-muted">{activity.city}</td>
      <td>
        <span
          className={`admin-status-pill ${STATUS_PILL[activity.status]?.className ?? ''}`}
        >
          <span className="admin-status-dot" aria-hidden="true" />
          {STATUS_PILL[activity.status]?.label ?? activity.status}
        </span>
      </td>
      <td>
        <span className="admin-rating">
          <Star size={14} className="admin-rating-star" aria-hidden="true" />
          <span className="admin-row-muted">{activity.rating.toFixed(1)}</span>
        </span>
      </td>
      <td>
        <Link
          to={`/activities/${activity.id}/edit`}
          className="admin-icon-button"
          aria-label={`Edit ${activity.title}`}
        >
          <Pencil size={16} aria-hidden="true" />
        </Link>
      </td>
    </tr>
  );
}

function EmptyState({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <div className="admin-empty-state">
      <Inbox size={20} aria-hidden="true" />
      <p className="admin-empty-title">No activities match your filters</p>
      <p className="admin-empty-hint">Try clearing the search or a filter</p>
      <button
        type="button"
        className="admin-control-button"
        onClick={onClearFilters}
      >
        Clear filters
      </button>
    </div>
  );
}
