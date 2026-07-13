import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as placesApi from '../../api/places';
import { usePlaceSearch } from './usePlaceSearch';
import { CITY_LOCATION_CONFIG, COUNTRY_LOCATION_CONFIG } from './config';

jest.mock('../../api/places', () => ({
  ...jest.requireActual('../../api/places'),
  searchPlaces: jest.fn(),
  getPlaceCoordinates: jest.fn(),
}));

const mockedSearch = jest.mocked(placesApi.searchPlaces);
const mockedDetails = jest.mocked(placesApi.getPlaceCoordinates);

afterEach(() => jest.resetAllMocks());

describe('usePlaceSearch', () => {
  it('starts on the summary view with the config default place selected', () => {
    const { result } = renderHook(() => usePlaceSearch(CITY_LOCATION_CONFIG));
    expect(result.current.region).toEqual({ view: 'summary' });
    expect(result.current.selected).toEqual(CITY_LOCATION_CONFIG.defaultPlace);
  });

  it('stays on summary below the trigger length — no search fires', () => {
    jest.useFakeTimers();
    const { result } = renderHook(() => usePlaceSearch(CITY_LOCATION_CONFIG));
    act(() => result.current.setQuery('a'));
    act(() => jest.advanceTimersByTime(500));
    expect(mockedSearch).not.toHaveBeenCalled();
    expect(result.current.region).toEqual({ view: 'summary' });
    jest.useRealTimers();
  });

  it('debounces and only fires the search once typing settles', async () => {
    jest.useFakeTimers();
    mockedSearch.mockResolvedValue({ status: 'success', suggestions: [] });
    const { result } = renderHook(() => usePlaceSearch(CITY_LOCATION_CONFIG));

    act(() => result.current.setQuery('Pa'));
    act(() => jest.advanceTimersByTime(100));
    act(() => result.current.setQuery('Par'));
    act(() => jest.advanceTimersByTime(300));
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedSearch).toHaveBeenCalledTimes(1);
    expect(mockedSearch).toHaveBeenCalledWith('Par', 'city');
    jest.useRealTimers();
  });

  it('drops a stale response — only the latest query updates the region', async () => {
    jest.useFakeTimers();
    let resolveFirst!: (value: placesApi.PlaceSearchResult) => void;
    mockedSearch
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({
        status: 'success',
        suggestions: [{ placeId: 'p2', primaryText: 'Bar', secondaryText: '' }],
      });

    const { result } = renderHook(() => usePlaceSearch(CITY_LOCATION_CONFIG));
    act(() => result.current.setQuery('Fo'));
    act(() => jest.advanceTimersByTime(300));
    act(() => result.current.setQuery('Ba'));
    act(() => jest.advanceTimersByTime(300));

    await waitFor(() => expect(result.current.region).toEqual({ view: 'suggestions', items: [{ placeId: 'p2', primaryText: 'Bar', secondaryText: '' }] }));

    // The first (slow) request resolves after the second already won — must not overwrite it.
    resolveFirst({ status: 'success', suggestions: [{ placeId: 'p1', primaryText: 'Foo', secondaryText: '' }] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.region).toEqual({ view: 'suggestions', items: [{ placeId: 'p2', primaryText: 'Bar', secondaryText: '' }] });
    jest.useRealTimers();
  });

  it('resolves coordinates on pick for city mode, keeping the previous selection on failure', async () => {
    mockedDetails.mockResolvedValue({ status: 'error', message: 'boom' });
    const { result } = renderHook(() => usePlaceSearch(CITY_LOCATION_CONFIG));
    const suggestion = { placeId: 'p1', primaryText: 'Paris', secondaryText: 'France' };

    await act(async () => {
      await result.current.pick(suggestion);
    });

    expect(result.current.region).toEqual({ view: 'error', message: 'boom' });
    expect(result.current.selected).toEqual(CITY_LOCATION_CONFIG.defaultPlace);
  });

  it('picks the suggestion directly for country mode — no details call', async () => {
    const { result } = renderHook(() => usePlaceSearch(COUNTRY_LOCATION_CONFIG));
    const suggestion = { placeId: 'p1', primaryText: 'Japan', secondaryText: '' };

    await act(async () => {
      await result.current.pick(suggestion);
    });

    expect(mockedDetails).not.toHaveBeenCalled();
    expect(result.current.selected).toEqual({ name: 'Japan', region: undefined });
  });

  it('retry re-runs the last failed search', async () => {
    jest.useFakeTimers();
    mockedSearch.mockResolvedValueOnce({ status: 'error', message: 'nope' });
    const { result } = renderHook(() => usePlaceSearch(CITY_LOCATION_CONFIG));
    act(() => result.current.setQuery('Par'));
    act(() => jest.advanceTimersByTime(300));
    await waitFor(() => expect(result.current.region).toEqual({ view: 'error', message: 'nope' }));

    mockedSearch.mockResolvedValueOnce({ status: 'success', suggestions: [] });
    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });
    expect(mockedSearch).toHaveBeenLastCalledWith('Par', 'city');
    expect(result.current.region).toEqual({ view: 'empty' });
    jest.useRealTimers();
  });
});
