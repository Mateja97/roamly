import { StyleSheet, Text, View } from 'react-native';
import { Star } from 'lucide-react-native';
import type { Activity, TripadvisorAttribution } from '../../api/activities';
import { colors, fontFamily, fontSize, space } from '../../theme/tokens';
import type { ArtAttribution } from './activityDetailConfig';
import { metaLineLeadItems } from './activityDetailConfig';
import { RatingSkeleton } from './DetailSkeletons';
import type { openStatus } from './openingHours';
import { MetaLine } from './MetaLine';

type DetailTitleBlockProps = {
  activity: Activity;
  attribution: ArtAttribution | undefined;
  tripadvisor: TripadvisorAttribution | undefined;
  showRatingCluster: boolean;
  ratingSkeletonShown: boolean;
  eyebrow: string | undefined;
  showMetaRow: boolean;
  metaText: string;
  kidsAge: string | undefined;
  metaExtras: string[];
  foldedValue: string | undefined;
  metaChipStatus: ReturnType<typeof openStatus>;
  levelChipText: string | undefined;
};

// design-spec.md's title block: art attribution + rating cluster, the
// eyebrow/title/cuisine-subtitle group, and the meta line — the leading
// run of `styles.titleBlock`'s children, so this returns a fragment and
// the screen's own `gap` keeps spacing them.
export function DetailTitleBlock({
  activity,
  attribution,
  tripadvisor,
  showRatingCluster,
  ratingSkeletonShown,
  eyebrow,
  showMetaRow,
  metaText,
  kidsAge,
  metaExtras,
  foldedValue,
  metaChipStatus,
  levelChipText,
}: DetailTitleBlockProps) {
  return (
    <>
      {/* §5b: the gold-star rating is suppressed for a Tripadvisor row —
          the TripadvisorBlock below carries rating instead (compliance
          rule 03). `attribution` (art's artist/work/medium line) never
          co-occurs with `tripadvisor` (art can't be a Tripadvisor
          category), so the whole group is safely omitted rather than
          left as an empty View + phantom gap. Category noun + subtype
          lead the meta line below instead (see `metaLineLeadItems`), so
          this cluster is rating-only. */}
      {(attribution || (!tripadvisor && showRatingCluster)) && (
        <View style={styles.badgeGroup}>
          {attribution && (
            <Text style={styles.attributionLine}>
              {[
                attribution.artist && <Text key="artist">{attribution.artist}</Text>,
                attribution.workYear && (
                  <Text key="workYear" style={styles.attributionItalic}>
                    {attribution.workYear}
                  </Text>
                ),
                attribution.medium && <Text key="medium">{attribution.medium}</Text>,
              ]
                .filter(Boolean)
                .flatMap((node, i) => (i === 0 ? [node] : [' · ', node]))}
            </Text>
          )}

          {/* "Rating value" — skeletoned only while the live fetch is
              pending and there's no real value we're allowed to show yet
              (rule 1: never pulse over an already-good value; T2's rating
              rule also withholds a Tripadvisor row's stale number until
              `ratingSkeletonShown`'s own gate settles it); once settled
              with no rating (failed/empty merge, or a Tripadvisor row
              never allowed to show one), the whole block collapses (rule
              3: no fabricated "0.0", no empty frame) rather than falling
              back to a fabricated zero. Once the Reviews slot below is
              genuinely showing this same score (`reviewsScoreShown`),
              this cluster stays hidden — one focal rating number, not two
              (folded into `showRatingCluster` above). */}
          {!tripadvisor && showRatingCluster && (
            ratingSkeletonShown ? (
              <View style={styles.rating}>
                <RatingSkeleton />
              </View>
            ) : (
              <View style={styles.rating}>
                <Star
                  size={16}
                  color={colors.primary}
                  strokeWidth={1.75}
                  fill={colors.primary}
                />
                <Text style={styles.ratingLabel}>
                  {activity.rating.toFixed(1)}
                </Text>
              </View>
            )
          )}
        </View>
      )}

      <View style={styles.titleGroup}>
        {eyebrow && <Text style={styles.tripadvisorEyebrow}>{eyebrow}</Text>}
        <Text style={styles.title}>{activity.title}</Text>
        {/* Same shared-wire-object scoping as `tripadvisorEyebrow`'s
            price level: only Restaurants' composition names a cuisine
            subtitle (it's the stand-in for the Cuisine chip
            `factStripFields` drops on Tripadvisor rows). Bars/Cafés
            compositions don't mention it, even though the wire type
            carries `cuisine` for every Tripadvisor-sourced category. */}
        {activity.category === 'restaurants' && tripadvisor?.cuisine && (
          <Text style={styles.tripadvisorCuisineSubtitle}>{tripadvisor.cuisine}</Text>
        )}
      </View>

      {/* design-spec.md's "Meta line" slot (§B1): join-never-prefix,
          one optional status/level chip. Category noun + subtype (from
          the taxonomy-validated `subcategory` slug, never a generated
          field) lead the line via `metaLineLeadItems`; absent for a
          Tripadvisor row (the eyebrow already carries category, per
          §5b). */}
      {showMetaRow && (
        <MetaLine
          // Category noun + subtype (from `subcategory`) lead, ahead of
          // distance/country — all app-computed/taxonomy data, never
          // run through `classifyField` (see MetaLine's `rawItems`).
          // Absent entirely for a Tripadvisor row (its eyebrow above
          // the title already carries category). `foldedValue` also
          // belongs here, not in `items` below — it's already been
          // through `classifyField` once (via `classifyFactChips`) —
          // `rawItems` is the already-final bypass that avoids running
          // it through a second `classifyField` call.
          // Candidate count (category + subtype + one of {kidsAge,
          // metaExtras, foldedValue}) maxes out at 3 for every
          // category, since `factStripFields` returns `[]`
          // unconditionally for Kids and Entertainment —
          // `foldedFactChip` can never be defined when
          // `kidsAge`/`metaExtras` are — so `metaText` (distance/
          // country) is never at risk of overflow and is included
          // unconditionally.
          rawItems={[
            ...(!tripadvisor ? [...metaLineLeadItems(activity), kidsAge, metaText] : []),
            foldedValue,
          ]}
          items={metaExtras}
          // Nightlife's `Open tonight` chip (folded into
          // `metaChipStatus` above) takes priority over, and unlike, the
          // generic status chip is never suppressed by `todayRow` — the
          // mockup shows the chip and HoursRow together, not one
          // replacing the other. Falls through to Tours-only
          // `levelChipText` — the two are mutually exclusive (Tours
          // never has a status/open-tonight chip, see `levelChipText`'s
          // definition above).
          chip={
            metaChipStatus
              ? { kind: 'status', text: metaChipStatus.text, isOpen: metaChipStatus.isOpen }
              : levelChipText
                ? { kind: 'level', text: levelChipText }
                : undefined
          }
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  badgeGroup: {
    gap: space[3],
  },
  attributionLine: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    letterSpacing: 0.24,
  },
  attributionItalic: {
    fontStyle: 'italic',
  },
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  ratingLabel: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  // §5b: wraps eyebrow/title/cuisine-subtitle as one tight cluster — a
  // smaller gap than titleBlock's own space[6] between its top-level
  // sections, matching the mock's close eyebrow→h2→subtitle spacing.
  titleGroup: {
    gap: space[1],
  },
  // §5b: eyebrow (category · price level · distance) — same overline
  // treatment as TripadvisorReviewsCarousel's section label.
  tripadvisorEyebrow: {
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: fontSize.xs * 0.08,
    color: colors.primary,
  },
  tripadvisorCuisineSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: fontSize.sm * 1.5,
  },
  title: {
    // Marcellus loads once, globally, gated by App.tsx's font-load gate —
    // every screen (this one included) applies the token directly (see
    // tokens.ts's fontFamily.display comment).
    fontFamily: fontFamily.display,
    fontSize: fontSize.xl,
    color: colors.text,
    fontWeight: '400',
    lineHeight: fontSize.xl * 1.1,
  },
});
