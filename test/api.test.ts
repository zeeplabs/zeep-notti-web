import { describe, expect, it } from 'vitest';
import { ApiError, request, type ApiConfig, type Fetcher } from '../src/api';

const config: ApiConfig = {
  appId: 'app-1',
  clientKey: 'ck_test',
  host: 'https://notti.example',
};

function answering(status: number, headers: Record<string, string> = {}): Fetcher {
  return async () =>
    new Response(JSON.stringify({ error: { code: 'rate_limited' } }), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
}

async function failureOf(fetcher: Fetcher): Promise<ApiError> {
  try {
    await request(fetcher, config, 'POST', '/v1/x', {});
  } catch (err) {
    return err as ApiError;
  }
  throw new Error('request did not fail');
}

describe('ApiError.retryAfter', () => {
  it('carries the Retry-After seconds of a 429', async () => {
    const err = await failureOf(answering(429, { 'Retry-After': '7' }));
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(7);
  });

  it.each([
    ['absent', {}],
    ['an HTTP date', { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }],
    ['negative', { 'Retry-After': '-3' }],
    ['empty', { 'Retry-After': '' }],
  ])('is undefined when the header is %s', async (_label, headers) => {
    const err = await failureOf(answering(429, headers));
    expect(err.retryAfter).toBeUndefined();
  });
});

describe('request keepalive', () => {
  it('passes keepalive to fetch only when asked', async () => {
    const seen: Array<boolean | undefined> = [];
    const fetcher: Fetcher = async (_input, init) => {
      seen.push(init?.keepalive);
      return new Response('{}', { status: 200 });
    };

    await request(fetcher, config, 'POST', '/v1/x', {}, undefined, true);
    await request(fetcher, config, 'POST', '/v1/x', {});

    expect(seen).toEqual([true, undefined]);
  });
});
