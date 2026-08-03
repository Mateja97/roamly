import { fireEvent, render, screen } from '@testing-library/react-native';
import { FeedHeader } from './FeedHeader';

function city(cityName: string) {
  return { city: cityName, country: 'X', centroid: { lat: 0, lng: 0 } };
}

describe('FeedHeader', () => {
  it('renders the Nearby scope pill + morning context line', () => {
    render(<FeedHeader scope="nearby" cities={[]} hour={7} travelerMode={false} onOpenScope={jest.fn()} />);
    expect(screen.getByRole('button', { name: /scope: nearby/i })).toBeTruthy();
    expect(screen.getByText('This morning near you')).toBeTruthy();
  });

  it('renders the Anywhere · city scope pill + "Exploring {city}" context line', () => {
    render(
      <FeedHeader scope="anywhere" cities={[city('Barcelona')]} hour={13} travelerMode={false} onOpenScope={jest.fn()} />
    );
    expect(screen.getByRole('button', { name: /scope: anywhere · barcelona/i })).toBeTruthy();
    expect(screen.getByText('Exploring Barcelona')).toBeTruthy();
  });

  it('renders "Exploring everywhere" cold-start pill with no cities', () => {
    render(<FeedHeader scope="anywhere" cities={[]} hour={13} travelerMode={false} onOpenScope={jest.fn()} />);
    expect(screen.getByRole('button', { name: /scope: exploring everywhere/i })).toBeTruthy();
  });

  it('tapping the scope pill calls onOpenScope', () => {
    const onOpenScope = jest.fn();
    render(<FeedHeader scope="nearby" cities={[]} hour={7} travelerMode={false} onOpenScope={onOpenScope} />);
    fireEvent.press(screen.getByRole('button', { name: /scope: nearby/i }));
    expect(onOpenScope).toHaveBeenCalledTimes(1);
  });

  it('focusing the scope pill applies the visible focus style', () => {
    render(<FeedHeader scope="nearby" cities={[]} hour={7} travelerMode={false} onOpenScope={jest.fn()} />);
    const pill = screen.getByRole('button', { name: /scope: nearby/i });
    fireEvent(pill, 'focus');
    expect(pill.props.style).toBeTruthy();
  });

  it('traveler mode + a known city renders the "New in town?" context line', () => {
    render(<FeedHeader scope="anywhere" cities={[city('Lisbon')]} hour={13} travelerMode onOpenScope={jest.fn()} />);
    expect(screen.getByText('New in town? The best of Lisbon')).toBeTruthy();
  });
});
