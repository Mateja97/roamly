import { fireEvent, render, screen } from '@testing-library/react-native';
import { FilterChip } from './FilterChip';

describe('FilterChip', () => {
  it('select variant fires onPress and exposes selected state', () => {
    const onPress = jest.fn();
    render(<FilterChip variant="select" label="Sports" selected onPress={onPress} />);
    const chip = screen.getByRole('button', { name: /sports, selected/i });
    fireEvent.press(chip);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('unselected select-variant chip has no ", selected" suffix', () => {
    render(<FilterChip variant="select" label="Sports" selected={false} onPress={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Sports' })).toBeTruthy();
  });

  it('remove variant announces "Remove <label> filter" and fires onPress', () => {
    const onPress = jest.fn();
    render(<FilterChip variant="remove" label="Food & Drink" onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: /remove food & drink filter/i }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
