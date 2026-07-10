import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchHealth } from './health';

describe('fetchHealth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves when proxy-service responds ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as Response));
    await expect(fetchHealth()).resolves.toBeUndefined();
  });

  it('throws when proxy-service responds with an error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response),
    );
    await expect(fetchHealth()).rejects.toThrow('health check failed: 503');
  });
});
