import { describe, expect, it, vi, afterEach } from 'vitest';
import { listAdminActivities } from './adminActivities';

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
