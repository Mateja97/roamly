import { render, screen } from '@testing-library/react-native';
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
});
