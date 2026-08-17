import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { FeedHeader } from './FeedHeader';

function city(cityName: string) {
  return { city: cityName, country: 'X', centroid: { lat: 0, lng: 0 } };
}

describe('FeedHeader', () => {
  it('renders the Nearby scope pill + morning context line', () => {
    render(<FeedHeader scope="nearby" cities={[]} minRating={null} hour={7} travelerMode={false} onOpenScope={jest.fn()} />);
    expect(screen.getByRole('button', { name: /scope: nearby/i })).toBeTruthy();
    expect(screen.getByText('This morning near you')).toBeTruthy();
  });

  it('renders the Anywhere · city scope pill + "Exploring {city}" context line', () => {
    render(
      <FeedHeader scope="anywhere" cities={[city('Barcelona')]} minRating={null} hour={13} travelerMode={false} onOpenScope={jest.fn()} />
    );
    expect(screen.getByRole('button', { name: /scope: anywhere · barcelona/i })).toBeTruthy();
    expect(screen.getByText('Exploring Barcelona')).toBeTruthy();
  });

  it('renders "Exploring everywhere" cold-start pill with no cities', () => {
    render(<FeedHeader scope="anywhere" cities={[]} minRating={null} hour={13} travelerMode={false} onOpenScope={jest.fn()} />);
    expect(screen.getByRole('button', { name: /scope: exploring everywhere/i })).toBeTruthy();
  });

  it('tapping the scope pill calls onOpenScope', () => {
    const onOpenScope = jest.fn();
    render(<FeedHeader scope="nearby" cities={[]} minRating={null} hour={7} travelerMode={false} onOpenScope={onOpenScope} />);
    fireEvent.press(screen.getByRole('button', { name: /scope: nearby/i }));
    expect(onOpenScope).toHaveBeenCalledTimes(1);
  });

  it('focusing the scope pill applies the visible focus style', () => {
    render(<FeedHeader scope="nearby" cities={[]} minRating={null} hour={7} travelerMode={false} onOpenScope={jest.fn()} />);
    const pill = screen.getByRole('button', { name: /scope: nearby/i });
    fireEvent(pill, 'focus');
    expect(pill.props.style).toBeTruthy();
  });

  it('traveler mode + a known city renders the "New in town?" context line', () => {
    render(<FeedHeader scope="anywhere" cities={[city('Lisbon')]} minRating={null} hour={13} travelerMode onOpenScope={jest.fn()} />);
    expect(screen.getByText('New in town? The best of Lisbon')).toBeTruthy();
  });

  // T5 regression: DESIGN_STANDARDS.md's Typography section reserves
  // Marcellus for exactly two screen-identity headers (Welcome hero 36px,
  // Activity detail title 28px) — the Feed context line must stay off it.
  it('renders the context line on the system font stack, not Marcellus', () => {
    render(<FeedHeader scope="nearby" cities={[]} minRating={null} hour={7} travelerMode={false} onOpenScope={jest.fn()} />);
    const contextLine = screen.getByText('This morning near you');
    const flatStyle = StyleSheet.flatten(contextLine.props.style);
    expect(flatStyle.fontFamily).not.toBe('Marcellus_400Regular');
  });

  // T6: an active minimum-rating filter must be visible/announced on the
  // pill after the scope sheet closes, without reopening it.
  it('an active minRating appends to both the pill text and its accessibilityLabel', () => {
    render(<FeedHeader scope="nearby" cities={[]} minRating={4.5} hour={7} travelerMode={false} onOpenScope={jest.fn()} />);
    expect(screen.getByRole('button', { name: /scope: nearby · 4\.5\+/i })).toBeTruthy();
    expect(screen.getByText('Nearby · 4.5+')).toBeTruthy();
  });

  it('clearing minRating (back to null) returns the pill to its unfiltered label', () => {
    render(<FeedHeader scope="nearby" cities={[]} minRating={null} hour={7} travelerMode={false} onOpenScope={jest.fn()} />);
    expect(screen.getByText('Nearby')).toBeTruthy();
    expect(screen.queryByText(/4\.5\+/)).toBeNull();
  });
});
