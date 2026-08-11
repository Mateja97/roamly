import { AccessibilityInfo, BackHandler } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { getActivity, getActivityPhotos, queryActivities } from '../../api/activities';
import type { Activity, ActivitiesQueryResult } from '../../api/activities';
import { suggestCities } from '../../api/cities';
import { ActivityListScreen } from './ActivityListScreen';

jest.mock('../../api/activities', () => ({
  queryActivities: jest.fn(),
  getActivityPhotos: jest.fn(),
  getActivity: jest.fn(() => new Promise(() => {})),
}));
jest.mock('../../api/cities', () => ({ suggestCities: jest.fn() }));
jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const mockedQuery = jest.mocked(queryActivities);
const mockedGetActivityPhotos = jest.mocked(getActivityPhotos);
const mockedGetActivity = jest.mocked(getActivity);
const mockedLocation = jest.mocked(Location);
const mockedSuggestCities = jest.mocked(suggestCities);

const COORDINATES = { latitude: 44.8125, longitude: 20.4612 };
const LOCATION = { lat: 44.8125, lng: 20.4612 };

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
  mockedGetActivityPhotos.mockReturnValue(new Promise(() => {}));
  mockedGetActivity.mockReturnValue(new Promise(() => {}));
  mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'undetermined' } as never);
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

async function flush() {
  await act(async () => {});
}

// T2: the Feed's own RatingRow and the open Scope sheet's "Minimum rating"
// group both render a "4.5+"-labelled chip once the sheet is open — scope
// the query to the sheet's own group (found via its accessibilityRole
// "header" label) so these don't collide with the Feed's row behind it.
function sheetRatingChip(name: string) {
  // .parent once lands on the Text's own host wrapper, not its JSX sibling
  // — .parent.parent is FilterGroup's outer View, the real ancestor of the
  // chips row.
  const group = screen.getByRole('header', { name: 'Minimum rating' }).parent!.parent;
  return within(group!).getByRole('button', { name });
}

describe('ActivityListScreen', () => {
  // T5 (root-cause fix, same landmine App.test.tsx's own comment already
  // documents): `resetAllMocks()` calls `mockReset()` on every jest.fn(),
  // including the AsyncStorage jest mock's own `jest.fn(realImplementation)`
  // methods (`@react-native-async-storage/async-storage/jest/async-storage-
  // mock`) — stripping their real in-memory-store implementation back to a
  // bare mock that returns `undefined` for the rest of this file's test run.
  // Every test that only spies on/re-arms `mockedQuery`/`mockedLocation`/
  // `mockedSuggestCities` (all explicitly reset in each test's own body)
  // never noticed; the new AsyncStorage round-trip tests below (traveler
  // mode, nudge-persists-across-a-mount) do. `clearAllMocks()` clears call
  // history only, leaving every mock's implementation — including
  // AsyncStorage's — intact across tests.
  afterEach(() => jest.clearAllMocks());

  it('fetches on mount using the scope + device location, and renders loaded cards under the new Feed header', async () => {
    mockedQuery.mockResolvedValue(successResult([activity]));
    render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
    expect(mockedQuery).toHaveBeenCalledWith({ scope: 'nearby', current_location: LOCATION });
    expect(screen.getByRole('button', { name: /scope: nearby/i })).toBeTruthy();
  });

  it('anywhere with a device-location anchor sends current_location and renders distance', async () => {
    mockedQuery.mockResolvedValue(successResult([activity]));
    render(<ActivityListScreen selection={{ scope: 'anywhere', coordinates: COORDINATES }} onBack={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
    expect(mockedQuery).toHaveBeenCalledWith({ scope: 'anywhere', current_location: LOCATION });
    expect(screen.getByText('0.4 km away')).toBeTruthy();
  });

  it('anywhere with no device-location anchor omits current_location and shows the country instead of distance', async () => {
    mockedQuery.mockResolvedValue(successResult([activity]));
    render(<ActivityListScreen selection={{ scope: 'anywhere' }} onBack={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
    expect(mockedQuery).toHaveBeenCalledWith({ scope: 'anywhere' });
    expect(screen.getByText('Serbia')).toBeTruthy();
    expect(screen.queryByText('0.4 km away')).toBeNull();
    expect(screen.getByRole('button', { name: /scope: exploring everywhere/i })).toBeTruthy();
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

    addBackListener.mockRestore();
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
    expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy();
    // closeDetail() re-fires checkTravelerMode's getHomeBaseSamples() read
    // (refreshAdaptivity on "focus regained") — settle it before the test ends.
    await flush();
  });

  it('Android hardware back closes an open detail screen instead of leaving the list (onBack not called)', async () => {
    mockedQuery.mockResolvedValue(successResult([activity]));
    const addBackListener = jest.spyOn(BackHandler, 'addEventListener');
    const onBack = jest.fn();
    render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={onBack} />);
    await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: /skadarlija food walk/i }));
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();

    const registrations = addBackListener.mock.calls.filter(([eventName]) => eventName === 'hardwareBackPress');
    const handler = registrations[registrations.length - 1][1] as () => boolean;
    act(() => {
      expect(handler()).toBe(true);
    });

    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(onBack).not.toHaveBeenCalled();

    addBackListener.mockRestore();
    // closeDetail() re-fires checkTravelerMode's getHomeBaseSamples() read
    // (refreshAdaptivity on "focus regained") — settle it before the test ends.
    await flush();
  });

  describe('Hardware back with no onBack (T4: Feed is the app\'s home screen)', () => {
    it('falls through to the OS default (returns false) when nothing is open and there is no onBack', async () => {
      mockedQuery.mockResolvedValue(successResult([]));
      const addBackListener = jest.spyOn(BackHandler, 'addEventListener');
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} />);
      await waitFor(() => expect(screen.getByText('No activities match')).toBeTruthy());

      const registration = addBackListener.mock.calls.find(([eventName]) => eventName === 'hardwareBackPress');
      const handler = registration![1] as () => boolean;
      expect(handler()).toBe(false);

      addBackListener.mockRestore();
    });

    it('closes an open Scope sheet instead of falling through, when there is no onBack', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      const addBackListener = jest.spyOn(BackHandler, 'addEventListener');
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      fireEvent.press(screen.getByRole('button', { name: /scope: nearby/i }));
      await flush();
      expect(screen.getByText('Where to?')).toBeTruthy();

      const registrations = addBackListener.mock.calls.filter(([eventName]) => eventName === 'hardwareBackPress');
      const handler = registrations[registrations.length - 1][1] as () => boolean;
      act(() => {
        expect(handler()).toBe(true);
      });

      expect(screen.queryByText('Where to?')).toBeNull();

      addBackListener.mockRestore();
      // closeSheet() re-fires checkTravelerMode's getHomeBaseSamples() read
      // (refreshAdaptivity on "focus regained") — settle it before the test ends.
      await flush();
    });
  });

  describe('Scope derivation at launch (T4)', () => {
    it('promotes the cold-start unanchored Anywhere selection to a real Nearby scope when permission is already granted', async () => {
      mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
      mockedLocation.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: COORDINATES.latitude, longitude: COORDINATES.longitude } } as never);
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'anywhere' }} />);

      await waitFor(() => expect(screen.getByRole('button', { name: /scope: nearby/i })).toBeTruthy());
      expect(mockedQuery).toHaveBeenLastCalledWith({ scope: 'nearby', current_location: LOCATION });
    });

    it('review round 1 (Minor): keeps the cold-start list visible during the promotion re-query instead of flashing back to skeletons', async () => {
      mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
      mockedLocation.getCurrentPositionAsync.mockResolvedValue({
        coords: { latitude: COORDINATES.latitude, longitude: COORDINATES.longitude },
      } as never);
      let resolveSecond!: (r: ActivitiesQueryResult) => void;
      mockedQuery
        .mockResolvedValueOnce(successResult([activity])) // cold-start anywhere query
        .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve))); // promotion's nearby query

      render(<ActivityListScreen selection={{ scope: 'anywhere' }} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      // The promotion's second (Nearby) query is now in flight — the card
      // from the first query must still be visible, not a skeleton.
      await flush();
      expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy();

      await act(async () => {
        resolveSecond(successResult([activity]));
      });
      await waitFor(() => expect(screen.getByRole('button', { name: /scope: nearby/i })).toBeTruthy());
      expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy();
    });

    it('does not promote a later, user-chosen unanchored Anywhere back to Nearby (only the launch occurrence promotes)', async () => {
      // Undetermined at mount — the launch check fires once here and finds
      // nothing granted, so it never promotes, but it does consume the
      // one-shot "this is launch" flag either way.
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'anywhere' }} />);
      await waitFor(() => expect(screen.getByRole('button', { name: /scope: exploring everywhere/i })).toBeTruthy());

      // The user explicitly picks Nearby via the Scope sheet (a real scope
      // change, not the launch state)...
      fireEvent.press(screen.getByRole('button', { name: /scope: exploring everywhere/i }));
      await flush();
      fireEvent.press(screen.getByRole('button', { name: 'Scope: Nearby' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /^show \d+ activit/i })).toBeTruthy());
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: /^show \d+ activit/i }));
      });
      await waitFor(() => expect(screen.getByRole('button', { name: /scope: nearby/i })).toBeTruthy());

      // ...then explicitly picks Anywhere again, with no city/anchor. This
      // re-enters unanchored Anywhere — a genuinely later occurrence. Even
      // with permission now granted, it must not silently relabel this as
      // Nearby: the user just chose Anywhere on purpose.
      mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
      mockedLocation.getCurrentPositionAsync.mockResolvedValue({
        coords: { latitude: COORDINATES.latitude, longitude: COORDINATES.longitude },
      } as never);
      fireEvent.press(screen.getByRole('button', { name: /scope: nearby/i }));
      await flush();
      fireEvent.press(screen.getByRole('button', { name: 'Scope: Anywhere' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /^show \d+ activit/i })).toBeTruthy());
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: /^show \d+ activit/i }));
      });

      await flush();
      expect(screen.getByRole('button', { name: /scope: exploring everywhere/i })).toBeTruthy();
    });

    it('review round 1 (Important): a pending launch GPS fix does not clobber an Anywhere+city choice applied while it is still in flight', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
      let resolveFix!: (position: unknown) => void;
      mockedLocation.getCurrentPositionAsync.mockReturnValue(
        new Promise((resolve) => {
          resolveFix = resolve;
        }) as never
      );
      mockedSuggestCities.mockResolvedValue({
        status: 'success',
        suggestions: [{ city: 'Lisbon', country: 'Portugal', centroid: { lat: 38.7, lng: -9.1 } }],
      });

      render(<ActivityListScreen selection={{ scope: 'anywhere' }} />);
      await waitFor(() => expect(screen.getByRole('button', { name: /scope: exploring everywhere/i })).toBeTruthy());

      // The launch GPS fix is now pending (mocked to hang). While it's still
      // in flight, the user opens the sheet and applies Anywhere + Lisbon.
      fireEvent.press(screen.getByRole('button', { name: /scope: exploring everywhere/i }));
      await flush();
      fireEvent.changeText(screen.getByLabelText('Search cities'), 'Lis');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Lisbon, Portugal' })).toBeTruthy());
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Lisbon, Portugal' }));
      });
      await waitFor(() => expect(screen.getByRole('button', { name: /^show \d+ activit/i })).toBeTruthy());
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: /^show \d+ activit/i }));
      });
      await waitFor(() => expect(screen.getByRole('button', { name: /scope: anywhere · lisbon/i })).toBeTruthy());

      // Now the pending launch fix resolves, late.
      await act(async () => {
        resolveFix({ coords: { latitude: COORDINATES.latitude, longitude: COORDINATES.longitude } });
      });
      await flush();

      // Still Anywhere · Lisbon — never silently promoted to Nearby, and no
      // incoherent `{scope:'nearby', cities:[...]}` request ever fired.
      expect(screen.getByRole('button', { name: /scope: anywhere · lisbon/i })).toBeTruthy();
      expect(mockedQuery).not.toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'nearby', cities: expect.anything() })
      );
    });

    it('review round 2 (Important — round 1 only closed the city sub-case): a pending launch GPS fix does not clobber a no-city Anywhere choice (e.g. just a minimum-rating apply) applied while it is still in flight', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
      let resolveFix!: (position: unknown) => void;
      mockedLocation.getCurrentPositionAsync.mockReturnValue(
        new Promise((resolve) => {
          resolveFix = resolve;
        }) as never
      );

      render(<ActivityListScreen selection={{ scope: 'anywhere' }} />);
      await waitFor(() => expect(screen.getByRole('button', { name: /scope: exploring everywhere/i })).toBeTruthy());

      // The launch GPS fix is now pending (mocked to hang). While it's
      // still in flight, the user opens the sheet and applies Anywhere with
      // no city at all — just a minimum-rating change (`prev.cities.length
      // === 0` is already true both before and after this apply, so that
      // guard alone can't tell the two apart; only a write-time check on
      // "has the user applied anything since" can).
      fireEvent.press(screen.getByRole('button', { name: /scope: exploring everywhere/i }));
      await flush();
      fireEvent.press(sheetRatingChip('4.5+'));
      await waitFor(() => expect(screen.getByRole('button', { name: /^show \d+ activit/i })).toBeTruthy());
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: /^show \d+ activit/i }));
      });
      await waitFor(() => expect(screen.getByRole('button', { name: /scope: exploring everywhere/i })).toBeTruthy());
      expect(mockedQuery).toHaveBeenLastCalledWith({ scope: 'anywhere', min_rating: 4.5 });

      // Now the pending launch fix resolves, late.
      await act(async () => {
        resolveFix({ coords: { latitude: COORDINATES.latitude, longitude: COORDINATES.longitude } });
      });
      await flush();

      // Still unanchored Anywhere with the applied rating — never silently
      // promoted to Nearby, and no `current_location`-bearing Nearby
      // request ever fired for it.
      expect(screen.getByRole('button', { name: /scope: exploring everywhere/i })).toBeTruthy();
      expect(mockedQuery).not.toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'nearby', current_location: expect.anything() })
      );
    });
  });

  describe('Category pill row (T3, relocated from the old header)', () => {
    it('renders "All" plus all 13 categories, "All" selected by default', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      expect(screen.getByRole('button', { name: 'All categories, selected' })).toBeTruthy();
      for (const label of [
        'Restaurants', 'Cafés', 'Bars', 'Nightlife', 'Nature', 'Sport', 'Kids', 'Culture', 'Art', 'Wellness', 'Shopping', 'Entertainment', 'Tours & Experiences',
      ]) {
        expect(screen.getByRole('button', { name: label })).toBeTruthy();
      }
    });

    it('review round 2 (Minor — round 1 narrowed stale-while-revalidate too broadly): a category tap still shows the loading skeleton, not the stale list', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([activity])); // initial mount
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      let resolveCategoryQuery!: (r: ActivitiesQueryResult) => void;
      mockedQuery.mockImplementationOnce(() => new Promise((resolve) => (resolveCategoryQuery = resolve)));
      fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
      await flush();

      // Still in flight — design-spec.md's list/skeleton states stay
      // unchanged by this task, so a user-initiated refetch collapses to
      // the loading skeleton exactly like it always has; stale-while-
      // revalidate is reserved for the launch promotion's own automatic
      // re-query only (see the "keeps the cold-start list visible" test).
      expect(screen.queryByText('Skadarlija Food Walk')).toBeNull();

      await act(async () => {
        resolveCategoryQuery(successResult([activity]));
      });
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
    });

    it('selecting a category marks it active, re-queries with it, and All goes inactive', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
      });

      expect(mockedQuery).toHaveBeenLastCalledWith({ scope: 'nearby', current_location: LOCATION, categories: ['sport'] });
      expect(screen.getByRole('button', { name: 'Sport, selected' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'All categories' })).toBeTruthy();
    });

    it('tapping a pill never reorders the row — same pill stays in the same slot, including itself', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      const categoryLabels = [
        'All', 'Restaurants', 'Cafés', 'Bars', 'Nightlife', 'Nature', 'Sport', 'Kids', 'Culture', 'Art', 'Wellness', 'Shopping', 'Entertainment', 'Tours & Experiences',
      ];
      function categoryPillOrder() {
        return screen
          .getAllByRole('button')
          .map((b) => (b.props.accessibilityLabel as string).replace(/, selected$/, '').replace(/^All categories$/, 'All'))
          .filter((name) => categoryLabels.includes(name));
      }

      // Captured, not asserted against a fixed taxonomy order — real wall-
      // clock time at test-run may float 2-3 categories to the front
      // (categoryOrder.ts); this test only cares that selecting never
      // changes whatever order it started in.
      const before = categoryPillOrder();
      expect(before).toHaveLength(categoryLabels.length);

      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
      });
      expect(categoryPillOrder()).toEqual(before);

      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sport, selected' }));
      });
      expect(categoryPillOrder()).toEqual(before);
    });

    it('deselecting the last selected category returns All to active and drops categories from the request', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
      });
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

    it('a stale response from an earlier tap never overwrites a later one', async () => {
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
      await act(async () => resolveCulture(successResult([cultureResult])));
      await waitFor(() => expect(screen.getByText('Sport+Culture result')).toBeTruthy());

      await act(async () => resolveSport(successResult([sportOnlyResult])));

      expect(screen.getByText('Sport+Culture result')).toBeTruthy();
      expect(screen.queryByText('Sport-only result')).toBeNull();
    });
  });

  describe('Rating pill row (T2, one-tap minimum-rating filter)', () => {
    it('renders exactly the four rating options, Any selected by default', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      expect(screen.getByRole('button', { name: 'Any rating, selected' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Rated 4.0 and up' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Rated 4.5 and up' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Rated 4.8 and up' })).toBeTruthy();
    });

    it('tapping a rating chip marks it active, re-queries with min_rating, and Any goes inactive', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Rated 4.5 and up' }));
      });

      expect(mockedQuery).toHaveBeenLastCalledWith({ scope: 'nearby', current_location: LOCATION, min_rating: 4.5 });
      expect(screen.getByRole('button', { name: 'Rated 4.5 and up, selected' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Any rating' })).toBeTruthy();
    });

    it('tapping the already-selected "Any" is a no-op — no extra query', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      fireEvent.press(screen.getByRole('button', { name: 'Any rating, selected' }));
      expect(mockedQuery).toHaveBeenCalledTimes(1);
    });

    it('switching from one rating chip to another is exactly one re-query, not the already-selected one\'s no-op', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Rated 4.0 and up' }));
      });
      expect(mockedQuery).toHaveBeenCalledTimes(2);

      // No mockResolvedValueOnce queued here — the no-op below must not
      // consume one (and mustn't fire a query at all).
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Rated 4.0 and up, selected' }));
      });
      expect(mockedQuery).toHaveBeenCalledTimes(2); // still 2 — re-tapping the selected chip fired no third query

      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Rated 4.8 and up' }));
      });
      expect(mockedQuery).toHaveBeenLastCalledWith({ scope: 'nearby', current_location: LOCATION, min_rating: 4.8 });
      expect(mockedQuery).toHaveBeenCalledTimes(3);
    });

    it('a rating that leaves zero results, with no category selected, shows Clear filters and resets both on tap', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([activity])); // mount
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      mockedQuery.mockResolvedValueOnce(successResult([])); // 4.8+ tap: zero results
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Rated 4.8 and up' }));
      });
      await waitFor(() => expect(screen.getByText('No activities match')).toBeTruthy());
      // Before this task, an active rating with no category selected wasn't
      // counted as a filter at all, so no Clear action showed here — a dead
      // end one tap after the filter that caused it.
      expect(screen.getByText('Try removing a filter or widening your distance.')).toBeTruthy();
      const clearButton = screen.getByRole('button', { name: 'Clear filters' });

      mockedQuery.mockResolvedValueOnce(successResult([activity])); // Clear filters re-query
      await act(async () => {
        fireEvent.press(clearButton);
      });

      expect(mockedQuery).toHaveBeenLastCalledWith({ scope: 'nearby', current_location: LOCATION }); // no min_rating, no categories
      expect(screen.getByRole('button', { name: 'Any rating, selected' })).toBeTruthy();
    });
  });

  describe('Tours ticket (GetYourGuide referral — the provider-less category)', () => {
    const originalPartnerId = process.env.EXPO_PUBLIC_GYG_PARTNER_ID;
    beforeEach(() => {
      process.env.EXPO_PUBLIC_GYG_PARTNER_ID = 'ABC123';
    });
    afterEach(() => {
      process.env.EXPO_PUBLIC_GYG_PARTNER_ID = originalPartnerId;
      if (originalPartnerId === undefined) delete process.env.EXPO_PUBLIC_GYG_PARTNER_ID;
    });

    async function selectTours() {
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
      mockedQuery.mockResolvedValue(successResult([]));
      fireEvent.press(screen.getByRole('button', { name: 'Tours & Experiences' }));
      await flush();
    }

    it('is absent until the category is selected', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
      expect(screen.queryByText(/Book a guided tour/)).toBeNull();
    });

    it('replaces the empty state when Tours is the only selection', async () => {
      await selectTours();
      // The category has no provider, so it always comes back empty — the
      // ticket is the answer, not "No activities match" beneath it.
      expect(screen.getByText(/Book a guided tour/)).toBeTruthy();
      expect(screen.queryByText('No activities match')).toBeNull();
    });

    // The tours query ALWAYS resolves empty in production — the category has no
    // provider. So the city has to survive that empty response, which is the
    // only sequence this feature ever actually sees in Nearby. An earlier
    // version of this test left the mock resolving rows for the tours query
    // too, and passed against a response the backend can never return.
    it('keeps the Nearby city after the tours query returns empty', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([{ ...activity, city: 'Belgrade' }]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      mockedQuery.mockResolvedValue(successResult([]));
      fireEvent.press(screen.getByRole('button', { name: 'Tours & Experiences' }));
      await flush();

      expect(screen.getByText('Book a guided tour in Belgrade')).toBeTruthy();
    });

    // Six chips all reading "(0)" and disabled is a filter that can't exist —
    // the category's whole answer is one outbound link.
    it('shows no subtype rail, unlike every other category', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      mockedQuery.mockResolvedValue(successResult([]));
      fireEvent.press(screen.getByRole('button', { name: 'Tours & Experiences' }));
      await flush();

      expect(screen.queryByText('Tours & Experiences subtypes')).toBeNull();
      expect(screen.queryByText(/Walking Tour/)).toBeNull();
      // The ticket still renders — only the rail is gone.
      expect(screen.getByText(/Book a guided tour/)).toBeTruthy();
    });

    // Novi Pazar has no confirmed GetYourGuide inventory — a search there
    // returns one Belgrade day-trip — so the card must not promise tours
    // there. It goes generic and the link widens to the country.
    it('drops the city name for a city with no confirmed inventory', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([{ ...activity, city: 'Novi Pazar' }]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      mockedQuery.mockResolvedValue(successResult([]));
      fireEvent.press(screen.getByRole('button', { name: 'Tours & Experiences' }));
      await flush();

      expect(screen.getByText('Book a guided tour')).toBeTruthy();
      expect(screen.queryByText(/Novi Pazar/)).toBeNull();
    });

    it('keeps the empty state when other categories are also selected', async () => {
      await selectTours();
      fireEvent.press(screen.getByRole('button', { name: 'Culture' }));
      await flush();
      // "No activities match" still speaks for Culture, so both render.
      expect(screen.getByText(/Book a guided tour/)).toBeTruthy();
      expect(screen.getByText('No activities match')).toBeTruthy();
    });

    it('is omitted entirely with no partner id configured — an untracked referral earns nothing', async () => {
      delete process.env.EXPO_PUBLIC_GYG_PARTNER_ID;
      await selectTours();
      expect(screen.queryByText(/Book a guided tour/)).toBeNull();
      expect(screen.getByText('No activities match')).toBeTruthy();
    });
  });

  describe('Subtype rail (T3, Decision 5 — one rail per selected category)', () => {
    const sportActivity: Activity = { ...activity, id: '2', title: 'Downtown Climbing Gym', category: 'sport', subcategory: 'climbing_gym' };

    it('renders no rail with zero categories selected', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
      expect(screen.queryByText(/subtypes$/)).toBeNull();
    });

    it('selecting one category renders exactly its own subtype rail, with a live count per subtype', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([sportActivity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Downtown Climbing Gym')).toBeTruthy());

      mockedQuery.mockResolvedValueOnce(successResult([sportActivity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
      });

      expect(screen.getByText('Sport subtypes')).toBeTruthy();
      expect(screen.getByText('Climbing Gym (1)')).toBeTruthy();
      expect(screen.getByText('Golf Course (0)')).toBeTruthy();
      expect(screen.queryByText(/^Culture subtypes/)).toBeNull();
    });

    it('selecting a second category renders a second, independent rail (not gated to a lone selection)', async () => {
      const cultureActivity: Activity = { ...activity, id: '3', category: 'culture', subcategory: 'historical_site' };
      mockedQuery.mockResolvedValueOnce(successResult([sportActivity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Downtown Climbing Gym')).toBeTruthy());

      mockedQuery.mockResolvedValueOnce(successResult([sportActivity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
      });
      mockedQuery.mockResolvedValueOnce(successResult([sportActivity, cultureActivity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Culture' }));
      });

      expect(screen.getByText('Sport subtypes')).toBeTruthy();
      expect(screen.getByText('Culture subtypes')).toBeTruthy();
      expect(screen.getByText('Historical Site (1)')).toBeTruthy();
    });

    // T5 regression, Decision 5 specifically: the superseded 07-30 rule gated
    // the rail to a *single* selected category. Selecting Sport then Culture
    // (above) already disproves "gated to a lone selection", but Sport and
    // Culture also happen to already be in CATEGORY_OPTIONS taxonomy order,
    // so that test alone can't tell "renders one rail per selection" apart
    // from "renders rails in selection order" (a different, also-wrong
    // rule). Selecting in the reverse order and a 3rd category closes both gaps.
    it('renders rails in taxonomy order regardless of selection order, for any number of simultaneous categories', async () => {
      const cultureActivity: Activity = { ...activity, id: '3', category: 'culture', subcategory: 'historical_site' };
      const kidsActivity: Activity = { ...activity, id: '4', category: 'kids', subcategory: 'playground' };
      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      // Culture (taxonomy index 7) selected before Sport (index 5) and Kids
      // (index 6) — reverse of taxonomy order.
      mockedQuery.mockResolvedValueOnce(successResult([cultureActivity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Culture' }));
      });
      mockedQuery.mockResolvedValueOnce(successResult([sportActivity, cultureActivity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
      });
      mockedQuery.mockResolvedValueOnce(successResult([sportActivity, cultureActivity, kidsActivity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Kids' }));
      });

      // SubtypeRail's heading is `{label} subtypes` — RN's JSX compiles the
      // expression + literal into a children array, not a plain string, so
      // join it rather than assume `.props.children` is already a string.
      const railHeadings = screen
        .getAllByRole('header')
        .map((h) => (Array.isArray(h.props.children) ? h.props.children.join('') : h.props.children));
      expect(railHeadings).toEqual(['Sport subtypes', 'Kids subtypes', 'Culture subtypes']);
    });

    it('tapping an enabled subtype chip filters the visible list client-side — no new query', async () => {
      const otherSport: Activity = { ...activity, id: '4', title: 'City Golf Course', category: 'sport', subcategory: 'golf_course' };
      mockedQuery.mockResolvedValueOnce(successResult([sportActivity, otherSport]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Downtown Climbing Gym')).toBeTruthy());

      mockedQuery.mockResolvedValueOnce(successResult([sportActivity, otherSport]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
      });
      expect(mockedQuery).toHaveBeenCalledTimes(2);
      expect(screen.getByText('City Golf Course')).toBeTruthy();

      fireEvent.press(screen.getByText('Climbing Gym (1)'));
      // Client-side filter only — no third query fired.
      expect(mockedQuery).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Downtown Climbing Gym')).toBeTruthy();
      expect(screen.queryByText('City Golf Course')).toBeNull();
    });

    it('a zero-count subtype chip is disabled and cannot be tapped', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([sportActivity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Downtown Climbing Gym')).toBeTruthy());
      mockedQuery.mockResolvedValueOnce(successResult([sportActivity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
      });

      const golfChip = screen.getByRole('button', { name: /golf course.*0 results.*unavailable/i });
      expect(golfChip.props.accessibilityState).toMatchObject({ disabled: true });
    });

    it('deselecting a category from the pill row drops its rail and its selected subtypes', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([sportActivity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Downtown Climbing Gym')).toBeTruthy());
      mockedQuery.mockResolvedValueOnce(successResult([sportActivity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
      });
      fireEvent.press(screen.getByText('Climbing Gym (1)'));

      mockedQuery.mockResolvedValueOnce(successResult([activity]));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sport, selected' }));
      });
      expect(screen.queryByText('Sport subtypes')).toBeNull();
      expect(mockedQuery).toHaveBeenLastCalledWith({ scope: 'nearby', current_location: LOCATION });
    });
  });

  // T5 regression: travelerMode.ts's own pure functions (median, threshold,
  // <3-samples gate) are unit-tested in travelerMode.test.ts, but the
  // screen's own `checkTravelerMode` wiring — reading AsyncStorage's
  // home-base samples, computing the median, and flipping `travelerMode`
  // state on mount — had zero integration coverage until now.
  describe('Traveler mode (T3 adaptivity wiring)', () => {
    // Same fixtures as travelerMode.test.ts — Paris is ~1500km from
    // Belgrade, comfortably past the 150km threshold.
    const BELGRADE = { latitude: 44.8125, longitude: 20.4612 };
    const PARIS = { latitude: 48.8566, longitude: 2.3522 };
    const HOME_BASE_KEY = 'roamly:home-base-samples';
    // "All" deliberately excluded — it's a separate, always-first control
    // (deselects every category), not part of `order`, so it's not a real
    // category name to filter for below.
    const CATEGORY_LABELS = [
      'Restaurants', 'Cafés', 'Bars', 'Nightlife', 'Nature', 'Sport', 'Kids', 'Culture', 'Art', 'Wellness', 'Shopping', 'Entertainment', 'Tours & Experiences',
    ];
    // categoryOrder.ts always prepends traveler floats ahead of any
    // time-of-day float (`[...travelerFloats, ...timeFloats]`), so the pair
    // ['Tours & Experiences', 'Culture'] can only ever lead the row when
    // travelerMode is true — real wall-clock time at test-run can't produce
    // it, no fake timers needed to isolate this from categoryOrder.test.ts's
    // own time-bucket cases.
    function pillOrder() {
      return screen
        .getAllByRole('button')
        .map((b) => (b.props.accessibilityLabel as string).replace(/, selected$/, ''))
        .filter((name) => CATEGORY_LABELS.includes(name));
    }

    afterEach(async () => {
      await AsyncStorage.clear();
    });

    it('fewer than 3 home-base samples never activates traveler mode, even from a fix far from all of them', async () => {
      await AsyncStorage.setItem(HOME_BASE_KEY, JSON.stringify([BELGRADE, BELGRADE]));
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: PARIS }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
      // No further pending state change to await — checkTravelerMode already
      // resolved by the time the query above settled (same microtask queue).

      expect(screen.queryByText('Top experiences here')).toBeNull();
      expect(pillOrder().slice(0, 2)).not.toEqual(['Tours & Experiences', 'Culture']);
      expect(mockedQuery).toHaveBeenCalledTimes(1); // no second, curated-row query ever fires
    });

    it('3+ home-base samples with a median over 150km from the current fix turns traveler mode on: curated row + floated pills', async () => {
      await AsyncStorage.setItem(HOME_BASE_KEY, JSON.stringify([BELGRADE, BELGRADE, BELGRADE]));
      // Distinct title for the curated row's own query result — the main
      // list and the traveler row both render an ActivityCard, so reusing
      // the same fixture for both makes `getByText` ambiguous.
      const curatedActivity: Activity = { ...activity, id: '9', title: 'Louvre Guided Tour' };
      mockedQuery.mockResolvedValueOnce(successResult([activity])); // main list (mount)
      mockedQuery.mockResolvedValue(successResult([curatedActivity])); // traveler row, once travelerMode flips true
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: PARIS }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      await waitFor(() => expect(screen.getByText('Top experiences here')).toBeTruthy());
      expect(screen.getByText('Louvre Guided Tour')).toBeTruthy();
      expect(pillOrder().slice(0, 2)).toEqual(['Tours & Experiences', 'Culture']);
    });
  });

  describe('Scope pill -> Scope sheet (T3 wiring T2)', () => {
    it('tapping the scope pill opens the Scope sheet', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      fireEvent.press(screen.getByRole('button', { name: /scope: nearby/i }));
      await flush();
      expect(screen.getByText('Where to?')).toBeTruthy();
    });

    it('applying a new scope (min rating) from the sheet commits it and re-queries the feed', async () => {
      mockedQuery.mockResolvedValueOnce(successResult([activity])); // initial mount
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      fireEvent.press(screen.getByRole('button', { name: /scope: nearby/i }));
      await flush();
      mockedQuery.mockResolvedValue(successResult([activity])); // sheet's own live-count + explicit tap query
      await act(async () => {
        fireEvent.press(sheetRatingChip('4.5+'));
      });
      // T5 (Minor, self-caught while building the sibling close/reopen
      // test below): the CTA stays disabled (`count === null`) until the
      // sheet's own 300ms-debounced live count resolves — pressing
      // `/^show/i` before that was a silent no-op, and this test's final
      // assertion only ever passed because the live-count debounce itself
      // (scheduled by the '4.5+' press above) produces an identically-
      // shaped request that the `waitFor` below can't tell apart from a
      // real Show tap. Waiting for the count-bearing label first is what
      // makes the later press a real one.
      await waitFor(() => expect(screen.getByRole('button', { name: /^show \d+ activit/i })).toBeTruthy());
      mockedQuery.mockResolvedValue(successResult([activity])); // Feed's own post-apply re-query
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: /^show \d+ activit/i }));
      });

      await waitFor(() =>
        expect(mockedQuery).toHaveBeenLastCalledWith({ scope: 'nearby', current_location: LOCATION, min_rating: 4.5 })
      );
      expect(screen.queryByText('Where to?')).toBeNull(); // the sheet actually closed, not just the request landing
    });

    // T5 regression: the sheet remounts on every open/close
    // (`key={sheetVisible ? 'open' : 'closed'}`) seeded from
    // `initialDraft={appliedScopeDraft}` — proves that contract actually
    // carries the applied rating forward, not just that Apply commits it once.
    it('minimum-rating selection survives a sheet close/reopen', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

      fireEvent.press(screen.getByRole('button', { name: /scope: nearby/i }));
      await flush();
      await act(async () => {
        fireEvent.press(sheetRatingChip('4.5+'));
      });
      // The CTA stays disabled (`count === null`) until the sheet's own
      // 300ms-debounced live count resolves — pressing it before that is a
      // silent no-op (RN's Pressable ignores `onPress` while `disabled`).
      // Same wait ScopeSheet.test.tsx's own "commits the draft and closes"
      // test uses before its Show tap.
      await waitFor(() => expect(screen.getByRole('button', { name: /^show \d+ activit/i })).toBeTruthy());
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: /^show \d+ activit/i }));
      });
      await waitFor(() =>
        expect(mockedQuery).toHaveBeenLastCalledWith({ scope: 'nearby', current_location: LOCATION, min_rating: 4.5 })
      );
      // Confirms the sheet actually closed (not just that the right request
      // landed — the live-count debounce alone can produce the identical
      // request shape while the sheet stays open, which is what silently
      // masked this exact gap the first time this test was written).
      expect(screen.queryByText('Where to?')).toBeNull();

      // Sheet closed on Show (design-spec.md T2's apply-commits-and-closes
      // contract) — reopen it and check the rating chip's own selected
      // state via its accessible name (FilterChip's convention, same as the
      // category row's "Sport, selected"), not just that "4.5+" is
      // rendered at all (an unselected chip renders that text too).
      fireEvent.press(screen.getByRole('button', { name: /scope: nearby/i }));
      await flush();
      expect(sheetRatingChip('4.5+, selected')).toBeTruthy();
    });
  });

  describe('Nearby nudge (T3)', () => {
    afterEach(async () => {
      await AsyncStorage.clear();
    });

    it('shows the "See what\'s near you" nudge for unanchored Anywhere with permission not yet asked', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'anywhere' }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText("See what's near you")).toBeTruthy());
    });

    it('dismissing the nudge hides it and persists the flag', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'anywhere' }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText("See what's near you")).toBeTruthy());

      // `dismissNearbyNudge`'s AsyncStorage write is fire-and-forget from the
      // component's own perspective — the spy captures the call the moment
      // it's made (synchronous up to the `await` inside dismissNearbyNudge
      // itself), so this needs no extra tick/timer to observe, unlike
      // reading the flag back through a second async round trip.
      const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');
      fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
      expect(screen.queryByText("See what's near you")).toBeNull();
      expect(setItemSpy).toHaveBeenCalledWith('roamly:nearby-nudge-dismissed', 'true');
    });

    // T5 regression: the test above only proves dismissing *writes* the
    // flag — it doesn't prove a later launch *reads* it back, the actual
    // "persistence" the AC asks for (mirrors App.test.tsx's own
    // record-then-remount shape for first-launch-seen).
    it('a dismissal from an earlier session persists — a fresh mount with the flag already set never shows the nudge', async () => {
      await AsyncStorage.setItem('roamly:nearby-nudge-dismissed', 'true');
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'anywhere' }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
      expect(screen.queryByText("See what's near you")).toBeNull();
    });

    it('shows the quiet "choose a city" nudge instead, after an OS-level deny', async () => {
      mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'anywhere' }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Choose a city to explore')).toBeTruthy());
      expect(screen.queryByText("See what's near you")).toBeNull();
    });

    it('review round 1/T3-round-2 (Minor): a granted-but-failed launch fix shows the quiet choose-a-city nudge, not "Turn on location"', async () => {
      mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
      mockedLocation.getCurrentPositionAsync.mockRejectedValue(new Error('timed out'));
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'anywhere' }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Choose a city to explore')).toBeTruthy());
      expect(screen.queryByText("See what's near you")).toBeNull();
    });

    it('does not show any nudge once a device-location anchor already exists', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'anywhere', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
      expect(screen.queryByText("See what's near you")).toBeNull();
      expect(screen.queryByText('Choose a city to explore')).toBeNull();
    });

    it('does not show any nudge for Nearby scope', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
      expect(screen.queryByText("See what's near you")).toBeNull();
    });

    it('does not show any nudge once a city is already selected, even with no device-location anchor', async () => {
      mockedQuery.mockResolvedValue(successResult([activity]));
      mockedSuggestCities.mockResolvedValue({
        status: 'success',
        suggestions: [{ city: 'Lisbon', country: 'Portugal', centroid: { lat: 38.7, lng: -9.1 } }],
      });
      render(<ActivityListScreen selection={{ scope: 'anywhere' }} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
      expect(screen.getByText("See what's near you")).toBeTruthy();

      // Select a city via the real Scope sheet flow, same as a user would —
      // a selected city is itself a valid anchor, "unanchored" means no
      // device location AND no city, not merely no device location.
      fireEvent.press(screen.getByRole('button', { name: /scope: exploring everywhere/i }));
      await flush();
      fireEvent.changeText(screen.getByLabelText('Search cities'), 'Lis');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Lisbon, Portugal' })).toBeTruthy());
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Lisbon, Portugal' }));
      });
      await waitFor(() => expect(screen.getByRole('button', { name: /^show \d+ activit/i })).toBeTruthy());
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: /^show \d+ activit/i }));
      });

      expect(screen.queryByText("See what's near you")).toBeNull();
      expect(screen.queryByText('Choose a city to explore')).toBeNull();
    });
  });

  describe('Tripadvisor list-footer attribution (T8, gated by T2 to a quotable review)', () => {
    it('shows the footer caption when the visible list has >=1 Tripadvisor row with a review', async () => {
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
          reviews: [{ rating: 5, date: '1 June 2026', text: 'Great spot.' }],
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

    // tripadvisor-marks-require-reviews (T2): the list query never
    // live-merges (Places Terms §14.3), so a review-less Tripadvisor row
    // never becomes attributed here — the footer must stay silent even
    // though the row is genuinely Tripadvisor-sourced.
    it('omits the footer caption when every Tripadvisor row in the result set is review-less', async () => {
      const reviewlessTripadvisor: Activity = {
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
      mockedQuery.mockResolvedValue(successResult([activity, reviewlessTripadvisor]));
      render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);

      await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
      expect(
        screen.queryByText('Restaurant, bar and café ratings, reviews and photos provided by Tripadvisor.'),
      ).toBeNull();
    });
  });
});
