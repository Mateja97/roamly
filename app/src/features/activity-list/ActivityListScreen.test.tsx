import { AccessibilityInfo, BackHandler } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { queryActivities } from '../../api/activities';
import type { Activity, ActivitiesQueryResult } from '../../api/activities';
import { ActivityListScreen } from './ActivityListScreen';

jest.mock('../../api/activities', () => ({ queryActivities: jest.fn() }));
const mockedQuery = jest.mocked(queryActivities);

const HOME_LOCATION = { lat: 44.8125, lng: 20.4612 };
const HOME_COUNTRY = 'Serbia';

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
  image_refs: ['https://example.com/img.jpg'],
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

  it('fetches on mount using the scope + home location, and renders loaded cards', async () => {
    mockedQuery.mockResolvedValue(successResult([activity]));
    render(<ActivityListScreen selection={{ scope: 'home', homeLocation: HOME_LOCATION }} onBack={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());

    expect(mockedQuery).toHaveBeenCalledWith({ scope: 'home', home_location: HOME_LOCATION, max_distance_km: 50 });
    expect(screen.getByText('1 activity')).toBeTruthy();
    expect(screen.queryByText('Top-rated activities')).toBeNull();
  });

  it('country scope sends the top_rated sort flag and shows the two-line ranking header immediately', async () => {
    mockedQuery.mockResolvedValue(successResult([activity]));
    render(<ActivityListScreen selection={{ scope: 'my_country', homeCountry: HOME_COUNTRY }} onBack={jest.fn()} />);

    // Static header copy renders at mount, before the fetch resolves.
    expect(screen.getByText(HOME_COUNTRY)).toBeTruthy();
    expect(screen.getByText('Top-rated activities')).toBeTruthy();

    await waitFor(() => expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy());
    expect(mockedQuery).toHaveBeenCalledWith({ scope: 'my_country', home_country: HOME_COUNTRY, sort: 'top_rated' });
    // Ranking is server-trusted — no re-sort UI, header copy is unchanged
    // after results arrive (the card's own country meta text also reads
    // "Serbia" here, hence getAllByText).
    expect(screen.getAllByText(HOME_COUNTRY).length).toBeGreaterThan(0);
    expect(screen.getByText('Top-rated activities')).toBeTruthy();
  });

  it('shows the empty state with no Clear-filters button when no filters are active', async () => {
    mockedQuery.mockResolvedValue(successResult([]));
    render(<ActivityListScreen selection={{ scope: 'home', homeLocation: HOME_LOCATION }} onBack={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('No activities match')).toBeTruthy());
    expect(screen.getByText('Nothing here right now.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('shows the error state with a Try again action that re-queries', async () => {
    mockedQuery.mockResolvedValueOnce({ status: 500, message: 'internal error' });
    render(<ActivityListScreen selection={{ scope: 'home', homeLocation: HOME_LOCATION }} onBack={jest.fn()} />);

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
    render(<ActivityListScreen selection={{ scope: 'home', homeLocation: HOME_LOCATION }} onBack={onBack} />);
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
    render(<ActivityListScreen selection={{ scope: 'home', homeLocation: HOME_LOCATION }} onBack={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('No activities match')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    await flush();
    expect(screen.getByText('Category')).toBeTruthy();
  });

  it('applying a filter in the sheet re-queries and shows the chip + updated count', async () => {
    mockedQuery.mockResolvedValueOnce(successResult([activity, { ...activity, id: '2' }]));
    render(<ActivityListScreen selection={{ scope: 'home', homeLocation: HOME_LOCATION }} onBack={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('2 activities')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    await flush();
    fireEvent.press(screen.getByRole('button', { name: 'Sports' }));

    mockedQuery.mockResolvedValueOnce(successResult([activity]));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /^apply filters$/i }));
    });

    expect(mockedQuery).toHaveBeenLastCalledWith({
      scope: 'home',
      home_location: HOME_LOCATION,
      categories: ['sports'],
      max_distance_km: 50,
    });
    expect(screen.getByText('1 activity')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Sports filter' })).toBeTruthy();
  });

  it('removing an active-filter chip clears just that filter and re-queries', async () => {
    mockedQuery.mockResolvedValueOnce(successResult([activity]));
    render(<ActivityListScreen selection={{ scope: 'home', homeLocation: HOME_LOCATION }} onBack={jest.fn()} />);
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

    expect(mockedQuery).toHaveBeenLastCalledWith({ scope: 'home', home_location: HOME_LOCATION, max_distance_km: 50 });
    expect(screen.getByText('2 activities')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove Sports filter' })).toBeNull();
  });

  it('re-opening the sheet after applying reflects the now-applied filters, not the stale draft', async () => {
    mockedQuery.mockResolvedValueOnce(successResult([activity]));
    render(<ActivityListScreen selection={{ scope: 'home', homeLocation: HOME_LOCATION }} onBack={jest.fn()} />);
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
