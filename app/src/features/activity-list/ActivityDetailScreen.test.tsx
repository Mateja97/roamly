import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
      expect(screen.getByText('9am–11pm')).toBeTruthy();
      // T2: Popular dishes is a pill row now — name only, no price chip.
      expect(screen.getByText('Popular dishes')).toBeTruthy();
      expect(screen.getByText('Truffle pasta')).toBeTruthy();
      expect(screen.queryByText('€14')).toBeNull();
      expect(screen.queryByText('€€')).toBeNull();
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

      const footer = within(screen.getByTestId('activity-detail-footer'));
      expect(footer.getByRole('button', { name: 'Share' })).toBeTruthy();
      fireEvent.press(footer.getByRole('button', { name: 'Get directions' }));

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

      fireEvent.press(
        within(screen.getByTestId('activity-detail-footer')).getByRole('button', { name: 'Share' }),
      );
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

    // T2: Entertainment's stat grid is now always empty (`factStripFields`
    // returns `[]` unconditionally), so `foldedFactChip` can never be
    // defined for this category any more — the old 5-candidate collision
    // the (now-deleted) `metaLineOverflow` guard existed for (category +
    // subtype + distance + neighborhood + a folded price_from) can no
    // longer occur, since `metaExtras` (neighborhood) is Entertainment-only
    // and a fold is Entertainment-never now. Category + subtype + distance +
    // neighborhood is only 4 real candidates either way (the fold never sat
    // among them, now it can't). This test pins that all four keep showing
    // together, unconditionally (no eviction logic left to drop any one of
    // them).
    it('keeps category, subtype, distance, and neighborhood together (a stat can never fold in to compete for the slot any more)', () => {
      const entertainment: Activity = {
        ...activity,
        category: 'entertainment',
        subcategory: 'cinema',
        details: { category: 'entertainment', neighborhood: 'Dorćol' },
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

      // T2: Culture's `Tickets` chip (`ticket_price`) is retired. Venue
      // matching the subtype now leaves 0 surviving chips — the grid omits
      // entirely (not a 1-chip fold, since there's no chip left at all),
      // even with a legacy ticket_price still present in the payload.
      it("Culture's stat grid omits entirely when Venue matches the subtype (no Tickets chip, even with a legacy ticket_price)", () => {
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
        expect(screen.queryByText('€10')).toBeNull();
        expect(screen.queryByText('Tickets')).toBeNull();
        expect(screen.queryByText('Venue')).toBeNull();
        expect(screen.getByText('Now showing')).toBeTruthy();
      });

      // T2: with Tickets gone, Venue (when it differs from the subtype) is
      // Culture's only possible chip — a lone survivor, so it folds into
      // the meta line rather than rendering a 1-column grid.
      it("folds Culture's lone Venue value into the meta line when it differs from the subtype (no Tickets chip, even with a legacy ticket_price)", () => {
        const culture: Activity = {
          ...activity,
          category: 'culture',
          subcategory: 'historical_site',
          details: { category: 'culture', venue_type: 'Fortress', ticket_price: '€10' },
        };
        render(<ActivityDetailScreen activity={culture} showDistance onBack={jest.fn()} />);
        expect(screen.getByText('Fortress')).toBeTruthy();
        expect(screen.queryByText('Venue')).toBeNull();
        expect(screen.queryByText('€10')).toBeNull();
        expect(screen.queryByText('Tickets')).toBeNull();
      });

      // T2: Art's only chip (`Tickets`/`ticket_price`) is retired. Art now
      // never has a stat grid at all, and never folds anything into the
      // meta line either (venue_type was never a chip for Art).
      it("Art's stat grid omits entirely, never a Tickets chip or a folded value, even with a legacy ticket_price", () => {
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
        expect(screen.queryByText('€6')).toBeNull();
        expect(screen.queryByText('Tickets')).toBeNull();
        expect(screen.queryByText('Venue')).toBeNull();
        expect(screen.queryByText('Museum')).toBeNull();
        expect(screen.getByText('Current exhibition')).toBeTruthy();
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

    // T2: the bottom-bar price-context line is retired entirely — for every
    // category, regardless of what the (possibly legacy) `price_from`/
    // `entry_price` field carries.
    it('never renders a bottom-bar "From <price>" line for wellness even when price_from is present', () => {
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

    it('never renders a bottom-bar "From <price>" line for entertainment even when price_from is present', () => {
      const entertainment: Activity = {
        ...activity,
        category: 'entertainment',
        details: { category: 'entertainment', price_from: '€8' },
      };
      render(
        <ActivityDetailScreen activity={entertainment} showDistance onBack={jest.fn()} />,
      );
      expect(screen.queryByText(/^From /)).toBeNull();
    });

    it('never renders a bottom-bar "From <price>" line for nightlife even when entry_price is present', () => {
      const nightlife: Activity = {
        ...activity,
        category: 'nightlife',
        details: { category: 'nightlife', entry_price: '€10' },
      };
      render(
        <ActivityDetailScreen activity={nightlife} showDistance onBack={jest.fn()} />,
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
    // T2: the `Entry` chip and the bottom-bar price line are both retired —
    // Nightlife's stat grid is Dress code/Opens only now, even with a
    // legacy entry_price present.
    it('renders the Nightlife stat grid (Dress code/Opens, no Entry chip) and the promoted Tonight lineup, no bottom price line', () => {
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
      expect(screen.queryByText('Entry')).toBeNull();
      expect(screen.getByText('Dress code')).toBeTruthy();
      expect(screen.getByText('Opens')).toBeTruthy();
      expect(screen.getByText('Tonight')).toBeTruthy();
      expect(screen.getByText('DJ Set')).toBeTruthy();
      expect(screen.queryByText(/^From /)).toBeNull();
      expect(screen.getByRole('button', { name: 'Guest list' })).toBeTruthy();
      // Promoted above the stat grid: Tonight precedes the Dress code chip.
      const tree = JSON.stringify(screen.toJSON());
      expect(tree.indexOf('Tonight')).toBeLessThan(tree.indexOf('Dress code'));
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
      const footer = within(screen.getByTestId('activity-detail-footer'));
      expect(footer.getByRole('button', { name: 'Get directions' })).toBeTruthy();
      expect(footer.getByRole('button', { name: 'Share' })).toBeTruthy();
      // No status chip for Nature (venue type has no open/closed state).
      expect(screen.queryByText('Open')).toBeNull();
      expect(screen.queryByText('Closed')).toBeNull();
      // T7 cross-check: Nature never renders the Sport-only difficulty meter.
      expect(screen.queryByText('Difficulty')).toBeNull();
    });

    // T2: the `Duration` chip (LLM-scraped session duration) is retired —
    // Sport's stat grid is Effort/Gear only now, even with a legacy
    // `duration` value present.
    it('renders the Sport stat grid (Effort/Gear, no Duration chip) and the What to bring checklist, below the promoted difficulty meter', () => {
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
      expect(screen.queryByText('Duration')).toBeNull();
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

  // T3 (detail-price-duration-purge): dedicated coverage for T2's shape
  // changes — genuinely new fixtures only; points already proven by T2's own
  // tests above (Culture's lone-Venue fold at "folds Culture's lone Venue
  // value…", Art's 0-chip omission at "Art's stat grid omits entirely…",
  // Sport's 2-column grid at "renders the Sport stat grid (Effort/Gear…)")
  // aren't duplicated here — see engineering-notes.md's T3 entry.
  describe('T3: empty-grid behavior and regression coverage', () => {
    it('Wellness with only treatments (no other stat-worthy field): no stat grid, Treatments render as pills, no crash', () => {
      const wellness: Activity = {
        ...activity,
        category: 'wellness',
        details: {
          category: 'wellness',
          treatments: [{ item: 'Swedish massage' }, { item: 'Deep tissue massage' }],
        },
      };
      render(<ActivityDetailScreen activity={wellness} showDistance onBack={jest.fn()} />);
      // No stat grid at all — factStripFields never reads a field for
      // wellness post-T2, so neither of its retired chip labels can appear.
      expect(screen.queryByText('Typical visit')).toBeNull();
      expect(screen.queryByText('Price from')).toBeNull();
      // Treatments render as pills (name only).
      expect(screen.getByText('Treatments')).toBeTruthy();
      expect(screen.getByText('Swedish massage')).toBeTruthy();
      expect(screen.getByText('Deep tissue massage')).toBeTruthy();
    });

    it('Entertainment with only upcoming_shows: no stat grid, shows render as date-block rows with title only (no subline)', () => {
      const entertainment: Activity = {
        ...activity,
        category: 'entertainment',
        details: {
          category: 'entertainment',
          upcoming_shows: [{ date: '2026-09-01', title: 'Live jazz night' }],
        },
      };
      render(<ActivityDetailScreen activity={entertainment} showDistance onBack={jest.fn()} />);
      expect(screen.queryByText('Typical show')).toBeNull();
      expect(screen.queryByText('Price from')).toBeNull();
      expect(screen.getByText('Live jazz night')).toBeTruthy();
    });

    // The production-bug regression this whole system exists to prevent —
    // unlike the T9 fixture above (denylisted/sentence-shaped hedges, which
    // would fail `classifyField` even if a stale code path still read them),
    // these values are well-formed, exactly the shape a legitimate scrape
    // produced before T1 stopped collecting them. The fix has to be
    // structural (the field is never read), not incidental (the value
    // happens to be denylisted) — this fixture proves that.
    it('Wellness: well-formed legacy price_from/typical_visit/treatments[].price/duration render nowhere, including the meta-line fold path', () => {
      const wellness: Activity = {
        ...activity,
        category: 'wellness',
        details: {
          category: 'wellness',
          typical_visit: '2-3 hrs',
          price_from: '€25',
          treatments: [{ item: 'Swedish massage', duration: '60 min', price: '€35' }],
        },
      };
      render(<ActivityDetailScreen activity={wellness} showDistance onBack={jest.fn()} />);
      expect(screen.queryByText('€25')).toBeNull();
      expect(screen.queryByText('2-3 hrs')).toBeNull();
      expect(screen.queryByText('€35')).toBeNull();
      expect(screen.queryByText('60 min')).toBeNull();
      // The treatment row itself survives, by name, as a pill.
      expect(screen.getByText('Swedish massage')).toBeTruthy();
    });

    it('Entertainment: well-formed legacy price_from/typical_show_length/time_or_price render nowhere', () => {
      const entertainment: Activity = {
        ...activity,
        category: 'entertainment',
        details: {
          category: 'entertainment',
          typical_show_length: '2 hrs',
          price_from: '€12',
          upcoming_shows: [{ date: '2026-09-01', title: 'Live jazz night', time_or_price: '€15' }],
        },
      };
      render(<ActivityDetailScreen activity={entertainment} showDistance onBack={jest.fn()} />);
      expect(screen.queryByText('€12')).toBeNull();
      expect(screen.queryByText('2 hrs')).toBeNull();
      expect(screen.queryByText('€15')).toBeNull();
      expect(screen.getByText('Live jazz night')).toBeTruthy();
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
          // T11: the reviews section (and its score header) only renders
          // once settled when a maps link is present (compliance) — see
          // "omits the reviews section entirely..." below for the case
          // where it's genuinely absent.
          google_maps_uri: 'https://maps.google.com/x',
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
          // T4: this café already has its own quotable review, so the
          // widened fetch gate (tested separately below) doesn't apply here
          // — keeps this test scoped to the café Tripadvisor-vs-Places-live
          // precedence question alone.
          reviews: [{ rating: 5, date: '1 June 2026', text: 'Lovely little spot.' }],
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

  // T4 (tripadvisor-google-review-fallback): the widened fetch gate + the
  // Google review-card fallback it unlocks for a review-less Tripadvisor row.
  describe('Google review-card fallback for a review-less Tripadvisor row (T4)', () => {
    const reviewlessTripadvisor: Activity = {
      ...activity,
      details: {
        category: 'restaurants',
        tripadvisor: {
          rating_image_url: 'https://tripadvisor.example/bubble.png',
          review_count: 1204,
          web_url: 'https://tripadvisor.example/place',
        },
        // No `reviews` key — the fetch-gate's trigger shape.
      },
    };
    const tripadvisorWithReviews: Activity = {
      ...reviewlessTripadvisor,
      details: {
        category: 'restaurants',
        tripadvisor: {
          rating_image_url: 'https://tripadvisor.example/bubble.png',
          review_count: 1204,
          web_url: 'https://tripadvisor.example/place',
        },
        reviews: [{ rating: 5, date: '1 June 2026', text: 'Great spot.' }],
      },
    };
    const googleReviews = [
      {
        authorAttribution: { displayName: 'Nina', uri: 'https://maps.google.com/contrib/1' },
        rating: 5,
        text: 'Wonderful evening.',
        date: '2026-06-01T00:00:00Z',
      },
    ];

    it('fires getActivity for a review-less Tripadvisor row', () => {
      render(<ActivityDetailScreen activity={reviewlessTripadvisor} showDistance onBack={jest.fn()} />);
      expect(mockedGetActivity).toHaveBeenCalledWith(reviewlessTripadvisor.id);
    });

    it('does not fire getActivity for a Tripadvisor row that already has reviews', () => {
      render(<ActivityDetailScreen activity={tripadvisorWithReviews} showDistance onBack={jest.fn()} />);
      expect(mockedGetActivity).not.toHaveBeenCalled();
    });

    it('shows the reviews skeleton in the slot while the fallback fetch is pending', () => {
      render(<ActivityDetailScreen activity={reviewlessTripadvisor} showDistance onBack={jest.fn()} />);
      expect(screen.getByTestId('reviews-skeleton')).toBeTruthy();
    });

    it('fills the slot with Google review cards once the fetch settles with reviews + a maps link', async () => {
      mockedGetActivity.mockResolvedValue({
        status: 'success',
        activity: {
          ...reviewlessTripadvisor,
          google_reviews: googleReviews,
          google_maps_uri: 'https://maps.google.com/place/xyz',
        },
      });
      render(<ActivityDetailScreen activity={reviewlessTripadvisor} showDistance onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByTestId('google-attribution-plate-detail')).toBeTruthy());
      expect(screen.getByText('Wonderful evening.')).toBeTruthy();
      expect(screen.queryByTestId('reviews-skeleton')).toBeNull();
    });

    it('collapses silently when Google reviews arrive with no maps link (compliance — no cards, no error)', async () => {
      mockedGetActivity.mockResolvedValue({
        status: 'success',
        activity: {
          ...reviewlessTripadvisor,
          google_reviews: googleReviews,
          google_maps_uri: undefined,
        },
      });
      render(<ActivityDetailScreen activity={reviewlessTripadvisor} showDistance onBack={jest.fn()} />);
      await waitFor(() => expect(screen.queryByTestId('reviews-skeleton')).toBeNull());
      expect(screen.queryByTestId('google-attribution-plate-detail')).toBeNull();
      expect(screen.queryByText('Wonderful evening.')).toBeNull();
    });

    it('collapses silently on fetch failure — same as the empty case, no error banner', async () => {
      mockedGetActivity.mockResolvedValue({ status: 500, message: 'boom' });
      render(<ActivityDetailScreen activity={reviewlessTripadvisor} showDistance onBack={jest.fn()} />);
      await waitFor(() => expect(screen.queryByTestId('reviews-skeleton')).toBeNull());
      expect(screen.queryByTestId('google-attribution-plate-detail')).toBeNull();
      expect(screen.queryByText('boom')).toBeNull();
    });

    it('keeps the Tripadvisor carousel once a fetch settles but the row already had its own reviews (no switch to Google)', async () => {
      mockedGetActivity.mockResolvedValue({
        status: 'success',
        activity: {
          ...reviewlessTripadvisor,
          google_reviews: googleReviews,
          google_maps_uri: 'https://maps.google.com/place/xyz',
        },
      });
      render(<ActivityDetailScreen activity={tripadvisorWithReviews} showDistance onBack={jest.fn()} />);
      expect(screen.getByText('“Great spot.”')).toBeTruthy();
      expect(screen.queryByTestId('google-attribution-plate-detail')).toBeNull();
    });

    it('never switches on any isPlacesLive-gated treatment for this row, in every case (pending, settled-with-fallback, settled-empty)', async () => {
      const { unmount } = render(
        <ActivityDetailScreen activity={reviewlessTripadvisor} showDistance onBack={jest.fn()} />,
      );
      // Pending: title-block gold star/skeleton never shows for a
      // Tripadvisor row — the plate above carries the rating instead.
      expect(screen.queryByTestId('rating-skeleton')).toBeNull();
      expect(screen.getByText('4.6')).toBeTruthy(); // Tripadvisor's own plate rating
      unmount();

      mockedGetActivity.mockResolvedValue({
        status: 'success',
        activity: {
          ...reviewlessTripadvisor,
          google_reviews: googleReviews,
          google_maps_uri: 'https://maps.google.com/place/xyz',
        },
      });
      render(<ActivityDetailScreen activity={reviewlessTripadvisor} showDistance onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByTestId('google-attribution-plate-detail')).toBeTruthy());
      // No Roamly-drawn score header (isPlacesLive-only "Reviews" overline +
      // score number) ever appears beside the borrowed Google cards.
      expect(screen.queryByText('Reviews')).toBeNull();
      expect(screen.queryByTestId('rating-skeleton')).toBeNull();
      // Still exactly one rating on screen — Tripadvisor's plate figure.
      expect(screen.getAllByText('4.6')).toHaveLength(1);
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

    // T2: Culture's own 2-chip case (Tickets+Venue) no longer exists — its
    // only remaining chip (Venue) is a lone survivor that folds into the
    // meta line rather than rendering a genuine multi-chip grid. Nightlife
    // (Dress code + Opens) keeps this test's original intent: a real 2-chip
    // grid alongside the standalone HoursRow, neither pushing the other out.
    it('renders the FactStrip grid and the standalone HoursRow together without either pushing the other out', () => {
      const nightlifeVenue: Activity = {
        ...activity,
        category: 'nightlife',
        details: {
          category: 'nightlife',
          dress_code: 'Smart casual',
          opens_time: '23:00',
          opening_hours: {
            timezone: 'UTC',
            periods: [{ day: 'monday', open: '09:00', close: '17:00' }],
          },
        },
      };
      render(
        <ActivityDetailScreen
          activity={nightlifeVenue}
          showDistance
          onBack={jest.fn()}
        />,
      );
      // FactStrip's own 2-chip grid (Hours no longer among them — T4 moved
      // it to its own row) …
      expect(screen.getByText('Dress code')).toBeTruthy();
      expect(screen.getByText('Smart casual')).toBeTruthy();
      expect(screen.getByText('Opens')).toBeTruthy();
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
    it('Restaurants (Tripadvisor): meta line reads category · subtype · price level · distance, no stat grid (price level already in the meta line), Popular dishes renders as pills (name only), description before the unique section, CTA is Book a table', () => {
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

      // Unique section: Popular dishes, pills density (name only, no price).
      expect(screen.getByText('Popular dishes')).toBeTruthy();
      expect(screen.getByText('Ćevapi')).toBeTruthy();
      expect(screen.queryByText('€8')).toBeNull();

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

    it('Cafés: meta line reads Café · subtype · distance, stat grid is Known for/Wifi, On the bar renders as pills (name only), CTA is Get directions/Share, description promotes above the stat grid', () => {
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
      expect(screen.queryByText('€2.80')).toBeNull();
      const footer = within(screen.getByTestId('activity-detail-footer'));
      expect(footer.getByRole('button', { name: 'Get directions' })).toBeTruthy();
      expect(footer.getByRole('button', { name: 'Share' })).toBeTruthy();

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

  // T11's cross-cutting composition smoke test: all 13 categories render
  // without crashing given three payload shapes. The "fully-empty" shape is
  // already proven above (T5's own smoke test, `minimalDetailsByCategory`) —
  // this adds the other two the task names: fully-populated (every field
  // filled with a shape-valid value) and every generated field replaced with
  // a denylist string (proving the absence rule degrades every category to
  // "no crash, content omitted" rather than throwing).
  describe('every category renders without crashing given full data or an all-denylisted payload (T11)', () => {
    const fullDetailsByCategory: Record<Category, Activity['details']> = {
      restaurants: {
        category: 'restaurants',
        cuisine: 'Italian',
        price_tier: '€€',
        hours: '9am–10pm',
        open_status: 'Open',
        popular_dishes: [{ name: 'Pasta', price: '€12' }],
        action_url: 'https://example.com/book',
        opening_hours: { timezone: 'Europe/Belgrade', periods: [{ day: 'monday', open: '09:00', close: '22:00' }] },
      },
      bars: {
        category: 'bars',
        vibe: 'Cozy',
        happy_hour_window: '5–7pm',
        opens_time: '18:00',
        signature_pours: ['Old Fashioned'],
        action_url: 'https://example.com/menu',
        opening_hours: { timezone: 'Europe/Belgrade', periods: [{ day: 'monday', open: '18:00', close: '02:00' }] },
      },
      cafes: {
        category: 'cafes',
        known_for_brew: 'Espresso',
        wifi_quality: 'Fast',
        hours: '8am–6pm',
        on_the_bar: [{ name: 'Latte', price: '€3' }],
        opening_hours: { timezone: 'Europe/Belgrade', periods: [{ day: 'monday', open: '08:00', close: '18:00' }] },
      },
      nightlife: {
        category: 'nightlife',
        entry_price: '€10',
        dress_code: 'Smart casual',
        opens_time: '22:00',
        open_tonight: true,
        lineup: [{ time: '23:00', act: 'DJ Ana', stage: 'Main' }],
        action_url: 'https://example.com/guestlist',
        venue_type: 'Club',
        opening_hours: { timezone: 'Europe/Belgrade', periods: [{ day: 'friday', open: '22:00', close: '06:00' }] },
      },
      nature: {
        category: 'nature',
        time_to_spend: '2 h',
        best_time: 'Morning',
        cost: 'Free',
        good_to_know: ['Bring water'],
      },
      sport: {
        category: 'sport',
        difficulty: 3,
        difficulty_inferred: false,
        effort_level: 'Moderate',
        duration: '1 h',
        gear: 'Helmet',
        what_to_bring: ['Water bottle'],
        action_url: 'https://example.com/book',
        discipline: 'Climbing',
      },
      kids: { category: 'kids', age_range: '3–10', facilities: ['Restrooms'] },
      culture: {
        category: 'culture',
        venue_type: 'Museum',
        ticket_price: '€8',
        hours: '10am–6pm',
        now_showing: { title: 'New exhibit', description: 'A great show' },
        action_url: 'https://example.com/tickets',
        opening_hours: { timezone: 'Europe/Belgrade', periods: [{ day: 'monday', open: '10:00', close: '18:00' }] },
      },
      art: {
        category: 'art',
        venue_type: 'Gallery',
        ticket_price: '€5',
        hours: '10am–5pm',
        artwork: { artist: 'Ana', work: 'Untitled', medium: 'Oil' },
        current_exhibition: { title: 'Spring show', description: 'A colorful exhibit' },
        action_url: 'https://example.com/tickets',
        year: 2023,
        opening_hours: { timezone: 'Europe/Belgrade', periods: [{ day: 'monday', open: '10:00', close: '17:00' }] },
      },
      wellness: {
        category: 'wellness',
        treatments: [{ item: 'Massage', duration: '60 min', price: '€40' }],
        external_booking_note: 'Book online',
        action_url: 'https://example.com/wellness',
        venue_type: 'Spa',
        typical_visit: '1 h',
        price_from: '€40',
        good_to_know: ['Bring a towel'],
        opening_hours: { timezone: 'Europe/Belgrade', periods: [{ day: 'monday', open: '09:00', close: '20:00' }] },
      },
      entertainment: {
        category: 'entertainment',
        genre: 'Comedy',
        neighborhood: 'Dorćol',
        upcoming_shows: [{ date: '2026-09-01', title: 'Live show', time_or_price: '€15' }],
        action_url: 'https://example.com/tickets',
        typical_show_length: '2 h',
        price_from: '€8',
        good_to_know: ['Arrive early'],
        opening_hours: { timezone: 'Europe/Belgrade', periods: [{ day: 'monday', open: '19:00', close: '23:00' }] },
      },
      shopping: {
        category: 'shopping',
        venue_type: 'Mall',
        best_day: 'Saturday',
        hours: '10am–9pm',
        what_youll_find: ['Clothing'],
        opening_hours: { timezone: 'Europe/Belgrade', periods: [{ day: 'monday', open: '10:00', close: '21:00' }] },
      },
      tours_experiences: {
        category: 'tours_experiences',
        duration: '3 h',
        group_size: 'Up to 10',
        languages: 'EN, DE',
        difficulty_level: 'Easy',
        included: ['Licensed guide'],
        not_included: ['Lunch'],
        meeting_point: 'Meet at the fountain in the main square.',
        itinerary: ['Old town square'],
      },
    };

    // Deep-maps every string leaf (except the `category` discriminant, which
    // would break the union tag) to a denylist string — one generic helper
    // instead of 13 hand-written poisoned fixtures, reused across every
    // category's nested arrays/objects (treatments, now_showing, artwork…).
    function poisonStrings<T>(value: T): T {
      if (typeof value === 'string') return 'not specified' as unknown as T;
      if (Array.isArray(value)) return value.map((v) => poisonStrings(v)) as unknown as T;
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
          out[k] = k === 'category' ? v : poisonStrings(v);
        }
        return out as T;
      }
      return value;
    }

    it.each(CATEGORY_OPTIONS.map((option) => option.value))('renders %s without crashing (fully-populated)', (category) => {
      const a: Activity = { ...activity, category, details: fullDetailsByCategory[category] };
      expect(() =>
        render(<ActivityDetailScreen activity={a} showDistance onBack={jest.fn()} />),
      ).not.toThrow();
    });

    it.each(CATEGORY_OPTIONS.map((option) => option.value))(
      'renders %s without crashing (every generated field denylisted)',
      (category) => {
        const a: Activity = {
          ...activity,
          category,
          details: poisonStrings(fullDetailsByCategory[category]),
        };
        expect(() =>
          render(<ActivityDetailScreen activity={a} showDistance onBack={jest.fn()} />),
        ).not.toThrow();
      },
    );
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
      const footer = within(screen.getByTestId('activity-detail-footer'));
      const cta = footer.getByRole('button', { name: 'Check availability' });
      expect(cta.props.accessibilityState.disabled).toBe(true);
      expect(footer.getByRole('button', { name: 'Directions' })).toBeTruthy();
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
      expect(
        within(screen.getByTestId('activity-detail-footer')).getByRole('button', { name: 'Directions' }),
      ).toBeTruthy();

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

  // T11: design-spec.md's "Action chips" slot (§B2) — wired into the
  // canonical order for the first time this task (previously built, T4, but
  // never called from any screen composition). Sourced from the same fields
  // the bottom bar/generic actions already use.
  describe('Action chips wired into the composition (T11)', () => {
    it('sources Directions (valid coordinates) + Website (action_url) + Share; omits Call (no Tripadvisor phone)', () => {
      const restaurant: Activity = {
        ...activity,
        details: { category: 'restaurants', action_url: 'https://example.com/book' },
      };
      render(<ActivityDetailScreen activity={restaurant} showDistance onBack={jest.fn()} />);
      const chips = within(screen.getByTestId('activity-detail-action-chips'));
      expect(chips.getByRole('button', { name: 'Directions' })).toBeTruthy();
      expect(chips.getByRole('button', { name: 'Website' })).toBeTruthy();
      expect(chips.getByRole('button', { name: 'Share' })).toBeTruthy();
      expect(chips.queryByRole('button', { name: 'Call' })).toBeNull();
    });

    it('sources Call from a Tripadvisor row\'s phone, never a Website chip pointing at tripadvisor.web_url', () => {
      const tripadvisorRow: Activity = {
        ...activity,
        details: {
          category: 'restaurants',
          tripadvisor: {
            rating_image_url: 'https://tripadvisor.example/bubble.png',
            review_count: 10,
            web_url: 'https://tripadvisor.example/place',
            phone: '+381 11 234 5678',
          },
        },
      };
      render(<ActivityDetailScreen activity={tripadvisorRow} showDistance onBack={jest.fn()} />);
      const chips = within(screen.getByTestId('activity-detail-action-chips'));
      expect(chips.getByRole('button', { name: 'Directions' })).toBeTruthy();
      expect(chips.getByRole('button', { name: 'Call' })).toBeTruthy();
      expect(chips.getByRole('button', { name: 'Share' })).toBeTruthy();
      expect(chips.queryByRole('button', { name: 'Website' })).toBeNull();
    });

    it('omits the Directions chip when the activity has no valid coordinates (Share still renders)', () => {
      const noLocation: Activity = { ...activity, location: { lat: 0, lng: 0 } };
      render(<ActivityDetailScreen activity={noLocation} showDistance onBack={jest.fn()} />);
      const chips = within(screen.getByTestId('activity-detail-action-chips'));
      expect(chips.queryByRole('button', { name: 'Directions' })).toBeNull();
      expect(chips.getByRole('button', { name: 'Share' })).toBeTruthy();
    });
  });

  // T2: `foldPrefix`/`stripLeadingFrom` are retired along with the price
  // chips that were their only callers — Wellness never has a stat grid
  // (and therefore never a fold) at all now, bare-number or not.
  describe('Wellness never folds a value into the meta line (T2: no stat grid, ever)', () => {
    it('renders no folded value in the meta line even for a bare-number legacy price_from', () => {
      const wellness: Activity = {
        ...activity,
        category: 'wellness',
        details: { category: 'wellness', price_from: '500' },
      };
      render(<ActivityDetailScreen activity={wellness} showDistance onBack={jest.fn()} />);
      expect(screen.queryByText('500')).toBeNull();
      expect(screen.queryByText('from 500')).toBeNull();
    });
  });

  // T11: design-spec.md's Screen-level/Reviews-slot state rules, exercised
  // end to end (component-level coverage already exists in
  // ReviewsSection.test.tsx/DetailSkeletons.test.tsx — these confirm the
  // real screen wires each state the way the spec describes).
  describe('Reviews states, end to end (T11)', () => {
    const placesRow: Activity = {
      id: 'places-row',
      title: 'Museum of Contemporary Art',
      description: '',
      category: 'culture',
      location: { lat: 44.8, lng: 20.46 },
      country: 'Serbia',
      rating: 0,
      image_refs: [{ uri: 'https://example.com/culture.jpg' }],
      tags: [],
      distance_km: 0.2,
      details: { category: 'culture' },
    };

    it('loading: three-review-card skeleton, no premature content', () => {
      // beforeEach's default mock never resolves getActivity — pending forever.
      render(<ActivityDetailScreen activity={placesRow} showDistance onBack={jest.fn()} />);
      expect(screen.getByTestId('reviews-skeleton')).toBeTruthy();
      expect(screen.queryByTestId('google-attribution-plate-detail')).toBeNull();
    });

    // T11 round 2: the real compliance gap — the old `detailsPending ||`
    // escape hatch assumed pending meant "nothing to show yet", which
    // doesn't hold when the seed/cached payload passed straight into
    // `activity` already carries reviews before the live merge even starts.
    // Probe-verified broken before this fix: score+cards+attribution mark
    // all rendered with no "View on Google Maps" link.
    it('loading: a pending seed that already carries reviews but no maps link renders neither the skeleton nor the section', () => {
      const pendingRowWithReviews: Activity = {
        ...placesRow,
        rating: 4.3,
        review_count: 9,
        google_reviews: [
          {
            authorAttribution: { displayName: 'Nina', uri: 'https://maps.google.com/contrib/1' },
            rating: 5,
            text: 'Wonderful collection.',
            date: '2026-06-01T00:00:00Z',
          },
        ],
        google_maps_uri: undefined,
      };
      // beforeEach's default mock never resolves getActivity — this is the
      // seed render, before any live merge.
      render(<ActivityDetailScreen activity={pendingRowWithReviews} showDistance onBack={jest.fn()} />);
      expect(screen.queryByTestId('reviews-skeleton')).toBeNull();
      expect(screen.queryByTestId('google-attribution-plate-detail')).toBeNull();
      expect(screen.queryByText('Wonderful collection.')).toBeNull();
      expect(screen.queryByText('9 reviews')).toBeNull();
      // The rating isn't lost outright — the title-block star carries it,
      // since the Reviews slot that would otherwise own it is suppressed.
      expect(screen.getByText('4.3')).toBeTruthy();
    });

    it('present: score, cards, and attribution all render once settled with a maps link', async () => {
      mockedGetActivity.mockResolvedValue({
        status: 'success',
        activity: {
          ...placesRow,
          rating: 4.5,
          review_count: 12,
          google_reviews: [
            {
              authorAttribution: { displayName: 'Nina', uri: 'https://maps.google.com/contrib/1' },
              rating: 5,
              text: 'Wonderful collection.',
              date: '2026-06-01T00:00:00Z',
            },
          ],
          google_maps_uri: 'https://maps.google.com/place/moca',
        },
      });
      render(<ActivityDetailScreen activity={placesRow} showDistance onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('12 reviews')).toBeTruthy());
      expect(screen.getByText('4.5')).toBeTruthy();
      expect(screen.getByTestId('google-attribution-plate-detail')).toBeTruthy();
    });

    it('reviews present, aggregate score absent: cards + attribution render alone — no "0.0", no score header', async () => {
      mockedGetActivity.mockResolvedValue({
        status: 'success',
        activity: {
          ...placesRow,
          rating: 0,
          review_count: undefined,
          google_reviews: [
            {
              authorAttribution: { displayName: 'Nina', uri: 'https://maps.google.com/contrib/1' },
              rating: 5,
              text: 'Wonderful collection.',
              date: '2026-06-01T00:00:00Z',
            },
          ],
          google_maps_uri: 'https://maps.google.com/place/moca',
        },
      });
      render(<ActivityDetailScreen activity={placesRow} showDistance onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByTestId('google-attribution-plate-detail')).toBeTruthy());
      expect(screen.getByText('Wonderful collection.')).toBeTruthy();
      expect(screen.queryByText('0.0')).toBeNull();
      expect(screen.queryByText(/reviews$/)).toBeNull();
    });

    it('zero reviews: omits the section entirely, no "be the first to review" copy', async () => {
      mockedGetActivity.mockResolvedValue({
        status: 'success',
        activity: { ...placesRow, rating: 0, review_count: undefined, google_reviews: [], google_maps_uri: undefined },
      });
      render(<ActivityDetailScreen activity={placesRow} showDistance onBack={jest.fn()} />);
      await waitFor(() => expect(screen.queryByTestId('reviews-skeleton')).toBeNull());
      expect(screen.queryByTestId('google-attribution-plate-detail')).toBeNull();
      expect(screen.queryByTestId('google-attribution-plate-footer')).toBeNull();
      expect(screen.queryByText(/be the first/i)).toBeNull();
    });

    // T11: real compliance gap found while writing this test — a settled
    // merge carrying rating/review_count/google_reviews but genuinely no
    // google_maps_uri used to still render the score header + review cards
    // with no way to ever link back to Google Maps. Fixed in
    // `googleReviewsAllowed` (ActivityDetailScreen.tsx) — the whole section
    // now omits in this exact shape, same silent-degrade rule as the
    // fetch-failed case, and the title-block star keeps carrying the rating
    // instead (never losing the number outright).
    it('compliance: never renders the reviews section when a Google Maps link would be missing, even with rating/reviews present', async () => {
      mockedGetActivity.mockResolvedValue({
        status: 'success',
        activity: {
          ...placesRow,
          rating: 4.2,
          review_count: 8,
          google_reviews: [
            {
              authorAttribution: { displayName: 'Nina', uri: 'https://maps.google.com/contrib/1' },
              rating: 5,
              text: 'Wonderful collection.',
              date: '2026-06-01T00:00:00Z',
            },
          ],
          google_maps_uri: undefined,
        },
      });
      render(<ActivityDetailScreen activity={placesRow} showDistance onBack={jest.fn()} />);
      await waitFor(() => expect(screen.queryByTestId('reviews-skeleton')).toBeNull());
      expect(screen.queryByTestId('google-attribution-plate-detail')).toBeNull();
      expect(screen.queryByText('Wonderful collection.')).toBeNull();
      expect(screen.queryByText('8 reviews')).toBeNull();
      // The rating isn't lost outright — the title-block star still carries
      // it, since the Reviews slot that would otherwise own it is suppressed.
      expect(screen.getByText('4.2')).toBeTruthy();
    });
  });

  // T11: design-spec.md's Field-level absence rule, "Distance is absent" —
  // never a fake placeholder. The country-substitution behavior itself
  // (Anywhere scope) predates this pipeline and is already covered above
  // ("shows the country instead of distance when showDistance is false");
  // this closes the loop on the spec's own forbidden-placeholder wording.
  describe('Field-specific absences, end to end (T11)', () => {
    it('never renders a dash, "? km", or a bare "0" placeholder when distance is unavailable', () => {
      render(
        <ActivityDetailScreen
          activity={{ ...activity, country: 'Serbia' }}
          showDistance={false}
          onBack={jest.fn()}
        />,
      );
      expect(screen.getByText('Serbia')).toBeTruthy();
      expect(screen.queryByText('—')).toBeNull();
      expect(screen.queryByText('? km')).toBeNull();
      expect(screen.queryByText('0 km away')).toBeNull();
      expect(screen.queryByText('0')).toBeNull();
    });

    // T6's "omits price level from the eyebrow when absent" test (above)
    // already covers this exact case for a Tripadvisor row with no
    // `subcategory` — confirmed here as the integration counterpart to
    // T5's `subtypeLabel`/`metaLineLeadItems` unit tests, not duplicated.
  });
});
