import type { ActivityStatus } from '../../../api/adminActivities';

const STATUS_OPTIONS: { value: ActivityStatus; label: string }[] = [
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending review' },
];

export interface StatusSectionProps {
  status: ActivityStatus;
  onStatusChange: (status: ActivityStatus) => void;
  /** Omitted entirely when absent — Create mode has no row yet, and the
   * model has no author/updated_at to fabricate a "last edited by" from
   * (see engineering-notes.md's T4 section). */
  createdAt?: string;
  disabled?: boolean;
}

/** Radio group (admin) — Published / Draft / Pending review, one tab
 * stop, arrow keys move the selection. Plus an honest "Created <date>"
 * line — never a fabricated editor name or "last edited" timestamp. */
export function StatusSection({
  status,
  onStatusChange,
  createdAt,
  disabled,
}: StatusSectionProps) {
  return (
    <section className="admin-card admin-section">
      <h2 className="admin-section-heading">Status</h2>
      <div className="admin-radio-group" role="radiogroup" aria-label="Status">
        {STATUS_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`admin-radio-row ${status === opt.value ? 'admin-radio-row-selected' : ''}`}
          >
            <input
              type="radio"
              name="activity-status"
              value={opt.value}
              checked={status === opt.value}
              disabled={disabled}
              onChange={() => onStatusChange(opt.value)}
            />
            {opt.label}
          </label>
        ))}
      </div>
      {createdAt && (
        <p className="admin-created-line">
          <span className="admin-created-label">Created</span>{' '}
          <span className="admin-created-value">
            {new Date(createdAt).toLocaleDateString()}
          </span>
        </p>
      )}
    </section>
  );
}
