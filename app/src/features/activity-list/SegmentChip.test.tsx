import { fireEvent, render, screen } from '@testing-library/react-native';
import { SegmentChip } from './SegmentChip';

describe('SegmentChip', () => {
  it('renders selected/unselected accessibility state from the label', () => {
    render(<SegmentChip label="Sport" selected onPress={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Sport, selected' })).toBeTruthy();
  });

  it('an accessibilityLabel override wins over the visible label', () => {
    render(<SegmentChip label="All" accessibilityLabel="All categories" selected={false} onPress={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'All categories' })).toBeTruthy();
  });

  it('tapping calls onPress', () => {
    const onPress = jest.fn();
    render(<SegmentChip label="Sport" selected={false} onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
