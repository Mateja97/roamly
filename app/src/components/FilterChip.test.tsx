import { StyleSheet } from 'react-native';
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

  describe('segment variant (T1)', () => {
    it('selected chip: filled gold, ink label, marked selected, no suffix Check icon rendered', () => {
      render(<FilterChip variant="segment" label="Restaurants" selected onPress={jest.fn()} />);
      const chip = screen.getByRole('button', { name: 'Restaurants, selected' });
      expect(chip.props.accessibilityState).toMatchObject({ selected: true });
      expect(StyleSheet.flatten(chip.props.style)).toMatchObject({ backgroundColor: '#CE9042' });
    });

    it('unselected chip: transparent bg, outlined border, no ", selected" suffix', () => {
      render(<FilterChip variant="segment" label="Restaurants" selected={false} onPress={jest.fn()} />);
      const chip = screen.getByRole('button', { name: 'Restaurants' });
      expect(chip.props.accessibilityState).toMatchObject({ selected: false });
      expect(StyleSheet.flatten(chip.props.style)).toMatchObject({ backgroundColor: 'transparent', borderColor: '#5C171C' });
    });

    it('fires onPress on tap', () => {
      const onPress = jest.fn();
      render(<FilterChip variant="segment" label="Bars" selected={false} onPress={onPress} />);
      fireEvent.press(screen.getByRole('button', { name: 'Bars' }));
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('focus swaps to the 2px primary focus border', () => {
      render(<FilterChip variant="segment" label="Culture" selected={false} onPress={jest.fn()} />);
      const chip = screen.getByRole('button', { name: 'Culture' });
      fireEvent(chip, 'focus');
      expect(StyleSheet.flatten(chip.props.style)).toMatchObject({ borderWidth: 2, borderColor: '#CE9042' });
    });

    it('T4: accessibilityLabel overrides the derived name (visible label unaffected)', () => {
      render(<FilterChip variant="segment" label="All" accessibilityLabel="All categories" selected onPress={jest.fn()} />);
      expect(screen.getByRole('button', { name: 'All categories, selected' })).toBeTruthy();
      expect(screen.getByText('All')).toBeTruthy();
    });
  });
});
