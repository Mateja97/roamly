import { queryActivities } from './activities';

function mockFetchOnce(status: number, body: unknown, ok = status < 300) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as never);
}

describe('queryActivities', () => {
  afterEach(() => jest.resetAllMocks());

  it('resolves success with the activities array on 200', async () => {
    mockFetchOnce(200, { activities: [{ id: '1' }] });
    const result = await queryActivities({ scope: 'home' });
    expect(result).toEqual({ status: 'success', activities: [{ id: '1', image_refs: [] }] });
  });

  it('normalizes today\'s plain-string image_refs into { uri } photo objects', async () => {
    mockFetchOnce(200, { activities: [{ id: '1', image_refs: ['https://example.com/img.jpg'] }] });
    const result = await queryActivities({ scope: 'home' });
    expect(result).toEqual({
      status: 'success',
      activities: [{ id: '1', image_refs: [{ uri: 'https://example.com/img.jpg' }] }],
    });
  });

  it('passes through an already-object image_refs entry (T3 wire format) unchanged', async () => {
    const attribution = { author: 'Jane Doe', link: 'https://maps.google.com/maps/contrib/1' };
    mockFetchOnce(200, {
      activities: [{ id: '1', image_refs: [{ uri: 'https://example.com/img.jpg', attribution }] }],
    });
    const result = await queryActivities({ scope: 'home' });
    expect(result).toEqual({
      status: 'success',
      activities: [{ id: '1', image_refs: [{ uri: 'https://example.com/img.jpg', attribution }] }],
    });
  });

  it('resolves a 400 with the server message', async () => {
    mockFetchOnce(400, { error: 'unknown scope: galaxy' });
    const result = await queryActivities({ scope: 'home' });
    expect(result).toEqual({ status: 400, message: 'unknown scope: galaxy' });
  });

  it('resolves a 500 with the server message', async () => {
    mockFetchOnce(500, { error: 'internal error' });
    const result = await queryActivities({ scope: 'home' });
    expect(result).toEqual({ status: 500, message: 'internal error' });
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.reject(new Error('not json')),
    } as never);
    const result = await queryActivities({ scope: 'home' });
    expect(result).toEqual({ status: 400, message: 'Something went wrong. Please try again.' });
  });

  it('maps a network failure (fetch throws) to a 500 result', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const result = await queryActivities({ scope: 'home' });
    expect(result.status).toBe(500);
  });

  it('buckets an unrecognized status code under 500', async () => {
    mockFetchOnce(418, { error: "I'm a teapot" });
    const result = await queryActivities({ scope: 'home' });
    expect(result.status).toBe(500);
  });
});
