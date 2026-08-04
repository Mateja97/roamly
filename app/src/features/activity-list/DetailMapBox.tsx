import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { MapPinOff } from 'lucide-react-native';
import type { Activity } from '../../api/activities';
import {
  hasMapsKey,
  hasValidCoordinates,
  staticMapUrl,
} from '../../api/staticMap';
import { Skeleton } from '../../components/Skeleton';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, radius } from '../../theme/tokens';

const DETAIL_MAP_WIDTH = 600;
const DETAIL_MAP_HEIGHT = 400; // 3:2, per the map box's reserved aspect ratio.

type DetailMapBoxProps = {
  activity: Activity;
  onPress: () => void;
  disabled: boolean;
};

// design-spec.md's "Map + address" slot (§B11): existing, unchanged —
// extracted to a function only so Tours' "Meeting point" section (below)
// can render the same box in its own position instead of the generic
// bottom spot (design-import mockup: "Tours replaces this with its own
// Meeting point map"). Every other category still calls this once, at the
// same bottom position it always has.
export function DetailMapBox({ activity, onPress, disabled }: DetailMapBoxProps) {
  const mapFocus = useFocusable();
  const [mapState, setMapState] = useState<'loading' | 'loaded' | 'broken'>(
    'loading',
  );
  if (!hasMapsKey()) return null;
  return (
    <Pressable
      onPress={onPress}
      onFocus={mapFocus.onFocus}
      onBlur={mapFocus.onBlur}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Open in Google Maps"
      style={[styles.mapBox, mapFocus.focused && styles.mapBoxFocused]}
    >
      {hasValidCoordinates(activity.location) && mapState !== 'broken' ? (
        <>
          <Image
            testID="activity-detail-map-image"
            source={{
              uri: staticMapUrl(activity.location, DETAIL_MAP_WIDTH, DETAIL_MAP_HEIGHT),
            }}
            style={styles.image}
            contentFit="cover"
            cachePolicy="memory-disk"
            accessibilityIgnoresInvertColors
            onLoad={() => setMapState('loaded')}
            onError={() => setMapState('broken')}
          />
          {mapState === 'loading' && (
            <Skeleton width="100%" height="100%" style={styles.imageSkeleton} />
          )}
        </>
      ) : (
        <View style={styles.imageFallback}>
          <MapPinOff size={20} color={colors.textMuted} strokeWidth={1.75} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mapBox: {
    width: '100%',
    aspectRatio: 3 / 2,
    borderRadius: radius.default,
    overflow: 'hidden',
    backgroundColor: colors.surfaceHover,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  mapBoxFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageSkeleton: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
