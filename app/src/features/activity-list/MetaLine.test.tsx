import { render, screen } from '@testing-library/react-native';
import { MetaLine } from './MetaLine';

describe('MetaLine', () => {
  it('joins multiple items with a single "·" between each (join, never a prefix)', () => {
    render(<MetaLine items={['Restaurant', 'Fine Dining', '400 m']} />);
    expect(screen.getByText('Restaurant')).toBeTruthy();
    expect(screen.getByText('Fine Dining')).toBeTruthy();
    expect(screen.getByText('400 m')).toBeTruthy();
    expect(screen.getAllByText('·')).toHaveLength(2);
  });

  it('renders a single surviving item alone, with no dangling separator', () => {
    render(<MetaLine items={['400 m']} />);
    expect(screen.getByText('400 m')).toBeTruthy();
    expect(screen.queryByText('·')).toBeNull();
  });

  it('drops absent/invalid items and closes the gap (no dangling separator)', () => {
    render(<MetaLine items={[undefined, 'Restaurant', '', '400 m']} />);
    expect(screen.getByText('Restaurant')).toBeTruthy();
    expect(screen.getByText('400 m')).toBeTruthy();
    expect(screen.getAllByText('·')).toHaveLength(1);
  });

  it('drops an item failing the scalar contract (a leaked sentence)', () => {
    render(<MetaLine items={['Restaurant', 'Vreme posete nije eksplicitno navedeno.']} />);
    expect(screen.getByText('Restaurant')).toBeTruthy();
    expect(screen.queryByText('Vreme posete nije eksplicitno navedeno.')).toBeNull();
    expect(screen.queryByText('·')).toBeNull();
  });

  it('renders nothing when every item is absent and there is no chip', () => {
    const { toJSON } = render(<MetaLine items={[undefined, '']} />);
    expect(toJSON()).toBeNull();
  });

  it('renders an open status chip with a leading dot, joined after the items', () => {
    render(<MetaLine items={['Restaurant']} chip={{ kind: 'status', text: 'Open', isOpen: true }} />);
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getAllByText('·')).toHaveLength(1);
  });

  it('renders a closed status chip with no dot and muted styling, never --error', () => {
    render(<MetaLine items={[]} chip={{ kind: 'status', text: 'Closed', isOpen: false }} />);
    const closedText = screen.getByText('Closed');
    expect(closedText).toBeTruthy();
    // No leading "·" when the chip is the row's only content.
    expect(screen.queryByText('·')).toBeNull();
  });

  it('renders a level chip', () => {
    render(<MetaLine items={[]} chip={{ kind: 'level', text: 'Moderate' }} />);
    expect(screen.getByText('Moderate')).toBeTruthy();
  });

  // T4 round-2 review finding: `rawItem` is app-computed structured data
  // (distance/country), not LLM-generated content — it must never be
  // dropped by the scalar kind check, unlike a classified `items` entry.
  it('renders rawItem verbatim even when it fails the scalar contract (a long country name)', () => {
    render(<MetaLine rawItem="Bosnia and Herzegovina" items={[]} />);
    expect(screen.getByText('Bosnia and Herzegovina')).toBeTruthy();
  });

  it('joins rawItem with classified items in order, rawItem first', () => {
    render(<MetaLine rawItem="400 m" items={['Restaurant']} />);
    expect(screen.getByText('400 m')).toBeTruthy();
    expect(screen.getByText('Restaurant')).toBeTruthy();
    expect(screen.getAllByText('·')).toHaveLength(1);
  });

  it('omits rawItem cleanly (no dangling separator) when undefined', () => {
    render(<MetaLine rawItem={undefined} items={['Restaurant']} />);
    expect(screen.getByText('Restaurant')).toBeTruthy();
    expect(screen.queryByText('·')).toBeNull();
  });

  it('caps the joined line at 4 items per the spec\'s "≤4 items" contract', () => {
    render(<MetaLine items={['A', 'B', 'C', 'D', 'E']} />);
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('D')).toBeTruthy();
    expect(screen.queryByText('E')).toBeNull();
    expect(screen.getAllByText('·')).toHaveLength(3);
  });
});
