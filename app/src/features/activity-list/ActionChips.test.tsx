import { fireEvent, render, screen } from '@testing-library/react-native';
import { ActionChips } from './ActionChips';
import type { ActionChipItem } from './ActionChips';

describe('ActionChips', () => {
  it('renders nothing when there are zero items (absent action is dropped, row omits below 1 chip)', () => {
    const { toJSON } = render(<ActionChips items={[]} />);
    expect(toJSON()).toBeNull();
  });

  it('renders an icon + label chip for each item and calls onPress when tapped', () => {
    const onPress = jest.fn();
    const items: ActionChipItem[] = [{ kind: 'directions', onPress }];
    render(<ActionChips items={items} />);
    const chip = screen.getByRole('button', { name: 'Directions' });
    expect(chip).toBeTruthy();
    fireEvent.press(chip);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('caps at 4 chips even when given all 5 kinds', () => {
    const items: ActionChipItem[] = [
      { kind: 'directions', onPress: jest.fn() },
      { kind: 'website', onPress: jest.fn() },
      { kind: 'call', onPress: jest.fn() },
      { kind: 'share', onPress: jest.fn() },
      { kind: 'menu', onPress: jest.fn() },
    ];
    render(<ActionChips items={items} />);
    expect(screen.getByRole('button', { name: 'Directions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Website' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Call' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull();
  });
});
