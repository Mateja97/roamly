import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/tokens';

const WIDTH = 30;

// ponytail: design-spec.md T3 calls for `mask-image: linear-gradient(90deg,
// #000 0,#000 calc(100% - 30px),transparent)` on the category row / subtype
// rail's trailing edge — a true alpha mask, but `mask-image` isn't a React
// Native style property (it's CSS, and only react-native-web would even
// attempt to pass it through, inconsistently across platforms). Substitutes
// the native RN equivalent for a fade against a known solid background: an
// opaque `--bg` -> transparent gradient strip overlaid on the trailing edge —
// same visual result (content "fades" before the hard edge) without an
// unsupported style property. Upgrade path: a real alpha mask (MaskedView)
// if a non-solid background ever sits behind this row. Shared by CategoryRow
// and SubtypeRail (2 call sites).
export function EdgeFade() {
  return (
    <LinearGradient
      colors={[`${colors.bg}00`, colors.bg]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.fade}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  fade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: WIDTH,
  },
});
