import { Link } from 'react-router-dom';
import { ChevronRight, Check, Loader2 } from 'lucide-react';
import type { ActivityStatus } from '../../../api/adminActivities';

const STATUS_PILL: Record<
  ActivityStatus,
  { label: string; className: string }
> = {
  published: { label: 'Published', className: 'admin-pill-published' },
  draft: { label: 'Draft', className: 'admin-pill-draft' },
  pending: { label: 'Pending', className: 'admin-pill-pending' },
};

export interface EditActivityHeaderProps {
  isCreate: boolean;
  /** The activity's current name (edit mode only — ignored in create mode,
   * which always reads "New activity"). */
  activityTitle: string;
  status: ActivityStatus;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

/** Breadcrumb + title + live status pill + Cancel/Save. The status pill
 * is a read-out of the Status radio group below, not an interactive
 * control, and always reserves its slot so a status change never reflows
 * the header. */
export function EditActivityHeader({
  isCreate,
  activityTitle,
  status,
  saving,
  onCancel,
  onSave,
}: EditActivityHeaderProps) {
  const pill = STATUS_PILL[status];

  return (
    <header className="admin-top-bar admin-edit-header">
      <div className="admin-top-bar-title">
        <p className="admin-breadcrumb">
          <Link to="/activities" className="admin-breadcrumb-link">
            Activities
          </Link>
          <ChevronRight size={13} aria-hidden="true" />
          <span aria-current="page">{isCreate ? 'New' : 'Edit'}</span>
        </p>
        <h1 className="admin-page-title admin-edit-title">
          {isCreate ? 'New activity' : activityTitle}
        </h1>
      </div>
      <div className="admin-top-bar-spacer" />
      <span className={`admin-status-pill ${pill.className}`}>
        <span className="admin-status-dot" aria-hidden="true" />
        {pill.label}
      </span>
      <button
        type="button"
        className="admin-control-button"
        onClick={onCancel}
        disabled={saving}
      >
        Cancel
      </button>
      <button
        type="button"
        className="admin-primary-button"
        onClick={onSave}
        disabled={saving}
      >
        {saving ? (
          <>
            <Loader2 size={16} className="admin-spin" aria-hidden="true" />
            Saving…
          </>
        ) : (
          <>
            <Check size={16} aria-hidden="true" />
            Save changes
          </>
        )}
      </button>
    </header>
  );
}
