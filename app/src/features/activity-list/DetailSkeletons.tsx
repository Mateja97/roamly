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

// design-spec.md's Fact strip row: "2 or 3 ... the count that category's
// fact-strip config can actually produce, never more than 3" — mirrors
// activityDetailConfig.ts's factStripFields per-category chip count
// (frontend-only knowledge; whether the live mapper currently fills a given
// chip is a separate, backend-side concern this table doesn't try to guess).
const FACT_STRIP_CHIP_COUNT: Record<Category, number> = {
  restaurants: 0,
  bars: 0,
  cafes: 3,
  nightlife: 3,
  nature: 3,
  sport: 3,
  kids: 0,
  culture: 3,
  art: 3,
  wellness: 0,
  shopping: 3,
  entertainment: 0,
  tours_experiences: 0,
};

export function factStripSkeletonCount(category: Category): number {
  return FACT_STRIP_CHIP_COUNT[category] ?? 0;
}

// design-spec.md's unique-section shape table — mirrors
// activityDetailConfig.ts's uniqueSection per-category shape 1:1 (the shape
// is fixed per category; only whether it has data is unknown pre-fetch).
type UniqueShape = 'nameprice' | 'pills' | 'checklist' | 'icongrid' | 'banner' | 'schedule-compact' | 'schedule-dateblock';

const UNIQUE_SHAPE_BY_CATEGORY: Partial<Record<Category, UniqueShape>> = {
  cafes: 'nameprice',
  shopping: 'pills',
  nature: 'checklist',
  sport: 'checklist',
  kids: 'icongrid',
  culture: 'banner',
  art: 'banner',
  nightlife: 'schedule-compact',
  wellness: 'schedule-compact',
  entertainment: 'schedule-dateblock',
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

// "Fact strip" row: 2 or 3 equal-flex 90px-tall blocks, --space-3 apart —
// mirrors FactStrip.tsx's own `row`/`chip` layout. Renders nothing when this
// category's fact strip can never produce a chip (kids/wellness/entertainment).
export function FactStripSkeleton({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View testID="fact-strip-skeleton" style={styles.factStripRow}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} width="100%" height={90} style={styles.flexItem} />
      ))}
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

// "Unique section heading + body": one 40%x20px heading bar (omitted for the
// banner shape, which draws no heading), then the shape-specific body below.
// Renders nothing for a category with no unique-section shape at all.
export function UniqueSectionSkeleton({ category }: { category: Category }) {
  const shape = UNIQUE_SHAPE_BY_CATEGORY[category];
  if (!shape) return null;
  return (
    <View testID="unique-section-skeleton" style={styles.uniqueWrap}>
      {shape !== 'banner' && <Skeleton width="40%" height={20} />}
      <UniqueBodySkeleton shape={shape} />
    </View>
  );
}

function UniqueBodySkeleton({ shape }: { shape: UniqueShape }) {
  switch (shape) {
    case 'checklist':
      // 3 bars, 20px tall, --space-3 apart; widths 90/100/65%.
      return (
        <View testID="unique-body-checklist" style={styles.checklistBody}>
          <Skeleton width="90%" height={20} />
          <Skeleton width="100%" height={20} />
          <Skeleton width="65%" height={20} />
        </View>
      );
    case 'nameprice':
      // 3 rows, --space-6 pitch, container padded --space-3 top/bottom
      // (~132px total); each row: a left 60%x20px bar, a right 48x20px bar.
      return (
        <View testID="unique-body-nameprice" style={styles.namePriceBody}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.namePriceRow}>
              <Skeleton width="60%" height={20} />
              <Skeleton width={48} height={20} />
            </View>
          ))}
        </View>
      );
    case 'pills':
      // 3 pill blocks in one row, 38px tall, full radius, --space-2 apart;
      // widths 88/116/72px.
      return (
        <View testID="unique-body-pills" style={styles.pillsBody}>
          <Skeleton width={88} height={38} style={styles.pillRadius} />
          <Skeleton width={116} height={38} style={styles.pillRadius} />
          <Skeleton width={72} height={38} style={styles.pillRadius} />
        </View>
      );
    case 'icongrid':
      // 4 cells, 2 per row, each 47% wide x 82px tall, lg radius, --space-3
      // row/column gap.
      return (
        <View testID="unique-body-icongrid" style={styles.iconGridBody}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} width="47%" height={82} style={styles.iconGridRadius} />
          ))}
        </View>
      );
    case 'banner':
      // One block, 100% x 100px; no heading bar above it (caller omits it).
      return (
        <View testID="unique-body-banner">
          <Skeleton width="100%" height={100} />
        </View>
      );
    case 'schedule-compact':
      // Same rows as the name+price list, plus a 52x20px leading bar in
      // each row (leading / main / trailing).
      return (
        <View testID="unique-body-schedule-compact" style={styles.namePriceBody}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.scheduleCompactRow}>
              <Skeleton width={52} height={20} />
              <Skeleton width="60%" height={20} />
              <Skeleton width={48} height={20} />
            </View>
          ))}
        </View>
      );
    case 'schedule-dateblock':
      // 2 cards, 100% x 70px, --space-3 apart.
      return (
        <View testID="unique-body-schedule-dateblock" style={styles.dateBlockBody}>
          <Skeleton width="100%" height={70} />
          <Skeleton width="100%" height={70} />
        </View>
      );
  }
}

// "Reviews / attribution block" pending state: the Google attribution
// plate's own card chrome renders for real (so the arriving plate doesn't
// re-frame itself), with placeholders standing in for its contents — brand
// mark bar, two review groups (author row + 3-line body), maps-link bar.
// Two groups, not five: the card promises "reviews are coming", not a count.
export function ReviewsSkeleton() {
  return (
    <View testID="reviews-skeleton" style={styles.reviewsCard}>
      <Skeleton width={96} height={18} />
      <ReviewGroupSkeleton />
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
  factStripRow: {
    flexDirection: 'row',
    gap: space[3],
  },
  flexItem: {
    flex: 1,
  },
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
  namePriceBody: {
    gap: space[6],
    paddingVertical: space[3],
  },
  namePriceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  scheduleCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  pillsBody: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  pillRadius: {
    borderRadius: radius.full,
  },
  iconGridBody: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[3],
  },
  iconGridRadius: {
    borderRadius: radius.lg,
  },
  dateBlockBody: {
    gap: space[3],
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
