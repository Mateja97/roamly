import { describe, expect, it, vi, afterEach } from 'vitest';
import { suggestCities } from './cities';

describe('suggestCities', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the city list on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            suggestions: [{ city: 'Belgrade' }, { city: 'Novi Sad' }],
          }),
      } as Response),
    );

    const result = await suggestCities();

    expect(result).toEqual(['Belgrade', 'Novi Sad']);
  });

  it('returns an empty list on failure rather than throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response),
    );

    await expect(suggestCities()).resolves.toEqual([]);
  });

  it('returns an empty list on a network-level failure rather than rejecting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    await expect(suggestCities()).resolves.toEqual([]);
  });
});
