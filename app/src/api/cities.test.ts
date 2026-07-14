import { suggestCities } from './cities';

function mockFetchOnce(status: number, body: unknown, ok = status < 300) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as never);
}

describe('suggestCities', () => {
  afterEach(() => jest.resetAllMocks());

  it('resolves success with the suggestions array on 200', async () => {
    mockFetchOnce(200, { suggestions: [{ city: 'Barcelona', country: 'Spain', centroid: { lat: 41.4, lng: 2.2 } }] });
    const result = await suggestCities('Bar');
    expect(result).toEqual({
      status: 'success',
      suggestions: [{ city: 'Barcelona', country: 'Spain', centroid: { lat: 41.4, lng: 2.2 } }],
    });
  });

  it('resolves an empty list for a non-matching query, not an error', async () => {
    mockFetchOnce(200, { suggestions: [] });
    const result = await suggestCities('zzz');
    expect(result).toEqual({ status: 'success', suggestions: [] });
  });

  it('resolves a 500 with the server message', async () => {
    mockFetchOnce(500, { error: 'internal error' });
    const result = await suggestCities('Bar');
    expect(result).toEqual({ status: 500, message: 'internal error' });
  });

  it('maps a network failure (fetch throws) to a 500 result', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const result = await suggestCities('Bar');
    expect(result.status).toBe(500);
  });
});
