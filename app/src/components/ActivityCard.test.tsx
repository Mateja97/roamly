import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Activity } from '../api/activities';
import { ActivityCard, ActivityCardSkeleton } from './ActivityCard';

const activity: Activity = {
  id: '1',
  title: 'Skadarlija Food Walk',
  description: 'A tasty walk',
  category: 'restaurants',
  location: { lat: 44.8153, lng: 20.4646 },
  country: 'Serbia',
  rating: 4.6,
  image_refs: [{ uri: 'https://example.com/img.jpg' }],
  tags: ['food'],
  distance_km: 0.4,
};

describe('ActivityCard', () => {
  it('renders title, category, rating, and distance as one accessible group, with no price signage', () => {
    render(<ActivityCard activity={activity} showDistance onPress={jest.fn()} />);
    expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy();
    // Category/rating pills are accessibilityElementsHidden (decorative — the
    // combined label already carries them), so queries need includeHiddenElements.
    expect(screen.getByText('Restaurants', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('4.6', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('$$', { includeHiddenElements: true })).toBeNull();
    const card = screen.getByLabelText(/skadarlija food walk.*restaurants.*rated 4.6.*0.4 km away/i);
    expect(card.props.accessibilityLabel).not.toMatch(/\$/);
  });

  it('is a tappable button that opens the detail screen on press', () => {
    const onPress = jest.fn();
    render(<ActivityCard activity={activity} showDistance onPress={onPress} />);
    const card = screen.getByLabelText(/skadarlija food walk/i);
    expect(card.props.accessibilityRole).toBe('button');
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders the go-button as decorative (no own role) but tapping it still fires onPress', () => {
    const onPress = jest.fn();
    render(<ActivityCard activity={activity} showDistance onPress={onPress} />);
    const goButton = screen.getByTestId('activity-card-go-button', { includeHiddenElements: true });
    expect(goButton.props.accessibilityElementsHidden).toBe(true);
    fireEvent.press(goButton);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows the country instead of distance when showDistance is false (no location anchor)', () => {
    render(<ActivityCard activity={activity} showDistance={false} onPress={jest.fn()} />);
    expect(screen.getByText('Serbia')).toBeTruthy();
  });

  it('shows the broken-image fallback when the image fails to load', () => {
    render(<ActivityCard activity={activity} showDistance onPress={jest.fn()} />);
    const image = screen.getByTestId('activity-card-image');
    fireEvent(image, 'error', { nativeEvent: { error: 'load failed' } });
    expect(screen.queryByTestId('activity-card-image')).toBeNull();
  });

  it('renders a skeleton with the same card footprint, hidden from accessibility', () => {
    render(<ActivityCardSkeleton />);
    expect(screen.queryByText('Skadarlija Food Walk')).toBeNull();
  });

  it('renders the description snippet, included in the a11y label, and no tags row', () => {
    render(
      <ActivityCard
        activity={{ ...activity, tags: ['food', 'walking', 'local', 'extra'] }}
        showDistance
        onPress={jest.fn()}
      />
    );
    expect(screen.getByText('A tasty walk')).toBeTruthy();
    expect(screen.queryByText('food')).toBeNull();
    expect(screen.queryByText('walking')).toBeNull();
    const card = screen.getByLabelText(/a tasty walk/i);
    expect(card.props.accessibilityLabel).not.toMatch(/tags:/i);
  });

  it('omits the description line and its label clause when description is empty', () => {
    render(<ActivityCard activity={{ ...activity, description: '' }} showDistance onPress={jest.fn()} />);
    expect(screen.queryByText('A tasty walk')).toBeNull();
    const card = screen.getByLabelText(/skadarlija food walk/i);
    expect(card.props.accessibilityLabel).not.toMatch(/tasty walk/i);
  });

  it('renders no attribution caption when the photo carries none (no-op)', () => {
    render(<ActivityCard activity={activity} showDistance onPress={jest.fn()} />);
    expect(screen.queryByText(/photo by/i)).toBeNull();
  });

  it('shows the author name as plain text when attribution has no link', () => {
    const withAttribution = {
      ...activity,
      image_refs: [{ uri: 'https://example.com/img.jpg', attribution: { author: 'Jane Doe' } }],
    };
    render(<ActivityCard activity={withAttribution} showDistance onPress={jest.fn()} />);
    expect(screen.getByText(/photo by/i)).toBeTruthy();
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the author name as a link opening the attribution link when present', () => {
    const withLink = {
      ...activity,
      image_refs: [
        {
          uri: 'https://example.com/img.jpg',
          attribution: { author: 'Jane Doe', link: 'https://maps.google.com/maps/contrib/1' },
        },
      ],
    };
    render(<ActivityCard activity={withLink} showDistance onPress={jest.fn()} />);
    expect(screen.getByRole('link', { name: 'Photo by Jane Doe' })).toBeTruthy();
  });

  describe('Tripadvisor-branded row (T8)', () => {
    const tripadvisorActivity: Activity = {
      ...activity,
      details: {
        category: 'restaurants',
        tripadvisor: {
          rating_image_url: 'https://tripadvisor.example/bubble.png',
          review_count: 1204,
          web_url: 'https://tripadvisor.example/place',
        },
      },
    };

    it('renders the attribution plate (rating · review count) instead of the gold rating pill', () => {
      render(<ActivityCard activity={tripadvisorActivity} showDistance onPress={jest.fn()} />);
      expect(screen.getByText('4.6 · 1,204')).toBeTruthy();
      // Gold pill's standalone "4.6" text node must not also render (rule 03).
      expect(screen.queryByText('4.6', { includeHiddenElements: true })).toBeNull();
    });

    it('replaces the "rated {x}" a11y fragment with "Tripadvisor, {N} reviews"', () => {
      render(<ActivityCard activity={tripadvisorActivity} showDistance onPress={jest.fn()} />);
      const card = screen.getByLabelText(/tripadvisor, 1,204 reviews/i);
      expect(card.props.accessibilityLabel).not.toMatch(/rated/i);
    });

    it('keeps the gold rating pill for a non-Tripadvisor row, unchanged', () => {
      render(<ActivityCard activity={activity} showDistance onPress={jest.fn()} />);
      expect(screen.getByText('4.6', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.queryByText(/reviews$/)).toBeNull();
    });
  });
});
