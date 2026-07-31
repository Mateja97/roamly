import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { GoogleAttributionPlate, type GoogleReview } from './GoogleAttributionPlate';

const review: GoogleReview = {
  author_attribution: {
    display_name: 'Jordan Lee',
    photo_uri: 'https://places.example/avatar.jpg',
    uri: 'https://google.example/profile/jordan',
  },
  rating: 4,
  text: 'Great little spot, would come back again.',
  publish_time: 'a month ago',
};

describe('GoogleAttributionPlate', () => {
  beforeEach(() => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('detail variant: renders Google Maps branding, the review author/date/rating, and the maps link', () => {
    render(
      <GoogleAttributionPlate variant="detail" reviews={[review]} googleMapsUri="https://maps.example/place" />,
    );
    // The brand mark is decorative (accessibilityElementsHidden) — RNTL excludes
    // hidden elements from queries by default, so opt in explicitly here.
    expect(screen.getAllByText('Google Maps', { includeHiddenElements: true }).length).toBeGreaterThan(0);
    expect(screen.getByText('Jordan Lee')).toBeTruthy();
    expect(screen.getByText('a month ago')).toBeTruthy();
    expect(screen.getByText('4.0')).toBeTruthy();
    expect(screen.getByText('View on Google Maps')).toBeTruthy();
  });

  it('detail variant: formats a raw ISO timestamp date into a readable date, not the raw string', () => {
    render(<GoogleAttributionPlate variant="detail" reviews={[{ ...review, publish_time: '2026-07-15T14:32:00Z' }]} />);
    expect(screen.getByText('15 July 2026')).toBeTruthy();
    expect(screen.queryByText('2026-07-15T14:32:00Z')).toBeNull();
  });

  it('detail variant: an already-human date string (not parseable as a Date) renders verbatim', () => {
    render(<GoogleAttributionPlate variant="detail" reviews={[{ ...review, publish_time: 'a month ago' }]} />);
    expect(screen.getByText('a month ago')).toBeTruthy();
  });

  it('detail variant: the brand mark renders once (header only), not again on the in-card maps link row', () => {
    render(
      <GoogleAttributionPlate variant="detail" reviews={[review]} googleMapsUri="https://maps.example/place" />,
    );
    expect(screen.getAllByText('Google Maps', { includeHiddenElements: true })).toHaveLength(1);
  });

  it('renders nothing when there are no reviews and no maps link (silent degrade)', () => {
    render(<GoogleAttributionPlate variant="detail" reviews={[]} />);
    expect(screen.queryByTestId('google-attribution-plate-detail')).toBeNull();
  });

  it('detail variant: the header carries the mandatory "Reviews from Google Maps" section name in the a11y tree', () => {
    render(<GoogleAttributionPlate variant="detail" reviews={[review]} />);
    expect(screen.getByRole('header', { name: 'Reviews from Google Maps' })).toBeTruthy();
  });

  it('detail variant: pressing the review author link opens author_attribution.uri', () => {
    render(<GoogleAttributionPlate variant="detail" reviews={[review]} />);
    const link = screen.getByRole('link', { name: 'Review by Jordan Lee on Google Maps' });
    fireEvent.press(link);
    expect(Linking.openURL).toHaveBeenCalledWith(review.author_attribution.uri);
  });

  it('pressing the maps link opens googleMapsUri', () => {
    render(<GoogleAttributionPlate variant="detail" reviews={[]} googleMapsUri="https://maps.example/place" />);
    const link = screen.getByRole('link', { name: 'View on Google Maps' });
    fireEvent.press(link);
    expect(Linking.openURL).toHaveBeenCalledWith('https://maps.example/place');
  });

  it('detail variant: partial data — reviews without a maps link omits the footer link', () => {
    render(<GoogleAttributionPlate variant="detail" reviews={[review]} />);
    expect(screen.queryByText('View on Google Maps')).toBeNull();
  });

  it('detail variant: partial data — a maps link without reviews shows the header and link only', () => {
    render(<GoogleAttributionPlate variant="detail" reviews={[]} googleMapsUri="https://maps.example/place" />);
    expect(screen.getByText('View on Google Maps')).toBeTruthy();
    expect(screen.queryByText('Jordan Lee')).toBeNull();
  });

  it('footer variant: renders the compact maps link when a googleMapsUri exists', () => {
    render(<GoogleAttributionPlate variant="footer" googleMapsUri="https://maps.example/place" />);
    expect(screen.getByText('View on Google Maps')).toBeTruthy();
  });

  it('footer variant: renders nothing without a googleMapsUri, even with reviews present', () => {
    render(<GoogleAttributionPlate variant="footer" reviews={[review]} />);
    expect(screen.queryByTestId('google-attribution-plate-footer')).toBeNull();
  });

  it('avatar: shows the author initial when photo_uri is absent', () => {
    render(
      <GoogleAttributionPlate
        variant="detail"
        reviews={[{ ...review, author_attribution: { ...review.author_attribution, photo_uri: undefined } }]}
      />,
    );
    expect(screen.getByText('J')).toBeTruthy();
  });

  it('avatar: falls back to the initial when the image fails to load', () => {
    render(<GoogleAttributionPlate variant="detail" reviews={[review]} />);
    const avatar = screen.getByTestId('google-review-avatar');
    fireEvent(avatar, 'error', { nativeEvent: { error: 'load failed' } });
    expect(screen.getByText('J')).toBeTruthy();
    expect(screen.queryByTestId('google-review-avatar')).toBeNull();
  });

  it('renders each supplied review with a hairline above every row but the first (no pad-to-N)', () => {
    const second: GoogleReview = {
      ...review,
      author_attribution: { ...review.author_attribution, display_name: 'Ana Petrovic', uri: 'https://google.example/profile/ana' },
      text: 'Cozy and quiet.',
    };
    render(<GoogleAttributionPlate variant="detail" reviews={[review, second]} />);
    const rows = screen.getAllByTestId('google-review-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toHaveStyle({ borderTopWidth: 1 });
    expect(rows[1]).toHaveStyle({ borderTopWidth: 1 });
  });
});
