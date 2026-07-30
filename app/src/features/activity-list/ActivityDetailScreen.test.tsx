import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo, Linking, Modal, Share, StyleSheet } from 'react-native';
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
    fireEvent(screen.getByTestId('activity-detail-hero-image-0'), 'error', {
      nativeEvent: { error: 'load failed' },
    });
    expect(screen.queryByTestId('activity-detail-hero-image-0')).toBeNull();
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

  it('tracks the hero carousel: swiping to a different photo updates the attribution caption to that photo\'s author', () => {
    const multiPhoto = {
      ...activity,
      image_refs: [
        {
          uri: 'https://example.com/1.jpg',
          attribution: { author: 'First Author', link: 'https://maps.google.com/maps/contrib/1' },
        },
        {
          uri: 'https://example.com/2.jpg',
          attribution: { author: 'Second Author', link: 'https://maps.google.com/maps/contrib/2' },
        },
      ],
    };
    render(
      <ActivityDetailScreen
        activity={multiPhoto}
        showDistance
        onBack={jest.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: 'Photo by First Author' })).toBeTruthy();

    fireEvent(screen.getByTestId('activity-detail-hero-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 320 } },
    });

    expect(screen.getByRole('link', { name: 'Photo by Second Author' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Photo by First Author' })).toBeNull();
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
      expect(screen.getByTestId('activity-detail-hero-image-0').props.source).toEqual([
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
      expect(screen.getByTestId('activity-detail-hero-image-0').props.source).toEqual([
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
      expect(screen.getByTestId('activity-detail-hero-image-0').props.source).toEqual([
        { uri: activity.image_refs[0].uri },
      ]);
      expect(screen.queryByLabelText(/view \d+ photos/i)).toBeNull();
    });
  });

  describe('Hours fact chip (opening-hours T1+T3 — folded back into FactStrip)', () => {
    // 2024-01-01 is a Monday, noon UTC — fixes the venue-local weekday/time
    // the same way activityDetailConfig.test.ts does.
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2024-01-01T12:00:00Z'));
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('shows today status/hours as a compact chip, suppressing the legacy free-text value and the meta-row status item, for usable structured opening_hours', () => {
      const withStructuredHours: Activity = {
        ...activity,
        details: {
          category: 'restaurants',
          hours: '9am–11pm',
          opening_hours: {
            timezone: 'UTC',
            periods: [{ day: 'monday', open: '09:00', close: '17:00' }],
          },
        },
      };
      render(
        <ActivityDetailScreen
          activity={withStructuredHours}
          showDistance
          onBack={jest.fn()}
        />,
      );
      expect(screen.getAllByText('Open')).toHaveLength(1); // only the Hours chip, not also the meta row
      expect(screen.getByText('09:00–17:00')).toBeTruthy();
      expect(screen.queryByText('9am–11pm')).toBeNull(); // legacy free-text suppressed
    });

    it('keeps the venue-type sibling chip in the same FactStrip grid, not pushed down by any extra row', () => {
      const cultureVenue: Activity = {
        ...activity,
        category: 'culture',
        details: {
          category: 'culture',
          venue_type: 'Historical Landmark',
          opening_hours: {
            timezone: 'UTC',
            periods: [{ day: 'monday', open: '09:00', close: '17:00' }],
          },
        },
      };
      render(
        <ActivityDetailScreen
          activity={cultureVenue}
          showDistance
          onBack={jest.fn()}
        />,
      );
      // Both chips render together in FactStrip — no standalone full-width
      // row inserted above it that would push the venue-type chip down.
      expect(screen.getByText('Historical Landmark')).toBeTruthy();
      expect(screen.getByText('Venue')).toBeTruthy();
      expect(screen.getByText('09:00–17:00')).toBeTruthy();
    });

    it('shows "Closed today" when today has zero periods', () => {
      const closedToday: Activity = {
        ...activity,
        details: {
          category: 'cafes',
          opening_hours: {
            timezone: 'UTC',
            periods: [{ day: 'tuesday', open: '09:00', close: '17:00' }],
          },
        },
      };
      render(
        <ActivityDetailScreen
          activity={closedToday}
          showDistance
          onBack={jest.fn()}
        />,
      );
      expect(screen.getByText('Closed today')).toBeTruthy();
    });

    it('shows "Open 24 hours" for an always_open venue', () => {
      const alwaysOpen: Activity = {
        ...activity,
        category: 'shopping',
        details: {
          category: 'shopping',
          opening_hours: { timezone: 'UTC', always_open: true },
        },
      };
      render(
        <ActivityDetailScreen
          activity={alwaysOpen}
          showDistance
          onBack={jest.fn()}
        />,
      );
      expect(screen.getByText('Open 24 hours')).toBeTruthy();
    });

    it('legacy-only fallback: keeps showing the free-text Hours chip (non-interactive) and the meta-row status, no regression', () => {
      const legacyOnly: Activity = {
        ...activity,
        details: {
          category: 'restaurants',
          hours: '9am–11pm',
          open_status: 'Open now',
        },
      };
      render(
        <ActivityDetailScreen
          activity={legacyOnly}
          showDistance
          onBack={jest.fn()}
        />,
      );
      expect(screen.getByText('9am–11pm')).toBeTruthy();
      expect(screen.getByText('Open now')).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: 'See full opening hours' }),
      ).toBeNull();
    });

    it('degrades to the legacy chip when opening_hours has an unresolvable timezone', () => {
      const badTimezone: Activity = {
        ...activity,
        details: {
          category: 'restaurants',
          hours: '9am–11pm',
          open_status: 'Open now',
          opening_hours: {
            timezone: 'Not/AZone',
            periods: [{ day: 'monday', open: '09:00', close: '17:00' }],
          },
        },
      };
      render(
        <ActivityDetailScreen
          activity={badTimezone}
          showDistance
          onBack={jest.fn()}
        />,
      );
      expect(screen.getByText('9am–11pm')).toBeTruthy();
      expect(screen.getByText('Open now')).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: 'See full opening hours' }),
      ).toBeNull();
    });
  });

  describe('Week hours modal (opening-hours T2)', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2024-01-01T12:00:00Z')); // Monday, noon UTC
      jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    });
    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    const withStructuredHours: Activity = {
      ...activity,
      details: {
        category: 'restaurants',
        hours: '9am–11pm',
        opening_hours: {
          timezone: 'UTC',
          periods: [{ day: 'monday', open: '09:00', close: '17:00' }],
        },
      },
    };

    async function flush() {
      await act(async () => {});
    }

    it('opens the full-week modal when the Today row is tapped', async () => {
      render(
        <ActivityDetailScreen activity={withStructuredHours} showDistance onBack={jest.fn()} />,
      );
      expect(screen.queryByText('Opening hours')).toBeNull();

      fireEvent.press(screen.getByRole('button', { name: 'See full opening hours' }));
      await flush();

      expect(screen.getByText('Opening hours')).toBeTruthy();
      // Full week, Monday->Sunday, now visible (unlike the collapsed default state).
      expect(screen.getByText('Tuesday')).toBeTruthy();
      expect(screen.getByText('Monday · Today')).toBeTruthy();
    });

    it('closes the modal (not the screen) via its close control', async () => {
      const onBack = jest.fn();
      render(
        <ActivityDetailScreen activity={withStructuredHours} showDistance onBack={onBack} />,
      );
      fireEvent.press(screen.getByRole('button', { name: 'See full opening hours' }));
      await flush();

      fireEvent.press(screen.getByRole('button', { name: 'Close' }));

      expect(screen.queryByText('Opening hours')).toBeNull();
      expect(onBack).not.toHaveBeenCalled();
    });

    it('closes the modal (not the screen) via the platform back gesture / Android hardware back', async () => {
      const onBack = jest.fn();
      render(
        <ActivityDetailScreen activity={withStructuredHours} showDistance onBack={onBack} />,
      );
      fireEvent.press(screen.getByRole('button', { name: 'See full opening hours' }));
      await flush();

      const modal = screen.UNSAFE_getByType(Modal);
      await act(async () => modal.props.onRequestClose());

      expect(screen.queryByText('Opening hours')).toBeNull();
      expect(onBack).not.toHaveBeenCalled();
    });

    it('shows no tap affordance and no modal for the legacy-only fallback (no usable structured opening_hours)', () => {
      const legacyOnly: Activity = {
        ...activity,
        details: { category: 'restaurants', hours: '9am–11pm', open_status: 'Open now' },
      };
      render(
        <ActivityDetailScreen activity={legacyOnly} showDistance onBack={jest.fn()} />,
      );
      expect(
        screen.queryByRole('button', { name: 'See full opening hours' }),
      ).toBeNull();
    });
  });

  describe('Tripadvisor-branded block (T8)', () => {
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

    it('suppresses the Roamly gold star + numeric rating, replacing it with the aggregate plate', () => {
      render(
        <ActivityDetailScreen activity={tripadvisorActivity} showDistance onBack={jest.fn()} />,
      );
      expect(screen.queryByText('4.6')).toBeNull();
      expect(screen.getByText('1,204 reviews on Tripadvisor')).toBeTruthy();
    });

    it('keeps the gold star + numeric rating for a non-Tripadvisor row, unchanged', () => {
      render(
        <ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />,
      );
      expect(screen.getByText('4.6')).toBeTruthy();
    });

    // design-spec.md T4: "Travellers' Choice 2026" badge / dated ranking
    // text is mock-only (no Terra API ranking data) — never rendered even
    // if a caller sets `ranking_text` (the field stays on the wire type but
    // the UI ignores it, see TripadvisorAttributionPlate.test.tsx).
    it('never renders ranking_text (mock-only, out of scope)', () => {
      const withRanking: Activity = {
        ...activity,
        details: {
          category: 'restaurants',
          tripadvisor: {
            rating_image_url: 'https://tripadvisor.example/bubble.png',
            review_count: 88,
            ranking_text: '#3 of 512 Restaurants in Belgrade, June 2026',
            web_url: 'https://tripadvisor.example/place',
          },
        },
      };
      render(<ActivityDetailScreen activity={withRanking} showDistance onBack={jest.fn()} />);
      expect(screen.getByText('88 reviews on Tripadvisor')).toBeTruthy();
      expect(screen.queryByText(/#3 of 512/)).toBeNull();
    });

    it('renders the subratings grid when tripadvisor.subratings is present', () => {
      const withSubratings: Activity = {
        ...activity,
        details: {
          category: 'restaurants',
          tripadvisor: {
            rating_image_url: 'https://tripadvisor.example/bubble.png',
            review_count: 1204,
            web_url: 'https://tripadvisor.example/place',
            subratings: { food: 4.5, service: 4.0, value: 3.5, atmosphere: 5.0 },
          },
        },
      };
      render(<ActivityDetailScreen activity={withSubratings} showDistance onBack={jest.fn()} />);
      expect(screen.getByText('Food')).toBeTruthy();
      expect(screen.getByText('4.5')).toBeTruthy();
    });

    it('omits the subratings grid when absent (no empty grid)', () => {
      render(<ActivityDetailScreen activity={tripadvisorActivity} showDistance onBack={jest.fn()} />);
      expect(screen.queryByText('Food')).toBeNull();
    });

    it('renders the reviews carousel with up to 3 cards when reviews is present', () => {
      const withReviews: Activity = {
        ...activity,
        details: {
          category: 'restaurants',
          tripadvisor: {
            rating_image_url: 'https://tripadvisor.example/bubble.png',
            review_count: 1204,
            web_url: 'https://tripadvisor.example/place',
          },
          reviews: [
            { rating: 5, date: '14 June 2026', text: 'Fantastic evening.' },
            { rating: 5, date: '2 June 2026', text: 'Best meal of the trip.' },
          ],
        },
      };
      render(<ActivityDetailScreen activity={withReviews} showDistance onBack={jest.fn()} />);
      expect(screen.getByText('Tripadvisor traveler reviews')).toBeTruthy();
      expect(screen.getByText('“Fantastic evening.”')).toBeTruthy();
      expect(screen.getByText('“Best meal of the trip.”')).toBeTruthy();
      expect(screen.getByText('1 of 2')).toBeTruthy();
    });

    it('omits the reviews carousel entirely when reviews is absent (no empty state)', () => {
      render(<ActivityDetailScreen activity={tripadvisorActivity} showDistance onBack={jest.fn()} />);
      expect(screen.queryByText('Tripadvisor traveler reviews')).toBeNull();
    });

    it('renders the address row from the top-level address/city fields', () => {
      const withAddress: Activity = { ...tripadvisorActivity, address: 'Knez Mihailova 10', city: 'Belgrade' };
      render(<ActivityDetailScreen activity={withAddress} showDistance onBack={jest.fn()} />);
      expect(screen.getByText('Knez Mihailova 10, Belgrade')).toBeTruthy();
    });

    it('renders the phone row as a tel: link and opens it via Linking, surfacing the error banner on failure', async () => {
      const openURLSpy = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no phone app'));
      const withPhone: Activity = {
        ...activity,
        details: {
          category: 'restaurants',
          tripadvisor: {
            rating_image_url: 'https://tripadvisor.example/bubble.png',
            review_count: 1204,
            web_url: 'https://tripadvisor.example/place',
            phone: '+381 11 123 4567',
          },
        },
      };
      render(<ActivityDetailScreen activity={withPhone} showDistance onBack={jest.fn()} />);
      fireEvent.press(screen.getByRole('link', { name: 'Call +381 11 123 4567' }));
      await waitFor(() => expect(openURLSpy).toHaveBeenCalledWith('tel:+381 11 123 4567'));
      await waitFor(() =>
        expect(screen.getByText('Could not open the link. Please try again.')).toBeTruthy(),
      );
      openURLSpy.mockRestore();
    });

    it('omits the facts block when address and phone are both absent', () => {
      render(<ActivityDetailScreen activity={tripadvisorActivity} showDistance onBack={jest.fn()} />);
      expect(screen.queryByLabelText(/call/i)).toBeNull();
    });

    it('opens tripadvisor.web_url via the deep-link row, and surfaces the error banner on failure', async () => {
      const openURLSpy = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no browser'));
      render(
        <ActivityDetailScreen activity={tripadvisorActivity} showDistance onBack={jest.fn()} />,
      );
      fireEvent.press(screen.getByRole('button', { name: 'Read all reviews on Tripadvisor' }));
      await waitFor(() => expect(openURLSpy).toHaveBeenCalledWith('https://tripadvisor.example/place'));
      await waitFor(() =>
        expect(screen.getByText('Could not open the link. Please try again.')).toBeTruthy(),
      );
      openURLSpy.mockRestore();
    });

    it('renders the deep-link button as a filled Primary CTA, not Secondary/outlined', () => {
      render(
        <ActivityDetailScreen activity={tripadvisorActivity} showDistance onBack={jest.fn()} />,
      );
      const button = screen.getByRole('button', { name: 'Read all reviews on Tripadvisor' });
      const buttonStyle = StyleSheet.flatten(button.props.style);
      expect(buttonStyle).toMatchObject({ backgroundColor: '#CE9042', minHeight: 54 });
      expect(buttonStyle).not.toHaveProperty('borderWidth');
      const label = screen.getByText('Read all reviews on Tripadvisor');
      expect(StyleSheet.flatten(label.props.style)).toMatchObject({
        color: '#2A0E11',
        fontWeight: '700',
      });
    });

    it('renders the compliance disclaimer for a Tripadvisor row', () => {
      render(
        <ActivityDetailScreen activity={tripadvisorActivity} showDistance onBack={jest.fn()} />,
      );
      expect(
        screen.getByText(/Roamly does not rate these places/),
      ).toBeTruthy();
    });

    it('renders no disclaimer / no Tripadvisor block for a non-Tripadvisor row', () => {
      render(<ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />);
      expect(screen.queryByText(/Roamly does not rate these places/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Read all reviews on Tripadvisor' })).toBeNull();
    });

    // Bug fix: the deep-link button + disclaimer used to render mid-block,
    // inside TripadvisorBlock right after the address/phone facts — ahead of
    // the FactStrip/description/tags/map. They're now the trailing elements
    // of the scrollable content, rendered by the screen itself.
    it('renders the deep-link button and disclaimer after the description/tags/map, not inside TripadvisorBlock', () => {
      process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
      render(
        <ActivityDetailScreen
          activity={{ ...tripadvisorActivity, tags: ['wine', 'dinner'] }}
          showDistance
          onBack={jest.fn()}
        />,
      );

      const tree = JSON.stringify(screen.toJSON());
      const descriptionIndex = tree.indexOf(tripadvisorActivity.description);
      const tagIndex = tree.indexOf('wine');
      const mapIndex = tree.indexOf('activity-detail-map-image');
      const buttonIndex = tree.indexOf('Read all reviews on Tripadvisor');
      const disclaimerIndex = tree.indexOf('Roamly does not rate these places');

      expect(descriptionIndex).toBeGreaterThan(-1);
      expect(tagIndex).toBeGreaterThan(descriptionIndex);
      expect(mapIndex).toBeGreaterThan(tagIndex);
      expect(buttonIndex).toBeGreaterThan(mapIndex);
      expect(disclaimerIndex).toBeGreaterThan(buttonIndex);
    });
  });
});
