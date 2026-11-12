import { beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../src/init';
import { setState } from '../src/runtime';
import { requestPermission } from '../src/subscribe';
import { DEVICE_KEY, memoryStore, type StoredDevice } from '../src/store';
import {
  PUBLIC_KEY,
  fakeBrowser,
  fakeRuntime,
  fakeSubscription,
  jsonResponse,
  type RecordedRequest,
} from './helpers';

const opts = { appId: 'app_1', clientKey: 'ck_test' };
const ENDPOINT = 'https://push.example.com/send/abcd';
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);

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

const writes = (requests: RecordedRequest[]) =>
  requests.filter((r) => r.method !== 'GET');

/** A visitor who registered at T0 through requestPermission. */
async function registered() {
  const browser = fakeBrowser({ created: fakeSubscription(ENDPOINT) });
  const store = memoryStore();
  const first = fakeRuntime(server(), browser.env, store);
  first.runtime.now = () => T0;
  setState(null);
  await init(opts, first.runtime);
  await requestPermission(first.runtime);
  return { browser, store };
}

/** The same browser, later, with a new page load. */
function reload(
  base: Awaited<ReturnType<typeof registered>>,
  now: number,
  respond = server()
) {
  setState(null);
  const rt = fakeRuntime(respond, base.browser.env, base.store);
  rt.runtime.now = () => now;
  return rt;
}

beforeEach(() => setState(null));

describe('last seen heartbeat', () => {
  it('records the registration as the last time the server saw the browser', async () => {
    const base = await registered();
    expect(await base.store.get<StoredDevice>(DEVICE_KEY)).toMatchObject({
      seenAt: T0,
    });
  });

  it('sends one light PATCH at init when the server has not seen the browser for a day', async () => {
    const base = await registered();
    const later = reload(base, T0 + DAY + 1000);
    await init(opts, later.runtime);

    await vi.waitFor(() => expect(writes(later.requests)).toHaveLength(1));
    expect(writes(later.requests)[0]).toMatchObject({
      method: 'PATCH',
      url: 'https://app.zeepnotti.app/v1/apps/app_1/devices/dev_1',
      headers: { Authorization: 'Bearer ck_test' },
      body: { token: ENDPOINT, permission_status: 'granted' },
    });
    // Nothing else rides along: it is a sign of life, not a profile update.
    expect(Object.keys(writes(later.requests)[0]?.body as object).sort()).toEqual(
      ['permission_status', 'token']
    );
    await vi.waitFor(async () =>
      expect(await base.store.get<StoredDevice>(DEVICE_KEY)).toMatchObject({
        seenAt: T0 + DAY + 1000,
      })
    );
  });

  it('sends nothing when the browser was seen less than a day ago', async () => {
    const base = await registered();
    const later = reload(base, T0 + DAY - 1000);
    await init(opts, later.runtime);
    await Promise.resolve();
    expect(writes(later.requests)).toHaveLength(0);
  });

  it('sends it once a day, not at every page load', async () => {
    const base = await registered();
    const day1 = reload(base, T0 + DAY + 1000);
    await init(opts, day1.runtime);
    await vi.waitFor(() => expect(writes(day1.requests)).toHaveLength(1));

    // Wait for the record to carry the new time, then load again an hour later.
    await vi.waitFor(async () =>
      expect(await base.store.get<StoredDevice>(DEVICE_KEY)).toMatchObject({
        seenAt: T0 + DAY + 1000,
      })
    );
    const sameDay = reload(base, T0 + DAY + 3_600_000);
    await init(opts, sameDay.runtime);
    await Promise.resolve();
    expect(writes(sameDay.requests)).toHaveLength(0);
  });

  it('also covers a browser registered by 0.1.0 or 0.1.1, whose record has no time', async () => {
    const base = await registered();
    const record = await base.store.get<StoredDevice>(DEVICE_KEY);
    const withoutTime: Partial<StoredDevice> = { ...record };
    delete withoutTime.seenAt;
    await base.store.set(DEVICE_KEY, withoutTime);

    const later = reload(base, T0 + 1000);
    await init(opts, later.runtime);
    await vi.waitFor(() => expect(writes(later.requests)).toHaveLength(1));
  });

  it('sends it when the clock went back and the stored time is in the future', async () => {
    const base = await registered();
    const later = reload(base, T0 - 5 * DAY);
    await init(opts, later.runtime);
    await vi.waitFor(() => expect(writes(later.requests)).toHaveLength(1));
  });

  it('does not delay or fail init when the heartbeat fails, and tries again at the next init', async () => {
    const base = await registered();
    const failing = reload(
      base,
      T0 + 2 * DAY,
      server({
        'PATCH /v1/apps/app_1/devices/dev_1': () => jsonResponse(500, {}),
      })
    );
    await expect(init(opts, failing.runtime)).resolves.toMatchObject({
      supported: true,
    });
    await vi.waitFor(() => expect(writes(failing.requests).length).toBe(1));
    // A failed heartbeat is not retried with a back-off that would hold init.
    expect(failing.sleeps).toEqual([]);
    expect(await base.store.get<StoredDevice>(DEVICE_KEY)).toMatchObject({
      seenAt: T0,
    });

    const next = reload(base, T0 + 2 * DAY + 60_000);
    await init(opts, next.runtime);
    await vi.waitFor(() => expect(writes(next.requests)).toHaveLength(1));
  });

  it('does not make init wait for the heartbeat', async () => {
    const base = await registered();
    let release: (r: Response) => void = () => undefined;
    const held = new Promise<Response>((resolve) => (release = resolve));
    const slow = reload(base, T0 + 2 * DAY, (req) =>
      req.method === 'PATCH' ? (held as unknown as Response) : server()(req)
    );
    // init resolves while the PATCH is still pending.
    await init(opts, slow.runtime);
    expect(writes(slow.requests)).toHaveLength(1);
    release(jsonResponse(200, { id: 'dev_1' }));
  });

  it('counts the sdk PATCH that repeats a failed registration step as the sign of life', async () => {
    const base = await registered();
    const record = await base.store.get<StoredDevice>(DEVICE_KEY);
    await base.store.set(DEVICE_KEY, { ...record, sdkSynced: false });

    const later = reload(base, T0 + 2 * DAY);
    await init(opts, later.runtime);
    await vi.waitFor(() => expect(writes(later.requests)).toHaveLength(1));
    expect(writes(later.requests)[0]?.body).toMatchObject({ sdk_name: 'web' });
    await vi.waitFor(async () =>
      expect(await base.store.get<StoredDevice>(DEVICE_KEY)).toMatchObject({
        sdkSynced: true,
        seenAt: T0 + 2 * DAY,
      })
    );
  });

  it('never sends it for a visitor who did not opt in through the SDK', async () => {
    const browser = fakeBrowser({
      created: fakeSubscription(ENDPOINT),
      permission: 'granted',
    });
    const rt = fakeRuntime(server(), browser.env, memoryStore());
    rt.runtime.now = () => T0;
    await init(opts, rt.runtime);
    await Promise.resolve();
    expect(writes(rt.requests)).toHaveLength(0);
  });
});
