import { getCountryFromCoordinates, getPlaceCoordinates, hasPlacesKey, searchPlaces } from './places';

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

function setKey(value: string | undefined) {
  // process.env coerces `undefined` to the string "undefined" on assignment
  // — delete the key instead to actually unset it.
  if (value === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  else process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = value;
}

function mockFetchOnce(body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve(body) } as never);
}

describe('places api', () => {
  afterEach(() => {
    jest.resetAllMocks();
    setKey(ORIGINAL_ENV);
  });

  describe('hasPlacesKey', () => {
    it('is false when the env var is unset', () => {
      setKey(undefined);
      expect(hasPlacesKey()).toBe(false);
    });

    it('is true when the env var is set', () => {
      setKey('test-key');
      expect(hasPlacesKey()).toBe(true);
    });
  });

  describe('searchPlaces', () => {
    it('resolves an error without calling fetch when no key is configured', async () => {
      setKey(undefined);
      global.fetch = jest.fn();
      const result = await searchPlaces('Paris', 'city');
      expect(result).toEqual({ status: 'error', message: 'Place search is not configured.' });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('maps OK predictions to suggestions, biased to cities', async () => {
      setKey('test-key');
      mockFetchOnce({
        status: 'OK',
        predictions: [
          { place_id: 'p1', description: 'Paris, France', structured_formatting: { main_text: 'Paris', secondary_text: 'France' } },
        ],
      });
      const result = await searchPlaces('Paris', 'city');
      expect(result).toEqual({
        status: 'success',
        suggestions: [{ placeId: 'p1', primaryText: 'Paris', secondaryText: 'France' }],
      });
      const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain('types=%28cities%29');
    });

    it('biases country mode to the country type', async () => {
      setKey('test-key');
      mockFetchOnce({ status: 'ZERO_RESULTS' });
      await searchPlaces('Japan', 'country');
      const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain('types=country');
    });

    it('treats ZERO_RESULTS as a success with an empty list', async () => {
      setKey('test-key');
      mockFetchOnce({ status: 'ZERO_RESULTS' });
      const result = await searchPlaces('asdf', 'city');
      expect(result).toEqual({ status: 'success', suggestions: [] });
    });

    it('resolves an error on a non-OK Google status', async () => {
      setKey('test-key');
      mockFetchOnce({ status: 'REQUEST_DENIED' });
      const result = await searchPlaces('Paris', 'city');
      expect(result.status).toBe('error');
    });

    it('resolves an error when fetch throws (network failure)', async () => {
      setKey('test-key');
      global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
      const result = await searchPlaces('Paris', 'city');
      expect(result).toEqual({ status: 'error', message: 'Could not reach place search. Check your connection and try again.' });
    });
  });

  describe('getPlaceCoordinates', () => {
    const suggestion = { placeId: 'p1', primaryText: 'Paris', secondaryText: 'France' };

    it('resolves the coordinates on an OK response', async () => {
      setKey('test-key');
      mockFetchOnce({ status: 'OK', result: { name: 'Paris', geometry: { location: { lat: 48.85, lng: 2.35 } } } });
      const result = await getPlaceCoordinates(suggestion);
      expect(result).toEqual({
        status: 'success',
        place: { name: 'Paris', region: 'France', coordinates: { lat: 48.85, lng: 2.35 } },
      });
    });

    it('resolves an error when the response has no geometry', async () => {
      setKey('test-key');
      mockFetchOnce({ status: 'OK', result: { name: 'Paris' } });
      const result = await getPlaceCoordinates(suggestion);
      expect(result.status).toBe('error');
    });
  });

  describe('getCountryFromCoordinates', () => {
    const COORDS = { latitude: 44.8125, longitude: 20.4612 };

    it('resolves an error without calling fetch when no key is configured', async () => {
      setKey(undefined);
      global.fetch = jest.fn();
      const result = await getCountryFromCoordinates(COORDS);
      expect(result).toEqual({ status: 'error', message: 'Place search is not configured.' });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('resolves an error when the network request fails', async () => {
      setKey('test-key');
      global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
      const result = await getCountryFromCoordinates(COORDS);
      expect(result).toEqual({
        status: 'error',
        message: 'Could not reach place search. Check your connection and try again.',
      });
    });

    it('resolves an error when the response status is not OK', async () => {
      setKey('test-key');
      mockFetchOnce({ status: 'ZERO_RESULTS' });
      const result = await getCountryFromCoordinates(COORDS);
      expect(result).toEqual({ status: 'error', message: 'Something went wrong. Please try again.' });
    });

    it('resolves an error when no result has a country address component', async () => {
      setKey('test-key');
      mockFetchOnce({
        status: 'OK',
        results: [{ address_components: [{ long_name: 'Belgrade', types: ['locality'] }] }],
      });
      const result = await getCountryFromCoordinates(COORDS);
      expect(result).toEqual({ status: 'error', message: 'Something went wrong. Please try again.' });
    });

    it('resolves the country name from the country address component', async () => {
      setKey('test-key');
      mockFetchOnce({
        status: 'OK',
        results: [
          {
            address_components: [
              { long_name: 'Serbia', types: ['country', 'political'] },
            ],
          },
        ],
      });
      const result = await getCountryFromCoordinates(COORDS);
      expect(result).toEqual({ status: 'success', country: 'Serbia' });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://maps.googleapis.com/maps/api/geocode/json?')
      );
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('result_type=country'));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('latlng=44.8125%2C20.4612'));
    });
  });
});
