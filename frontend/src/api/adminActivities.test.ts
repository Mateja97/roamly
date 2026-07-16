import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  listAdminActivities,
  getAdminActivity,
  patchAdminActivity,
  createAdminActivity,
} from './adminActivities';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('listAdminActivities', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the X-Admin-Token header and resolves a success result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        activities: [],
        total: 0,
        page: 1,
        page_size: 20,
        stats: { total: 0, published: 0, draft: 0, pending: 0 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await listAdminActivities({ page: 1, page_size: 20 });

    expect(result.status).toBe('success');
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain('/admin/activities');
    expect(
      (init.headers as Record<string, string>)['X-Admin-Token'],
    ).toBeDefined();
  });

  it('only sets query params that are provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        activities: [],
        total: 0,
        page: 1,
        page_size: 20,
        stats: { total: 0, published: 0, draft: 0, pending: 0 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await listAdminActivities({ q: 'museum', category: 'culture' });

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.get('q')).toBe('museum');
    expect(url.searchParams.get('category')).toBe('culture');
    expect(url.searchParams.get('city')).toBeNull();
    expect(url.searchParams.get('status')).toBeNull();
  });

  it('resolves the 403 branch with the server message (admin token rejected)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: 'invalid or missing admin token' }, 403),
        ),
    );

    const result = await listAdminActivities({});

    expect(result).toEqual({
      status: 403,
      message: 'invalid or missing admin token',
    });
  });

  it.each([400, 404, 409, 500] as const)(
    'resolves the %d branch with the server message',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse({ error: `error ${status}` }, status),
          ),
      );

      const result = await listAdminActivities({});

      expect(result).toEqual({ status, message: `error ${status}` });
    },
  );

  it('falls back to a generic message when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not json')),
      } as unknown as Response),
    );

    const result = await listAdminActivities({});

    expect(result.status).toBe(500);
    if (result.status !== 'success') {
      expect(result.message).toContain('500');
    }
  });

  it('resolves a 500 result (not an unhandled rejection) on a network-level failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    const result = await listAdminActivities({});

    expect(result.status).toBe(500);
  });
});

const ACTIVITY = {
  id: 'a1',
  title: 'Test',
  description: '',
  category: 'nature',
  city: 'Belgrade',
  address: '',
  status: 'draft',
  rating: 0,
  details: {},
  photos: [],
};

describe('getAdminActivity', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends the token and GETs /admin/activities/{id}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(ACTIVITY));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getAdminActivity('a1');

    expect(result).toEqual({ status: 'success', data: ACTIVITY });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain('/admin/activities/a1');
    expect(init.method).toBeUndefined();
  });

  it('resolves 404 for a missing activity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'not found' }, 404)),
    );

    const result = await getAdminActivity('missing');

    expect(result).toEqual({ status: 404, message: 'not found' });
  });

  it('resolves 403 (admin token rejected)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: 'invalid or missing admin token' }, 403),
        ),
    );

    const result = await getAdminActivity('a1');

    expect(result).toEqual({
      status: 403,
      message: 'invalid or missing admin token',
    });
  });
});

describe('patchAdminActivity', () => {
  afterEach(() => vi.restoreAllMocks());

  it('PATCHes only the given fields as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(ACTIVITY));
    vi.stubGlobal('fetch', fetchMock);

    await patchAdminActivity('a1', { title: 'New title' });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain('/admin/activities/a1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'New title' });
  });

  it('resolves 400 on an invalid category/status', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: 'unknown status: bogus' }, 400),
        ),
    );

    const result = await patchAdminActivity('a1', { status: 'bogus' });

    expect(result).toEqual({ status: 400, message: 'unknown status: bogus' });
  });
});

describe('createAdminActivity', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs the payload as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(ACTIVITY));
    vi.stubGlobal('fetch', fetchMock);

    await createAdminActivity({ title: 'New activity', category: 'nature' });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain('/admin/activities');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'New activity',
      category: 'nature',
    });
  });

  it('resolves 400 when title is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: 'title is required' }, 400),
        ),
    );

    const result = await createAdminActivity({
      title: '',
      category: 'nature',
    });

    expect(result).toEqual({ status: 400, message: 'title is required' });
  });
});
