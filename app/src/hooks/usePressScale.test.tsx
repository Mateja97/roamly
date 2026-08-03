import { AccessibilityInfo, Animated, Pressable, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { usePressScale } from './usePressScale';

function Harness() {
  const press = usePressScale();
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel="press me"
      >
        <Text>press me</Text>
      </Pressable>
    </Animated.View>
  );
}

describe('usePressScale', () => {
  afterEach(() => jest.restoreAllMocks());

  it('animates to 0.97 on press-in and back to 1 on press-out', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const timingSpy = jest.spyOn(Animated, 'timing');
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'press me' });

    await act(async () => {
      fireEvent(button, 'pressIn');
    });
    expect(timingSpy).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: 0.97, duration: 120 })
    );

    await act(async () => {
      fireEvent(button, 'pressOut');
    });
    expect(timingSpy).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: 1, duration: 120 })
    );
  });

  it('reduced motion sets the value instantly instead of animating', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const timingSpy = jest.spyOn(Animated, 'timing');
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'press me' });

    await act(async () => {
      fireEvent(button, 'pressIn');
    });
    expect(timingSpy).not.toHaveBeenCalled();
  });
});
