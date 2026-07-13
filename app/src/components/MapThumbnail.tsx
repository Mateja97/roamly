import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { MapPinOff } from 'lucide-react-native';
import type { Location } from '../api/activities';
import { hasMapsKey, hasValidCoordinates, staticMapUrl } from '../api/staticMap';
import { colors, radius } from '../theme/tokens';
import { Skeleton } from './Skeleton';

const SIZE = 72;

type MapThumbnailProps = {
  location: Location | undefined;
};

// DESIGN_STANDARDS.md's Activity card recipe, Map thumbnail sub-element.
// Degrade rules: no key app-wide → render nothing (keeps text location, no
// wall of placeholders across the list); missing/invalid coords or a broken
// image request, per-card → a reserved placeholder box so every card keeps a
// uniform location-row height. Decorative (the marker is baked into the
// image), so it's excluded from the card's accessibility label.
export function MapThumbnail({ location }: MapThumbnailProps) {
  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'broken'>('loading');

  if (!hasMapsKey()) return null;

  if (!hasValidCoordinates(location) || imageState === 'broken') {
    return (
      <View style={[styles.box, styles.placeholder]}>
        <MapPinOff size={20} color={colors.textMuted} strokeWidth={1.75} />
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Image
        testID="map-thumbnail-image"
        source={{ uri: staticMapUrl(location, SIZE) }}
        style={styles.image}
        onLoad={() => setImageState('loaded')}
        onError={() => setImageState('broken')}
        accessibilityIgnoresInvertColors
      />
      {imageState === 'loading' && <Skeleton width={SIZE} height={SIZE} style={styles.skeleton} />}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.default,
    overflow: 'hidden',
    backgroundColor: colors.surfaceHover,
  },
  image: {
    width: SIZE,
    height: SIZE,
  },
  skeleton: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
