import { AccessibilityInfo, BackHandler } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { queryActivities } from '../../api/activities';
import type { Activity, ActivitiesQueryResult } from '../../api/activities';
import { ActivityListScreen } from './ActivityListScreen';

jest.mock('../../api/activities', () => ({ queryActivities: jest.fn() }));
const mockedQuery = jest.mocked(queryActivities);

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
});

const activity: Activity = {
  id: '1',
  title: 'Skadarlija Food Walk',
  description: 'A tasty walk',
  category: 'food_and_drink',
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
    expect(screen.getByText('1 activity')).toBeTruthy();
    expect(screen.getByText('Nearby')).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText('2 activities')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    await flush();
    fireEvent.press(screen.getByRole('button', { name: 'Sports' }));

    mockedQuery.mockResolvedValueOnce(successResult([activity]));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /^apply filters$/i }));
    });

    expect(mockedQuery).toHaveBeenLastCalledWith({
      scope: 'nearby',
      current_location: LOCATION,
      categories: ['sports'],
    });
    expect(screen.getByText('1 activity')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Sports filter' })).toBeTruthy();
  });

  it('removing an active-filter chip clears just that filter and re-queries', async () => {
    mockedQuery.mockResolvedValueOnce(successResult([activity]));
    render(<ActivityListScreen selection={{ scope: 'nearby', coordinates: COORDINATES }} onBack={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('1 activity')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    await flush();
    fireEvent.press(screen.getByRole('button', { name: 'Sports' }));
    mockedQuery.mockResolvedValueOnce(successResult([activity]));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /^apply filters$/i }));
    });
    expect(screen.getByRole('button', { name: 'Remove Sports filter' })).toBeTruthy();

    mockedQuery.mockResolvedValueOnce(successResult([activity, { ...activity, id: '2' }]));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Remove Sports filter' }));
    });

    expect(mockedQuery).toHaveBeenLastCalledWith({ scope: 'nearby', current_location: LOCATION });
    expect(screen.getByText('2 activities')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove Sports filter' })).toBeNull();
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
    await waitFor(() => expect(screen.getByText('1 activity')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    await flush();
    fireEvent.press(screen.getByRole('button', { name: 'Sports' }));
    mockedQuery.mockResolvedValueOnce(successResult([activity]));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /^apply filters$/i }));
    });

    // Sheet closed on Apply success — re-open it and it should show Sports
    // already selected (the now-applied filter), not the pre-Apply draft.
    fireEvent.press(screen.getByRole('button', { name: /^filters/i }));
    await flush();
    expect(screen.getByRole('button', { name: /sports, selected/i })).toBeTruthy();
  });
});
