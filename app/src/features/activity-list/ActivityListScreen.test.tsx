import { AccessibilityInfo, BackHandler, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { getActivity, getActivityPhotos, queryActivities } from '../../api/activities';
import type { Activity, ActivitiesQueryResult } from '../../api/activities';
import type { CitySuggestion } from '../../api/cities';
import { ActivityListScreen } from './ActivityListScreen';

// T4: the pushed ActivityDetailScreen fires its own getActivityPhotos fetch
// on mount — stub it to never resolve so it never disturbs the list-level
// assertions here (ActivityDetailScreen.test.tsx owns the photo-upgrade
// behavior itself).
// T6: the pushed ActivityDetailScreen also fires its own getActivity fetch
// on mount — stub it to never resolve for the same reason as
// getActivityPhotos above (owned by ActivityDetailScreen.test.tsx itself).
jest.mock('../../api/activities', () => ({
  queryActivities: jest.fn(),
  getActivityPhotos: jest.fn(),
  getActivity: jest.fn(() => new Promise(() => {})),
}));
const mockedQuery = jest.mocked(queryActivities);
const mockedGetActivityPhotos = jest.mocked(getActivityPhotos);
const mockedGetActivity = jest.mocked(getActivity);

const COORDINATES = { latitude: 44.8125, longitude: 20.4612 };
const LOCATION = { lat: 44.8125, lng: 20.4612 };

beforeEach(() => {
  // afterEach's resetAllMocks wipes the RN jest preset's default
  // AccessibilityInfo mock implementations too (Skeleton/FilterSheet both
  // use it) — re-arm them each test, same as ScopePickerScreen.test.tsx.
  // true (reduced motion) sidesteps the Filter sheet's slide/fade Animated
  // calls — irrelevant to what these tests verify (data fetching, filters).
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
  // resetAllMocks (below) wipes getActivityPhotos'/getActivity's
  // implementation too — re-arm every test, same reasoning as the
  // AccessibilityInfo spies above.
  mockedGetActivityPhotos.mockReturnValue(new Promise(() => {}));
  mockedGetActivity.mockReturnValue(new Promise(() => {}));
});

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

function successResult(activities: Activity[]): ActivitiesQueryResult {
  return { status: 'success', activities };
}

function city(city: string, country: string): CitySuggestion {
  return { city, country, centroid: { lat: 0, lng: 0 } };
}

// Opening the sheet kicks off its own `isReduceMotionEnabled()` check on a
// microtask — flush it inside `act` so the resulting Animated.Value writes
// aren't attributed to "outside act" (same reasoning as FilterSheet.test.tsx).
async function flush() {
  await act(async () => {});
}

describe('ActivityListScreen', () => {
  afterEach(() => jest.resetAllMocks());

  it('fetches on mount using the scope + device location, and renders loaded cards', async () => {
    mockedQuery.mockResolvedValue(successResult([activity]));
    render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

    expect(mockedQuery).toHaveBeenCalledWith({ scope: 'nearby', current_location: LOCATION });
    expect(screen.getByText('1 place · within 10 km')).toBeTruthy();
    // T1: title renders in the Marcellus display face at the 26px list-header
    // size, not the system font.
    const title = screen.getByText('Nearby');
    expect(StyleSheet.flatten(title.props.style)).toMatchObject({ fontFamily: 'Marcellus_400Regular', fontSize: 26 });
    // Filters pill: radius.full + gold border, per the pill recipe.
    const filtersButton = screen.getByRole('button', { name: 'Filters' });
    expect(StyleSheet.flatten(filtersButton.props.style)).toMatchObject({ borderRadius: 999, borderColor: '#CE9042' });
  });

  it('anywhere with a device-location anchor sends current_location and no max_distance_km at its "no limit" default', async () => {
    mockedQuery.mockResolvedValue(successResult([activity]));
    render(<ActivityListScreen selection={{ scope: 'anywhere', coordinates: COORDINATES }} onBack={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
    expect(mockedQuery).toHaveBeenCalledWith({ scope: 'anywhere', current_location: LOCATION });
    expect(screen.getByText('Anywhere')).toBeTruthy();
    // A location anchor exists, so distance renders (not the fallback country).
    expect(screen.getByText('0.4 km away')).toBeTruthy();
  });

  it('anywhere with no device-location anchor omits current_location and shows the country instead of distance', async () => {
    mockedQuery.mockResolvedValue(successResult([activity]));
    render(<ActivityListScreen selection={{ scope: 'anywhere' }} onBack={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
    expect(mockedQuery).toHaveBeenCalledWith({ scope: 'anywhere' });
    expect(screen.getByText('Serbia')).toBeTruthy();
    expect(screen.queryByText('0.4 km away')).toBeNull();
  });

  it('shows the empty state with no Clear-filters button when no filters are active', async () => {
    mockedQuery.mockResolvedValue(successResult([]));
    render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('No activities match')).toBeTruthy());
    expect(screen.getByText('Nothing here right now.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('shows the error state with a Try again action that re-queries', async () => {
    mockedQuery.mockResolvedValueOnce({ status: 500, message: 'internal error' });
    render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('internal error')).toBeTruthy());

    mockedQuery.mockResolvedValueOnce(successResult([activity]));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    });

    expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy();
  });

  it('calls onBack on Android hardware back press — no custom back control per design-spec.md', async () => {
    mockedQuery.mockResolvedValue(successResult([]));
    const addBackListener = jest.spyOn(BackHandler, 'addEventListener');
    const onBack = jest.fn();
    render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={onBack} />);
    await waitFor(() => expect(screen.getByText('No activities match')).toBeTruthy());

    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();

    const registration = addBackListener.mock.calls.find(([eventName]) => eventName === 'hardwareBackPress');
    expect(registration).toBeTruthy();
    const handler = registration![1] as () => boolean;
    expect(handler()).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);

    // afterEach's resetAllMocks() would otherwise leave addEventListener
    // returning undefined for every later test's own BackHandler
    // registration (real `.remove()` call on unmount) — restore explicitly.
    addBackListener.mockRestore();
  });

  it('opens the Filter sheet from the header Filters button', async () => {
    mockedQuery.mockResolvedValue(successResult([]));
    render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('No activities match')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    await flush();
    expect(screen.getByText('Category')).toBeTruthy();
  });

  it('applying a filter in the sheet re-queries and shows the chip + updated count', async () => {
    mockedQuery.mockResolvedValueOnce(successResult([activity, { ...activity, id: '2' }]));
    render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('2 places · within 10 km')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    await flush();
    // T4: a category pick no longer gets its own removable chip (the header
    // pill row owns that state) — use the rating group here so this test
    // still exercises the sheet-apply + removable-chip mechanism.
    fireEvent.press(screen.getByRole('button', { name: '4.5+' }));

    mockedQuery.mockResolvedValueOnce(successResult([activity]));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /^apply filters$/i }));
    });

    expect(mockedQuery).toHaveBeenLastCalledWith({
      scope: 'nearby',
      current_location: LOCATION,
      min_rating: 4.5,
    });
    expect(screen.getByText('1 place · within 10 km')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove 4.5+ filter' })).toBeTruthy();
  });

  it('removing an active-filter chip clears just that filter and re-queries', async () => {
    mockedQuery.mockResolvedValueOnce(successResult([activity]));
    render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('1 place · within 10 km')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    await flush();
    fireEvent.press(screen.getByRole('button', { name: '4.5+' }));
    mockedQuery.mockResolvedValueOnce(successResult([activity]));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /^apply filters$/i }));
    });
    expect(screen.getByRole('button', { name: 'Remove 4.5+ filter' })).toBeTruthy();

    mockedQuery.mockResolvedValueOnce(successResult([activity, { ...activity, id: '2' }]));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Remove 4.5+ filter' }));
    });

    expect(mockedQuery).toHaveBeenLastCalledWith({ scope: 'nearby', current_location: LOCATION });
    expect(screen.getByText('2 places · within 10 km')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove 4.5+ filter' })).toBeNull();
  });

  it('tapping a card opens the detail screen, and the on-screen Back control returns to the list', async () => {
    mockedQuery.mockResolvedValue(successResult([activity]));
    render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: /skadarlija food walk/i }));
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(screen.getByText('A tasty walk')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    // The list is still mounted underneath, unaffected — same card is there.
    expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy();
  });

  it('Android hardware back closes an open detail screen instead of leaving the list (onBack not called)', async () => {
    mockedQuery.mockResolvedValue(successResult([activity]));
    const addBackListener = jest.spyOn(BackHandler, 'addEventListener');
    const onBack = jest.fn();
    render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={onBack} />);
    await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: /skadarlija food walk/i }));
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();

    // The BackHandler effect re-subscribes whenever `selectedActivity`
    // changes, so the listener that closes the detail overlay is the most
    // recent registration, not the mount-time one.
    const registrations = addBackListener.mock.calls.filter(([eventName]) => eventName === 'hardwareBackPress');
    const handler = registrations[registrations.length - 1][1] as () => boolean;
    act(() => {
      expect(handler()).toBe(true);
    });

    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(onBack).not.toHaveBeenCalled();

    addBackListener.mockRestore();
  });

  it('re-opening the sheet after applying reflects the now-applied filters, not the stale draft', async () => {
    mockedQuery.mockResolvedValueOnce(successResult([activity]));
    render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('1 place · within 10 km')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    await flush();
    // "Sport" now matches both the header pill row (T4) and the sheet's own
    // Category option — press the sheet's (opened second, so it's last).
    const sportChipsBeforeApply = screen.getAllByRole('button', { name: 'Sport' });
    fireEvent.press(sportChipsBeforeApply[sportChipsBeforeApply.length - 1]);
    mockedQuery.mockResolvedValueOnce(successResult([activity]));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /^apply filters$/i }));
    });

    // Sheet closed on Apply success — re-open it and it should show Sports
    // already selected (the now-applied filter), not the pre-Apply draft.
    fireEvent.press(screen.getByRole('button', { name: /^filters/i }));
    await flush();
    expect(screen.getAllByRole('button', { name: /sport, selected/i })).toHaveLength(2);
  });

  it('T2: Anywhere with one selected city shows just its name in the subtitle', async () => {
    mockedQuery.mockResolvedValue(successResult([activity]));
    render(
      <ActivityListScreen
        selection={{ scope: 'anywhere', coordinates: COORDINATES }}
        initialCities={[city('Lisbon', 'Portugal')]}
        onBack={jest.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('1 place · Lisbon')).toBeTruthy());
  });

  it('T2: Anywhere with two selected cities joins them with "&"', async () => {
    mockedQuery.mockResolvedValue(successResult([activity, { ...activity, id: '2' }]));
    render(
      <ActivityListScreen
        selection={{ scope: 'anywhere', coordinates: COORDINATES }}
        initialCities={[city('Lisbon', 'Portugal'), city('Barcelona', 'Spain')]}
        onBack={jest.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('2 places · Lisbon & Barcelona')).toBeTruthy());
  });

  it('T2: Anywhere with three-or-more selected cities comma-joins with "&" before the last, no Oxford comma', async () => {
    mockedQuery.mockResolvedValue(successResult([activity]));
    render(
      <ActivityListScreen
        selection={{ scope: 'anywhere', coordinates: COORDINATES }}
        initialCities={[city('Lisbon', 'Portugal'), city('Barcelona', 'Spain'), city('Amsterdam', 'Netherlands')]}
        onBack={jest.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByText('1 place · Lisbon, Barcelona & Amsterdam')).toBeTruthy()
    );
  });

  it('T2: Anywhere with zero selected cities falls back to the title-only header (no subtitle)', async () => {
    mockedQuery.mockResolvedValue(successResult([activity]));
    render(<ActivityListScreen selection={{ scope: 'anywhere', coordinates: COORDINATES }} onBack={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
    expect(screen.queryByText(/^1 place/)).toBeNull();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  describe('Category header pill row (T4)', () => {
    it('renders "All" plus all 13 categories, "All" selected by default', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      expect(screen.getByRole('button', { name: 'All categories, selected' })).toBeTruthy();
      for (const label of ['Restaurants', 'Cafés', 'Bars', 'Nightlife', 'Nature', 'Sport', 'Kids', 'Culture', 'Art', 'Wellness', 'Shopping', 'Entertainment', 'Tours & Experiences']) {
        expect(screen.getByRole('button', { name: label })).toBeTruthy();
      }
    });

    it('selecting a previously non-headline category (Sport) marks it active and leaves All inactive — the fixed defect', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
      });

      expect(mockedQuery).toHaveBeenLastCalledWith({
        scope: 'nearby',
        current_location: LOCATION,
        categories: ['sport'],
      });
      expect(screen.getByRole('button', { name: 'Sport, selected' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'All categories' })).toBeTruthy();
    });

    it('selecting a second category marks both pills active', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
      });
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Culture' }));
      });

      expect(mockedQuery).toHaveBeenLastCalledWith({
        scope: 'nearby',
        current_location: LOCATION,
        categories: ['sport', 'culture'],
      });
      expect(screen.getByRole('button', { name: 'Sport, selected' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Culture, selected' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'All categories' })).toBeTruthy();
    });

    it('deselecting the last selected category returns All to active', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
      });
      expect(screen.getByRole('button', { name: 'Sport, selected' })).toBeTruthy();

      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sport, selected' }));
      });

      expect(mockedQuery).toHaveBeenLastCalledWith({ scope: 'nearby', current_location: LOCATION });
      expect(screen.getByRole('button', { name: 'All categories, selected' })).toBeTruthy();
    });

    it('tapping "All" while already active is a no-op — no extra query', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      fireEvent.press(screen.getByRole('button', { name: 'All categories, selected' }));
      expect(mockedQuery).toHaveBeenCalledTimes(1);
    });

    it('a stale response from an earlier tap never overwrites a later one (retarget mid-flight, design-spec.md T4)', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      let resolveSport!: (r: ActivitiesQueryResult) => void;
      let resolveCulture!: (r: ActivitiesQueryResult) => void;
      mockedQuery.mockImplementationOnce(() => new Promise((resolve) => (resolveSport = resolve)));
      mockedQuery.mockImplementationOnce(() => new Promise((resolve) => (resolveCulture = resolve)));

      fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
      fireEvent.press(screen.getByRole('button', { name: 'Culture' }));

      const cultureResult = { ...activity, id: '2', title: 'Sport+Culture result' };
      const sportOnlyResult = { ...activity, id: '3', title: 'Sport-only result' };
      // Culture's request (fired second) resolves first; Sport's (fired
      // first, so it's stale) resolves after — the exact "last-resolved
      // isn't last-requested" ordering the fix guards against.
      await act(async () => resolveCulture(successResult([cultureResult])));
      await waitFor(() => expect(screen.getByText('Sport+Culture result')).toBeTruthy());

      await act(async () => resolveSport(successResult([sportOnlyResult])));

      expect(screen.getByText('Sport+Culture result')).toBeTruthy();
      expect(screen.queryByText('Sport-only result')).toBeNull();
    });

    it('a pill tap while the initial load is still in flight leaves the pill-filtered result standing, not the initial load', async () => {
      let resolveInitial!: (r: ActivitiesQueryResult) => void;
      mockedQuery.mockImplementationOnce(() => new Promise((resolve) => (resolveInitial = resolve)));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);

      // Row stays operable while the initial fetch is still pending
      // (design-spec.md T4) — tap a pill before it resolves.
      let resolveSport!: (r: ActivitiesQueryResult) => void;
      mockedQuery.mockImplementationOnce(() => new Promise((resolve) => (resolveSport = resolve)));
      fireEvent.press(screen.getByRole('button', { name: 'Sport' }));

      const sportResult = { ...activity, id: '2', title: 'Sport-filtered result' };
      const initialResult = { ...activity, id: '1', title: 'Unfiltered initial result' };
      // Sport's request (fired second) resolves first; the initial load's
      // (fired first, now stale) resolves after it.
      await act(async () => resolveSport(successResult([sportResult])));
      await waitFor(() => expect(screen.getByText('Sport-filtered result')).toBeTruthy());

      await act(async () => resolveInitial(successResult([initialResult])));

      expect(screen.getByText('Sport-filtered result')).toBeTruthy();
      expect(screen.queryByText('Unfiltered initial result')).toBeNull();
    });

    it('"Try again" after an error, then a pill tap before retry resolves, leaves the pill-filtered result standing', async () => {
      mockedQuery.mockResolvedValueOnce({ status: 500, message: 'internal error' });
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('internal error')).toBeTruthy());

      let resolveRetry!: (r: ActivitiesQueryResult) => void;
      let resolveSport!: (r: ActivitiesQueryResult) => void;
      mockedQuery.mockImplementationOnce(() => new Promise((resolve) => (resolveRetry = resolve)));
      mockedQuery.mockImplementationOnce(() => new Promise((resolve) => (resolveSport = resolve)));

      fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      // The pill row sits in the header, unaffected by the error body below
      // it — still tappable the instant retry fires.
      fireEvent.press(screen.getByRole('button', { name: 'Sport' }));

      const sportResult = { ...activity, id: '2', title: 'Sport-filtered result' };
      const retryResult = { ...activity, id: '1', title: 'Unfiltered retry result' };
      // Sport's request (fired second) resolves first; retry's (fired first,
      // now stale) resolves after it.
      await act(async () => resolveSport(successResult([sportResult])));
      await waitFor(() => expect(screen.getByText('Sport-filtered result')).toBeTruthy());

      await act(async () => resolveRetry(successResult([retryResult])));

      expect(screen.getByText('Sport-filtered result')).toBeTruthy();
      expect(screen.queryByText('Unfiltered retry result')).toBeNull();
    });

    it('a sheet-applied category (e.g. Sport) reads as active in the pill row too — no more lossy projection', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
      await flush();
      // "Sport" matches both the header pill and the sheet's own Category
      // option — press the sheet's (opened second, so it's the last match).
      const sportChips = screen.getAllByRole('button', { name: 'Sport' });
      fireEvent.press(sportChips[sportChips.length - 1]);
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: /^apply filters$/i }));
      });

      expect(screen.getByRole('button', { name: 'Sport, selected' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'All categories' })).toBeTruthy();
      // design-spec.md T4: no duplicate removable chip — the pill row is the
      // only representation; the Filters button's count badge covers the rest.
      expect(screen.queryByRole('button', { name: 'Remove Sport filter' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeTruthy();
    });

    it('deselecting a category from the header pill clears only that category\'s subtypes, applied via the sheet', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      // Select Sport from the header pill row, then apply one of its
      // subtypes from the sheet (still gated to a single category pre-T5).
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
      });
      fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
      await flush();
      fireEvent.press(screen.getByRole('button', { name: 'Climbing Gym' }));
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: /^apply filters$/i }));
      });
      expect(mockedQuery).toHaveBeenLastCalledWith({
        scope: 'nearby',
        current_location: LOCATION,
        categories: ['sport'],
        subcategories: ['climbing_gym'],
      });

      // Deselecting Sport from the header pill drops the category and its
      // subtype together — no orphaned subcategory left on the wire.
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sport, selected' }));
      });
      expect(mockedQuery).toHaveBeenLastCalledWith({ scope: 'nearby', current_location: LOCATION });
    });
  });

  describe('Tripadvisor list-footer attribution (T8)', () => {
    it('shows the footer caption when the visible list has >=1 Tripadvisor row', async () => {
      const tripadvisorActivity: Activity = {
        ...activity,
        id: '2',
        title: 'Casa Verde Bistro',
        details: {
          category: 'restaurants',
          tripadvisor: {
            rating_image_url: 'https://tripadvisor.example/bubble.png',
            review_count: 42,
            web_url: 'https://tripadvisor.example/place',
          },
        },
      };
      mockedQuery.mockResolvedValue(successResult([activity, tripadvisorActivity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);

      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
      expect(
        screen.getByText('Restaurant, bar and café ratings, reviews and photos provided by Tripadvisor.'),
      ).toBeTruthy();
    });

    it('omits the footer caption when no row in the visible list is Tripadvisor-sourced', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);

      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
      expect(
        screen.queryByText('Restaurant, bar and café ratings, reviews and photos provided by Tripadvisor.'),
      ).toBeNull();
    });
  });
});
