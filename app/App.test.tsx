import { AccessibilityInfo, BackHandler } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import App from './App';
import { queryActivities } from './src/api/activities';
import type { Activity } from './src/api/activities';

const activity: Activity = {
  id: '1',
  title: 'Skadarlija Food Walk',
  description: 'A tasty walk',
  category: 'sport',
  location: { lat: 44.8153, lng: 20.4646 },
  country: 'Serbia',
  rating: 4.6,
  image_refs: [],
  tags: [],
  distance_km: 0.4,
};

// ScopePickerScreen's mount effect checks `isReduceMotionEnabled()` on a
// microtask — flush it inside `act` so a purely synchronous test doesn't
// leave it dangling past the test's own act scope.
async function flush() {
  await act(async () => {});
}

// T4: a pushed ActivityDetailScreen fires its own getActivityPhotos fetch on
// mount — stub it to never resolve so it doesn't disturb assertions here.
jest.mock('./src/api/activities', () => ({
  queryActivities: jest.fn(),
  getActivityPhotos: jest.fn(() => new Promise(() => {})),
}));
const mockedQuery = jest.mocked(queryActivities);

jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));
const mockedLocation = jest.mocked(Location);

// Marcellus's real load path goes through expo-font's native module, which
// isn't available in the Jest environment — stub it to "already loaded" so
// tests exercise the screen's actual content, not the font-load gate (see
// ScopePickerScreen.test.tsx for the same mock).
jest.mock('@expo-google-fonts/marcellus', () => ({
  useFonts: () => [true, null],
  Marcellus_400Regular: 'Marcellus_400Regular',
}));

function pressBackHandler(addBackListener: jest.SpyInstance) {
  const registration = addBackListener.mock.calls.find(([eventName]) => eventName === 'hardwareBackPress');
  const handler = registration![1] as () => boolean;
  act(() => {
    handler();
  });
}

describe('App', () => {
  beforeEach(() => {
    mockedQuery.mockResolvedValue({ status: 'success', activities: [] });
    // afterEach's resetAllMocks wipes the RN jest preset's default
    // AccessibilityInfo mock implementations too — re-arm them each test.
    // true (reduced motion) sidesteps the Filter sheet's slide/fade Animated
    // calls — irrelevant to what these tests verify.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 44.8125, longitude: 20.4612 },
    } as never);
  });
  afterEach(() => jest.resetAllMocks());

  it('opens on the scope picker', async () => {
    render(<App />);
    await flush();
    expect(screen.getByText('Where to?')).toBeTruthy();
  });

  it('hands off the selected scope after choosing Nearby, landing on the search-setup screen', async () => {
    render(<App />);
    await flush();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Explore activities nearby' }));
    });
    expect(screen.getByText('Refine your search')).toBeTruthy();
  });

  it('confirming the Nearby search-setup screen carries the location + category selection to the list, pre-filtered', async () => {
    // The search-setup screen's own live-count/CTA queries need a non-zero
    // result to keep the CTA enabled — unrelated to what the list screen
    // itself renders afterwards.
    mockedQuery.mockResolvedValue({ status: 'success', activities: [activity] });
    render(<App />);
    await flush();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Explore activities nearby' }));
    });
    await flush();
    fireEvent.press(screen.getByRole('button', { name: 'Sport' }));

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /^show \d+ activities$/i }));
    });

    expect(screen.getAllByText('Nearby').length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(mockedQuery).toHaveBeenCalledWith({
        scope: 'nearby',
        current_location: { lat: 44.8125, lng: 20.4612 },
        categories: ['sport'],
      })
    );
    expect(screen.getByRole('button', { name: 'Remove Sport filter' })).toBeTruthy();
  });

  it('Anywhere with location denied still reaches the search-setup screen with no anchor (no dead end)', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
    mockedQuery.mockResolvedValue({
      status: 'success',
      activities: [{ id: '1', title: 'Tour', description: '', category: 'sport', location: { lat: 0, lng: 0 }, country: 'Spain', rating: 4.5, image_refs: [], tags: [], distance_km: 1 }],
    });
    render(<App />);
    await flush();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Explore activities anywhere' }));
    });
    expect(screen.getByText('Refine your search')).toBeTruthy();

    // The live-count query (debounced) resolves before the CTA reflects a
    // real count and stops being disabled.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show 1 activity' })).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Show 1 activity' }));
    });
    expect(screen.getByText('Anywhere')).toBeTruthy();
    await waitFor(() => expect(mockedQuery).toHaveBeenCalledWith({ scope: 'anywhere', max_distance_km: 500 }));
  });

  it('Android hardware back on the Nearby search-setup screen returns to the scope picker', async () => {
    const addBackListener = jest.spyOn(BackHandler, 'addEventListener');
    render(<App />);
    await flush();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Explore activities nearby' }));
    });
    expect(screen.getByText('Refine your search')).toBeTruthy();

    pressBackHandler(addBackListener);
    // Popping back remounts ScopePickerScreen, which re-triggers its
    // reduce-motion mount effect — flush it before the test ends so its
    // setState doesn't fire outside act().
    await flush();
    expect(screen.getByText('Where to?')).toBeTruthy();
    addBackListener.mockRestore();
  });

  it('Android hardware back on the activity list returns to the Nearby search-setup screen (not the scope picker)', async () => {
    // Only the search-setup screen's own live-count + CTA queries need a
    // non-zero result to keep the CTA enabled; the list screen's own query
    // (the 3rd call) falls back to beforeEach's empty default, landing on
    // the empty state this test asserts.
    mockedQuery
      .mockResolvedValueOnce({ status: 'success', activities: [activity] })
      .mockResolvedValueOnce({ status: 'success', activities: [activity] });
    const addBackListener = jest.spyOn(BackHandler, 'addEventListener');
    render(<App />);
    await flush();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Explore activities nearby' }));
    });
    await flush();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /^show \d+ activities$/i }));
    });
    await waitFor(() => expect(screen.getByText('No activities match')).toBeTruthy());

    pressBackHandler(addBackListener);
    expect(screen.getByText('Refine your search')).toBeTruthy();
    addBackListener.mockRestore();
  });
});
