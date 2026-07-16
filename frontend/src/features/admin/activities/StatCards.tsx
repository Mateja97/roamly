import type { AdminActivityStats } from '../../../api/adminActivities';

export type StatCardsState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'loaded'; stats: AdminActivityStats };

const CARDS: {
  key: keyof AdminActivityStats;
  label: string;
  colorClass: string;
}[] = [
  { key: 'total', label: 'Total', colorClass: 'admin-stat-value-total' },
  {
    key: 'published',
    label: 'Published',
    colorClass: 'admin-stat-value-published',
  },
  { key: 'draft', label: 'Drafts', colorClass: 'admin-stat-value-draft' },
  { key: 'pending', label: 'Pending', colorClass: 'admin-stat-value-pending' },
];

/** The four stat cards, bound to the API's global `stats` object (not the
 * filtered page). Loading shows a skeleton bar at the value's footprint;
 * error shows an em-dash rather than a stale/zero number — the table's own
 * error banner carries the actual message. */
export function StatCards({ state }: { state: StatCardsState }) {
  return (
    <div className="admin-stat-cards">
      {CARDS.map(({ key, label, colorClass }) => (
        <div className="admin-stat-card" key={key}>
          <span className="admin-stat-label">{label}</span>
          {state.kind === 'loading' && (
            <span
              className="admin-skeleton admin-stat-skeleton"
              aria-hidden="true"
            />
          )}
          {state.kind === 'error' && (
            <span className="admin-stat-value admin-stat-value-error">—</span>
          )}
          {state.kind === 'loaded' && (
            <span className={`admin-stat-value ${colorClass}`}>
              {state.stats[key]}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
