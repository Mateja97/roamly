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
    // the reduce-motion check doesn't call `.then` on undefined.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
  });
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('renders the destination overline and "Where to?" headline', () => {
    render(<ScopePickerScreen onScopeSelected={jest.fn()} />);
    expect(screen.getByText('Destination')).toBeTruthy();
    expect(screen.getByText('Where to?')).toBeTruthy();
  });

  it('renders exactly the two scope tickets', () => {
    render(<ScopePickerScreen onScopeSelected={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Explore activities nearby' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Explore activities anywhere' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /home/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /my country/i })).toBeNull();
  });

  it('navigates with coordinates once Nearby resolves a GPS fix', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 10, longitude: 20 },
    } as never);
    const onScopeSelected = jest.fn();
    render(<ScopePickerScreen onScopeSelected={onScopeSelected} />);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Explore activities nearby' }));
    });

    expect(onScopeSelected).toHaveBeenCalledWith({
      scope: 'nearby',
      coordinates: { latitude: 10, longitude: 20 },
    });
  });

  it('shows the permission-denied message pointing at Anywhere, not Home/My country', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
    render(<ScopePickerScreen onScopeSelected={jest.fn()} />);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Explore activities nearby' }));
    });

    expect(screen.getByText(/choose anywhere instead/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /open settings/i })).toBeTruthy();
  });

  it('shows the location-unavailable message when the GPS fix fails', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    mockedLocation.getCurrentPositionAsync.mockRejectedValue(new Error('timeout'));
    render(<ScopePickerScreen onScopeSelected={jest.fn()} />);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Explore activities nearby' }));
    });

    expect(screen.getByText(/couldn't get your current location/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('navigates with coordinates once Anywhere resolves a GPS fix', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 1, longitude: 2 },
    } as never);
    const onScopeSelected = jest.fn();
    render(<ScopePickerScreen onScopeSelected={onScopeSelected} />);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Explore activities anywhere' }));
    });

    expect(onScopeSelected).toHaveBeenCalledWith({
      scope: 'anywhere',
      coordinates: { latitude: 1, longitude: 2 },
    });
  });

  it('navigates with no coordinates (and no error shown) when Anywhere is picked with location denied', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
    const onScopeSelected = jest.fn();
    render(<ScopePickerScreen onScopeSelected={onScopeSelected} />);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Explore activities anywhere' }));
    });

    expect(onScopeSelected).toHaveBeenCalledWith({ scope: 'anywhere', coordinates: undefined });
    expect(screen.queryByText(/location access is off/i)).toBeNull();
  });

  it('navigates with no coordinates when Anywhere is picked and the GPS fix fails', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    mockedLocation.getCurrentPositionAsync.mockRejectedValue(new Error('timeout'));
    const onScopeSelected = jest.fn();
    render(<ScopePickerScreen onScopeSelected={onScopeSelected} />);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Explore activities anywhere' }));
    });

    expect(onScopeSelected).toHaveBeenCalledWith({ scope: 'anywhere', coordinates: undefined });
    expect(screen.queryByText(/couldn't get your current location/i)).toBeNull();
  });
});
