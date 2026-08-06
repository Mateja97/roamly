import { StyleSheet, Text, View } from 'react-native';
import { MapPin } from 'lucide-react-native';
import type { Activity } from '../../api/activities';
import { colors, fontSize, space } from '../../theme/tokens';
import type {
  BodySection,
  FactChip,
  UniqueSectionData,
} from './activityDetailConfig';
import { DetailMapBox } from './DetailMapBox';
import { DifficultyMeter } from './DifficultyMeter';
import {
  DescriptionSkeleton,
  UniqueSectionSkeleton,
} from './DetailSkeletons';
import { FactStrip } from './FactStrip';
import { ProseBlock } from './ProseBlock';
import { UniqueSection, sectionHeadingStyle } from './UniqueSection';

type DetailBodyProps = {
  section: BodySection;
  activity: Activity;
  isPlacesLive: boolean;
  detailsPending: boolean;
  descriptionPending: boolean;
  fields: FactChip[];
  unique: UniqueSectionData | undefined;
  goodToKnow: UniqueSectionData | undefined;
  toursChecklist: UniqueSectionData | undefined;
  toursItineraryData: UniqueSectionData | undefined;
  meetingPointText: string | undefined;
  onMapPress: () => void;
  mapDisabled: boolean;
};

// design-spec.md: per-category body-section order. FactStrip/
// UniqueSection/DifficultyMeter each already render nothing when their
// own data is absent, so this only controls order, not per-section
// omission.
export function DetailBody({
  section,
  activity,
  isPlacesLive,
  detailsPending,
  descriptionPending,
  fields,
  unique,
  goodToKnow,
  toursChecklist,
  toursItineraryData,
  meetingPointText,
  onMapPress,
  mapDisabled,
}: DetailBodyProps) {
  switch (section) {
    case 'description':
      // Only skeleton when the seed description is genuinely empty —
      // never pulse over text the user could already be reading.
      // design-spec.md's "Prose block" slot (§B5): the one legal home
      // for a generated sentence. `descriptionPending` (not the raw
      // `isPlacesLive && detailsPending`) additionally excludes a
      // Tripadvisor-sourced row — see useActivityDetailData.ts's comment —
      // since the live merge never fills a description for one, so the
      // plain gate would skeleton forever and never resolve.
      if (activity.description) {
        return <ProseBlock heading="About" value={activity.description} />;
      }
      return descriptionPending ? <DescriptionSkeleton /> : null;
    case 'difficulty':
      return activity.details?.category === 'sport' &&
        activity.details.difficulty !== undefined ? (
        <DifficultyMeter
          difficulty={activity.details.difficulty}
          inferred={activity.details.difficulty_inferred}
        />
      ) : null;
    case 'factstrip':
      return <FactStrip fields={fields} />;
    case 'unique':
      // design-spec.md's Tours & Experiences composition: "What's
      // included" → "Meeting point" → "Itinerary", three sections sharing
      // this one canonical slot — see `toursChecklist`/`meetingPointText`/
      // `toursItineraryData` above. Every other category keeps the plain
      // single-`UniqueSection` render below, unchanged.
      if (activity.details?.category === 'tours_experiences') {
        if (!toursChecklist && !meetingPointText && !toursItineraryData) return null;
        return (
          <View style={styles.toursUniqueGroup}>
            {toursChecklist && <UniqueSection data={toursChecklist} />}
            {meetingPointText && (
              <View style={styles.toursMeetingPoint}>
                <Text style={sectionHeadingStyle}>Meeting point</Text>
                <DetailMapBox
                  activity={activity}
                  onPress={onMapPress}
                  disabled={mapDisabled}
                />
                <View style={styles.toursMeetingPointAddressRow}>
                  <MapPin size={15} color={colors.textMuted} strokeWidth={1.75} />
                  <Text style={styles.toursMeetingPointAddressText}>{meetingPointText}</Text>
                </View>
              </View>
            )}
            {toursItineraryData && <UniqueSection data={toursItineraryData} />}
          </View>
        );
      }
      return isPlacesLive && detailsPending && !unique ? (
        <UniqueSectionSkeleton category={activity.category} />
      ) : (
        <UniqueSection data={unique} />
      );
    case 'goodtoknow':
      return goodToKnow ? <UniqueSection data={goodToKnow} /> : null;
  }
}

const styles = StyleSheet.create({
  // Tours & Experiences' three-part 'unique' body slot — same top-level
  // rhythm as the other body sections' own space[6] gap.
  toursUniqueGroup: {
    gap: space[6],
  },
  toursMeetingPoint: {
    gap: space[3],
  },
  toursMeetingPointAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  toursMeetingPointAddressText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
});
