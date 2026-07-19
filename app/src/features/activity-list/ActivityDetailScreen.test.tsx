import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Linking, Share } from 'react-native';
import type { Activity } from '../../api/activities';
import { getActivityPhotos } from '../../api/activities';
import { ActivityDetailScreen } from './ActivityDetailScreen';

// T4: real network calls aren't available in the Jest environment (a bare
// `fetch` throws, caught by getActivityPhotos' own try/catch) — mocking
// keeps that failure deterministic and lets the new describe block below
// control resolve/reject timing.
jest.mock('../../api/activities', () => ({
  ...jest.requireActual('../../api/activities'),
  getActivityPhotos: jest.fn(),
}));
const mockedGetActivityPhotos = jest.mocked(getActivityPhotos);

const activity: Activity = {
  id: '1',
  title: 'Skadarlija Food Walk',
  description:
    'A tasty walk through the old bohemian quarter, with stops at three taverns.',
  category: 'restaurants',
  location: { lat: 44.8153, lng: 20.4646 },
  country: 'Serbia',
  rating: 4.6,
  image_refs: [{ uri: 'https://example.com/img.jpg' }],
  tags: ['food', 'walking', 'local', 'evening'],
  distance_km: 0.4,
};

describe('ActivityDetailScreen', () => {
  const originalKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  beforeEach(() => {
    // Default: never resolves, so every pre-existing test above (none of
    // which cares about the photo-set upgrade) sees the plain provisional
    // state throughout.
    mockedGetActivityPhotos.mockReturnValue(new Promise(() => {}));
  });
  afterEach(() => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = originalKey;
    mockedGetActivityPhotos.mockReset();
  });

  it('shows the full description (no snippet truncation) and every tag, uncapped', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(
      <ActivityDetailScreen
        activity={activity}
        showDistance
        onBack={jest.fn()}
      />,
    );

    expect(screen.getByText(activity.description)).toBeTruthy();
    expect(screen.getByText('food')).toBeTruthy();
    expect(screen.getByText('walking')).toBeTruthy();
    expect(screen.getByText('local')).toBeTruthy();
    expect(screen.getByText('evening')).toBeTruthy();
    expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy();
    expect(screen.getByText('Restaurant')).toBeTruthy();
    expect(screen.getByText('4.6')).toBeTruthy();
    expect(screen.getByText('0.4 km away')).toBeTruthy();
  });

  it('shows the country instead of distance when showDistance is false (no location anchor)', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(
      <ActivityDetailScreen
        activity={activity}
        showDistance={false}
        onBack={jest.fn()}
      />,
    );
    expect(screen.getByText('Serbia')).toBeTruthy();
  });

  it('calls onBack when the on-screen Back control is pressed', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    const onBack = jest.fn();
    render(
      <ActivityDetailScreen activity={activity} showDistance onBack={onBack} />,
    );
    fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows the broken-image fallback when the hero photo fails to load', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(
      <ActivityDetailScreen
        activity={activity}
        showDistance
        onBack={jest.fn()}
      />,
    );
    fireEvent(screen.getByTestId('activity-detail-hero-image'), 'error', {
      nativeEvent: { error: 'load failed' },
    });
    expect(screen.queryByTestId('activity-detail-hero-image')).toBeNull();
  });

  it('omits the map block entirely when the maps key is absent, app-wide', () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
    render(
      <ActivityDetailScreen
        activity={activity}
        showDistance
        onBack={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('activity-detail-map-image')).toBeNull();
  });

  it('shows the map image when the key is present and coordinates are valid', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(
      <ActivityDetailScreen
        activity={activity}
        showDistance
        onBack={jest.fn()}
      />,
    );
    expect(screen.getByTestId('activity-detail-map-image')).toBeTruthy();
  });

  it('falls back to the pin-off placeholder when coordinates are (0,0)', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(
      <ActivityDetailScreen
        activity={{ ...activity, location: { lat: 0, lng: 0 } }}
        showDistance
        onBack={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('activity-detail-map-image')).toBeNull();
  });

  it('falls back to the pin-off placeholder when the map image request fails', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(
      <ActivityDetailScreen
        activity={activity}
        showDistance
        onBack={jest.fn()}
      />,
    );
    fireEvent(screen.getByTestId('activity-detail-map-image'), 'error', {
      nativeEvent: { error: 'load failed' },
    });
    expect(screen.queryByTestId('activity-detail-map-image')).toBeNull();
  });

  it('opens Google Maps directions when the map preview is tapped', async () => {
    const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(
      <ActivityDetailScreen
        activity={activity}
        showDistance
        onBack={jest.fn()}
      />,
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Open in Google Maps' }),
    );

    await waitFor(() =>
      expect(openURLSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `${activity.location.lat},${activity.location.lng}`,
        ),
      ),
    );
    openURLSpy.mockRestore();
  });

  it('surfaces the generic error banner when tapping the map preview fails to open maps', async () => {
    const openURLSpy = jest
      .spyOn(Linking, 'openURL')
      .mockRejectedValue(new Error('no maps app'));
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(
      <ActivityDetailScreen
        activity={activity}
        showDistance
        onBack={jest.fn()}
      />,
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Open in Google Maps' }),
    );
    await waitFor(() =>
      expect(
        screen.getByText('Could not open maps. Please try again.'),
      ).toBeTruthy(),
    );
    openURLSpy.mockRestore();
  });

  it('disables the map preview tap when coordinates are invalid (0,0)', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(
      <ActivityDetailScreen
        activity={{ ...activity, location: { lat: 0, lng: 0 } }}
        showDistance
        onBack={jest.fn()}
      />,
    );
    const mapButton = screen.getByRole('button', {
      name: 'Open in Google Maps',
    });
    expect(mapButton.props.accessibilityState.disabled).toBe(true);
  });

  it('omits the tags row when tags is empty', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(
      <ActivityDetailScreen
        activity={{ ...activity, tags: [] }}
        showDistance
        onBack={jest.fn()}
      />,
    );
    expect(screen.queryByText('food')).toBeNull();
  });

  it('renders no attribution caption when the hero photo carries none (no-op)', () => {
    render(
      <ActivityDetailScreen
        activity={activity}
        showDistance
        onBack={jest.fn()}
      />,
    );
    expect(screen.queryByText(/photo by/i)).toBeNull();
  });

  it('shows the hero attribution as a link opening the author profile when present', () => {
    const withLink = {
      ...activity,
      image_refs: [
        {
          uri: 'https://example.com/img.jpg',
          attribution: {
            author: 'Jane Doe',
            link: 'https://maps.google.com/maps/contrib/1',
          },
        },
      ],
    };
    render(
      <ActivityDetailScreen
        activity={withLink}
        showDistance
        onBack={jest.fn()}
      />,
    );
    expect(
      screen.getByRole('link', { name: 'Photo by Jane Doe' }),
    ).toBeTruthy();
  });

  describe('category-specific fact strip, unique section, badge, CTA (T4)', () => {
    it('renders fact strip, badge qualifier, open status, and the Shape A unique section for a fully-detailed Restaurants activity', () => {
      const withDetails: Activity = {
        ...activity,
        details: {
          category: 'restaurants',
          cuisine: 'Italian',
          price_tier: '€€',
          hours: '9am–11pm',
          open_status: 'Open now',
          popular_dishes: [{ name: 'Truffle pasta', price: '€14' }],
        },
      };
      render(
        <ActivityDetailScreen
          activity={withDetails}
          showDistance
          onBack={jest.fn()}
        />,
      );

      expect(screen.getByText('Restaurant · Italian')).toBeTruthy();
      expect(screen.getByText('Open now')).toBeTruthy();
      expect(screen.getByText('€€')).toBeTruthy();
      expect(screen.getByText('9am–11pm')).toBeTruthy();
      expect(screen.getByText('Popular dishes')).toBeTruthy();
      expect(screen.getByText('Truffle pasta')).toBeTruthy();
      expect(screen.getByText('€14')).toBeTruthy();
    });

    it('omits the fact strip and unique section (no placeholder, no crash) for empty details {}', () => {
      // Wire payload from the proxy: `details: {}` (no omitempty), never
      // `undefined` — this is the real shape every seed activity sends.
      const emptyDetails: Activity = {
        ...activity,
        details: {} as Activity['details'],
      };
      render(
        <ActivityDetailScreen
          activity={emptyDetails}
          showDistance
          onBack={jest.fn()}
        />,
      );
      expect(screen.queryByText('Popular dishes')).toBeNull();
      expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy();
    });

    it('shows the difficulty meter above the fact strip for Sport activities with a difficulty value', () => {
      const sport: Activity = {
        ...activity,
        category: 'sport',
        details: {
          category: 'sport',
          difficulty: 3,
          effort_level: 'Moderate',
          duration: '2h',
          gear: 'Boots',
        },
      };
      render(
        <ActivityDetailScreen
          activity={sport}
          showDistance
          onBack={jest.fn()}
        />,
      );
      expect(screen.getByText('Intermediate')).toBeTruthy();
      expect(screen.getByText('Moderate')).toBeTruthy();
    });

    it('disables the primary CTA (no backing URL data) for a non-directions category, e.g. Restaurants', () => {
      render(
        <ActivityDetailScreen
          activity={activity}
          showDistance
          onBack={jest.fn()}
        />,
      );
      const cta = screen.getByRole('button', { name: 'Book a table' });
      expect(cta.props.accessibilityState.disabled).toBe(true);
    });

    it('the primary CTA opens maps for a directions-primary category (Cafés) and the generic action becomes Share', async () => {
      const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
      const cafe: Activity = {
        ...activity,
        category: 'cafes',
        location: { lat: 44.8, lng: 20.4 },
      };
      render(
        <ActivityDetailScreen
          activity={cafe}
          showDistance
          onBack={jest.fn()}
        />,
      );

      expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
      fireEvent.press(screen.getByRole('button', { name: 'Get directions' }));

      await waitFor(() =>
        expect(openURLSpy).toHaveBeenCalledWith(
          expect.stringContaining('44.8,20.4'),
        ),
      );
      openURLSpy.mockRestore();
    });

    it('surfaces the generic error banner (dismissible) when the maps handoff fails', async () => {
      const openURLSpy = jest
        .spyOn(Linking, 'openURL')
        .mockRejectedValue(new Error('no maps app'));
      const cafe: Activity = {
        ...activity,
        category: 'cafes',
        location: { lat: 44.8, lng: 20.4 },
      };
      render(
        <ActivityDetailScreen
          activity={cafe}
          showDistance
          onBack={jest.fn()}
        />,
      );

      fireEvent.press(screen.getByRole('button', { name: 'Get directions' }));
      await waitFor(() =>
        expect(
          screen.getByText('Could not open maps. Please try again.'),
        ).toBeTruthy(),
      );

      fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
      expect(
        screen.queryByText('Could not open maps. Please try again.'),
      ).toBeNull();
      openURLSpy.mockRestore();
    });

    it('the generic action opens the share sheet for a directions-primary category (Cafés), since its primary CTA already is Directions', async () => {
      const shareSpy = jest
        .spyOn(Share, 'share')
        .mockResolvedValue({ action: Share.sharedAction });
      const cafe: Activity = { ...activity, category: 'cafes' };
      render(
        <ActivityDetailScreen
          activity={cafe}
          showDistance
          onBack={jest.fn()}
        />,
      );

      fireEvent.press(screen.getByRole('button', { name: 'Share' }));
      await waitFor(() => expect(shareSpy).toHaveBeenCalled());
      shareSpy.mockRestore();
    });
  });

  describe('photo gallery pill + viewer (T4)', () => {
    const withTwoPhotos: Activity = {
      ...activity,
      image_refs: [
        { uri: 'https://example.com/1.jpg', thumb_url: 'https://example.com/1_t.jpg' },
        { uri: 'https://example.com/2.jpg', thumb_url: 'https://example.com/2_t.jpg' },
      ],
    };

    it('hides the "Photos N" pill when the activity has fewer than 2 photos', () => {
      render(
        <ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />,
      );
      expect(screen.queryByLabelText(/view \d+ photos/i)).toBeNull();
    });

    it('shows the "Photos N" pill with the live count when the activity has 2+ photos', () => {
      render(
        <ActivityDetailScreen activity={withTwoPhotos} showDistance onBack={jest.fn()} />,
      );
      expect(screen.getByLabelText('View 2 photos')).toBeTruthy();
      expect(screen.getByText('Photos 2')).toBeTruthy();
    });

    it('opens the fullscreen viewer at the hero photo (index 0) when the pill is pressed, and closes it', () => {
      render(
        <ActivityDetailScreen activity={withTwoPhotos} showDistance onBack={jest.fn()} />,
      );
      fireEvent.press(screen.getByLabelText('View 2 photos'));
      expect(screen.getByText('1 / 2')).toBeTruthy();

      fireEvent.press(screen.getByLabelText('Close photos'));
      expect(screen.queryByText('1 / 2')).toBeNull();
    });
  });

  describe('design-fidelity fixes across categories (T8)', () => {
    it('opens the external action_url for a non-directions category (Sport) and is never disabled once the URL exists', async () => {
      const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
      const sport: Activity = {
        ...activity,
        category: 'sport',
        details: {
          category: 'sport',
          difficulty: 2,
          action_url: 'https://booking.example.com/kayaking-sava',
        },
      };
      render(
        <ActivityDetailScreen activity={sport} showDistance onBack={jest.fn()} />,
      );
      const cta = screen.getByRole('button', { name: 'Book session' });
      expect(cta.props.accessibilityState.disabled).toBe(false);
      fireEvent.press(cta);
      await waitFor(() =>
        expect(openURLSpy).toHaveBeenCalledWith(
          'https://booking.example.com/kayaking-sava',
        ),
      );
      openURLSpy.mockRestore();
    });

    it('surfaces the generic error banner when the external action_url handoff fails', async () => {
      const openURLSpy = jest
        .spyOn(Linking, 'openURL')
        .mockRejectedValue(new Error('no browser'));
      const sport: Activity = {
        ...activity,
        category: 'sport',
        details: {
          category: 'sport',
          action_url: 'https://booking.example.com/kayaking-sava',
        },
      };
      render(
        <ActivityDetailScreen activity={sport} showDistance onBack={jest.fn()} />,
      );
      fireEvent.press(screen.getByRole('button', { name: 'Book session' }));
      await waitFor(() =>
        expect(
          screen.getByText('Could not open the link. Please try again.'),
        ).toBeTruthy(),
      );
      openURLSpy.mockRestore();
    });

    it('shows the singular badge noun + venue_type subtype for Nightlife, in fact-strip-first order with no description', () => {
      const nightlife: Activity = {
        ...activity,
        category: 'nightlife',
        description: 'Should not render for Nightlife',
        details: {
          category: 'nightlife',
          venue_type: 'Club',
          entry_price: '€10',
        },
      };
      render(
        <ActivityDetailScreen
          activity={nightlife}
          showDistance
          onBack={jest.fn()}
        />,
      );
      expect(screen.getByText('Nightlife · Club')).toBeTruthy();
      expect(
        screen.queryByText('Should not render for Nightlife'),
      ).toBeNull();
    });

    it('shows the Nightlife open-tonight status dot + success-colored text, leading the meta row', () => {
      const nightlife: Activity = {
        ...activity,
        category: 'nightlife',
        details: { category: 'nightlife', open_tonight: true },
      };
      render(
        <ActivityDetailScreen
          activity={nightlife}
          showDistance
          onBack={jest.fn()}
        />,
      );
      expect(screen.getByText('Open tonight')).toBeTruthy();
    });

    it('shows Entertainment genre + neighborhood inline in the meta row instead of a fact strip', () => {
      const entertainment: Activity = {
        ...activity,
        category: 'entertainment',
        details: {
          category: 'entertainment',
          genre: 'Concerts & theatre',
          neighborhood: 'Dorćol',
        },
      };
      render(
        <ActivityDetailScreen
          activity={entertainment}
          showDistance
          onBack={jest.fn()}
        />,
      );
      expect(screen.getByText('Concerts & theatre')).toBeTruthy();
      expect(screen.getByText('Dorćol')).toBeTruthy();
      expect(screen.queryByText('Genre')).toBeNull();
    });

    it("shows Art's artist/work/year/medium attribution line above the badge, not inside the exhibition banner", () => {
      const art: Activity = {
        ...activity,
        category: 'art',
        details: {
          category: 'art',
          artwork: {
            artist: 'Marina Abramović',
            work: 'The Cleaner',
            medium: 'mixed media',
          },
          year: 2019,
          current_exhibition: { title: 'Retrospective' },
        },
      };
      render(
        <ActivityDetailScreen activity={art} showDistance onBack={jest.fn()} />,
      );
      expect(screen.getByText('Marina Abramović')).toBeTruthy();
      expect(screen.getByText('The Cleaner, 2019')).toBeTruthy();
      expect(screen.getByText('mixed media')).toBeTruthy();
    });

    it("shows Wellness' external-booking note above the footer button row, not among the treatments", () => {
      const wellness: Activity = {
        ...activity,
        category: 'wellness',
        details: {
          category: 'wellness',
          external_booking_note: "Booking is handled on the venue's own site",
          treatments: [{ item: 'Massage' }],
        },
      };
      render(
        <ActivityDetailScreen
          activity={wellness}
          showDistance
          onBack={jest.fn()}
        />,
      );
      expect(
        screen.getByText("Booking is handled on the venue's own site"),
      ).toBeTruthy();
    });
  });

  describe('photo-set upgrade fetch (T4)', () => {
    it('fetches the T3 endpoint for this activity on open', () => {
      render(
        <ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />,
      );
      expect(mockedGetActivityPhotos).toHaveBeenCalledWith(activity.id);
    });

    it('renders the provisional photo immediately, before the fetch resolves — no blocking spinner over the screen', () => {
      render(
        <ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />,
      );
      expect(screen.getByTestId('activity-detail-hero-image').props.source).toEqual([
        { uri: activity.image_refs[0].uri },
      ]);
      // The one-photo provisional set hides the pill — no other loading
      // affordance replaces it, per design-spec.md.
      expect(screen.queryByLabelText(/view \d+ photos/i)).toBeNull();
    });

    it('upgrades to the full gallery (pill + viewer) once the fetch resolves, without swapping the hero photo', async () => {
      const fullSet = [
        activity.image_refs[0],
        { uri: 'https://example.com/2.jpg', attribution: { author: 'Jane Doe' } },
        { uri: 'https://example.com/3.jpg' },
      ];
      mockedGetActivityPhotos.mockResolvedValue({ status: 'success', image_refs: fullSet });
      render(
        <ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />,
      );

      await waitFor(() => expect(screen.getByText('Photos 3')).toBeTruthy());
      expect(screen.getByTestId('activity-detail-hero-image').props.source).toEqual([
        { uri: activity.image_refs[0].uri },
      ]);

      fireEvent.press(screen.getByLabelText('View 3 photos'));
      expect(screen.getByText('1 / 3')).toBeTruthy();
    });

    it('stays on the provisional photo with no error UI when the fetch fails', async () => {
      mockedGetActivityPhotos.mockResolvedValue({ status: 500, message: 'boom' });
      render(
        <ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />,
      );

      await waitFor(() => expect(mockedGetActivityPhotos).toHaveBeenCalled());
      await screen.findByText(activity.description); // let the resolved promise settle
      expect(screen.queryByText('boom')).toBeNull();
      expect(screen.getByTestId('activity-detail-hero-image').props.source).toEqual([
        { uri: activity.image_refs[0].uri },
      ]);
      expect(screen.queryByLabelText(/view \d+ photos/i)).toBeNull();
    });
  });
});
