import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { ScopePickerScreen } from './ScopePickerScreen';

jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const mockedLocation = jest.mocked(Location);

// getCountryFromCoordinates (app/src/api/places.ts) short-circuits to an
// error before calling fetch when this is unset — see
// useMyCountryLocation.test.tsx for the same pattern.
const ORIGINAL_GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

describe('ScopePickerScreen', () => {
  beforeEach(() => {
    // afterEach's resetAllMocks wipes the RN jest preset's default
    // AccessibilityInfo mock implementations too — re-arm them each test so
    // ScopePickerScreen's reduce-motion check doesn't call `.then` on undefined.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
    // My country card: default every test to "denied" (no OS prompt, no
    // fetch) unless a test overrides it — matches how Nearby's tests already
    // scope mockedLocation calls per-test.
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
  });
  afterEach(() => {
    jest.resetAllMocks();
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = ORIGINAL_GOOGLE_MAPS_API_KEY;
  });

  it('renders the three scope choices', () => {
    render(<ScopePickerScreen onScopeSelected={jest.fn()} />);
    expect(screen.getByRole('button', { name: /^home\./i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^nearby\./i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^my country\./i })).toBeTruthy();
  });

  it('navigates immediately with scope "home" on Home tap — no location context', () => {
    const onScopeSelected = jest.fn();
    render(<ScopePickerScreen onScopeSelected={onScopeSelected} />);
    fireEvent.press(screen.getByRole('button', { name: /^home\./i }));
    expect(onScopeSelected).toHaveBeenCalledWith({ scope: 'home' });
  });

  it('navigates with scope "my_country" and no homeCountry on tap while detection has not resolved', () => {
    const onScopeSelected = jest.fn();
    render(<ScopePickerScreen onScopeSelected={onScopeSelected} />);
    fireEvent.press(screen.getByRole('button', { name: /^my country\./i }));
    expect(onScopeSelected).toHaveBeenCalledWith({ scope: 'my_country' });
  });

  it('navigates with scope "my_country" and the detected homeCountry once detection resolves', async () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 44.8125, longitude: 20.4612 },
    } as never);
    global.fetch = jest.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          status: 'OK',
          results: [{ address_components: [{ long_name: 'Serbia', types: ['country', 'political'] }] }],
        }),
    } as never);

    const onScopeSelected = jest.fn();
    render(<ScopePickerScreen onScopeSelected={onScopeSelected} />);

    await screen.findByRole('button', { name: /^serbia\./i });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /^serbia\./i }));
    });

    expect(onScopeSelected).toHaveBeenCalledWith({ scope: 'my_country', homeCountry: 'Serbia' });
  });

  it('navigates with coordinates once Nearby resolves a GPS fix', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 10, longitude: 20 },
    } as never);
    const onScopeSelected = jest.fn();
    render(<ScopePickerScreen onScopeSelected={onScopeSelected} />);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /^nearby\./i }));
    });

    expect(onScopeSelected).toHaveBeenCalledWith({
      scope: 'nearby',
      coordinates: { latitude: 10, longitude: 20 },
    });
  });

  it('shows the permission-denied message with an Open settings action, and leaves Home/My country enabled', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
    const onScopeSelected = jest.fn();
    render(<ScopePickerScreen onScopeSelected={onScopeSelected} />);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /^nearby\./i }));
    });

    expect(screen.getByText(/location access is off/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /open settings/i })).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: /^home\./i }));
    expect(onScopeSelected).toHaveBeenCalledWith({ scope: 'home' });
  });

  it('shows the location-unavailable message with a Try again action when the GPS fix fails', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    mockedLocation.getCurrentPositionAsync.mockRejectedValue(new Error('timeout'));
    render(<ScopePickerScreen onScopeSelected={jest.fn()} />);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /^nearby\./i }));
    });

    expect(screen.getByText(/couldn't get your current location/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});
