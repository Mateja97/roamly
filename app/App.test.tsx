import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import App from './App';
import { queryActivities } from './src/api/activities';
import type { Activity } from './src/api/activities';
import { hasSeenSplash } from './src/utils/firstLaunch';

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
    mockedQuery.mockResolvedValue({ status: 'success', activities: [] });
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'undetermined' } as never);
  });
  // ponytail: no jest.resetAllMocks() here — it wipes the *implementation*
  // of every jest.fn(), including AsyncStorage's own auto-mock (jest-expo's,
  // not one this file owns), and there's no auto-restore for a plain
  // jest.fn() the way jest.spyOn has one. This suite genuinely needs
  // AsyncStorage's real in-memory read/write to work across renders (to
  // prove "splash seen" persists) — beforeEach already re-arms the two
  // mocks this file *does* own (mockedQuery/mockedLocation) via
  // mockResolvedValue, which fully replaces any prior implementation on its
  // own, no reset needed.
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
