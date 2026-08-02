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
});
