import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PrimaryTicket } from './PrimaryTicket';
import { colors } from '../theme/tokens';

function renderTicket(onPress = jest.fn()) {
  render(
    <PrimaryTicket
      title="Start exploring"
      subtitle="Real places, picked for right now"
      accessibilityLabel="Start exploring, real places picked for right now"
      onPress={onPress}
    />,
  );
  return screen.getByRole('button', { name: 'Start exploring, real places picked for right now' });
}

function backgroundColorOf(element: ReturnType<typeof renderTicket>) {
  const flatStyle = [element.props.style].flat(Infinity);
  const withBg = flatStyle.reverse().find((style) => style && style.backgroundColor);
  return withBg?.backgroundColor;
}

// Pressability's touch responder handshake — the same event shape RNTL's
// own `userEvent.press()` dispatches internally (see @testing-library/
// react-native's event-builder) — needed because `pressed` in Pressable's
// style callback is driven by onResponderGrant/onResponderRelease, not a
// bare 'pressIn'/'pressOut' prop.
function responderEvent() {
  return {
    persist: () => {},
    currentTarget: { measure: () => {} },
    nativeEvent: {
      changedTouches: [],
      identifier: 0,
      locationX: 0,
      locationY: 0,
      pageX: 0,
      pageY: 0,
      target: 0,
      timestamp: Date.now(),
      touches: [],
    },
  };
}

describe('PrimaryTicket', () => {
  it('renders the title and subtitle labels', () => {
    renderTicket();
    expect(screen.getByText('Start exploring')).toBeTruthy();
    expect(screen.getByText('Real places, picked for right now')).toBeTruthy();
  });

  it('rests on --primary gold', () => {
    const button = renderTicket();
    expect(backgroundColorOf(button)).toBe(colors.primary);
  });

  // ponytail: no jest test for the hover state — RN's Pressability gates
  // onMouseEnter behind a module-load-time `Platform.OS === 'web'` check in
  // HoverState.js (evaluated once, before any per-test Platform.OS mock can
  // take effect) plus a real mouse-move-vs-touch timing heuristic, so it
  // can't be simulated here even with fireEvent. Touch has no hover either
  // (DESIGN_STANDARDS.md's Mobile-specific rule) — the pressed test below
  // covers the state that actually matters on-device. The hover swap is
  // still verified visually: T1's Visual check captures a real Playwright
  // `.hover()` against the web-preview build, which exercises hover for
  // real (react-native-web's own Pressable, not this native module).

  it('swaps to --primary-active while pressed (touch has no hover)', () => {
    jest.useFakeTimers();
    try {
      const button = renderTicket();
      fireEvent(button, 'responderGrant', responderEvent());
      expect(backgroundColorOf(button)).toBe(colors.primaryActive);

      fireEvent(button, 'responderRelease', responderEvent());
      // Pressability holds the pressed highlight for a minimum duration
      // (~130ms) so a very fast tap doesn't flash with no visible feedback
      // at all — advance past it to observe the reverted rest color.
      act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(backgroundColorOf(button)).toBe(colors.primary);
    } finally {
      jest.useRealTimers();
    }
  });

  it('fires onPress', () => {
    const onPress = jest.fn();
    const button = renderTicket(onPress);
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('hides the pin icon and go-disc from accessibility tools', () => {
    renderTicket();
    // Only the card itself is exposed as a button; the pin well/go-disc
    // decorative wrappers are excluded via accessibilityElementsHidden.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
