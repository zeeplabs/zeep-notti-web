import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api';
import { isRetryable, withRetry } from '../src/retry';

describe('isRetryable', () => {
  it.each([500, 502, 503, 408, 429])('retries %i', (status) => {
    expect(isRetryable(new ApiError(status))).toBe(true);
  });
  it.each([400, 401, 403, 404, 409, 422])('does not retry %i', (status) => {
    expect(isRetryable(new ApiError(status))).toBe(false);
  });
  it('retries network errors', () => {
    expect(isRetryable(new TypeError('failed to fetch'))).toBe(true);
  });
});

describe('withRetry', () => {
  it('returns the first success without sleeping', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    expect(await withRetry(async () => 'ok', sleep)).toBe('ok');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('backs off 1s then 2s', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    let n = 0;
    const result = await withRetry(async () => {
      if (++n < 3) throw new TypeError('offline');
      return n;
    }, sleep);
    expect(result).toBe(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it('rethrows the last error after the attempts run out', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    await expect(
      withRetry(async () => Promise.reject(new ApiError(500)), sleep)
    ).rejects.toMatchObject({ status: 500 });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('stops at once on a terminal error', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const fn = vi.fn(async () => Promise.reject(new ApiError(422)));
    await expect(withRetry(fn, sleep)).rejects.toMatchObject({ status: 422 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
