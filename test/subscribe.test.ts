import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../src/init';
import { getState, setState } from '../src/runtime';
import { requestPermission } from '../src/subscribe';
import { DEVICE_KEY, CONFIG_KEY, memoryStore } from '../src/store';
import {
  OTHER_PUBLIC_KEY,
  PUBLIC_KEY,
  fakeBrowser,
  fakeRuntime,
  fakeSubscription,
  jsonResponse,
  type RecordedRequest,
} from './helpers';

const opts = { appId: 'app_1', clientKey: 'ck_test' };
const ENDPOINT = 'https://push.example.com/send/abcd';

/** A Notti server that accepts config, device create and patch. */
function server(overrides: Partial<Record<string, () => Response>> = {}) {
  return (req: RecordedRequest): Response => {
    const key = `${req.method} ${new URL(req.url).pathname}`;
    const hit = overrides[key];
    if (hit) return hit();
    if (key === 'GET /v1/apps/app_1/web-push/config') {
      return jsonResponse(200, { public_key: PUBLIC_KEY });
    }
    if (key === 'POST /v1/apps/app_1/devices') {
      return jsonResponse(201, { id: 'dev_1' });
    }
    if (key === 'PATCH /v1/apps/app_1/devices/dev_1') {
      return jsonResponse(200, { id: 'dev_1' });
    }
    return jsonResponse(404, { error: { code: 'not_found' } });
  };
}

function setup(
  browserOptions: Parameters<typeof fakeBrowser>[0] = {},
  respond = server(),
  store = memoryStore()
) {
  const browser = fakeBrowser({
    created: fakeSubscription(ENDPOINT),
    ...browserOptions,
  });
  const rt = fakeRuntime(respond, browser.env, store);
  return { browser, ...rt };
}

const writes = (requests: RecordedRequest[]) =>
  requests.filter((r) => r.method !== 'GET');

beforeEach(() => setState(null));

describe('requestPermission', () => {
  it('prompts, subscribes with the App key and registers one web Device', async () => {
    const { browser, runtime, requests, store } = setup();
    await init(opts, runtime);
    const result = await requestPermission(runtime);

    expect(result).toEqual({
      permission: 'granted',
      registered: true,
      deviceId: 'dev_1',
    });
    expect(browser.notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(browser.register).toHaveBeenCalledWith('/notti-sw.js');
    expect(browser.subscribe).toHaveBeenCalledTimes(1);
    const subscribeArg = browser.subscribe.mock.calls[0]?.[0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(subscribeArg.userVisibleOnly).toBe(true);
    expect(subscribeArg.applicationServerKey).toHaveLength(65);

    const [post, patch] = writes(requests);
    expect(post).toMatchObject({
      method: 'POST',
      url: 'https://app.zeepnotti.app/v1/apps/app_1/devices',
      headers: { Authorization: 'Bearer ck_test' },
      body: {
        token: ENDPOINT,
        platform: 'web',
        keys: { p256dh: 'p256dh-abcd', auth: 'auth-abcd' },
      },
    });
    expect(patch).toMatchObject({
      method: 'PATCH',
      url: 'https://app.zeepnotti.app/v1/apps/app_1/devices/dev_1',
      body: {
        token: ENDPOINT,
        sdk_name: 'web',
        sdk_version: '0.0.0',
        permission_status: 'granted',
      },
    });
    expect(writes(requests)).toHaveLength(2);
    expect(await store.get(DEVICE_KEY)).toMatchObject({
      id: 'dev_1',
      endpoint: ENDPOINT,
      publicKey: PUBLIC_KEY,
    });
  });

  it('stores the config the service worker needs', async () => {
    const { runtime, store } = setup();
    await init(opts, runtime);
    expect(await store.get(CONFIG_KEY)).toEqual({
      appId: 'app_1',
      clientKey: 'ck_test',
      host: 'https://app.zeepnotti.app',
      publicKey: PUBLIC_KEY,
    });
  });

  it('skips the prompt when permission is already granted', async () => {
    const { browser, runtime } = setup({ permission: 'granted' });
    await init(opts, runtime);
    const result = await requestPermission(runtime);
    expect(result.registered).toBe(true);
    expect(browser.notification.requestPermission).not.toHaveBeenCalled();
  });

  it('registers nothing when the visitor denies the prompt', async () => {
    const { browser, runtime, requests } = setup({ promptAnswer: 'denied' });
    await init(opts, runtime);
    const result = await requestPermission(runtime);
    expect(result).toEqual({ permission: 'denied', registered: false });
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(writes(requests)).toHaveLength(0);
  });

  it('registers nothing when the visitor dismisses the prompt', async () => {
    const { browser, runtime, requests } = setup({ promptAnswer: 'default' });
    await init(opts, runtime);
    const result = await requestPermission(runtime);
    expect(result).toEqual({ permission: 'default', registered: false });
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(writes(requests)).toHaveLength(0);
  });

  it('does not prompt again once denied', async () => {
    const { browser, runtime } = setup({ permission: 'denied' });
    await init(opts, runtime);
    const result = await requestPermission(runtime);
    expect(result).toEqual({ permission: 'denied', registered: false });
    expect(browser.notification.requestPermission).not.toHaveBeenCalled();
  });

  it('init never prompts', async () => {
    const { browser, runtime } = setup();
    await init(opts, runtime);
    expect(browser.notification.requestPermission).not.toHaveBeenCalled();
    expect(browser.subscribe).not.toHaveBeenCalled();
  });

  it('works with the callback-only prompt of older Safari', async () => {
    const { runtime } = setup({ callbackOnly: true });
    await init(opts, runtime);
    expect((await requestPermission(runtime)).registered).toBe(true);
  });

  it('reports not_initialized before init', async () => {
    const { runtime } = setup();
    const result = await requestPermission(runtime);
    expect(result).toEqual({
      permission: 'default',
      registered: false,
      reason: 'not_initialized',
    });
  });

  it('reports subscribe_failed when the browser refuses to subscribe', async () => {
    const { browser, runtime, requests } = setup();
    browser.subscribe.mockRejectedValueOnce(new Error('AbortError'));
    await init(opts, runtime);
    const result = await requestPermission(runtime);
    expect(result).toEqual({
      permission: 'granted',
      registered: false,
      reason: 'subscribe_failed',
    });
    expect(writes(requests)).toHaveLength(0);
  });

  it('reports subscribe_failed when the subscription has no keys', async () => {
    const { runtime } = setup({
      created: fakeSubscription(ENDPOINT, PUBLIC_KEY, { p256dh: 'x' }),
    });
    await init(opts, runtime);
    expect((await requestPermission(runtime)).reason).toBe('subscribe_failed');
  });

  it('reuses a browser subscription made with the same key', async () => {
    const existing = fakeSubscription(ENDPOINT);
    const { browser, runtime } = setup({ permission: 'granted', existing });
    await init(opts, runtime);
    const result = await requestPermission(runtime);
    expect(result.registered).toBe(true);
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(existing.unsubscribe).not.toHaveBeenCalled();
  });
});

describe('service worker readiness', () => {
  afterEach(() => vi.useRealTimers());

  it('uses the registration directly when it is already active', async () => {
    const { browser, runtime } = setup({
      activeOnRegister: true,
      readyNeverSettles: true,
    });
    await init(opts, runtime);
    expect((await requestPermission(runtime)).registered).toBe(true);
    expect(browser.subscribe).toHaveBeenCalledTimes(1);
  });

  it('asks for a newer worker file but still registers when the worker is stale', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { browser, runtime } = setup({
      activeOnRegister: true,
      workerVersion: '0.0.0-old',
    });
    await init(opts, runtime);
    expect((await requestPermission(runtime)).registered).toBe(true);
    expect(browser.update).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('gives up with subscribe_failed when the worker never becomes ready', async () => {
    vi.useFakeTimers();
    const { runtime } = setup({ readyNeverSettles: true });
    await init(opts, runtime);
    const pending = requestPermission(runtime);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toEqual({
      permission: 'granted',
      registered: false,
      reason: 'subscribe_failed',
    });
  });
});

describe('registration', () => {
  it('retries a 5xx with backoff and then succeeds', async () => {
    let posts = 0;
    const { runtime, sleeps } = setup(
      {},
      server({
        'POST /v1/apps/app_1/devices': () =>
          ++posts < 3
            ? jsonResponse(503, {})
            : jsonResponse(201, { id: 'dev_1' }),
      })
    );
    await init(opts, runtime);
    const result = await requestPermission(runtime);
    expect(result.registered).toBe(true);
    expect(posts).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('gives up after three attempts', async () => {
    let posts = 0;
    const { runtime } = setup(
      {},
      server({
        'POST /v1/apps/app_1/devices': () => {
          posts++;
          return jsonResponse(500, {});
        },
      })
    );
    await init(opts, runtime);
    const result = await requestPermission(runtime);
    expect(result).toMatchObject({
      registered: false,
      reason: 'register_failed',
    });
    expect(posts).toBe(3);
  });

  it('does not retry a terminal 4xx', async () => {
    let posts = 0;
    const { runtime, sleeps, store } = setup(
      {},
      server({
        'POST /v1/apps/app_1/devices': () => {
          posts++;
          return jsonResponse(422, { error: { code: 'invalid_device' } });
        },
      })
    );
    await init(opts, runtime);
    const result = await requestPermission(runtime);
    expect(result.reason).toBe('register_failed');
    expect(posts).toBe(1);
    expect(sleeps).toEqual([]);
    expect(await store.get(DEVICE_KEY)).toBeUndefined();
  });

  it('reports not_enabled when the App turned web push off', async () => {
    const { runtime } = setup(
      {},
      server({
        'POST /v1/apps/app_1/devices': () =>
          jsonResponse(409, { error: { code: 'web_push_not_enabled' } }),
      })
    );
    await init(opts, runtime);
    expect((await requestPermission(runtime)).reason).toBe('not_enabled');
  });

  it('keeps the registration when only the sdk PATCH fails, and repeats it next init', async () => {
    const respond = server({
      'PATCH /v1/apps/app_1/devices/dev_1': () => jsonResponse(500, {}),
    });
    const first = setup({}, respond);
    await init(opts, first.runtime);
    const result = await requestPermission(first.runtime);
    expect(result).toMatchObject({ registered: true, deviceId: 'dev_1' });
    expect(await first.store.get(DEVICE_KEY)).toBeUndefined();
  });
});

describe('re-sync on init', () => {
  async function optIn() {
    const first = setup();
    await init(opts, first.runtime);
    await requestPermission(first.runtime);
    return first;
  }

  it('makes no write on reload when nothing changed (no duplicate)', async () => {
    const first = await optIn();
    setState(null);
    // Same browser state and store, a fresh page load.
    const reload = fakeRuntime(server(), first.browser.env, first.store);
    await init(opts, reload.runtime);
    expect(writes(reload.requests)).toHaveLength(0);
    expect(first.browser.subscribe).toHaveBeenCalledTimes(1);
    expect(getState()).not.toBeNull();
  });

  it('re-registers when the browser endpoint changed', async () => {
    const first = await optIn();
    const rotated = fakeSubscription('https://push.example.com/send/zzzz');
    first.browser.setExisting(rotated);
    const reload = fakeRuntime(server(), first.browser.env, first.store);
    await init(opts, reload.runtime);

    const [post] = writes(reload.requests);
    expect(post).toMatchObject({
      method: 'POST',
      body: { token: 'https://push.example.com/send/zzzz' },
    });
  });

  it('resubscribes silently when the App key was rotated', async () => {
    const first = await optIn();
    // The browser still holds the subscription made with the old key; the
    // server now publishes a new one.
    const stale = fakeSubscription(ENDPOINT, PUBLIC_KEY);
    first.browser.setExisting(stale);
    const reload = fakeRuntime(
      (req) =>
        req.method === 'GET'
          ? jsonResponse(200, { public_key: OTHER_PUBLIC_KEY })
          : server()(req),
      first.browser.env,
      first.store
    );
    await init(opts, reload.runtime);

    expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
    expect(first.browser.subscribe).toHaveBeenCalledTimes(2);
    expect(first.browser.notification.requestPermission).toHaveBeenCalledTimes(
      1
    );
    expect(writes(reload.requests).map((r) => r.method)).toEqual([
      'POST',
      'PATCH',
    ]);
    expect(await first.store.get(DEVICE_KEY)).toMatchObject({
      publicKey: OTHER_PUBLIC_KEY,
    });
  });

  it('trusts the stored key when the browser does not expose it', async () => {
    const first = await optIn();
    first.browser.setExisting(fakeSubscription(ENDPOINT, null));
    const reload = fakeRuntime(server(), first.browser.env, first.store);
    await init(opts, reload.runtime);
    expect(first.browser.subscribe).toHaveBeenCalledTimes(1);
    expect(writes(reload.requests)).toHaveLength(0);
  });

  it('does nothing when permission is no longer granted', async () => {
    const first = await optIn();
    first.browser.notification.permission = 'denied';
    const reload = fakeRuntime(server(), first.browser.env, first.store);
    await init(opts, reload.runtime);
    expect(writes(reload.requests)).toHaveLength(0);
    expect(first.browser.subscribe).toHaveBeenCalledTimes(1);
  });

  it('does not subscribe a visitor who never opted in, even if granted', async () => {
    const { browser, runtime, requests } = setup({ permission: 'granted' });
    await init(opts, runtime);
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(browser.register).not.toHaveBeenCalled();
    expect(writes(requests)).toHaveLength(0);
  });

  it('ignores a Device stored for another App', async () => {
    const first = await optIn();
    const other = fakeRuntime(
      (req) =>
        req.url.includes('/apps/app_2/web-push/config')
          ? jsonResponse(200, { public_key: PUBLIC_KEY })
          : jsonResponse(500, {}),
      first.browser.env,
      first.store
    );
    await init({ appId: 'app_2', clientKey: 'ck_2' }, other.runtime);
    expect(writes(other.requests)).toHaveLength(0);
  });

  it('never fails init because a sync failed', async () => {
    const first = await optIn();
    first.browser.getSubscription.mockRejectedValueOnce(new Error('boom'));
    const reload = fakeRuntime(server(), first.browser.env, first.store);
    expect(await init(opts, reload.runtime)).toEqual({ supported: true });
  });
});

describe('concurrent subscribe', () => {
  it('shares one subscription when init re-syncs while the visitor enables', async () => {
    // A visitor who opted in earlier, whose browser subscription is gone.
    const first = setup({ permission: 'granted' });
    await first.store.set(DEVICE_KEY, {
      id: 'dev_0',
      appId: 'app_1',
      endpoint: 'https://push.example.com/send/old',
      p256dh: 'p',
      auth: 'a',
      publicKey: PUBLIC_KEY,
    });
    // The browser takes a moment to subscribe and, like Chrome, hands each
    // concurrent call its own endpoint while none exists yet.
    let calls = 0;
    first.browser.subscribe.mockImplementation(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return fakeSubscription(`https://push.example.com/send/new-${calls}`);
    });

    const initial = init(opts, first.runtime);
    await vi.waitFor(() => expect(getState()).not.toBeNull(), { interval: 1 });
    const [, result] = await Promise.all([
      initial,
      requestPermission(first.runtime),
    ]);

    expect(result.registered).toBe(true);
    expect(first.browser.subscribe).toHaveBeenCalledTimes(1);
    const posts = first.requests.filter(
      (r) => r.method === 'POST' && r.url.endsWith('/devices')
    );
    expect(posts).toHaveLength(1);
  });

  it('lets a later call register again once the first one finished', async () => {
    const { browser, runtime } = setup({ permission: 'granted' });
    await init(opts, runtime);
    await requestPermission(runtime);
    await requestPermission(runtime);
    expect(browser.subscribe).toHaveBeenCalledTimes(1);
    browser.setExisting(null);
    await requestPermission(runtime);
    expect(browser.subscribe).toHaveBeenCalledTimes(2);
  });
});
