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

    it('focus swaps the border colour only — width stays the constant 1.5px (design-spec.md T3)', () => {
      render(<FilterChip variant="segment" label="Culture" selected={false} onPress={jest.fn()} />);
      const chip = screen.getByRole('button', { name: 'Culture' });
      fireEvent(chip, 'focus');
      expect(StyleSheet.flatten(chip.props.style)).toMatchObject({ borderWidth: 1.5, borderColor: '#CE9042' });
    });

    it('T4: accessibilityLabel overrides the derived name (visible label unaffected)', () => {
      render(<FilterChip variant="segment" label="All" accessibilityLabel="All categories" selected onPress={jest.fn()} />);
      expect(screen.getByRole('button', { name: 'All categories, selected' })).toBeTruthy();
      expect(screen.getByText('All')).toBeTruthy();
    });

    it('T4 fix: reserves the selected weight-700 label metrics so selecting does not resize the pill (DESIGN_STANDARDS.md:1214-1217)', () => {
      render(<FilterChip variant="segment" label="Restaurants" selected={false} onPress={jest.fn()} />);
      // A hidden weight-700 sizer (same text) renders alongside the visible
      // label to reserve the wider metrics — it's excluded from default
      // a11y-tree queries (accessibilityElementsHidden), same convention as
      // ActivityCard.test.tsx's decorative pills.
      const visibleLabel = screen.getByText('Restaurants');
      expect(StyleSheet.flatten(visibleLabel.props.style)).toMatchObject({ fontWeight: '500' });
      const allLabels = screen.getAllByText('Restaurants', { includeHiddenElements: true });
      const sizerLabel = allLabels.find((el) => el.props.accessibilityElementsHidden);
      expect(StyleSheet.flatten(sizerLabel?.props.style)).toMatchObject({ fontWeight: '700' });
      expect(sizerLabel?.props.accessibilityElementsHidden).toBe(true);
      // The visible label is absolutely positioned over the sizer, so its
      // own weight/size changes on selection can never drive the pill's
      // laid-out box — only the (unchanging) sizer's normal-flow width does.
      expect(StyleSheet.flatten(visibleLabel.props.style)).toMatchObject({ position: 'absolute' });
    });

    it('design-spec.md T3: border width is constant (1.5px) across selected/unselected — a color-only swap', () => {
      const { rerender } = render(<FilterChip variant="segment" label="Restaurants" selected={false} onPress={jest.fn()} />);
      const unselectedChip = screen.getByRole('button', { name: 'Restaurants' });
      expect(StyleSheet.flatten(unselectedChip.props.style)).toMatchObject({
        borderWidth: 1.5,
        borderTopColor: 'rgba(206,144,66,0.45)',
      });

      rerender(<FilterChip variant="segment" label="Restaurants" selected onPress={jest.fn()} />);
      const selectedChip = screen.getByRole('button', { name: 'Restaurants, selected' });
      expect(StyleSheet.flatten(selectedChip.props.style)).toMatchObject({ borderWidth: 1.5 });
    });
  });
});
