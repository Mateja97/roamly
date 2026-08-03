import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Activity } from '../../api/activities';
import { ActivityCard, ActivityCardSkeleton } from '../../components/ActivityCard';
import { fontFamily, fontSize, colors, space } from '../../theme/tokens';

const CARD_WIDTH = 260;
const SKELETON_COUNT = 3;

export type TravelerRowState = { status: 'loading' } | { status: 'loaded'; activities: Activity[] } | { status: 'omit' };

type TravelerRowProps = {
  state: TravelerRowState;
  showDistance: boolean;
  onPressActivity: (activity: Activity) => void;
};

// design-spec.md T3: traveler mode's "one curated row above the list (Top
// experiences here: Tours & Experiences + Culture)". Reuses `ActivityCard`
// exactly as it ships (per its own "unchanged" acceptance criterion) inside
// a horizontal ScrollView instead of the main vertical FlatList — no new
// card variant. Silently omitted on error/empty, same as the Fact chip
// grid's "no skeleton for a grid that may never fill, no error banner for a
// bonus section" precedent — this is a decorative highlight row, not a
// primary content region with its own error UI.
export function TravelerRow({ state, showDistance, onPressActivity }: TravelerRowProps) {
  if (state.status === 'omit') return null;
  if (state.status === 'loaded' && state.activities.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Top experiences here</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {state.status === 'loading'
          ? Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <View key={i} style={styles.cardWrap}>
                <ActivityCardSkeleton />
              </View>
            ))
          : state.activities.map((activity) => (
              <View key={activity.id} style={styles.cardWrap}>
                <ActivityCard activity={activity} showDistance={showDistance} onPress={() => onPressActivity(activity)} />
              </View>
            ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[2],
  },
  heading: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.lg,
    color: colors.text,
  },
  row: {
    gap: space[3],
    paddingRight: space[4],
  },
  cardWrap: {
    width: CARD_WIDTH,
  },
});
