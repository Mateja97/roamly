import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo, Linking, Modal, Share, StyleSheet } from 'react-native';
import type { Activity } from '../../api/activities';
import { getActivity, getActivityPhotos } from '../../api/activities';
import { ActivityDetailScreen } from './ActivityDetailScreen';
import { CATEGORY_OPTIONS } from './filters';
import type { Category } from './types';

// T4/T6: real network calls aren't available in the Jest environment (a
// bare `fetch` throws, caught by getActivityPhotos'/getActivity's own
// try/catch) — mocking keeps that failure deterministic and lets the
// describe blocks below control resolve/reject timing.
jest.mock('../../api/activities', () => ({
  ...jest.requireActual('../../api/activities'),
  getActivityPhotos: jest.fn(),
  getActivity: jest.fn(),
}));
const mockedGetActivityPhotos = jest.mocked(getActivityPhotos);
const mockedGetActivity = jest.mocked(getActivity);

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
    // state throughout. Same for getActivity — the default `activity`
    // fixture above is 'restaurants' (never `isPlacesLive`), so its
    // resolution is irrelevant to every test that doesn't override it.
    mockedGetActivityPhotos.mockReturnValue(new Promise(() => {}));
    mockedGetActivity.mockReturnValue(new Promise(() => {}));
  });
  afterEach(() => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = originalKey;
    mockedGetActivityPhotos.mockReset();
    mockedGetActivity.mockReset();
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

  // T4 round-2 review finding: a country name is app-computed structured
  // data, not LLM-generated content — it must never be silently dropped by
  // the meta line's `scalar` kind check (>18 chars/4 words), unlike a
  // generated field failing that same check.
  it('shows a long country name in full, even past the scalar kind\'s 18-char limit', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(
      <ActivityDetailScreen
        activity={{ ...activity, country: 'Bosnia and Herzegovina' }}
        showDistance={false}
        onBack={jest.fn()}
      />,
    );
    expect(screen.getByText('Bosnia and Herzegovina')).toBeTruthy();
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

  describe('category-specific fact strip, unique section, meta line, CTA (T4/T5)', () => {
    it('renders fact strip, subcategory-derived meta subtype, open status, and the Shape A unique section for a fully-detailed Restaurants activity', () => {
      const withDetails: Activity = {
        ...activity,
        // T5: subtype comes from the `subcategory` slug, not `cuisine`
        // (badgeQualifier is retired) — `cuisine` still feeds the Cuisine
        // fact-strip chip below, unrelated to the meta line now.
        subcategory: 'fine_dining',
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

      expect(screen.getByText('Restaurant')).toBeTruthy();
      expect(screen.getByText('Fine Dining')).toBeTruthy();
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

    // T5: subtype now comes from `subcategory` (badgeQualifier/`venue_type`
    // qualifier retired). The canonical order's single per-category freedom
    // is "promote one slot above the stat grid" — Nightlife already
    // promotes its unique section ('Tonight') per its carried-over config,
    // same as before; there's no longer a way for a category to structurally
    // exclude the description slot the way the old BODY_SECTION_ORDER array
    // could, so a Nightlife activity with real description data now renders
    // it like any other category (only its *position* — promoted-unique
    // first — is preserved from the old array).
    it('shows the singular category noun + subcategory-derived subtype for Nightlife, with its unique section promoted above the stat grid', () => {
      const nightlife: Activity = {
        ...activity,
        category: 'nightlife',
        subcategory: 'nightclub',
        description: 'Renders for Nightlife too, per the canonical order',
        details: {
          category: 'nightlife',
          venue_type: 'Club',
          entry_price: '€10',
          lineup: [{ time: '22:00', act: 'DJ Set', stage: 'Main' }],
        },
      };
      render(
        <ActivityDetailScreen
          activity={nightlife}
          showDistance
          onBack={jest.fn()}
        />,
      );
      expect(screen.getByText('Nightlife')).toBeTruthy();
      expect(screen.getByText('Nightclub')).toBeTruthy();
      expect(
        screen.getByText('Renders for Nightlife too, per the canonical order'),
      ).toBeTruthy();
      // Promoted-above-stat-grid ordering preserved: "Tonight" (unique
      // section) still renders before the description block.
      const tree = JSON.stringify(screen.toJSON());
      expect(tree.indexOf('Tonight')).toBeLessThan(
        tree.indexOf('Renders for Nightlife too, per the canonical order'),
      );
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

    // T7 round-2 fix: `open_tonight` and `opening_hours` used to both feed
    // `openStatus`, so a row with usable structured hours lost the "Open
    // tonight" chip entirely (superseded by the generic hours-derived
    // status, then suppressed a second time by the `!todayRow` gate) — the
    // mockup renders the chip *and* the HoursRow together.
    it('renders the Open tonight chip alongside the HoursRow when opening_hours is also usable', () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-01-01T12:00:00Z')); // Monday, noon UTC
      const nightlife: Activity = {
        ...activity,
        category: 'nightlife',
        details: {
          category: 'nightlife',
          open_tonight: true,
          opening_hours: {
            timezone: 'UTC',
            periods: [{ day: 'monday', open: '22:00', close: '06:00' }],
          },
        },
      };
      render(
        <ActivityDetailScreen activity={nightlife} showDistance onBack={jest.fn()} />,
      );
      expect(screen.getByText('Open tonight')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'See full opening hours' })).toBeTruthy();
      jest.useRealTimers();
    });

    it("shows Entertainment's neighborhood inline in the meta row instead of a fact strip", () => {
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
      expect(screen.getByText('Dorćol')).toBeTruthy();
      expect(screen.queryByText('Genre')).toBeNull();
      // T5 round-2 fix: `genre` deliberately dropped from the meta row (see
      // `metaRowExtras`) — kept alongside neighborhood it would overflow
      // `MetaLine`'s 4-item cap once category+subtype also lead the row,
      // silently dropping neighborhood (the regression test right below).
      expect(screen.queryByText('Concerts & theatre')).toBeNull();
    });

    // T5 round-2 fix: probe-verified regression — once `metaLineLeadItems`
    // also prepends category noun + subtype, a subtype-carrying Entertainment
    // row overflowed `MetaLine`'s `MAX_ITEMS = 4` (category, subtype,
    // distance, neighborhood = 4 already), silently dropping neighborhood.
    // Pins the fix, not just the no-subtype case above.
    it('still shows the neighborhood when the row also carries a subtype (no overflow)', () => {
      const entertainment: Activity = {
        ...activity,
        category: 'entertainment',
        subcategory: 'cinema',
        details: {
          category: 'entertainment',
          genre: 'Arthouse',
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
      expect(screen.getByText('Dorćol')).toBeTruthy();
    });

    // T5 round-3 fix: probe-verified regression — category + subtype (2) +
    // distance/country (1) already fill 3 of MetaLine's 4 slots; when the
    // row also carries a neighborhood (metaExtras) *and* a single surviving
    // stat (the fold), that's 5 candidates for 4 slots and round 2's fix
    // only closed the no-fold case. The fold is the value's only home
    // (FactStrip nulls out below 2 chips) so it must survive alongside
    // neighborhood — distance/country is what yields.
    it('keeps both the neighborhood and a folded lone stat when they collide with category+subtype+distance', () => {
      const entertainment: Activity = {
        ...activity,
        category: 'entertainment',
        subcategory: 'cinema',
        details: {
          category: 'entertainment',
          neighborhood: 'Dorćol',
          price_from: 'EUR8',
        },
      };
      render(
        <ActivityDetailScreen
          activity={entertainment}
          showDistance
          onBack={jest.fn()}
        />,
      );
      expect(screen.getByText('Entertainment')).toBeTruthy();
      expect(screen.getByText('Cinema')).toBeTruthy();
      expect(screen.getByText('Dorćol')).toBeTruthy();
      expect(screen.getByText('EUR8')).toBeTruthy();
      expect(screen.queryByText(`${entertainment.distance_km.toFixed(1)} km away`)).toBeNull();
    });

    // T5 round-4 fix: round 3's `metaLineOverflow` counted assumed slots (2
    // lead items, always) rather than what actually renders, so it evicted
    // distance/country even when only 4 real candidates were competing for
    // the 4-item cap. Probe-verified regression, 3 fixtures — each should
    // keep distance visible since nothing needs to yield.
    it('keeps distance when subcategory is empty (documented unset value) leaves only 4 real candidates', () => {
      const entertainment: Activity = {
        ...activity,
        category: 'entertainment',
        subcategory: '',
        details: {
          category: 'entertainment',
          neighborhood: 'Dorćol',
          price_from: 'EUR8',
        },
      };
      render(
        <ActivityDetailScreen
          activity={entertainment}
          showDistance
          onBack={jest.fn()}
        />,
      );
      expect(screen.getByText('Entertainment')).toBeTruthy();
      expect(screen.getByText('Dorćol')).toBeTruthy();
      expect(screen.getByText('EUR8')).toBeTruthy();
      expect(
        screen.getByText(`${entertainment.distance_km.toFixed(1)} km away`),
      ).toBeTruthy();
    });

    it('keeps distance when subcategory is an off-taxonomy slug (subtype item drops out)', () => {
      const entertainment: Activity = {
        ...activity,
        category: 'entertainment',
        subcategory: 'brand_new_subtype',
        details: {
          category: 'entertainment',
          neighborhood: 'Dorćol',
          price_from: 'EUR8',
        },
      };
      render(
        <ActivityDetailScreen
          activity={entertainment}
          showDistance
          onBack={jest.fn()}
        />,
      );
      expect(screen.getByText('Entertainment')).toBeTruthy();
      expect(screen.getByText('Dorćol')).toBeTruthy();
      expect(screen.getByText('EUR8')).toBeTruthy();
      expect(
        screen.getByText(`${entertainment.distance_km.toFixed(1)} km away`),
      ).toBeTruthy();
    });

    it('keeps distance when the neighborhood is over 18 chars (classifyField drops it, one fewer real candidate)', () => {
      const entertainment: Activity = {
        ...activity,
        category: 'entertainment',
        subcategory: 'cinema',
        details: {
          category: 'entertainment',
          neighborhood: 'Stari Grad Downtown',
          price_from: 'EUR8',
        },
      };
      render(
        <ActivityDetailScreen
          activity={entertainment}
          showDistance
          onBack={jest.fn()}
        />,
      );
      expect(screen.getByText('Entertainment')).toBeTruthy();
      expect(screen.getByText('Cinema')).toBeTruthy();
      expect(screen.getByText('EUR8')).toBeTruthy();
      expect(screen.queryByText('Stari Grad Downtown')).toBeNull();
      expect(
        screen.getByText(`${entertainment.distance_km.toFixed(1)} km away`),
      ).toBeTruthy();
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

    // T8: Kids/Culture/Art screen compositions.
    describe('Kids/Culture/Art composition (T8)', () => {
      it("shows Kids' meta line as `Kids · <subtype> · Ages X–Y · <distance>`, no stat grid, description promoted above Facilities", () => {
        const kids: Activity = {
          ...activity,
          category: 'kids',
          subcategory: 'playground',
          description: 'A shaded playground with a small splash pad.',
          details: {
            category: 'kids',
            age_range: '3-10',
            facilities: ['Parking', 'Restrooms'],
          },
        };
        render(<ActivityDetailScreen activity={kids} showDistance onBack={jest.fn()} />);
        expect(screen.getByText('Kids')).toBeTruthy();
        expect(screen.getByText('Playground')).toBeTruthy();
        expect(screen.getByText('Ages 3-10')).toBeTruthy();
        expect(screen.getByText(`${kids.distance_km.toFixed(1)} km away`)).toBeTruthy();
        // No stat grid — Facilities uses the existing icongrid shape.
        expect(screen.getByText('Facilities')).toBeTruthy();
        expect(screen.getByText('Parking')).toBeTruthy();
        // Promoted slot: description renders before Facilities.
        const tree = JSON.stringify(screen.toJSON());
        expect(tree.indexOf('A shaded playground with a small splash pad.')).toBeLessThan(
          tree.indexOf('Facilities'),
        );
      });

      it('omits the Ages line for Kids when age_range is absent, without breaking the meta line', () => {
        const kids: Activity = {
          ...activity,
          category: 'kids',
          subcategory: 'playground',
          details: { category: 'kids', facilities: ['Parking'] },
        };
        render(<ActivityDetailScreen activity={kids} showDistance onBack={jest.fn()} />);
        expect(screen.getByText('Kids')).toBeTruthy();
        expect(screen.getByText('Playground')).toBeTruthy();
        expect(screen.queryByText(/^Ages /)).toBeNull();
      });

      // Venue matching the subtype leaves Tickets as the only surviving
      // chip — the stat grid's own degradation rule (1 survivor folds into
      // the meta line, unlabelled) applies here same as any other category,
      // so "Tickets" the label never renders; only its value does.
      it("folds Culture's lone Tickets value into the meta line and promotes the Now-showing banner, Venue omitted when it matches the subtype", () => {
        const culture: Activity = {
          ...activity,
          category: 'culture',
          subcategory: 'historical_site',
          details: {
            category: 'culture',
            venue_type: 'Historical Site',
            ticket_price: '€10',
            now_showing: { title: 'Roman Belgrade, Rebuilt', description: 'Until 14 September.' },
          },
        };
        render(<ActivityDetailScreen activity={culture} showDistance onBack={jest.fn()} />);
        expect(screen.getByText('€10')).toBeTruthy();
        expect(screen.queryByText('Tickets')).toBeNull();
        expect(screen.queryByText('Venue')).toBeNull();
        // The folded value lives in the title-block meta line, which
        // precedes every body section (including the promoted banner) in
        // DOM order regardless of promotion — promotion only orders the
        // banner relative to the *other* body sections.
        const tree = JSON.stringify(screen.toJSON());
        expect(tree.indexOf('€10')).toBeLessThan(tree.indexOf('Now showing'));
      });

      it("shows Culture's Tickets and Venue stats as a 2-column grid when Venue differs from the subtype", () => {
        const culture: Activity = {
          ...activity,
          category: 'culture',
          subcategory: 'historical_site',
          details: { category: 'culture', venue_type: 'Fortress', ticket_price: '€10' },
        };
        render(<ActivityDetailScreen activity={culture} showDistance onBack={jest.fn()} />);
        expect(screen.getByText('Fortress')).toBeTruthy();
        expect(screen.getByText('Venue')).toBeTruthy();
        expect(screen.getByText('€10')).toBeTruthy();
        expect(screen.getByText('Tickets')).toBeTruthy();
      });

      // Art never has a second stat to pair with Tickets (no Venue chip at
      // all), so the lone value always folds the same way Culture's does
      // above — this pins "no Venue, ever" rather than "Venue happens to be
      // absent this time".
      it("folds Art's lone Tickets value into the meta line, never showing a Venue chip even though venue_type differs from the subtype", () => {
        const art: Activity = {
          ...activity,
          category: 'art',
          subcategory: 'art_museum',
          details: {
            category: 'art',
            venue_type: 'Museum',
            ticket_price: '€6',
            current_exhibition: { title: 'Bodies of Evidence' },
          },
        };
        render(<ActivityDetailScreen activity={art} showDistance onBack={jest.fn()} />);
        expect(screen.getByText('€6')).toBeTruthy();
        expect(screen.queryByText('Tickets')).toBeNull();
        expect(screen.queryByText('Venue')).toBeNull();
        expect(screen.queryByText('Museum')).toBeNull();
        const tree = JSON.stringify(screen.toJSON());
        expect(tree.indexOf('€6')).toBeLessThan(tree.indexOf('Current exhibition'));
      });
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

    it('omits the bottom-bar price-context line for wellness even when price_from is present', () => {
      const wellness: Activity = {
        ...activity,
        category: 'wellness',
        details: { category: 'wellness', price_from: '€25' },
      };
      render(
        <ActivityDetailScreen activity={wellness} showDistance onBack={jest.fn()} />,
      );
      expect(screen.queryByText(/^From /)).toBeNull();
    });

    it('shows the bottom-bar price-context line for entertainment when price_from is present', () => {
      const entertainment: Activity = {
        ...activity,
        category: 'entertainment',
        details: { category: 'entertainment', price_from: '€8' },
      };
      render(
        <ActivityDetailScreen activity={entertainment} showDistance onBack={jest.fn()} />,
      );
      expect(screen.getByText('From €8')).toBeTruthy();
    });

    it('omits the price-context line entirely when price_from is absent', () => {
      const wellness: Activity = {
        ...activity,
        category: 'wellness',
        details: { category: 'wellness' },
      };
      render(
        <ActivityDetailScreen activity={wellness} showDistance onBack={jest.fn()} />,
      );
      expect(screen.queryByText(/^From /)).toBeNull();
    });

    it('renders a Good to know checklist for a wellness activity that has good_to_know data', () => {
      const wellness: Activity = {
        ...activity,
        category: 'wellness',
        details: {
          category: 'wellness',
          good_to_know: ['Towel, robe and slippers included'],
        },
      };
      render(
        <ActivityDetailScreen activity={wellness} showDistance onBack={jest.fn()} />,
      );
      expect(screen.getByText('Good to know')).toBeTruthy();
      expect(screen.getByText('Towel, robe and slippers included')).toBeTruthy();
    });
  });

  // T7: design-spec.md's Nightlife/Nature/Sport screen compositions —
  // render-level checks alongside activityDetailConfig.test.ts's
  // function-level coverage of the same fields. Each Nightlife/Nature test
  // below also asserts no difficulty meter renders (acceptance criteria:
  // "confirm, via a test, that Sport is the only category rendering the
  // difficulty meter" — the Sport test asserts the positive case).
  describe('Nightlife, Nature, Sport screen compositions (T7)', () => {
    it('renders the Nightlife stat grid (Entry/Dress code/Opens), the promoted Tonight lineup, and the bottom price line', () => {
      const nightlife: Activity = {
        ...activity,
        category: 'nightlife',
        details: {
          category: 'nightlife',
          entry_price: '€10',
          dress_code: 'Smart casual',
          opens_time: '23:00',
          lineup: [{ time: '22:00', act: 'DJ Set', stage: 'Main' }],
        },
      };
      render(<ActivityDetailScreen activity={nightlife} showDistance onBack={jest.fn()} />);
      expect(screen.getByText('Entry')).toBeTruthy();
      expect(screen.getByText('Dress code')).toBeTruthy();
      expect(screen.getByText('Opens')).toBeTruthy();
      expect(screen.getByText('Tonight')).toBeTruthy();
      expect(screen.getByText('DJ Set')).toBeTruthy();
      expect(screen.getByText('From €10')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Guest list' })).toBeTruthy();
      // Promoted above the stat grid: Tonight precedes the Entry chip.
      const tree = JSON.stringify(screen.toJSON());
      expect(tree.indexOf('Tonight')).toBeLessThan(tree.indexOf('Entry'));
      // T7 cross-check: "no category shows both" the difficulty meter and a
      // status/level chip — Nightlife never renders it (Sport-only slot).
      expect(screen.queryByText('Difficulty')).toBeNull();
    });

    it('renders the Nature stat grid (Time to spend/Best time/Cost), the Good to know checklist, and Get directions/Share', () => {
      const nature: Activity = {
        ...activity,
        category: 'nature',
        details: {
          category: 'nature',
          time_to_spend: '2 h',
          best_time: 'Morning',
          cost: 'Free',
          good_to_know: ['Bring water'],
        },
      };
      render(<ActivityDetailScreen activity={nature} showDistance onBack={jest.fn()} />);
      expect(screen.getByText('Time to spend')).toBeTruthy();
      expect(screen.getByText('Best time')).toBeTruthy();
      expect(screen.getByText('Cost')).toBeTruthy();
      expect(screen.getByText('Good to know')).toBeTruthy();
      expect(screen.getByText('Bring water')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Get directions' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
      // No status chip for Nature (venue type has no open/closed state).
      expect(screen.queryByText('Open')).toBeNull();
      expect(screen.queryByText('Closed')).toBeNull();
      // T7 cross-check: Nature never renders the Sport-only difficulty meter.
      expect(screen.queryByText('Difficulty')).toBeNull();
    });

    it('renders the Sport stat grid (Effort/Duration/Gear) and the What to bring checklist, below the promoted difficulty meter', () => {
      const sport: Activity = {
        ...activity,
        category: 'sport',
        details: {
          category: 'sport',
          difficulty: 4,
          effort_level: 'High',
          duration: '2 h',
          gear: 'Boots',
          what_to_bring: ['Water bottle'],
        },
      };
      render(<ActivityDetailScreen activity={sport} showDistance onBack={jest.fn()} />);
      expect(screen.getByText('Advanced')).toBeTruthy(); // DifficultyMeter's level readout
      expect(screen.getByText('Effort')).toBeTruthy();
      expect(screen.getByText('Duration')).toBeTruthy();
      expect(screen.getByText('Gear')).toBeTruthy();
      expect(screen.getByText('What to bring')).toBeTruthy();
      expect(screen.getByText('Water bottle')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Book session' })).toBeTruthy();
      // Promoted above the stat grid: the meter's overline precedes Effort.
      const tree = JSON.stringify(screen.toJSON());
      expect(tree.indexOf('Difficulty')).toBeLessThan(tree.indexOf('Effort'));
    });
  });

  // T9: the exact reported production payload — see design-spec.md's "The
  // problem" section. This is the single most important test in the whole
  // pipeline run: it proves the client-side typed-slot contract alone
  // (T3/T4/T5/T9, with no backend change in this fixture) already fixes the
  // reported symptom.
  describe('production-bug regression fixture (T9)', () => {
    const wellnessBug: Activity = {
      ...activity,
      category: 'wellness',
      details: {
        category: 'wellness',
        // Full-sentence hedges in fields sized for a scalar — the exact
        // reported strings.
        typical_visit: 'Vreme posete nije eksplicitno navedeno.',
        price_from: 'Početna cena nije navedena za najjeftiniju uslugu.',
        // Three "not specified" price placeholders, same denylisted string
        // the backend guard (T1) now refuses to write for new/re-synced
        // rows — this fixture represents an already-stored legacy row.
        treatments: [
          { item: 'Swedish massage', price: 'Nije navedeno' },
          { item: 'Deep tissue massage', price: 'Nije navedeno' },
          { item: 'Hot stone massage', price: 'Nije navedeno' },
        ],
        // Sport-equipment boilerplate on a spa page — included for fidelity
        // to the real payload, but NOT asserted absent below. See the
        // comment further down for why.
        good_to_know: ['Koristimo najnoviju sportsku opremu'],
      },
    };

    it('closes all 4 scalar-shape defects: both stat tiles absent, all 3 treatment prices omitted (rows kept)', () => {
      render(
        <ActivityDetailScreen activity={wellnessBug} showDistance onBack={jest.fn()} />,
      );

      // Stat grid: both tiles fail `classifyField('scalar', …)` (over the
      // 4-word cap, terminal punctuation) — 0 survivors, so the grid itself
      // doesn't render at all (not a dash, not the raw sentence).
      expect(screen.queryByText('Typical visit')).toBeNull();
      expect(screen.queryByText('Price from')).toBeNull();
      expect(screen.queryByText(/Vreme posete/)).toBeNull();
      expect(screen.queryByText(/Početna cena/)).toBeNull();

      // Treatments: all 3 rows render by name — the row survives (`name` is
      // present), only the trailing price is dropped, per-row.
      expect(screen.getByText('Swedish massage')).toBeTruthy();
      expect(screen.getByText('Deep tissue massage')).toBeTruthy();
      expect(screen.getByText('Hot stone massage')).toBeTruthy();
      expect(screen.queryByText('Nije navedeno')).toBeNull();
      expect(screen.queryByText(/from Nije/)).toBeNull();
    });

    // The bug report's good_to_know string is well-formed by the phrase
    // contract: 35 chars, 4 words, no terminal punctuation — it passes
    // `classifyField('phrase', …)` cleanly and always will, by design (the
    // client-side contract is scoped to *shape*, not semantic relevance —
    // see design-spec.md's Decision section). It still renders here, and
    // that's expected: the fix for this specific string is T2's already-
    // merged venue-specific good_to_know prompt rewrite (PR #128), which
    // stops it being generated for new/re-synced rows. This fixture
    // represents an already-stored legacy row, which T9's client-side guard
    // was never going to (and isn't meant to) scrub retroactively.
    // `goodToKnowSection`'s own phrase-kind guard (real T9 scope) is
    // covered separately in activityDetailConfig.test.ts with a genuinely
    // shape-violating example.
    it('still renders the sport-equipment boilerplate — a content-relevance defect T2 fixes at generation time, not a shape defect this contract catches', () => {
      render(
        <ActivityDetailScreen activity={wellnessBug} showDistance onBack={jest.fn()} />,
      );
      expect(screen.getByText('Koristimo najnoviju sportsku opremu')).toBeTruthy();
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
      // The opened PhotoViewerModal's FlatLists schedule their own cell-render
      // update on a timer — wait for it to settle instead of asserting
      // immediately, so it doesn't land outside act() after the test returns.
      await waitFor(() => expect(screen.getByText('1 / 3')).toBeTruthy());
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

  describe('live-details upgrade fetch — seed → skeleton → merge (T6)', () => {
    // Places-sourced row, post-migration: empty at seed (rating 0, blank
    // description, `details` with only the category stamped on) — every
    // Places-backed block should skeleton while getActivity(id) is pending.
    const placesActivity: Activity = {
      id: '2',
      title: 'Kafeterija',
      description: '',
      category: 'cafes',
      location: { lat: 44.8, lng: 20.46 },
      country: 'Serbia',
      rating: 0,
      image_refs: [{ uri: 'https://example.com/cafe.jpg' }],
      tags: [],
      distance_km: 0.2,
      details: { category: 'cafes' },
    };

    it('fetches getActivity(id) on mount', () => {
      render(<ActivityDetailScreen activity={placesActivity} showDistance onBack={jest.fn()} />);
      expect(mockedGetActivity).toHaveBeenCalledWith(placesActivity.id);
    });

    it('seeds render from the passed activity immediately, before the fetch resolves', () => {
      render(<ActivityDetailScreen activity={placesActivity} showDistance onBack={jest.fn()} />);
      expect(screen.getByText('Kafeterija')).toBeTruthy();
      expect(screen.getByText('0.2 km away')).toBeTruthy();
    });

    it('skeletons the rating/description/reviews blocks while pending (cafes)', () => {
      render(<ActivityDetailScreen activity={placesActivity} showDistance onBack={jest.fn()} />);
      expect(screen.getByTestId('rating-skeleton')).toBeTruthy();
      // T4 (activity-detail-system): cafes' only live-fillable fact-strip
      // field was `opening_hours`, now owned by HoursRow (not skeletoned —
      // its presence genuinely depends on data, design-spec.md's Screen-
      // level loading rule) — no fact-strip skeleton left to reserve.
      expect(screen.queryByTestId('fact-strip-skeleton')).toBeNull();
      expect(screen.getByTestId('description-skeleton')).toBeTruthy();
      expect(screen.getByTestId('reviews-skeleton')).toBeTruthy();
      // cafes' unique-section field (`on_the_bar`) is never in T1's live
      // mapper output (design-spec.md rule 2) — no guaranteed
      // flash-then-collapse skeleton for it.
      expect(screen.queryByTestId('unique-section-skeleton')).toBeNull();
    });

    it('skeletons the unique-section block for a category the live mapper can actually fill (nature)', () => {
      const natureActivity: Activity = { ...placesActivity, id: '3', category: 'nature', details: { category: 'nature' } };
      render(<ActivityDetailScreen activity={natureActivity} showDistance onBack={jest.fn()} />);
      expect(screen.getByTestId('unique-section-skeleton')).toBeTruthy();
      // nature's fact-strip fields (time_to_spend/best_time/cost) are never
      // in the mapper's output either — no skeleton for that block.
      expect(screen.queryByTestId('fact-strip-skeleton')).toBeNull();
    });

    it('merges the live fields onto local state on success, replacing every skeleton with real content', async () => {
      mockedGetActivity.mockResolvedValue({
        status: 'success',
        activity: {
          ...placesActivity,
          rating: 4.5,
          // T4 (activity-detail-system): ReviewsSection's score header needs
          // this alongside `rating` — regression coverage for the merge
          // effect actually copying it onto local state.
          review_count: 128,
          details: {
            category: 'cafes',
            known_for_brew: 'Turkish coffee',
            hours: '8am–8pm',
            on_the_bar: [{ name: 'Baklava', price: '€3' }],
          },
          description: 'Cozy corner cafe with a garden terrace.',
          google_reviews: [
            {
              authorAttribution: { displayName: 'Ana K.', uri: 'https://maps.google.com/contrib/1' },
              rating: 5,
              text: 'Best coffee in town.',
              date: '2026-06-01T00:00:00Z',
            },
          ],
          google_maps_uri: 'https://maps.google.com/place/xyz',
        },
      });
      render(<ActivityDetailScreen activity={placesActivity} showDistance onBack={jest.fn()} />);

      await waitFor(() => expect(screen.getByText('128 reviews')).toBeTruthy());
      expect(screen.getByText('Turkish coffee')).toBeTruthy();
      expect(screen.getByText('Cozy corner cafe with a garden terrace.')).toBeTruthy();
      expect(screen.getByText('Baklava')).toBeTruthy();
      expect(screen.getByTestId('google-attribution-plate-detail')).toBeTruthy();
      // T5 round-2 fix: the footer copy of the plate is suppressed once the
      // reviews card above is showing (its own `detail`-variant attribution
      // plate already carries the "View on Google Maps" link) — otherwise
      // the same link renders twice, right on top of each other.
      expect(screen.queryByTestId('google-attribution-plate-footer')).toBeNull();
      expect(screen.getAllByText('View on Google Maps')).toHaveLength(1);

      // T4 round-2 review finding: the aggregate score has exactly one home
      // once the Reviews slot is genuinely showing it — the title-block gold
      // star must not duplicate it.
      expect(screen.getAllByText('4.5')).toHaveLength(1);

      // Every placeholder is gone — one settle, not a per-block cascade.
      expect(screen.queryByTestId('rating-skeleton')).toBeNull();
      expect(screen.queryByTestId('fact-strip-skeleton')).toBeNull();
      expect(screen.queryByTestId('description-skeleton')).toBeNull();
      expect(screen.queryByTestId('unique-section-skeleton')).toBeNull();
      expect(screen.queryByTestId('reviews-skeleton')).toBeNull();
    });

    it('caps Google review cards at 3, even when the merge carries more', async () => {
      mockedGetActivity.mockResolvedValue({
        status: 'success',
        activity: {
          ...placesActivity,
          rating: 4.1,
          review_count: 4,
          google_reviews: Array.from({ length: 4 }, (_, i) => ({
            authorAttribution: { displayName: `Reviewer ${i}`, uri: `https://maps.google.com/contrib/${i}` },
            rating: 5,
            text: `Review number ${i}.`,
            date: '2026-06-01T00:00:00Z',
          })),
        },
      });
      render(<ActivityDetailScreen activity={placesActivity} showDistance onBack={jest.fn()} />);

      await waitFor(() => expect(screen.getByText('4 reviews')).toBeTruthy());
      expect(screen.getAllByTestId('google-review-row')).toHaveLength(3);
    });

    it('silently drops every skeletoned block on failure — no error UI, seeded page intact', async () => {
      mockedGetActivity.mockResolvedValue({ status: 500, message: 'boom' });
      render(<ActivityDetailScreen activity={placesActivity} showDistance onBack={jest.fn()} />);

      await waitFor(() => expect(mockedGetActivity).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByTestId('rating-skeleton')).toBeNull());

      expect(screen.queryByText('boom')).toBeNull();
      expect(screen.queryByTestId('fact-strip-skeleton')).toBeNull();
      expect(screen.queryByTestId('description-skeleton')).toBeNull();
      expect(screen.queryByTestId('unique-section-skeleton')).toBeNull();
      expect(screen.queryByTestId('reviews-skeleton')).toBeNull();
      expect(screen.queryByTestId('google-attribution-plate-detail')).toBeNull();
      expect(screen.queryByTestId('google-attribution-plate-footer')).toBeNull();
      // The rating block genuinely collapses too — no fabricated "0.0",
      // no leftover star, matching every other Places-backed block.
      expect(screen.queryByTestId('rating-skeleton')).toBeNull();
      expect(screen.queryByText('0.0')).toBeNull();
      // The seeded page itself is unaffected.
      expect(screen.getByText('Kafeterija')).toBeTruthy();
      expect(screen.getByTestId('activity-detail-hero-image-0')).toBeTruthy();
    });

    it('never renders the Google attribution plate or any Places skeleton for a Tripadvisor-sourced row', () => {
      render(<ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />);
      expect(screen.queryByTestId('google-attribution-plate-detail')).toBeNull();
      expect(screen.queryByTestId('google-attribution-plate-footer')).toBeNull();
      expect(screen.queryByTestId('rating-skeleton')).toBeNull();
      expect(screen.queryByTestId('reviews-skeleton')).toBeNull();
    });

    it('never fires getActivity for a Tripadvisor-sourced row (no wasted round trip)', () => {
      render(<ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />);
      expect(mockedGetActivity).not.toHaveBeenCalled();
    });

    // Cafés is the one dual-sourced category (#103/#104): a café can be
    // Places-live (placesActivity above) OR Tripadvisor-sourced. This is the
    // case those two "restaurants row" tests above don't actually cover
    // (restaurants is never in PLACES_LIVE_CATEGORIES to begin with) — a
    // café that's genuinely both must still resolve to Tripadvisor-only.
    it('treats a Tripadvisor-sourced café as Tripadvisor-only, never Places-live', () => {
      const tripadvisorCafe: Activity = {
        ...placesActivity,
        details: {
          category: 'cafes',
          tripadvisor: {
            rating_image_url: 'https://tripadvisor.example/bubble.png',
            review_count: 104,
            web_url: 'https://tripadvisor.example/place',
          },
        },
      };
      render(<ActivityDetailScreen activity={tripadvisorCafe} showDistance onBack={jest.fn()} />);
      expect(mockedGetActivity).not.toHaveBeenCalled();
      expect(screen.queryByTestId('google-attribution-plate-detail')).toBeNull();
      expect(screen.queryByTestId('google-attribution-plate-footer')).toBeNull();
      expect(screen.queryByTestId('rating-skeleton')).toBeNull();
      expect(screen.queryByTestId('reviews-skeleton')).toBeNull();
      expect(screen.queryByTestId('fact-strip-skeleton')).toBeNull();
      expect(screen.queryByTestId('description-skeleton')).toBeNull();
      expect(screen.getByText('104 reviews on Tripadvisor')).toBeTruthy();
    });

    it('announces the loading status only for a Places-live category, not a Tripadvisor row', () => {
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      render(<ActivityDetailScreen activity={placesActivity} showDistance onBack={jest.fn()} />);
      expect(announce).toHaveBeenCalledWith('Loading place details');
      announce.mockClear();
      render(<ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />);
      expect(announce).not.toHaveBeenCalled();
    });

    it('does not announce "added" when the merge collapses every block (nothing new arrived)', async () => {
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      mockedGetActivity.mockResolvedValue({ status: 'success', activity: { ...placesActivity } });
      render(<ActivityDetailScreen activity={placesActivity} showDistance onBack={jest.fn()} />);
      await waitFor(() => expect(mockedGetActivity).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByTestId('rating-skeleton')).toBeNull());
      expect(announce).toHaveBeenCalledWith('Loading place details');
      expect(announce).not.toHaveBeenCalledWith('Place details added');
    });
  });

  describe('Hours row (opening-hours T1+T3, relocated out of FactStrip by T4)', () => {
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

    it('renders the FactStrip grid and the standalone HoursRow together without either pushing the other out', () => {
      const cultureVenue: Activity = {
        ...activity,
        category: 'culture',
        details: {
          category: 'culture',
          venue_type: 'Fortress',
          ticket_price: '€10',
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
      // FactStrip's own 2-chip grid (Hours no longer among them — T4 moved
      // it to its own row) …
      expect(screen.getByText('Fortress')).toBeTruthy();
      expect(screen.getByText('Venue')).toBeTruthy();
      expect(screen.getByText('€10')).toBeTruthy();
      // … and the standalone HoursRow, both present.
      expect(screen.getByText('09:00–17:00')).toBeTruthy();
    });

    it('folds a single surviving fact-strip value into the meta line instead of a 1-cell grid', () => {
      // Only `venue_type` survives (no ticket_price) — the stat grid's own
      // degradation rule (design-spec.md) folds the lone value into the
      // meta line rather than rendering a 1-cell grid.
      const cultureVenue: Activity = {
        ...activity,
        category: 'culture',
        details: { category: 'culture', venue_type: 'Fortress' },
      };
      render(
        <ActivityDetailScreen
          activity={cultureVenue}
          showDistance
          onBack={jest.fn()}
        />,
      );
      expect(screen.getByText('Fortress')).toBeTruthy();
      expect(screen.queryByText('Venue')).toBeNull(); // the chip's label doesn't survive the fold, only its value
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

    it('legacy-only fallback: the free-text hours value folds into the meta line (sole surviving fact-strip value), meta-row status unaffected, no regression', () => {
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
      // '9am–11pm' is the lone surviving fact-strip value (restaurants has
      // no cuisine/price here) — the stat grid's own degradation rule folds
      // it into the meta line rather than a 1-cell grid.
      expect(screen.getByText('9am–11pm')).toBeTruthy();
      expect(screen.getByText('Open now')).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: 'See full opening hours' }),
      ).toBeNull();
    });

    it('falls back to the legacy hours value (folded into the meta line) when opening_hours has an unresolvable timezone', () => {
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

    it('shows no tap affordance and no modal for the legacy-only fallback (no usable structured opening_hours)', async () => {
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
      // The map preview's Skeleton mounts a reduce-motion effect that
      // resolves asynchronously — flush it before the test ends so it
      // doesn't land outside act() during the next test.
      await flush();
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

    it('suppresses the Roamly gold star, replacing it with the aggregate plate (Tripadvisor\'s own rating + count)', () => {
      render(
        <ActivityDetailScreen activity={tripadvisorActivity} showDistance onBack={jest.fn()} />,
      );
      // "4.6" now comes from the plate itself (activity.rating, threaded
      // through as Tripadvisor's own rating for a TA-sourced row) — not from
      // the suppressed gold-star row, which never renders for a Tripadvisor row.
      expect(screen.getByText('4.6')).toBeTruthy();
      expect(screen.getByText('1,204 reviews on Tripadvisor')).toBeTruthy();
    });

    it('keeps the gold star + numeric rating for a non-Tripadvisor row, unchanged', () => {
      render(
        <ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />,
      );
      expect(screen.getByText('4.6')).toBeTruthy();
    });

    it('renders the dated ranking sentence verbatim, appended to the review count context line', () => {
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
      expect(
        screen.getByText('88 reviews on Tripadvisor · #3 of 512 Restaurants in Belgrade, June 2026'),
      ).toBeTruthy();
    });

    it('omits the ranking sentence when absent (no dangling separator)', () => {
      render(
        <ActivityDetailScreen activity={tripadvisorActivity} showDistance onBack={jest.fn()} />,
      );
      expect(screen.getByText('1,204 reviews on Tripadvisor')).toBeTruthy();
    });

    it('renders the Travelers\' Choice badge when award is present', () => {
      const withAward: Activity = {
        ...activity,
        details: {
          category: 'restaurants',
          tripadvisor: {
            rating_image_url: 'https://tripadvisor.example/bubble.png',
            review_count: 1204,
            web_url: 'https://tripadvisor.example/place',
            award: { name: "Travelers' Choice", year: 2026 },
          },
        },
      };
      render(<ActivityDetailScreen activity={withAward} showDistance onBack={jest.fn()} />);
      expect(screen.getByText("Travelers' Choice 2026")).toBeTruthy();
    });

    it('omits the Travelers\' Choice badge when award is absent (no empty badge)', () => {
      render(
        <ActivityDetailScreen activity={tripadvisorActivity} showDistance onBack={jest.fn()} />,
      );
      expect(screen.queryByText(/Travelers' Choice/)).toBeNull();
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
            subratings: {
              food: { rating: 4.5 },
              service: { rating: 4.0 },
              value: { rating: 3.5 },
              atmosphere: { rating: 5.0 },
            },
          },
        },
      };
      render(<ActivityDetailScreen activity={withSubratings} showDistance onBack={jest.fn()} />);
      expect(screen.getByText('Food')).toBeTruthy();
      expect(screen.getByText('4.5')).toBeTruthy();
    });

    it('renders the subrating bubble image (compliance rule 02) when the aspect carries an icon_url', () => {
      const withImage: Activity = {
        ...activity,
        details: {
          category: 'restaurants',
          tripadvisor: {
            rating_image_url: 'https://tripadvisor.example/bubble.png',
            review_count: 1204,
            web_url: 'https://tripadvisor.example/place',
            subratings: {
              food: { rating: 4.5, icon_url: 'https://tripadvisor.example/food-bubble.png' },
            },
          },
        },
      };
      render(<ActivityDetailScreen activity={withImage} showDistance onBack={jest.fn()} />);
      expect(screen.getByTestId('subrating-bubble-food')).toBeTruthy();
      expect(screen.queryByText('4.5')).toBeNull();
    });

    describe('§5b eyebrow line + cuisine subtitle', () => {
      it('renders category · price level · distance above the title', () => {
        const withPriceLevel: Activity = {
          ...activity,
          details: {
            category: 'restaurants',
            tripadvisor: {
              rating_image_url: 'https://tripadvisor.example/bubble.png',
              review_count: 1204,
              web_url: 'https://tripadvisor.example/place',
              price_level: 'Mid Range',
            },
          },
        };
        render(<ActivityDetailScreen activity={withPriceLevel} showDistance onBack={jest.fn()} />);
        expect(screen.getByText(`Restaurant · Mid Range · ${activity.distance_km.toFixed(1)} km away`)).toBeTruthy();
      });

      it('omits price level from the eyebrow when absent (category + distance only, no dangling separator)', () => {
        render(
          <ActivityDetailScreen activity={tripadvisorActivity} showDistance onBack={jest.fn()} />,
        );
        expect(screen.getByText(`Restaurant · ${activity.distance_km.toFixed(1)} km away`)).toBeTruthy();
      });

      it('renders no eyebrow at all for a non-Tripadvisor row', () => {
        render(<ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />);
        expect(screen.queryByText(new RegExp(`^Restaurant · `))).toBeNull();
      });

      it('renders the cuisine subtitle beneath the title when present', () => {
        const withCuisine: Activity = {
          ...activity,
          details: {
            category: 'restaurants',
            tripadvisor: {
              rating_image_url: 'https://tripadvisor.example/bubble.png',
              review_count: 1204,
              web_url: 'https://tripadvisor.example/place',
              cuisine: 'Fine Dining',
            },
          },
        };
        render(<ActivityDetailScreen activity={withCuisine} showDistance onBack={jest.fn()} />);
        expect(screen.getByText('Fine Dining')).toBeTruthy();
      });

      it('omits the cuisine subtitle when absent (no empty line)', () => {
        render(
          <ActivityDetailScreen activity={tripadvisorActivity} showDistance onBack={jest.fn()} />,
        );
        expect(screen.queryByText('Fine Dining')).toBeNull();
      });
    });

    // §5b: the eyebrow *replaces* the badge pill (category) and the meta
    // row's distance segment for a Tripadvisor row — each fact shows
    // exactly once, never twice. Non-Tripadvisor rows must stay untouched.
    describe('§5b eyebrow replaces the badge pill + meta-row distance (no duplicate facts)', () => {
      it('shows category exactly once for a Tripadvisor row (eyebrow only, badge pill suppressed)', () => {
        render(
          <ActivityDetailScreen activity={tripadvisorActivity} showDistance onBack={jest.fn()} />,
        );
        expect(screen.getByText(`Restaurant · ${activity.distance_km.toFixed(1)} km away`)).toBeTruthy();
        // The badge pill would render exactly "Restaurant" alone (no
        // qualifier data on this fixture) — a separate, shorter string from
        // the eyebrow's full text, so this only passes if the pill itself
        // is gone, not just coincidentally out-matched.
        expect(screen.queryByText('Restaurant')).toBeNull();
      });

      it('shows distance exactly once for a Tripadvisor row (eyebrow only, meta-row MapPin+distance suppressed)', () => {
        render(
          <ActivityDetailScreen activity={tripadvisorActivity} showDistance onBack={jest.fn()} />,
        );
        const distanceMatches = screen.getAllByText(
          new RegExp(`${activity.distance_km.toFixed(1)} km away`),
        );
        expect(distanceMatches).toHaveLength(1);
      });

      it('keeps the badge pill, rating star, and full meta-row distance unchanged for a non-Tripadvisor row', () => {
        render(<ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />);
        expect(screen.getByText('Restaurant')).toBeTruthy();
        expect(screen.getByText('4.6')).toBeTruthy();
        expect(screen.getByText(`${activity.distance_km.toFixed(1)} km away`)).toBeTruthy();
      });

      it('keeps showing the legacy Open/Closed status for a Tripadvisor row when present, with no dangling leading separator', () => {
        const withStatus: Activity = {
          ...activity,
          details: {
            category: 'restaurants',
            open_status: 'Open now',
            tripadvisor: {
              rating_image_url: 'https://tripadvisor.example/bubble.png',
              review_count: 1204,
              web_url: 'https://tripadvisor.example/place',
            },
          },
        };
        render(<ActivityDetailScreen activity={withStatus} showDistance onBack={jest.fn()} />);
        expect(screen.getByText('Open now')).toBeTruthy();
        expect(screen.queryByText('·')).toBeNull();
        expect(
          screen.getAllByText(new RegExp(`${activity.distance_km.toFixed(1)} km away`)),
        ).toHaveLength(1);
      });
    });

    it('drops the Cuisine/Price fact-strip chips for a Tripadvisor row (carried by the eyebrow/subtitle instead)', () => {
      const taWithLegacyFields: Activity = {
        ...activity,
        details: {
          category: 'restaurants',
          cuisine: 'Italian',
          price_tier: '€€',
          tripadvisor: {
            rating_image_url: 'https://tripadvisor.example/bubble.png',
            review_count: 1204,
            web_url: 'https://tripadvisor.example/place',
          },
        },
      };
      render(<ActivityDetailScreen activity={taWithLegacyFields} showDistance onBack={jest.fn()} />);
      expect(screen.queryByText('Cuisine')).toBeNull();
      expect(screen.queryByText('Italian')).toBeNull();
      expect(screen.queryByText('Price')).toBeNull();
      expect(screen.queryByText('€€')).toBeNull();
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

  // T6 (design-spec.md §C, Restaurants/Bars/Cafés entries): the three
  // screens' final compositions, using T5's canonical-order/promote
  // mechanism and T4's slots. Order/promote-mechanism unit coverage already
  // exists generically in activityDetailConfig.test.ts's `bodySectionOrder`
  // describe (T5) — these are the end-to-end renders per category.
  describe('T6: Restaurants/Bars/Cafés final composition', () => {
    it('Restaurants (Tripadvisor): meta line reads category · subtype · price level · distance, no stat grid (price level already in the meta line), Popular dishes renders as nameprice, description before the unique section, CTA is Book a table', () => {
      const restaurant: Activity = {
        ...activity,
        subcategory: 'fine_dining',
        description: 'A candle-lit dining room with an open kitchen.',
        details: {
          category: 'restaurants',
          tripadvisor: {
            rating_image_url: 'https://tripadvisor.example/bubble.png',
            review_count: 1204,
            web_url: 'https://tripadvisor.example/place',
            price_level: 'Mid Range',
          },
          popular_dishes: [{ name: 'Ćevapi', price: '€8' }],
        },
      };
      render(<ActivityDetailScreen activity={restaurant} showDistance onBack={jest.fn()} />);
      expect(
        screen.getByText(
          `Restaurant · Fine Dining · Mid Range · ${activity.distance_km.toFixed(1)} km away`,
        ),
      ).toBeTruthy();

      // Stat grid: none for a Tripadvisor-sourced row — price level already
      // sits in the meta line, so Cuisine/Price never render as chips too.
      expect(screen.queryByText('Cuisine')).toBeNull();
      expect(screen.queryByText('Price')).toBeNull();

      // Unique section: Popular dishes, nameprice density (name + price column).
      expect(screen.getByText('Popular dishes')).toBeTruthy();
      expect(screen.getByText('Ćevapi')).toBeTruthy();
      expect(screen.getByText('€8')).toBeTruthy();

      expect(screen.getByRole('button', { name: 'Book a table' })).toBeTruthy();

      // No promotion for Restaurants: description renders before the unique
      // section in body order, but not above it (only Cafés promotes).
      const tree = JSON.stringify(screen.toJSON());
      expect(tree.indexOf('A candle-lit dining room with an open kitchen.')).toBeLessThan(
        tree.indexOf('Popular dishes'),
      );
    });

    it('Bars: meta line reads Bar · subtype · distance (no price level), a sentence-shaped vibe is dropped from the stat grid, Signature pours renders as pills, CTA is See menu, no promotion (stat grid before unique section)', () => {
      const bar: Activity = {
        ...activity,
        category: 'bars',
        subcategory: 'cocktail_bar',
        details: {
          category: 'bars',
          vibe: 'The atmosphere here is genuinely impossible to describe in one word.',
          happy_hour_window: '17:00–19:00',
          opens_time: '17:00',
          signature_pours: ['Rakija sour', 'Amaro spritz'],
        },
      };
      render(<ActivityDetailScreen activity={bar} showDistance onBack={jest.fn()} />);

      // Meta line: category · subtype · distance, no price level (Bars'
      // composition never names one, unlike Restaurants). MetaLine renders
      // each item as its own <Text> node (unlike the Tripadvisor eyebrow's
      // single joined string), so these are asserted individually.
      expect(screen.getByText('Bar')).toBeTruthy();
      expect(screen.getByText('Cocktail Bar')).toBeTruthy();
      expect(screen.getByText(`${activity.distance_km.toFixed(1)} km away`)).toBeTruthy();

      // Stat grid: the spec's own flagged at-risk field — a sentence-shaped
      // vibe never reaches the tile.
      expect(
        screen.queryByText('The atmosphere here is genuinely impossible to describe in one word.'),
      ).toBeNull();
      expect(screen.queryByText('Vibe')).toBeNull();
      expect(screen.getByText('17:00–19:00')).toBeTruthy();
      expect(screen.getByText('17:00')).toBeTruthy();

      // Unique section: Signature pours, pills density (bare item text, no
      // price column).
      expect(screen.getByText('Signature pours')).toBeTruthy();
      expect(screen.getByText('Rakija sour')).toBeTruthy();
      expect(screen.getByText('Amaro spritz')).toBeTruthy();

      expect(screen.getByRole('button', { name: 'See menu' })).toBeTruthy();

      // No promotion: the stat grid (Happy hour chip) renders before the
      // unique section (Signature pours heading) in the DOM.
      const tree = JSON.stringify(screen.toJSON());
      expect(tree.indexOf('17:00–19:00')).toBeLessThan(tree.indexOf('Signature pours'));
    });

    it('Cafés: meta line reads Café · subtype · distance, stat grid is Known for/Wifi, On the bar renders as nameprice, CTA is Get directions/Share, description promotes above the stat grid', () => {
      const cafe: Activity = {
        ...activity,
        category: 'cafes',
        subcategory: 'coffee_shop',
        description: 'A roastery-first café with a short food menu.',
        details: {
          category: 'cafes',
          known_for_brew: 'Pour-over',
          wifi_quality: 'Fast',
          on_the_bar: [{ name: 'Flat white', price: '€2.80' }],
        },
      };
      render(<ActivityDetailScreen activity={cafe} showDistance onBack={jest.fn()} />);

      // MetaLine renders each item as its own <Text> node (see the Bars
      // test above for why these are asserted individually).
      expect(screen.getByText('Café')).toBeTruthy();
      expect(screen.getByText('Coffee Shop')).toBeTruthy();
      expect(screen.getByText(`${activity.distance_km.toFixed(1)} km away`)).toBeTruthy();
      expect(screen.getByText('Pour-over')).toBeTruthy();
      expect(screen.getByText('Fast')).toBeTruthy();
      expect(screen.getByText('On the bar')).toBeTruthy();
      expect(screen.getByText('Flat white')).toBeTruthy();
      expect(screen.getByText('€2.80')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Get directions' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();

      // Promoted slot: description renders above the stat grid.
      const tree = JSON.stringify(screen.toJSON());
      expect(tree.indexOf('A roastery-first café with a short food menu.')).toBeLessThan(
        tree.indexOf('Pour-over'),
      );
    });
  });

  // T5: the canonical-order + promote-one-slot mechanism (activityDetailConfig.ts's
  // `bodySectionOrder`) replaces the 13 hand-maintained BODY_SECTION_ORDER
  // arrays — this smoke test proves every category still renders with its
  // carried-over config, nothing crashes now that they all share one order
  // function instead of a bespoke array each.
  describe('every category renders without crashing using its carried-over config (T5 smoke test)', () => {
    const minimalDetailsByCategory: Partial<Record<Category, Activity['details']>> = {
      restaurants: { category: 'restaurants' },
      bars: { category: 'bars' },
      cafes: { category: 'cafes' },
      nightlife: { category: 'nightlife' },
      nature: { category: 'nature' },
      sport: { category: 'sport' },
      kids: { category: 'kids' },
      culture: { category: 'culture' },
      art: { category: 'art' },
      wellness: { category: 'wellness' },
      entertainment: { category: 'entertainment' },
      shopping: { category: 'shopping' },
      // tours_experiences intentionally omitted — no `ActivityDetails`
      // variant exists yet (T2/T10); `details` stays undefined below, the
      // same "no details" fallback state the spec pins for this category
      // until a provider lands.
    };

    it.each(CATEGORY_OPTIONS.map((option) => option.value))('renders %s without crashing', (category) => {
      const a: Activity = {
        ...activity,
        category,
        details: minimalDetailsByCategory[category],
      };
      expect(() =>
        render(<ActivityDetailScreen activity={a} showDistance onBack={jest.fn()} />),
      ).not.toThrow();
    });
  });

  // T5: "Every category is wired to render a reviews section via T4's
  // shared wrapper: Tripadvisor attribution for restaurants/bars/cafes,
  // Google attribution for the other 9, absent for tours_experiences."
  describe('reviews section wired per category (T5)', () => {
    it('uses the Tripadvisor attribution plate for a Tripadvisor-sourced restaurant/bar/café row', () => {
      const withTripadvisor: Activity = {
        ...activity,
        details: {
          category: 'restaurants',
          tripadvisor: {
            rating_image_url: 'https://tripadvisor.example/bubble.png',
            review_count: 10,
            web_url: 'https://tripadvisor.example/place',
          },
        },
      };
      render(<ActivityDetailScreen activity={withTripadvisor} showDistance onBack={jest.fn()} />);
      expect(screen.getByRole('button', { name: 'Read all reviews on Tripadvisor' })).toBeTruthy();
    });

    it('uses the Google attribution plate for one of the other 9 categories (Culture)', () => {
      const culture: Activity = { ...activity, category: 'culture', google_maps_uri: 'https://maps.google.com/x' };
      render(<ActivityDetailScreen activity={culture} showDistance onBack={jest.fn()} />);
      expect(screen.getByTestId('google-attribution-plate-detail')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Read all reviews on Tripadvisor' })).toBeNull();
    });

    it('renders no reviews section and no attribution plate for Tours & Experiences (no data source yet)', () => {
      const tours: Activity = { ...activity, category: 'tours_experiences', details: undefined };
      render(<ActivityDetailScreen activity={tours} showDistance onBack={jest.fn()} />);
      expect(screen.queryByRole('button', { name: 'Read all reviews on Tripadvisor' })).toBeNull();
      expect(screen.queryByTestId('reviews-skeleton')).toBeNull();
      expect(screen.queryByText('Reviews')).toBeNull();
      expect(screen.queryByTestId('google-attribution-plate-detail')).toBeNull();
      expect(screen.queryByTestId('google-attribution-plate-footer')).toBeNull();
    });
  });

  // design-spec.md's Tours & Experiences composition (T10). No provider
  // populates `details` yet, so this whole screen composition is
  // exercised only via fixtures — the no-`details` fallback (a separate
  // describe below) is what real users see until a provider lands.
  describe('Tours & Experiences — full-data composition (T10)', () => {
    const toursFull: Activity = {
      ...activity,
      category: 'tours_experiences',
      subcategory: 'walking_tour',
      distance_km: 0.4,
      details: {
        category: 'tours_experiences',
        duration: '2 h 30 min',
        group_size: 'Max 12',
        languages: 'EN, SR',
        difficulty_level: 'Moderate',
        included: ['Licensed local guide', 'Fortress grounds entry'],
        not_included: ['Museum tickets', 'Food and drink'],
        meeting_point: 'Republic Square, by the horse statue',
        itinerary: ['Fortress', 'Bazaar quarter', 'Riverfront market'],
      },
    };

    beforeEach(() => {
      process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    });

    it('renders the meta line as "Tour · <subtype> · Meets <distance> away" plus a level chip (never the difficulty meter)', () => {
      render(<ActivityDetailScreen activity={toursFull} showDistance onBack={jest.fn()} />);
      expect(screen.getByText('Tour')).toBeTruthy();
      expect(screen.getByText('Walking Tour')).toBeTruthy();
      expect(screen.getByText('Meets 0.4 km away')).toBeTruthy();
      expect(screen.getByText('Moderate')).toBeTruthy();
      // DifficultyMeter is Sport's slot only (T7) — confirms Tours' level
      // chip never coexists with it, per the spec's "no category shows
      // both" rule.
      expect(screen.queryByLabelText(/^Difficulty:/)).toBeNull();
    });

    it('renders the Duration/Group size/Languages stat grid', () => {
      render(<ActivityDetailScreen activity={toursFull} showDistance onBack={jest.fn()} />);
      expect(screen.getByText('2 h 30 min')).toBeTruthy();
      expect(screen.getByText('Duration')).toBeTruthy();
      expect(screen.getByText('Max 12')).toBeTruthy();
      expect(screen.getByText('Group size')).toBeTruthy();
      expect(screen.getByText('EN, SR')).toBeTruthy();
      expect(screen.getByText('Languages')).toBeTruthy();
    });

    it('renders "What\'s included" with ✓ items and ✗ not-included items, in order before Meeting point and Itinerary', () => {
      render(<ActivityDetailScreen activity={toursFull} showDistance onBack={jest.fn()} />);
      const tree = JSON.stringify(screen.toJSON());
      const includedHeadingIndex = tree.indexOf("What's included");
      const meetingHeadingIndex = tree.indexOf('Meeting point');
      const itineraryHeadingIndex = tree.indexOf('Itinerary');
      expect(screen.getByText('Licensed local guide')).toBeTruthy();
      expect(screen.getByText('Fortress grounds entry')).toBeTruthy();
      expect(screen.getByText('Museum tickets')).toBeTruthy();
      expect(screen.getByText('Food and drink')).toBeTruthy();
      expect(includedHeadingIndex).toBeGreaterThan(-1);
      expect(meetingHeadingIndex).toBeGreaterThan(includedHeadingIndex);
      expect(itineraryHeadingIndex).toBeGreaterThan(meetingHeadingIndex);
    });

    it('renders the Meeting point address text and exactly one map (relocated here, not duplicated at the bottom)', () => {
      render(<ActivityDetailScreen activity={toursFull} showDistance onBack={jest.fn()} />);
      expect(screen.getByText('Republic Square, by the horse statue')).toBeTruthy();
      expect(screen.getAllByTestId('activity-detail-map-image')).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'Open in Google Maps' })).toHaveLength(1);
    });

    it('renders the Itinerary as numbered stops', () => {
      render(<ActivityDetailScreen activity={toursFull} showDistance onBack={jest.fn()} />);
      expect(screen.getByText('Fortress')).toBeTruthy();
      expect(screen.getByText('Bazaar quarter')).toBeTruthy();
      expect(screen.getByText('Riverfront market')).toBeTruthy();
      expect(screen.getByText('1')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy();
      expect(screen.getByText('3')).toBeTruthy();
    });

    it('the ✓/✗ checklist only renders items passing classifyField(\'phrase\', …) — a denylisted item is dropped', () => {
      const withHedge: Activity = {
        ...toursFull,
        details: {
          ...toursFull.details,
          category: 'tours_experiences',
          included: ['Licensed local guide', 'Not specified'],
        },
      };
      render(<ActivityDetailScreen activity={withHedge} showDistance onBack={jest.fn()} />);
      expect(screen.getByText('Licensed local guide')).toBeTruthy();
      expect(screen.queryByText('Not specified')).toBeNull();
    });

    it('renders the bottom bar as a disabled "Check availability" CTA (no backing action_url field on this category)', () => {
      render(<ActivityDetailScreen activity={toursFull} showDistance onBack={jest.fn()} />);
      const cta = screen.getByRole('button', { name: 'Check availability' });
      expect(cta.props.accessibilityState.disabled).toBe(true);
      expect(screen.getByRole('button', { name: 'Directions' })).toBeTruthy();
    });

    it('renders no reviews section and no attribution plate for the full-data composition either (still no provider)', () => {
      render(<ActivityDetailScreen activity={toursFull} showDistance onBack={jest.fn()} />);
      expect(screen.queryByText('Reviews')).toBeNull();
      expect(screen.queryByTestId('google-attribution-plate-detail')).toBeNull();
      expect(screen.queryByTestId('google-attribution-plate-footer')).toBeNull();
    });
  });

  // design-spec.md's Screen-level "No `details`" state: "This is also the
  // Tours screen until its provider lands" — the primary state most users
  // of this category will actually see (T10).
  describe('Tours & Experiences — no-details fallback (T10)', () => {
    it('renders hero, title, meta line (category + subcategory + distance), description if present, map, and Directions only — no stat grid/unique/level chip', () => {
      process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
      const noDetails: Activity = {
        ...activity,
        category: 'tours_experiences',
        subcategory: 'walking_tour',
        distance_km: 0.4,
        details: undefined,
      };
      render(<ActivityDetailScreen activity={noDetails} showDistance onBack={jest.fn()} />);

      expect(screen.getByText(noDetails.title)).toBeTruthy();
      expect(screen.getByText('Tour')).toBeTruthy();
      expect(screen.getByText('Walking Tour')).toBeTruthy();
      expect(screen.getByText('Meets 0.4 km away')).toBeTruthy();
      expect(screen.getByText(noDetails.description)).toBeTruthy();
      expect(screen.getByTestId('activity-detail-map-image')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Directions' })).toBeTruthy();

      // No level chip, no stat grid, no unique-section content.
      expect(screen.queryByText('Duration')).toBeNull();
      expect(screen.queryByText("What's included")).toBeNull();
      expect(screen.queryByText('Meeting point')).toBeNull();
      expect(screen.queryByText('Itinerary')).toBeNull();
    });

    it('omits the description block too when it is also absent (details: {})', () => {
      const bare: Activity = {
        ...activity,
        category: 'tours_experiences',
        description: '',
        details: {} as Activity['details'],
      };
      expect(() =>
        render(<ActivityDetailScreen activity={bare} showDistance onBack={jest.fn()} />),
      ).not.toThrow();
      expect(screen.getByText(bare.title)).toBeTruthy();
    });
  });
});
