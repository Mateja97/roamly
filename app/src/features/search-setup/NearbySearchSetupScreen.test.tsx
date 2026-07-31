import { AccessibilityInfo, BackHandler } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { queryActivities } from '../../api/activities';
import type { Activity, ActivitiesQueryResult } from '../../api/activities';
import { NearbySearchSetupScreen } from './NearbySearchSetupScreen';

// T4/T6: a pushed ActivityDetailScreen fires its own getActivityPhotos and
// getActivity fetches on mount — stub both to never resolve so neither
// disturbs assertions here.
jest.mock('../../api/activities', () => ({
  queryActivities: jest.fn(),
  getActivityPhotos: jest.fn(() => new Promise(() => {})),
  getActivity: jest.fn(() => new Promise(() => {})),
}));
const mockedQuery = jest.mocked(queryActivities);

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
});

const SELECTION = { scope: 'nearby' as const, coordinates: { latitude: 44.8125, longitude: 20.4612 } };

const activity: Activity = {
  id: '1',
  title: 'Skadarlija Food Walk',
  description: 'A tasty walk',
  category: 'restaurants',
  location: { lat: 44.8153, lng: 20.4646 },
  country: 'Serbia',
  rating: 4.6,
  image_refs: [],
  tags: [],
  distance_km: 0.4,
};

function successResult(activities: Activity[]): ActivitiesQueryResult {
  return { status: 'success', activities };
}

afterEach(() => jest.resetAllMocks());

describe('NearbySearchSetupScreen', () => {
  it('shows the fixed 10km range card with no slider, and the all-categories count once it resolves', async () => {
    mockedQuery.mockResolvedValue(successResult([activity, activity]));
    render(<NearbySearchSetupScreen selection={SELECTION} onConfirm={jest.fn()} onBack={jest.fn()} />);

    expect(screen.getByText('Within 10 km')).toBeTruthy();
    expect(screen.getByText('Fixed range around your location')).toBeTruthy();
    expect(screen.getByText('Fixed')).toBeTruthy();
    expect(screen.getByText('0 selected')).toBeTruthy();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Show 2 activities' })).toBeTruthy());
    expect(mockedQuery).toHaveBeenCalledWith({
      scope: 'nearby',
      current_location: { lat: 44.8125, lng: 20.4612 },
    });
  });

  it('selecting a chip updates the count and includes categories in the request', async () => {
    mockedQuery.mockResolvedValue(successResult([activity]));
    render(<NearbySearchSetupScreen selection={SELECTION} onConfirm={jest.fn()} onBack={jest.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show 1 activities' })).toBeTruthy());

    mockedQuery.mockResolvedValueOnce(successResult([activity, activity, activity]));
    fireEvent.press(screen.getByRole('button', { name: 'Sport' }));

    expect(screen.getByText('1 selected')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show 3 activities' })).toBeTruthy());
    expect(mockedQuery).toHaveBeenLastCalledWith({
      scope: 'nearby',
      current_location: { lat: 44.8125, lng: 20.4612 },
      categories: ['sport'],
    });
  });

  it('disables Reset with nothing selected, enables it once a chip is picked, and Reset clears the selection', async () => {
    mockedQuery.mockResolvedValue(successResult([activity]));
    render(<NearbySearchSetupScreen selection={SELECTION} onConfirm={jest.fn()} onBack={jest.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show 1 activities' })).toBeTruthy());

    expect(screen.getByRole('button', { name: 'Reset' })).toHaveProp('accessibilityState', { disabled: true });

    fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
    expect(screen.getByRole('button', { name: 'Reset' })).toHaveProp('accessibilityState', { disabled: false });

    fireEvent.press(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByText('0 selected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sport, selected/i })).toBeNull();

    // Reset re-triggers the live-count effect (selected changed back to []) —
    // wait for it to settle so its setCount/setError isn't left dangling
    // outside act() past the end of the test.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show 1 activities' })).toBeTruthy());
  });

  it('disables the CTA and reads "Show 0 activities" when the filter yields no results', async () => {
    mockedQuery.mockResolvedValue(successResult([]));
    render(<NearbySearchSetupScreen selection={SELECTION} onConfirm={jest.fn()} onBack={jest.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Show 0 activities' })).toHaveProp('accessibilityState', {
        disabled: true,
      })
    );
  });

  it('pressing the CTA re-queries and, on success, confirms the selection forward', async () => {
    mockedQuery.mockResolvedValue(successResult([activity]));
    const onConfirm = jest.fn();
    render(<NearbySearchSetupScreen selection={SELECTION} onConfirm={onConfirm} onBack={jest.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show 1 activities' })).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /show \d+ activities/i })).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /show \d+ activities/i }));
    });

    expect(onConfirm).toHaveBeenCalledWith(['sport']);
  });

  it('shows an error banner and never confirms when the CTA-triggered search fails', async () => {
    mockedQuery.mockResolvedValueOnce(successResult([activity]));
    render(<NearbySearchSetupScreen selection={SELECTION} onConfirm={jest.fn()} onBack={jest.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show 1 activities' })).toBeTruthy());

    mockedQuery.mockResolvedValueOnce({ status: 500, message: 'internal error' });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Show 1 activities' }));
    });

    expect(screen.getByText('internal error')).toBeTruthy();
    expect(screen.getByRole('button', { name: /show \d+ activities/i })).toBeTruthy();
  });

  it('calls onBack on Android hardware back press — no custom navigator', async () => {
    mockedQuery.mockResolvedValue(successResult([]));
    const addBackListener = jest.spyOn(BackHandler, 'addEventListener');
    const onBack = jest.fn();
    render(<NearbySearchSetupScreen selection={SELECTION} onConfirm={jest.fn()} onBack={onBack} />);
    // Let the mount-time live-count effect settle before asserting, so its
    // setCount/setError doesn't land outside act() after the test returns.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show 0 activities' })).toBeTruthy());

    const registration = addBackListener.mock.calls.find(([eventName]) => eventName === 'hardwareBackPress');
    expect(registration).toBeTruthy();
    const handler = registration![1] as () => boolean;
    expect(handler()).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);

    addBackListener.mockRestore();
  });
});
