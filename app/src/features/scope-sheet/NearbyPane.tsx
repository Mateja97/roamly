import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { useFocusable } from '../../hooks/useFocusable';
import { Spinner } from '../../components/Spinner';
import { NEARBY_RADIUS_KM } from '../activity-list/filters';
import type { NearbyLocationState } from '../../hooks/useNearbyLocation';
import type { ScopeDraft } from './scopeDraft';
import { scopeSheetStyles } from './scopeSheetStyles';

export type NearbyPaneProps = {
  coordinates: ScopeDraft['coordinates'];
  nearbyState: NearbyLocationState;
  onTurnOnLocation: () => void;
};

// design-spec.md T2's three Nearby panes: granted / not-yet-asked / denied.
// `coordinates` present is the "granted" signal (either resolved by this
// sheet or handed in already-anchored by the caller). `unavailable` (GPS fix
// failed after permission was already granted) gets its own branch below,
// matching ScopePickerScreen's exact copy for this same case, rather than
// silently falling through to the neutral not-yet-asked explainer with no
// feedback at all.
export function NearbyPane({ coordinates, nearbyState, onTurnOnLocation }: NearbyPaneProps) {
  const busy = nearbyState.status === 'requesting-permission' || nearbyState.status === 'locating';
  const buttonFocus = useFocusable();

  if (coordinates) {
    return (
      <View style={scopeSheetStyles.section}>
        <Text style={scopeSheetStyles.sectionLabel}>Range</Text>
        <View
          style={styles.rangeCard}
          accessible
          accessibilityLabel={`Range: within ${NEARBY_RADIUS_KM} km, fixed range around your location`}
        >
          <MapPin size={20} color={colors.primary} strokeWidth={1.75} />
          <View style={styles.rangeTextColumn}>
            <Text style={styles.rangeTitle}>Within {NEARBY_RADIUS_KM} km</Text>
            <Text style={styles.rangeSubtitle}>Fixed range around your location</Text>
          </View>
          <View style={styles.fixedBadge}>
            <Text style={styles.fixedBadgeLabel}>Fixed</Text>
          </View>
        </View>
      </View>
    );
  }

  if (nearbyState.status === 'denied') {
    return (
      <View style={scopeSheetStyles.section}>
        <Text style={styles.paneText}>
          Location access is off, so we can&apos;t show what&apos;s nearby. Turn it on in Settings, or use Anywhere instead.
        </Text>
        <Pressable
          onPress={() => Linking.openSettings()}
          onFocus={buttonFocus.onFocus}
          onBlur={buttonFocus.onBlur}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          style={[styles.secondaryButton, buttonFocus.focused && styles.secondaryButtonFocused]}
        >
          <Text style={styles.secondaryButtonLabel}>Open settings</Text>
        </Pressable>
      </View>
    );
  }

  if (nearbyState.status === 'unavailable') {
    return (
      <View style={scopeSheetStyles.section}>
        <Text style={styles.paneText}>We couldn&apos;t get your current location. Try again, or choose Anywhere instead.</Text>
        <Pressable
          onPress={onTurnOnLocation}
          onFocus={buttonFocus.onFocus}
          onBlur={buttonFocus.onBlur}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={[styles.secondaryButton, buttonFocus.focused && styles.secondaryButtonFocused]}
        >
          <Text style={styles.secondaryButtonLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={scopeSheetStyles.section}>
      <Text style={styles.paneText}>See what&apos;s nearby without typing a thing.</Text>
      <Pressable
        onPress={onTurnOnLocation}
        onFocus={buttonFocus.onFocus}
        onBlur={buttonFocus.onBlur}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={busy ? 'Requesting location' : 'Turn on location'}
        style={[styles.secondaryButton, buttonFocus.focused && styles.secondaryButtonFocused]}
      >
        {busy && <Spinner />}
        <Text style={styles.secondaryButtonLabel}>{busy ? 'Requesting…' : 'Turn on location'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  paneText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: fontSize.sm * 1.45,
  },
  rangeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopColor: colors.cardHighlight,
    borderRadius: radius.default,
    padding: space[4],
  },
  rangeTextColumn: {
    flex: 1,
  },
  rangeTitle: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '600',
  },
  rangeSubtitle: {
    marginTop: space[1],
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  fixedBadge: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingVertical: space[1],
    paddingHorizontal: space[2],
  },
  fixedBadgeLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.default,
    paddingHorizontal: space[6],
    alignSelf: 'flex-start',
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  secondaryButtonFocused: {
    backgroundColor: colors.surfaceHover,
    borderColor: colors.primary,
  },
  secondaryButtonLabel: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
});
