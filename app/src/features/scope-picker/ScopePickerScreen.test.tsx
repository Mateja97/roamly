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

describe('ScopePickerScreen', () => {
  beforeEach(() => {
    // afterEach's resetAllMocks wipes the RN jest preset's default
    // AccessibilityInfo mock implementations too — re-arm them each test so
    // ScopePickerScreen's reduce-motion check doesn't call `.then` on undefined.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
  });
  afterEach(() => jest.resetAllMocks());

  it('renders the three scope choices', () => {
    render(<ScopePickerScreen onScopeSelected={jest.fn()} />);
    expect(screen.getByRole('button', { name: /^home\./i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^nearby\./i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^outside country\./i })).toBeTruthy();
  });

  it('navigates immediately with scope "home" on Home tap — no location context', () => {
    const onScopeSelected = jest.fn();
    render(<ScopePickerScreen onScopeSelected={onScopeSelected} />);
    fireEvent.press(screen.getByRole('button', { name: /^home\./i }));
    expect(onScopeSelected).toHaveBeenCalledWith({ scope: 'home' });
  });

  it('navigates immediately with scope "outside_country" on Outside country tap', () => {
    const onScopeSelected = jest.fn();
    render(<ScopePickerScreen onScopeSelected={onScopeSelected} />);
    fireEvent.press(screen.getByRole('button', { name: /^outside country\./i }));
    expect(onScopeSelected).toHaveBeenCalledWith({ scope: 'outside_country' });
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

  it('shows the permission-denied message with an Open settings action, and leaves Home/Outside country enabled', async () => {
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
