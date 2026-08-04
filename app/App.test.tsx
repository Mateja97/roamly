import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import App from './App';
import { queryActivities } from './src/api/activities';
import type { Activity } from './src/api/activities';
import { hasSeenSplash } from './src/utils/firstLaunch';
import * as firstLaunch from './src/utils/firstLaunch';

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

// Flushes the microtask queue so a purely-synchronous test doesn't leave a
// pending AsyncStorage/permission-check promise dangling past its act scope.
async function flush() {
  await act(async () => {});
}

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
// tests exercise real content instead of the font-load gate.
jest.mock('@expo-google-fonts/marcellus', () => ({
  useFonts: () => [true, null],
  Marcellus_400Regular: 'Marcellus_400Regular',
}));

describe('App', () => {
  beforeEach(() => {
    // review round 1 (Minor): `jest.clearAllMocks()`, not
    // `jest.resetAllMocks()` — clear wipes each mock's *call history*
    // (recorded calls/results) but keeps its implementation intact, so
    // AsyncStorage's own auto-mock (jest-expo's, not one this file owns)
    // keeps working across renders, which this suite genuinely needs (to
    // prove "splash seen" persists). `resetAllMocks` would additionally
    // strip that implementation with no auto-restore for a plain `jest.fn()`
    // the way `jest.spyOn` has one — clear is the one that actually matches
    // "start each test with a clean slate" here. Re-arm the resolved values
    // for the two mocks this file owns straight after.
    jest.clearAllMocks();
    mockedQuery.mockResolvedValue({ status: 'success', activities: [] });
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'undetermined' } as never);
  });
  afterEach(async () => {
    await AsyncStorage.clear();
  });

  it('T4: a fresh install (first-launch-seen unset) opens on the Splash screen', async () => {
    render(<App />);
    await flush();
    expect(screen.getByText('Where to?')).toBeTruthy();
    expect(screen.getByRole('button', { name: /start exploring/i })).toBeTruthy();
  });

  it('T4: Splash "Start exploring" advances to the Feed, cold-started as unanchored Anywhere', async () => {
    render(<App />);
    await flush();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /start exploring/i }));
    });
    await flush();
    expect(screen.getByRole('button', { name: /scope: exploring everywhere/i })).toBeTruthy();
    expect(mockedQuery).toHaveBeenCalledWith({ scope: 'anywhere' });
  });

  it('T4: Splash records first-launch-seen so the very next launch skips straight to the Feed', async () => {
    const { unmount } = render(<App />);
    await flush();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /start exploring/i }));
    });
    // markSplashSeen is fire-and-forget from the CTA's own perspective (no
    // in-flight state on Splash, per design-spec.md T1) — wait for the write
    // to actually land before asserting the next launch sees it.
    await waitFor(async () => expect(await hasSeenSplash()).toBe(true));
    unmount();

    render(<App />);
    await flush();
    expect(screen.queryByText('Where to?')).toBeNull();
    expect(screen.getByRole('button', { name: /scope: exploring everywhere/i })).toBeTruthy();
  });

  it('T4: a returning launch (splash already seen) goes straight to the Feed', async () => {
    await AsyncStorage.setItem('roamly:first-launch-seen', 'true');
    render(<App />);
    await flush();
    expect(screen.queryByText('Where to?')).toBeNull();
    expect(screen.getByRole('button', { name: /scope: exploring everywhere/i })).toBeTruthy();
  });

  // Critical fix has two independent layers: firstLaunch.ts's own internal
  // try/catch (unit-tested directly in firstLaunch.test.ts, including a
  // rejecting AsyncStorage.getItem — the real read-failure path) and this
  // App.tsx-level .catch backstop (tested below). Not duplicated here as a
  // third, App-level "rejecting AsyncStorage" test — spying on
  // AsyncStorage.getItem itself (vs. spying on hasSeenSplash directly, as
  // below) left the shared jest-expo AsyncStorage mock in a broken state
  // for every test running after it in this file, even past an explicit
  // mockRestore(); not worth chasing for coverage firstLaunch.test.ts
  // already carries.
  it('review round 1 (Critical): a rejecting hasSeenSplash still lands on the Feed via App.tsx\'s own backstop', async () => {
    // Bypasses firstLaunch.ts's own internal try/catch entirely, to prove
    // App.tsx's .catch is a real, independent second layer, not dead code.
    const hasSeenSpy = jest.spyOn(firstLaunch, 'hasSeenSplash').mockRejectedValueOnce(new Error('boom'));
    const { unmount } = render(<App />);
    await flush();
    expect(screen.getByRole('button', { name: /scope: exploring everywhere/i })).toBeTruthy();
    unmount();
    hasSeenSpy.mockRestore();
  });

  it('T4: a returning launch with location already granted derives Nearby scope instead of Anywhere', async () => {
    await AsyncStorage.setItem('roamly:first-launch-seen', 'true');
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 44.8125, longitude: 20.4612 },
    } as never);
    mockedQuery.mockResolvedValue({ status: 'success', activities: [activity] });

    render(<App />);
    await flush();
    await waitFor(() => expect(screen.getByRole('button', { name: /scope: nearby/i })).toBeTruthy());
    expect(mockedQuery).toHaveBeenLastCalledWith({
      scope: 'nearby',
      current_location: { lat: 44.8125, lng: 20.4612 },
    });
  });
});
