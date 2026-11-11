import { describe, expect, it } from 'vitest';
import { DEFAULT_HOST, normalizeHost } from '../src/api';
import { init } from '../src/init';
import { getState } from '../src/runtime';
import { fakeRuntime, jsonResponse, supportedEnv } from './helpers';

const opts = { appId: 'app_123', clientKey: 'ck_test_abc' };

describe('init', () => {
  it('loads the public key with only the Client key', async () => {
    const { runtime, requests } = fakeRuntime(() =>
      jsonResponse(200, { public_key: 'BPublicKey' })
    );
    const result = await init(opts, runtime);

    expect(result).toEqual({ supported: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: `${DEFAULT_HOST}/v1/apps/app_123/web-push/config`,
      method: 'GET',
      headers: { Authorization: 'Bearer ck_test_abc' },
    });
    expect(requests[0]?.body).toBeUndefined();
    expect(getState()?.publicKey).toBe('BPublicKey');
  });

  it('uses the host override for self-hosted', async () => {
    const { runtime, requests } = fakeRuntime(() =>
      jsonResponse(200, { public_key: 'k' })
    );
    await init({ ...opts, host: 'https://push.example.com/' }, runtime);
    expect(requests[0]?.url).toBe(
      'https://push.example.com/v1/apps/app_123/web-push/config'
    );
  });

  it('allows http only on localhost', async () => {
    const { runtime, requests } = fakeRuntime(() =>
      jsonResponse(200, { public_key: 'k' })
    );
    expect(
      await init({ ...opts, host: 'http://localhost:8080' }, runtime)
    ).toEqual({ supported: true });
    expect(requests[0]?.url.startsWith('http://localhost:8080/')).toBe(true);

    const other = fakeRuntime(() => jsonResponse(200, { public_key: 'k' }));
    expect(
      await init({ ...opts, host: 'http://notti.example.com' }, other.runtime)
    ).toEqual({ supported: false, reason: 'invalid_options' });
    expect(other.requests).toHaveLength(0);
  });

  it('returns not_enabled on 404 web_push_not_enabled', async () => {
    const { runtime } = fakeRuntime(() =>
      jsonResponse(404, { error: { code: 'web_push_not_enabled' } })
    );
    expect(await init(opts, runtime)).toEqual({
      supported: false,
      reason: 'not_enabled',
    });
    expect(getState()).toBeNull();
  });

  it.each([401, 403, 500])('returns request_failed on %i', async (status) => {
    const { runtime } = fakeRuntime(() =>
      jsonResponse(status, { error: { code: 'forbidden' } })
    );
    expect(await init(opts, runtime)).toEqual({
      supported: false,
      reason: 'request_failed',
    });
  });

  it('returns request_failed when the network throws', async () => {
    const { runtime } = fakeRuntime(() => {
      throw new TypeError('failed to fetch');
    });
    expect(await init(opts, runtime)).toEqual({
      supported: false,
      reason: 'request_failed',
    });
  });

  it('returns request_failed on a body without a public key', async () => {
    const { runtime } = fakeRuntime(() => jsonResponse(200, {}));
    expect((await init(opts, runtime)).reason).toBe('request_failed');
  });

  it('makes no request in an unsupported browser', async () => {
    const { runtime, requests } = fakeRuntime(
      () => jsonResponse(200, { public_key: 'k' }),
      supportedEnv({ isSecureContext: false })
    );
    expect(await init(opts, runtime)).toEqual({
      supported: false,
      reason: 'insecure_context',
    });
    expect(requests).toHaveLength(0);
  });

  it.each([
    ['empty app id', { ...opts, appId: ' ' }],
    ['empty client key', { ...opts, clientKey: '' }],
    ['bad host', { ...opts, host: 'not a url' }],
    ['host with user info', { ...opts, host: 'https://u:p@notti.example.com' }],
  ])('rejects %s without throwing or requesting', async (_name, options) => {
    const { runtime, requests } = fakeRuntime(() =>
      jsonResponse(200, { public_key: 'k' })
    );
    expect(await init(options, runtime)).toEqual({
      supported: false,
      reason: 'invalid_options',
    });
    expect(requests).toHaveLength(0);
  });

  it('never leaks the client key in an error path', async () => {
    const { runtime } = fakeRuntime(() => jsonResponse(500, {}));
    const result = await init(opts, runtime);
    expect(JSON.stringify(result)).not.toContain('ck_test_abc');
  });

  it('forgets a previous init when a later one fails', async () => {
    const ok = fakeRuntime(() => jsonResponse(200, { public_key: 'k' }));
    await init(opts, ok.runtime);
    expect(getState()).not.toBeNull();
    const bad = fakeRuntime(() => jsonResponse(500, {}));
    await init(opts, bad.runtime);
    expect(getState()).toBeNull();
  });
});

describe('normalizeHost', () => {
  it('defaults and strips the path and trailing slash', () => {
    expect(normalizeHost(undefined)).toBe(DEFAULT_HOST);
    expect(normalizeHost('https://a.example.com/x/')).toBe(
      'https://a.example.com'
    );
  });
});
