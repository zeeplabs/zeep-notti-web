import { ApiError } from './api';

export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether a failed request is worth repeating: network errors, 5xx, 408 and
 * 429. Any other 4xx is terminal (same policy as the mobile SDKs).
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status >= 500 || err.status === 408 || err.status === 429;
  }
  return true;
}

/**
 * Runs `fn` up to `attempts` times with exponential backoff (1s, 2s, ...).
 * Rethrows the last error, or the first terminal one.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  sleep: Sleep,
  attempts = 3
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isRetryable(err) || i === attempts - 1) throw err;
      await sleep(1000 * 2 ** i);
    }
  }
  throw last;
}
