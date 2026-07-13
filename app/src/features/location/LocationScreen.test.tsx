import { Animated, AccessibilityInfo, BackHandler } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as placesApi from '../../api/places';
import { LocationScreen } from './LocationScreen';
import { CITY_LOCATION_CONFIG, COUNTRY_LOCATION_CONFIG } from './config';

jest.mock('../../api/places', () => ({
  ...jest.requireActual('../../api/places'),
  hasPlacesKey: jest.fn(),
  searchPlaces: jest.fn(),
  getPlaceCoordinates: jest.fn(),
}));

const mockedHasKey = jest.mocked(placesApi.hasPlacesKey);
const mockedSearch = jest.mocked(placesApi.searchPlaces);
const mockedDetails = jest.mocked(placesApi.getPlaceCoordinates);

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
  mockedHasKey.mockReturnValue(true);
});

afterEach(() => jest.resetAllMocks());

async function typeAndDebounce(text: string) {
  fireEvent.changeText(screen.getByLabelText('City'), text);
  await act(async () => {
    jest.advanceTimersByTime(300);
    await Promise.resolve();
  });
}

describe('LocationScreen', () => {
  it('shows the default place in the summary card on entry, with Confirm enabled', () => {
    render(<LocationScreen config={CITY_LOCATION_CONFIG} onConfirm={jest.fn()} onBack={jest.fn()} />);
    expect(screen.getByText('Belgrade')).toBeTruthy();
    expect(screen.getByText('Serbia')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
  });

  it('renders the no-key fallback when the Places key is missing — no crash, Confirm still enabled', () => {
    mockedHasKey.mockReturnValue(false);
    render(<LocationScreen config={CITY_LOCATION_CONFIG} onConfirm={jest.fn()} onBack={jest.fn()} />);
    expect(screen.getByText('Search unavailable')).toBeTruthy();
    expect(screen.queryByLabelText('City')).toBeNull();
    expect(screen.getByText('Belgrade')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
  });

  it('searches, shows suggestions, and resolves coordinates on pick (city mode)', async () => {
    jest.useFakeTimers();
    mockedSearch.mockResolvedValue({
      status: 'success',
      suggestions: [{ placeId: 'p1', primaryText: 'Paris', secondaryText: 'France' }],
    });
    mockedDetails.mockResolvedValue({
      status: 'success',
      place: { name: 'Paris', region: 'France', coordinates: { lat: 48.85, lng: 2.35 } },
    });
    render(<LocationScreen config={CITY_LOCATION_CONFIG} onConfirm={jest.fn()} onBack={jest.fn()} />);

    await typeAndDebounce('Par');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Paris, France' })).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Paris, France' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedDetails).toHaveBeenCalledWith({ placeId: 'p1', primaryText: 'Paris', secondaryText: 'France' });
    await waitFor(() => expect(screen.getAllByText('Paris').length).toBeGreaterThan(0));
    jest.useRealTimers();
  });

  it('country mode picks the suggestion directly, no coordinate resolve', async () => {
    jest.useFakeTimers();
    mockedSearch.mockResolvedValue({
      status: 'success',
      suggestions: [{ placeId: 'p1', primaryText: 'Japan', secondaryText: '' }],
    });
    render(<LocationScreen config={COUNTRY_LOCATION_CONFIG} onConfirm={jest.fn()} onBack={jest.fn()} />);

    fireEvent.changeText(screen.getByLabelText('Country'), 'Jap');
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Japan' })).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: 'Japan' }));

    expect(mockedDetails).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByText('Japan').length).toBeGreaterThan(0));
    jest.useRealTimers();
  });

  it('shows the no-matches empty state on zero results', async () => {
    jest.useFakeTimers();
    mockedSearch.mockResolvedValue({ status: 'success', suggestions: [] });
    render(<LocationScreen config={CITY_LOCATION_CONFIG} onConfirm={jest.fn()} onBack={jest.fn()} />);

    await typeAndDebounce('zzz');
    await waitFor(() => expect(screen.getByText('No places found')).toBeTruthy());
    jest.useRealTimers();
  });

  it('shows the lookup-error banner with retry, keeping the previous selection', async () => {
    jest.useFakeTimers();
    mockedSearch.mockResolvedValue({ status: 'error', message: 'Something went wrong. Please try again.' });
    render(<LocationScreen config={CITY_LOCATION_CONFIG} onConfirm={jest.fn()} onBack={jest.fn()} />);

    await typeAndDebounce('Par');
    await waitFor(() => expect(screen.getByText('Something went wrong. Please try again.')).toBeTruthy());

    mockedSearch.mockResolvedValueOnce({
      status: 'success',
      suggestions: [{ placeId: 'p1', primaryText: 'Paris', secondaryText: 'France' }],
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Paris, France' })).toBeTruthy());
    jest.useRealTimers();
  });

  it('confirming disables the button and calls onConfirm with the selected place', () => {
    const onConfirm = jest.fn();
    render(<LocationScreen config={CITY_LOCATION_CONFIG} onConfirm={onConfirm} onBack={jest.fn()} />);
    fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith({ name: 'Belgrade', region: 'Serbia', coordinates: { lat: 44.8125, lng: 20.4612 } });
  });

  it('does not fade the results region on mount, only on a later view change (non-reduced-motion)', async () => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    // Skeleton/Spinner also drive Animated.timing (their own pulse/spin
    // loops), so scope the spy to fade-starts (`setValue(0)` is unique to
    // this effect's cross-fade — see LocationScreen.tsx / usePlaceSearch.ts,
    // nothing else in this tree zeroes an Animated.Value).
    const setValueSpy = jest.spyOn(Animated.Value.prototype, 'setValue');
    const fadeStarts = () => setValueSpy.mock.calls.filter(([value]) => value === 0).length;
    mockedSearch.mockResolvedValue({
      status: 'success',
      suggestions: [{ placeId: 'p1', primaryText: 'Paris', secondaryText: 'France' }],
    });
    render(<LocationScreen config={CITY_LOCATION_CONFIG} onConfirm={jest.fn()} onBack={jest.fn()} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(fadeStarts()).toBe(0);

    await typeAndDebounce('Par');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Paris, France' })).toBeTruthy());
    // summary -> loading -> suggestions: two genuine view changes, two fades.
    expect(fadeStarts()).toBe(2);
    jest.useRealTimers();
  });

  it('calls onBack on Android hardware back press', () => {
    const addBackListener = jest.spyOn(BackHandler, 'addEventListener');
    const onBack = jest.fn();
    render(<LocationScreen config={CITY_LOCATION_CONFIG} onConfirm={jest.fn()} onBack={onBack} />);

    const registration = addBackListener.mock.calls.find(([eventName]) => eventName === 'hardwareBackPress');
    expect(registration).toBeTruthy();
    const handler = registration![1] as () => boolean;
    expect(handler()).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);
    addBackListener.mockRestore();
  });
});
