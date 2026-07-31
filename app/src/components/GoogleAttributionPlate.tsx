import { Image } from 'expo-image';
import { ExternalLink, Star } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { GoogleAuthorAttribution, GoogleReview } from '../api/activities';
import { useFocusable } from '../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../theme/tokens';
import { formatReviewDate } from '../utils/date';
import { Skeleton } from './Skeleton';

// T5 stubbed `GoogleAuthorAttribution`/`GoogleReview` here directly (T2
// hadn't landed the backend wire shape yet). T6 wired real data through and
// made `api/activities.ts` their canonical home (same file every other wire
// type — `TripadvisorReview`, `ActivityDetails`, etc. — already lives in);
// re-exported here so existing importers of this file are unaffected. Kept
// camelCase (the shape this component was built and reviewed against,
// mirroring T1's Go `placesmap.Review`/`AuthorAttribution` field-for-field)
// rather than reshaping this already-shipped component to match
// proxy-service's snake_case `googleReviewDTO` wire shape — `toActivity`
// (`api/activities.ts`) is where that reshape belongs, same as
// `toActivityPhotos` already does for photos.
export type { GoogleAuthorAttribution, GoogleReview };

type GoogleAttributionPlateProps = {
  /** `detail` = full block with review rows, `footer` = compact maps-link line. */
  variant: 'detail' | 'footer';
  reviews?: GoogleReview[];
  googleMapsUri?: string;
};

// DESIGN_STANDARDS.md's "Google attribution plate" recipe — required
// wherever live Google Places content renders (T6). Sibling of
// TripadvisorAttributionPlate/PhotoAttributionCaption; compliance rules
// carried as code comments in the same style:
//   - Google Maps branding always visible, never a bare "Google".
//   - Per-review attribution (avatar + name + profile link) never stripped.
//   - The googleMapsUri link renders whenever a googleMapsUri exists.
//   - Review body may be 4-line-clamped; the attribution itself never is.
//   - Photo author credit is delegated to PhotoAttributionCaption, not
//     duplicated here.
export function GoogleAttributionPlate({ variant, reviews = [], googleMapsUri }: GoogleAttributionPlateProps) {
  // Empty state: no reviews and no maps link — render nothing rather than a
  // broken/empty plate on a silent-degrade detail page.
  if (reviews.length === 0 && !googleMapsUri) return null;

  if (variant === 'footer') {
    // footer variant only ever shows the maps link (no reviews) — nothing to
    // render without one. Carries its own Google Maps mark (the one spot
    // this component renders without the detail card's header mark above it).
    if (!googleMapsUri) return null;
    return (
      <View testID="google-attribution-plate-footer" style={styles.mark16Row}>
        <GoogleMapsMark height={16} />
        <MapsLink googleMapsUri={googleMapsUri} />
      </View>
    );
  }

  return (
    <View testID="google-attribution-plate-detail" style={styles.card}>
      <View accessible accessibilityRole="header" accessibilityLabel="Reviews from Google Maps">
        <GoogleMapsMark height={18} />
      </View>
      {reviews.map((review, index) => (
        <ReviewRow key={review.authorAttribution.uri + index} review={review} hairline={index > 0} />
      ))}
      {googleMapsUri && (
        // No repeated brand mark here — the header above already carries it;
        // this row is just the link (design-spec.md's "Maps link (block footer)").
        <View style={reviews.length > 0 && styles.hairlineAbove}>
          <MapsLink googleMapsUri={googleMapsUri} />
        </View>
      )}
    </View>
  );
}

// Google Maps branding is mandatory here — the literal words "Google Maps"
// (never a bare "Google"), never hidden/obscured/restyled away. Plain text,
// no icon: a generic (non-Google) pin glyph next to the words would read as
// an invented pseudo-lockup — exactly the "unofficial redraw" risk Google's
// attribution policy exists to avoid. Words alone are a policy-sanctioned
// alternative to a bundled logo asset (product-tasks.md's acceptance
// criteria: "logo or the literal words 'Google Maps'").
// ponytail: no bundled SVG asset (unlike TripadvisorLogo.tsx) — sourcing an
// accurate copy of Google's actual brand mark is out of scope here; swap in
// the real bundled asset if/when one is sourced, per DESIGN_STANDARDS.md.
function GoogleMapsMark({ height }: { height: number }) {
  // `height` doubles as the literal font size (not one of tokens.ts's
  // fontSize steps — 18px/16px don't land on that scale) so the rendered
  // size always matches exactly what DESIGN_STANDARDS.md documents per
  // call site (detail 18px, footer 16px) — no separate mapping to drift
  // out of sync with the doc again.
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[styles.markText, { fontSize: height }]}>Google Maps</Text>
    </View>
  );
}

function ReviewRow({ review, hairline }: { review: GoogleReview; hairline: boolean }) {
  const focus = useFocusable();
  const { authorAttribution, rating, text, date } = review;

  return (
    <View testID="google-review-row" style={[styles.reviewRow, hairline && styles.hairlineAbove]}>
      <View style={styles.authorRow}>
        <Pressable
          onPress={() => {
            Linking.openURL(authorAttribution.uri).catch(() => {
              // ponytail: matches PhotoAttributionCaption's waiver — a dead
              // profile link is silently swallowed, not a general no-op.
            });
          }}
          onFocus={focus.onFocus}
          onBlur={focus.onBlur}
          accessibilityRole="link"
          accessibilityLabel={`Review by ${authorAttribution.displayName} on Google Maps`}
          style={({ pressed }) => [
            styles.profileLink,
            pressed && styles.pressedDip,
            focus.focused && styles.profileLinkFocused,
          ]}
        >
          <ReviewAvatar photoUri={authorAttribution.photoUri} displayName={authorAttribution.displayName} />
          <View style={styles.nameColumn}>
            <Text style={styles.authorName}>{authorAttribution.displayName}</Text>
            {/* formatReviewDate reformats an ISO timestamp (T1's raw
                PublishTime); an already-human string that doesn't parse as
                a Date (e.g. a relative "a month ago") passes through as-is. */}
            <Text style={styles.reviewDate}>{formatReviewDate(date) ?? date}</Text>
          </View>
        </Pressable>
        <View style={styles.ratingGroup}>
          <Star size={14} color={colors.primary} fill={colors.primary} />
          <Text style={styles.ratingNumber}>{rating.toFixed(1)}</Text>
        </View>
      </View>
      {/* Review body may be truncated (compliance allows it) — only the
          attribution above (branding/name/links) must never be. */}
      <Text style={styles.reviewText} numberOfLines={4}>
        {text}
      </Text>
    </View>
  );
}

function ReviewAvatar({ photoUri, displayName }: { photoUri?: string; displayName: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(photoUri ? 'loading' : 'error');
  const initial = (displayName.trim().charAt(0) || '?').toUpperCase();

  return (
    <View style={styles.avatarBox}>
      {status === 'loading' && <Skeleton width={32} height={32} style={styles.avatarRadius} />}
      {status === 'error' && (
        <View style={[styles.avatarFallback, styles.avatarRadius]}>
          <Text style={styles.avatarInitial}>{initial}</Text>
        </View>
      )}
      {photoUri && status !== 'error' && (
        <Image
          testID="google-review-avatar"
          source={{ uri: photoUri }}
          style={[styles.avatarImage, styles.avatarRadius, status === 'loading' && styles.avatarImageHidden]}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  );
}

function MapsLink({ googleMapsUri }: { googleMapsUri: string }) {
  const focus = useFocusable();
  return (
    <Pressable
      onPress={() => {
        Linking.openURL(googleMapsUri).catch(() => {
          // ponytail: matches PhotoAttributionCaption's waiver — a dead
          // maps link is silently swallowed, not a general no-op.
        });
      }}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      accessibilityRole="link"
      accessibilityLabel="View on Google Maps"
      style={({ pressed }) => [
        styles.mapsLinkRow,
        pressed && styles.pressedDip,
        focus.focused && styles.mapsLinkFocused,
      ]}
    >
      <Text style={styles.mapsLinkText}>View on Google Maps</Text>
      <ExternalLink size={16} color={colors.text} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 1,
    borderTopColor: colors.cardHighlight,
    borderRadius: radius.default,
    padding: space[4],
    gap: space[3],
  },
  mark16Row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  markText: {
    fontWeight: '600',
    color: colors.text,
  },
  reviewRow: {
    gap: space[2],
  },
  hairlineAbove: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space[3],
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space[2],
  },
  profileLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    flex: 1,
    minHeight: 44,
    borderRadius: radius.default,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  profileLinkFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  // design-spec.md's link press state: brief opacity dip. A plain style
  // value (not an Animated timing) — matches HeroCarousel.tsx's pressedDip,
  // which is instant either way and so already satisfies the
  // prefers-reduced-motion "instant" fallback without a separate branch.
  pressedDip: {
    opacity: 0.7,
  },
  avatarBox: {
    width: 32,
    height: 32,
  },
  avatarRadius: {
    borderRadius: 16,
  },
  avatarImage: {
    position: 'absolute',
    width: 32,
    height: 32,
  },
  avatarImageHidden: {
    opacity: 0,
  },
  avatarFallback: {
    width: 32,
    height: 32,
    backgroundColor: colors.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: '600',
  },
  nameColumn: {
    flexShrink: 1,
  },
  authorName: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
    textDecorationLine: 'underline',
  },
  reviewDate: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  ratingGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  ratingNumber: {
    fontSize: fontSize.xs,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  reviewText: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: fontSize.sm * 1.5,
  },
  mapsLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: 44,
    borderRadius: radius.default,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  mapsLinkFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  mapsLinkText: {
    fontSize: fontSize.sm,
    color: colors.text,
    textDecorationLine: 'underline',
  },
});
