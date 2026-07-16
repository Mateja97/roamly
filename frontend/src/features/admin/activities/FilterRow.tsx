import { CATEGORY_OPTIONS, STATUS_CHIPS } from '../constants';

export interface FilterRowProps {
  status: string;
  onStatusChange: (value: string) => void;
  category: string;
  onCategoryChange: (value: string) => void;
  city: string;
  onCityChange: (value: string) => void;
  cityOptions: string[];
}

/** Status chips (single-select) + category/city native selects — every
 * change is server-driven (the caller hits `/admin/activities` again),
 * never client-side filtering of the current page. */
export function FilterRow({
  status,
  onStatusChange,
  category,
  onCategoryChange,
  city,
  onCityChange,
  cityOptions,
}: FilterRowProps) {
  return (
    <div className="admin-filter-row">
      <div
        className="admin-status-chips"
        role="group"
        aria-label="Filter by status"
      >
        {STATUS_CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            className={`admin-chip ${status === chip.value ? 'admin-chip-active' : ''}`}
            aria-pressed={status === chip.value}
            onClick={() => onStatusChange(chip.value)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="admin-filter-spacer" />

      <label className="admin-select-label">
        <span className="sr-only">Category</span>
        <select
          className="admin-select"
          value={category}
          onChange={(e) => onCategoryChange(e.target.value)}
        >
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="admin-select-label">
        <span className="sr-only">City</span>
        <select
          className="admin-select"
          value={city}
          onChange={(e) => onCityChange(e.target.value)}
        >
          <option value="">All cities</option>
          {cityOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
