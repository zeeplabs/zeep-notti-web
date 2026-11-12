import { beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../src/init';
import { identify, logout, removeTags, setTags } from '../src/profile';
import { setState } from '../src/runtime';
import { requestPermission } from '../src/subscribe';
import {
  DEVICE_KEY,
  PROFILE_KEY,
  memoryStore,
  type Store,
  type StoredProfile,
} from '../src/store';
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
const DEVICES = 'https://app.zeepnotti.app/v1/apps/app_1/devices';

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

type Respond = (req: RecordedRequest) => Response | Promise<Response>;

function build(respond: Respond = server(), store: Store = memoryStore()) {
  const browser = fakeBrowser({ created: fakeSubscription(ENDPOINT) });
  return { browser, ...fakeRuntime(respond, browser.env, store) };
}

/** A browser that already opted in; later requests are the ones asserted. */
async function registered(respond: Respond = server()) {
  const t = build(respond);
  await init(opts, t.runtime);
  await requestPermission(t.runtime);
  t.requests.length = 0;
  return t;
}

const patches = (requests: RecordedRequest[]) =>
  requests.filter((r) => r.method === 'PATCH');

beforeEach(() => setState(null));

describe('identify', () => {
  it('sends external_user_id with the device token', async () => {
    const t = await registered();
    await identify(t.runtime, 'user-42');
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0]).toMatchObject({
      method: 'PATCH',
      url: `${DEVICES}/dev_1`,
      headers: { Authorization: 'Bearer ck_test' },
    });
    expect(t.requests[0]?.raw).toBe(
      `{"token":"${ENDPOINT}","external_user_id":"user-42"}`
    );
  });

  it('trims the id and ignores an empty one', async () => {
    const t = await registered();
    await identify(t.runtime, '   ');
    expect(t.requests).toHaveLength(0);
    await identify(t.runtime, '  u1 ');
    expect(t.requests[0]?.body).toMatchObject({ external_user_id: 'u1' });
  });

  it('is kept and carried by the registration when called before it', async () => {
    const t = build();
    await init(opts, t.runtime);
    await identify(t.runtime, 'early-user');
    expect(patches(t.requests)).toHaveLength(0);

    await requestPermission(t.runtime);
    const post = t.requests.find((r) => r.method === 'POST');
    expect(post?.body).toMatchObject({
      token: ENDPOINT,
      platform: 'web',
      external_user_id: 'early-user',
    });
    // Only the sdk report is patched; the id already went in the POST.
    expect(patches(t.requests)).toHaveLength(1);
    expect(patches(t.requests)[0]?.body).toHaveProperty('sdk_name', 'web');
  });

  it('is kept when called before init and sent after registration', async () => {
    const t = build();
    await identify(t.runtime, 'before-init');
    await init(opts, t.runtime);
    await requestPermission(t.runtime);
    const post = t.requests.find((r) => r.method === 'POST');
    expect(post?.body).toMatchObject({ external_user_id: 'before-init' });
  });

  it('retries a failed request at the next registration sync', async () => {
    let fail = false;
    const t = await registered(
      server({
        'PATCH /v1/apps/app_1/devices/dev_1': () =>
          fail ? jsonResponse(500, {}) : jsonResponse(200, {}),
      })
    );
    fail = true;
    await identify(t.runtime, 'flaky');
    expect(patches(t.requests)).toHaveLength(3);
    expect(
      (await t.store.get<{ pending: string[] }>(PROFILE_KEY))?.pending
    ).toEqual(['external_user_id']);

    fail = false;
    t.requests.length = 0;
    setState(null);
    await init(opts, t.runtime); // a later page load
    expect(patches(t.requests)).toHaveLength(1);
    expect(patches(t.requests)[0]?.body).toEqual({
      token: ENDPOINT,
      external_user_id: 'flaky',
    });
    expect(
      (await t.store.get<{ pending: string[] }>(PROFILE_KEY))?.pending
    ).toEqual([]);
  });
});

describe('setTags', () => {
  it('sends the full resulting map, merging with earlier tags', async () => {
    const t = await registered();
    await setTags(t.runtime, { plan: 'pro' });
    await setTags(t.runtime, { beta: true, seats: 3 });
    expect(t.requests.map((r) => r.raw)).toEqual([
      `{"token":"${ENDPOINT}","tags":{"plan":"pro"}}`,
      `{"token":"${ENDPOINT}","tags":{"plan":"pro","beta":true,"seats":3}}`,
    ]);
  });

  it('removes a key with null', async () => {
    const t = await registered();
    await setTags(t.runtime, { a: '1', b: '2' });
    await setTags(t.runtime, { a: null });
    expect(t.requests[1]?.body).toEqual({ token: ENDPOINT, tags: { b: '2' } });
  });

  it('removeTags sends the remaining map', async () => {
    const t = await registered();
    await setTags(t.runtime, { a: '1', b: '2' });
    await removeTags(t.runtime, ['a']);
    expect(t.requests[1]?.body).toEqual({ token: ENDPOINT, tags: { b: '2' } });
  });

  it('removing the last tag sends an empty map (which clears server-side)', async () => {
    const t = await registered();
    await setTags(t.runtime, { a: '1' });
    await removeTags(t.runtime, ['a']);
    expect(t.requests[1]?.raw).toBe(`{"token":"${ENDPOINT}","tags":{}}`);
  });

  it('ignores values that are not string, number, boolean or null', async () => {
    const t = await registered();
    await setTags(t.runtime, {
      ok: 'yes',
      bad: { nested: 1 } as never,
      worse: undefined as never,
    });
    expect(t.requests[0]?.body).toEqual({
      token: ENDPOINT,
      tags: { ok: 'yes' },
    });
  });

  it('is carried by the registration when set before it', async () => {
    const t = build();
    await init(opts, t.runtime);
    await setTags(t.runtime, { plan: 'free' });
    await requestPermission(t.runtime);
    const post = t.requests.find((r) => r.method === 'POST');
    expect(post?.body).toMatchObject({ tags: { plan: 'free' } });
    expect(patches(t.requests)).toHaveLength(1);
  });

  it('keeps both tags when two calls overlap', async () => {
    const t = await registered();
    await Promise.all([
      setTags(t.runtime, { a: '1' }),
      setTags(t.runtime, { b: '2' }),
    ]);
    const stored = await t.store.get<{ tags: Record<string, string> }>(
      PROFILE_KEY
    );
    expect(stored?.tags).toEqual({ a: '1', b: '2' });
    expect(t.requests.at(-1)?.body).toEqual({
      token: ENDPOINT,
      tags: { a: '1', b: '2' },
    });
  });
});

describe('logout', () => {
  it('sends an explicit null external_user_id and keeps the tags', async () => {
    const t = await registered();
    await identify(t.runtime, 'u1');
    await setTags(t.runtime, { plan: 'pro' });
    t.requests.length = 0;

    await logout(t.runtime);
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0]?.raw).toBe(
      `{"token":"${ENDPOINT}","external_user_id":null}`
    );

    // Tags survived: the next tag change still carries them.
    t.requests.length = 0;
    await setTags(t.runtime, { beta: true });
    expect(t.requests[0]?.body).toEqual({
      token: ENDPOINT,
      tags: { plan: 'pro', beta: true },
    });
    // And the subscription is untouched.
    expect(await t.store.get(DEVICE_KEY)).toMatchObject({ id: 'dev_1' });
  });

  it('is repeated at the next sync when the request failed', async () => {
    let fail = false;
    const t = await registered(
      server({
        'PATCH /v1/apps/app_1/devices/dev_1': () =>
          fail ? jsonResponse(503, {}) : jsonResponse(200, {}),
      })
    );
    fail = true;
    await logout(t.runtime);
    fail = false;
    t.requests.length = 0;
    setState(null);
    await init(opts, t.runtime);
    expect(patches(t.requests)).toHaveLength(1);
    expect(patches(t.requests)[0]?.raw).toBe(
      `{"token":"${ENDPOINT}","external_user_id":null}`
    );
  });

  it('is not undone by a later identify that was made first', async () => {
    const t = await registered();
    await identify(t.runtime, 'u1');
    await logout(t.runtime);
    const stored = await t.store.get<{
      external_user_id?: string;
      pending: string[];
    }>(PROFILE_KEY);
    expect(stored?.external_user_id).toBeUndefined();
    expect(stored?.pending).toEqual([]);
  });

  it('still reaches the server when the endpoint changed after logout failed', async () => {
    let fail = false;
    const t = await registered(
      server({
        'PATCH /v1/apps/app_1/devices/dev_1': () =>
          fail ? jsonResponse(500, {}) : jsonResponse(200, { id: 'dev_1' }),
      })
    );
    fail = true;
    await identify(t.runtime, 'u1');
    await logout(t.runtime); // both fail, logout stays pending
    fail = false;
    t.requests.length = 0;
    t.browser.setExisting(
      fakeSubscription('https://push.example.com/send/new1')
    );
    setState(null);
    await init(opts, t.runtime);

    const post = t.requests.find((r) => r.method === 'POST');
    expect(post?.body).not.toHaveProperty('external_user_id');
    const last = patches(t.requests).at(-1);
    expect(last?.body).toEqual({
      token: 'https://push.example.com/send/new1',
      external_user_id: null,
    });
  });
});

describe('robustness', () => {
  it('never throws when storage fails', async () => {
    const broken: Store = {
      get: () => Promise.reject(new Error('quota')),
      set: () => Promise.reject(new Error('quota')),
      delete: () => Promise.reject(new Error('quota')),
    };
    const t = build(server(), broken);
    await expect(identify(t.runtime, 'u')).resolves.toBeUndefined();
    await expect(setTags(t.runtime, { a: 'b' })).resolves.toBeUndefined();
    await expect(removeTags(t.runtime, ['a'])).resolves.toBeUndefined();
    await expect(logout(t.runtime)).resolves.toBeUndefined();
  });

  it('never throws on bad input', async () => {
    const t = build();
    await expect(
      identify(t.runtime, undefined as never)
    ).resolves.toBeUndefined();
    await expect(setTags(t.runtime, null as never)).resolves.toBeUndefined();
    await expect(removeTags(t.runtime, 'a' as never)).resolves.toBeUndefined();
  });

  it('does nothing on the wire before the browser is registered', async () => {
    const t = build();
    await init(opts, t.runtime);
    await identify(t.runtime, 'u');
    await setTags(t.runtime, { a: 'b' });
    await logout(t.runtime);
    expect(t.requests.filter((r) => r.method !== 'GET')).toHaveLength(0);
  });
});

describe('a profile change made while the registration POST is in flight', () => {
  /** A server whose device POST waits until `release` is called. */
  function slowPost() {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const base = server();
    const respond = async (req: RecordedRequest): Promise<Response> => {
      if (req.method === 'POST' && req.url === DEVICES) await gate;
      return base(req);
    };
    return { respond, release };
  }

  /** Waits until the POST has been sent, so the change lands while it is in flight. */
  async function postSent(requests: RecordedRequest[]) {
    await vi.waitFor(
      () => expect(requests.some((r) => r.method === 'POST')).toBe(true),
      {
        interval: 1,
      }
    );
  }

  it('still sends a logout that came after the POST read the profile', async () => {
    const { respond, release } = slowPost();
    const t = build(respond);
    await init(opts, t.runtime);
    await identify(t.runtime, 'user-A');

    const registering = requestPermission(t.runtime);
    await postSent(t.requests);
    expect(t.requests.find((r) => r.method === 'POST')?.body).toMatchObject({
      external_user_id: 'user-A',
    });
    await logout(t.runtime);
    release();
    await registering;

    const last = patches(t.requests).at(-1);
    expect(last?.body).toMatchObject({ external_user_id: null });
    expect((await t.store.get<StoredProfile>(PROFILE_KEY))?.pending).toEqual(
      []
    );
  });

  it('still sends tags changed after the POST read the profile', async () => {
    const { respond, release } = slowPost();
    const t = build(respond);
    await init(opts, t.runtime);
    await setTags(t.runtime, { plan: 'pro' });

    const registering = requestPermission(t.runtime);
    await postSent(t.requests);
    await setTags(t.runtime, { plan: 'basic' });
    release();
    await registering;

    const last = patches(t.requests).at(-1);
    expect(last?.body).toMatchObject({ tags: { plan: 'basic' } });
    expect((await t.store.get<StoredProfile>(PROFILE_KEY))?.pending).toEqual(
      []
    );
  });

  it('clears the pending fields when nothing changed meanwhile', async () => {
    const t = build();
    await init(opts, t.runtime);
    await identify(t.runtime, 'user-A');
    await setTags(t.runtime, { plan: 'pro' });
    await requestPermission(t.runtime);

    expect((await t.store.get<StoredProfile>(PROFILE_KEY))?.pending).toEqual(
      []
    );
    // The POST carried both, so only the sdk PATCH follows.
    expect(patches(t.requests)).toHaveLength(1);
  });
});

describe('concurrent profile calls', () => {
  it('sends one PATCH at a time and ends with the last value', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));
    let patchCount = 0;
    const base = server();
    const respond = async (req: RecordedRequest): Promise<Response> => {
      if (
        req.method === 'PATCH' &&
        'external_user_id' in (req.body as object)
      ) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (++patchCount === 1) await firstGate;
        inFlight--;
      }
      return base(req);
    };
    const t = await registered(respond);

    const first = logout(t.runtime);
    const second = identify(t.runtime, 'user-B');
    // Let both calls reach the server queue before the first PATCH finishes.
    await vi.waitFor(() => expect(patchCount).toBe(1), { interval: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    releaseFirst();
    await Promise.all([first, second]);

    expect(maxInFlight).toBe(1);
    const sent = patches(t.requests).filter(
      (r) => 'external_user_id' in (r.body as object)
    );
    expect(sent.at(-1)?.body).toMatchObject({ external_user_id: 'user-B' });
    expect((await t.store.get<StoredProfile>(PROFILE_KEY))?.pending).toEqual(
      []
    );
  });
});
