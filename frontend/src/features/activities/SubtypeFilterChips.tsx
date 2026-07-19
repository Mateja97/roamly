import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { SUBCATEGORIES } from '../admin/constants';
import './SubtypeFilterChips.css';

export interface SubtypeFilterChipsProps {
  /** The host page's currently-selected category filter values. The row
   * renders only when this holds exactly one value — a subtype facet only
   * makes sense scoped to a single category (design-spec.md T2). */
  categories: string[];
  /** Called with the full selected-subtype list on every toggle, and with
   * `[]` whenever the row's own single-category context changes (goes to
   * 0/many categories, or swaps to a different one) — feed straight into
   * the activities query's `subcategories` field. */
  onChange: (subtypes: string[]) => void;
}

/** User-facing subtype filter chips (T2) — multi-select, OR within the
 * field, AND-ed with the single selected category by the caller. No host
 * page consumes this yet (the web frontend is entirely the admin light
 * panel today, see design-spec.md's T2 grounding note); this ships as a
 * standalone, tested unit ready to mount wherever the consumer category
 * filter lands. */
export function SubtypeFilterChips({
  categories,
  onChange,
}: SubtypeFilterChipsProps) {
  const category = categories.length === 1 ? categories[0] : null;
  const [selected, setSelected] = useState<string[]>([]);

  // Orphan-clearing: whenever the single-category context changes (swaps,
  // or goes away entirely), any subtype selection scoped to the old context
  // is stale. `onChange` is deliberately left out of the deps list — it
  // tracks `category` only, so a caller re-render that hands in a fresh
  // inline callback doesn't wrongly re-clear an unrelated selection.
  useEffect(() => {
    setSelected([]);
    onChange([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  if (!category) return null;
  const options = SUBCATEGORIES[category] ?? [];
  if (options.length === 0) return null;

  function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    setSelected(next);
    onChange(next);
  }

  return (
    <div
      className="subtype-filter-row"
      role="group"
      aria-label="Filter by subtype"
    >
      {options.map((opt) => {
        const isSelected = selected.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            className={`subtype-chip ${isSelected ? 'subtype-chip-selected' : ''}`}
            aria-pressed={isSelected}
            onClick={() => toggle(opt.value)}
          >
            {isSelected && (
              <Check size={16} color="var(--primary)" aria-hidden="true" />
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
