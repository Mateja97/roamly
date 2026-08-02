import { StyleSheet, View } from 'react-native';
import { Skeleton } from '../../components/Skeleton';
import { colors, radius, space } from '../../theme/tokens';
import type { Category } from './types';

// design-spec.md's T6 "Detail screen skeleton states" — per-block loading
// placeholders for the Places-backed body while ActivityDetailScreen's live
// getActivity(id) fetch is pending. Every block below composes the existing
// Skeleton pulse primitive only (no new pulse/loading mechanism) — this
// file just fixes where placeholders go and how big they are, per the
// design spec's geometry table.
//
// T11 investigation, no code change: the spec's Screen-level Loading state
// reads "hero, title, and stat-grid skeletons only." No stat-grid skeleton
// exists here (an earlier `FactStripSkeleton` + `FACT_STRIP_CHIP_COUNT`
// table were deleted in T4's own resolve pass, confirmed dead at the time —
// their render guard could never evaluate true). Re-checked against
// `backend/activities-service/internal/placesmap/placesmap.go`'s
// `BuildLiveDetails` (the one function that can ever populate a Places-live
// category's `details` before this screen's stat grid reads it): for every
// one of the 10 Places-sourced categories, it fills at most one field this
// screen's `factStripFields` (activityDetailConfig.ts) treats as a stat-grid
// chip (culture/art/shopping's `venue_type` → the Venue chip; every other
// category gets none at all). `FactStrip` needs ≥2 valid chips to render a
// grid at all (1 folds into the meta line, 0 omits) — so a stat-grid
// skeleton would always resolve to nothing, the exact case this same
// design rule forbids ("a skeleton that resolves to nothing is worse than a
// shorter page"). Not reviving `FACT_STRIP_CHIP_COUNT`/`FactStripSkeleton`
// stays correct, not a gap — recorded here so a future editor doesn't
// re-litigate T4's deletion from the spec's literal wording alone.

// The 10 Google-Places-sourced categories T1's live mapper covers, mirrored
// 1:1 (backend/activities-service/internal/placesmap's BuildLiveDetails).
// Restaurants/bars are Tripadvisor-sourced and never skeletoned here —
// their content (TripadvisorBlock) is already synchronous from seed.
export const PLACES_LIVE_CATEGORIES: ReadonlySet<Category> = new Set([
  'cafes',
  'nightlife',
  'nature',
  'sport',
  'kids',
  'culture',
  'art',
  'wellness',
  'shopping',
  'entertainment',
]);

// design-spec.md's unique-section shape table, narrowed by rule 2: only a
// category whose live mapper can actually fill its unique-section field
// gets a placeholder. Per T1's engineering-notes.md, the mapper only ever
// emits `good_to_know` (nature) and `facilities` (kids) among the fields
// `uniqueSection` (activityDetailConfig.ts) reads — every other category's
// unique-section field (`on_the_bar`, `lineup`, `what_to_bring`,
// `now_showing`, `current_exhibition`, `treatments`, `what_youll_find`,
// `upcoming_shows`) is never in the mapper's output, and T4 already wiped
// any stored copy, so skeletoning them would be a guaranteed
// flash-then-collapse — the exact case rule 2 forbids. cafes' mapper output
// (`known_for`) doesn't even correspond to a field on the app's cafes
// `ActivityDetails` type (`on_the_bar` is name/price pairs, not an amenity
// list), so it's excluded too, not just narrowed.
type UniqueShape = 'checklist' | 'icongrid';

const UNIQUE_SHAPE_BY_CATEGORY: Partial<Record<Category, UniqueShape>> = {
  nature: 'checklist',
  kids: 'icongrid',
};

// "Rating value" row: one bar 48x20px, right-aligned in the badge row
// (matches the 16px gold star + 14px rating number cluster it stands in for).
export function RatingSkeleton() {
  return (
    <View testID="rating-skeleton">
      <Skeleton width={48} height={20} />
    </View>
  );
}

// "Description" row: only ever rendered when the seed description is empty
// (the caller's job to gate) — 3 bars, 16px tall, --space-2 apart, wrapped
// in --space-1 top/bottom padding (72px total), widths 100/100/62%.
export function DescriptionSkeleton() {
  return (
    <View testID="description-skeleton" style={styles.descriptionWrap}>
      <Skeleton width="100%" height={16} />
      <Skeleton width="100%" height={16} />
      <Skeleton width="62%" height={16} />
    </View>
  );
}

// "Unique section heading + body": one 40%x20px heading bar, then the
// shape-specific body below. Renders nothing for a category with no
// live-fillable unique-section shape (see UNIQUE_SHAPE_BY_CATEGORY above).
export function UniqueSectionSkeleton({ category }: { category: Category }) {
  const shape = UNIQUE_SHAPE_BY_CATEGORY[category];
  if (!shape) return null;
  return (
    <View testID="unique-section-skeleton" style={styles.uniqueWrap}>
      <Skeleton width="40%" height={20} />
      {shape === 'checklist' ? (
        // 3 bars, 20px tall, --space-3 apart; widths 90/100/65%.
        <View testID="unique-body-checklist" style={styles.checklistBody}>
          <Skeleton width="90%" height={20} />
          <Skeleton width="100%" height={20} />
          <Skeleton width="65%" height={20} />
        </View>
      ) : (
        // 4 cells, 2 per row, each 47% wide x 82px tall, lg radius, --space-3
        // row/column gap.
        <View testID="unique-body-icongrid" style={styles.iconGridBody}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} width="47%" height={82} style={styles.iconGridRadius} />
          ))}
        </View>
      )}
    </View>
  );
}

// "Reviews / attribution block" pending state: the Google attribution
// plate's own card chrome renders for real (so the arriving plate doesn't
// re-frame itself), with placeholders standing in for its contents — brand
// mark bar, three review groups (author row + 3-line body), maps-link bar.
// Three groups per the AC's "3 skeleton review cards" — matches
// `MAX_REVIEW_CARDS` (ActivityDetailScreen.tsx), the cap the real cards land
// on once settled.
export function ReviewsSkeleton() {
  return (
    <View testID="reviews-skeleton" style={styles.reviewsCard}>
      <Skeleton width={96} height={18} />
      <ReviewGroupSkeleton />
      <ReviewGroupSkeleton hairline />
      <ReviewGroupSkeleton hairline />
      <View style={styles.hairlineTop}>
        <Skeleton width={160} height={16} />
      </View>
    </View>
  );
}

function ReviewGroupSkeleton({ hairline }: { hairline?: boolean }) {
  return (
    <View style={[styles.reviewGroup, hairline && styles.hairlineTop]}>
      <View style={styles.reviewAuthorRow}>
        <View style={styles.reviewAuthorLeft}>
          <Skeleton width={32} height={32} style={styles.circle} />
          <Skeleton width={120} height={16} />
          <Skeleton width={56} height={12} />
        </View>
        <Skeleton width={40} height={14} />
      </View>
      <View style={styles.reviewBody}>
        <Skeleton width="100%" height={14} />
        <Skeleton width="100%" height={14} />
        <Skeleton width="70%" height={14} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  descriptionWrap: {
    gap: space[2],
    paddingVertical: space[1],
  },
  uniqueWrap: {
    gap: space[3],
  },
  checklistBody: {
    gap: space[3],
  },
  iconGridBody: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[3],
  },
  iconGridRadius: {
    borderRadius: radius.lg,
  },
  // Mirrors GoogleAttributionPlate.tsx's own `card` style exactly, so the
  // real plate never re-frames itself when the swap happens.
  reviewsCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 1,
    borderTopColor: colors.cardHighlight,
    borderRadius: radius.default,
    padding: space[4],
    gap: space[3],
  },
  reviewGroup: {
    gap: space[2],
  },
  // Shared by the 2nd review group and the maps-link line below — both are
  // "another group, separated from the one above by a hairline".
  hairlineTop: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space[3],
  },
  reviewAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  reviewAuthorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  circle: {
    borderRadius: radius.full,
  },
  reviewBody: {
    gap: space[2],
  },
});
