import type { ActivityStatus } from '../../api/adminActivities';

/** The 12-category taxonomy from BUSINESS_STANDARDS.md; wire values match
 * backend/shared/models/activitiessvc.Category's string consts. */
export const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'restaurants', label: 'Restaurants' },
  { value: 'cafes', label: 'Cafés' },
  { value: 'bars', label: 'Bars' },
  { value: 'nightlife', label: 'Nightlife' },
  { value: 'nature', label: 'Nature' },
  { value: 'sport', label: 'Sport' },
  { value: 'kids', label: 'Kids' },
  { value: 'culture', label: 'Culture' },
  { value: 'art', label: 'Art' },
  { value: 'wellness', label: 'Wellness' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'entertainment', label: 'Entertainment' },
];

export const STATUS_CHIPS: { value: ActivityStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Drafts' },
  { value: 'pending', label: 'Pending' },
];

/** Shared status-pill label + CSS class per status — used by the
 * activities table row and the edit form header's read-out pill. */
export const STATUS_PILL: Record<
  ActivityStatus,
  { label: string; className: string }
> = {
  published: { label: 'Published', className: 'admin-pill-published' },
  draft: { label: 'Draft', className: 'admin-pill-draft' },
  pending: { label: 'Pending', className: 'admin-pill-pending' },
};

export const DEFAULT_PAGE_SIZE = 20;
