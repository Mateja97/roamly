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

  // design-spec.md's Stat grid degradation rule: 3 valid -> 3 columns, 2 ->
  // 2 columns, 1 -> folds into the meta line (grid itself omits, not a
  // 1-cell grid), 0 -> omits. FactStrip only owns "am I 2/3 columns or
  // nothing" — the actual fold is T5's composition concern.
  describe('degradation (design-spec.md "Stat grid" slot)', () => {
    it('omits the whole grid when only 1 field is valid (folds into the meta line elsewhere)', () => {
      const { toJSON } = render(<FactStrip fields={fields.slice(0, 1)} />);
      expect(toJSON()).toBeNull();
    });

    it('drops a field whose value fails the scalar contract (the production bug fix)', () => {
      const withLeakedSentence: FactChip[] = [
        ...fields.slice(0, 2),
        { icon: Clock, label: 'Typical visit', value: 'Vreme posete nije eksplicitno navedeno.' },
      ];
      render(<FactStrip fields={withLeakedSentence} />);
      expect(screen.getByText('Italian')).toBeTruthy();
      expect(screen.getByText('€€')).toBeTruthy();
      expect(screen.queryByText('Vreme posete nije eksplicitno navedeno.')).toBeNull();
      expect(screen.queryByText('Typical visit')).toBeNull();
    });

    it('omits the grid entirely when every field fails its scalar contract', () => {
      const allInvalid: FactChip[] = [
        { icon: Clock, label: 'Typical visit', value: 'Not specified.' },
        { icon: Euro, label: 'Price from', value: 'Nije navedeno' },
      ];
      const { toJSON } = render(<FactStrip fields={allInvalid} />);
      expect(toJSON()).toBeNull();
    });

    it('caps at 3 columns even if more than 3 valid fields are given', () => {
      const four: FactChip[] = [
        ...fields,
        { icon: Euro, label: 'Extra', value: 'Fast' },
      ];
      render(<FactStrip fields={four} />);
      expect(screen.queryByText('Fast')).toBeNull();
    });
  });
});
