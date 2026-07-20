import { fireEvent, render, screen } from '@testing-library/react-native';
import { Clock, Euro, Utensils } from 'lucide-react-native';
import { FactStrip } from './FactStrip';
import type { FactChip } from './activityDetailConfig';

const fields: FactChip[] = [
  { icon: Utensils, label: 'Cuisine', value: 'Italian' },
  { icon: Euro, label: 'Price', value: '€€' },
  { icon: Clock, label: 'Hours', value: '9am–11pm' },
];

describe('FactStrip', () => {
  it('renders every chip value and label (3-column)', () => {
    render(<FactStrip fields={fields} />);
    expect(screen.getByText('Italian')).toBeTruthy();
    expect(screen.getByText('Cuisine')).toBeTruthy();
    expect(screen.getByText('€€')).toBeTruthy();
    expect(screen.getByText('9am–11pm')).toBeTruthy();
  });

  it('re-flows to 2 chips when only 2 fields are given (no layout jump)', () => {
    render(<FactStrip fields={fields.slice(0, 2)} />);
    expect(screen.getByText('Italian')).toBeTruthy();
    expect(screen.getByText('€€')).toBeTruthy();
    expect(screen.queryByText('9am–11pm')).toBeNull();
  });

  it('renders nothing when there are zero fields', () => {
    const { toJSON } = render(<FactStrip fields={[]} />);
    expect(toJSON()).toBeNull();
  });

  // opening-hours T3: the Hours chip carries `onPress` only when structured
  // opening_hours is usable — every other chip (and the legacy-fallback
  // Hours chip) has no `onPress` and stays a plain, non-interactive View.
  describe('interactive chip (opening-hours T3)', () => {
    it('renders a chip with onPress as a real button and calls onPress when tapped', () => {
      const onPress = jest.fn();
      const interactiveFields: FactChip[] = [
        ...fields.slice(0, 2),
        { icon: Clock, label: '09:00–17:00', value: 'Open', onPress },
      ];
      render(<FactStrip fields={interactiveFields} />);

      const button = screen.getByRole('button', {
        name: 'See full opening hours',
      });
      expect(button).toBeTruthy();
      fireEvent.press(button);
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('keeps a chip with no onPress non-interactive (legacy fallback)', () => {
      render(<FactStrip fields={fields} />);
      expect(
        screen.queryByRole('button', { name: 'See full opening hours' }),
      ).toBeNull();
    });
  });
});
