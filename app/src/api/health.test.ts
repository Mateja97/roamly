// tsconfig restricts `types` to ["jest"]; this test uses Node's `global`.
/// <reference types="node" />
import { fetchHealth } from './health';

describe('fetchHealth', () => {
  it('resolves when proxy-service responds ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true } as Response) as unknown as typeof fetch;
    await expect(fetchHealth()).resolves.toBeUndefined();
  });

  it('throws when proxy-service responds with an error status', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
    } as Response) as unknown as typeof fetch;
    await expect(fetchHealth()).rejects.toThrow('health check failed: 503');
  });
});
