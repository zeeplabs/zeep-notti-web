import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryStore, CONFIG_KEY, DEVICE_KEY, type Store } from '../src/store';
import {
  VERSION_REQUEST,
  WORKER_VERSION,
  installWorker,
  resolveClickTarget,
  type WindowClientLike,
  type WorkerScope,
} from '../src/sw/worker';
import { SDK_VERSION } from '../src/version';
import { jsonResponse } from './helpers';

const ORIGIN = 'https://site.example';
const ENDPOINT = 'https://push.example.com/send/abcd';
const EVENTS =
  'https://app.zeepnotti.app/v1/apps/app_1/notifications/n1/events';

interface Shown {
  title: string;
  options: Record<string, unknown> | undefined;
}

interface Harness {
  scope: WorkerScope;
  listeners: Map<string, (event: never) => void>;
  shown: Shown[];
  order: string[];
  fetches: { url: string; raw: string; headers: Record<string, string> }[];
  windows: WindowClientLike[];
  openWindow: ReturnType<typeof vi.fn>;
  matchAll: ReturnType<typeof vi.fn>;
  showNotification: ReturnType<typeof vi.fn>;
  store: Store;
  fetchImpl: { current: () => Promise<Response> };
  sleeps: number[];
}

async function harness(
  options: { configured?: boolean; windows?: WindowClientLike[] } = {}
): Promise<Harness> {
  const listeners = new Map<string, (event: never) => void>();
  const shown: Shown[] = [];
  const order: string[] = [];
  const fetches: Harness['fetches'] = [];
  const sleeps: number[] = [];
  const store = memoryStore();
  if (options.configured !== false) {
    await store.set(CONFIG_KEY, {
      appId: 'app_1',
      clientKey: 'ck_test',
      host: 'https://app.zeepnotti.app',
      publicKey: 'k',
    });
    await store.set(DEVICE_KEY, {
      id: 'dev_1',
      appId: 'app_1',
      endpoint: ENDPOINT,
      p256dh: 'p',
      auth: 'a',
      publicKey: 'k',
    });
  }
  const windows = options.windows ?? [];
  const showNotification = vi.fn(
    async (title: string, opts?: Record<string, unknown>) => {
      order.push('show');
      shown.push({ title, options: opts });
    }
  );
  const openWindow = vi.fn(async () => ({}));
  const matchAll = vi.fn(async () => windows);
  const fetchImpl = {
    current: async () => jsonResponse(201, { id: 'ev' }),
  };

  const scope: WorkerScope = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => undefined),
    registration: { showNotification },
    clients: { matchAll, openWindow, claim: vi.fn(async () => undefined) },
    location: { origin: ORIGIN, hostname: 'site.example' },
  };
  installWorker(scope, {
    store,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    fetch: async (input, init) => {
      order.push('fetch');
      fetches.push({
        url: String(input),
        raw: String(init?.body),
        headers: { ...((init?.headers as Record<string, string>) ?? {}) },
      });
      return fetchImpl.current();
    },
  });
  return {
    scope,
    listeners,
    shown,
    order,
    fetches,
    windows,
    openWindow,
    matchAll,
    showNotification,
    store,
    fetchImpl,
    sleeps,
  };
}

/** Dispatches an event and returns the promises handed to waitUntil. */
function dispatch(h: Harness, type: string, event: Record<string, unknown>) {
  const waits: Promise<unknown>[] = [];
  const full = { ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) };
  h.listeners.get(type)?.(full as never);
  return { settled: () => Promise.all(waits), waits };
}

const pushWith = (payload: unknown) => ({
  data: { json: () => payload },
});

const message = (extra: Record<string, unknown> = {}) => ({
  v: 1,
  title: 'Hello',
  body: 'World',
  image: 'https://cdn.example/i.png',
  tag: 'promo',
  data: {
    url: '/offers',
    notification_id: 'n1',
    delivery_id: 'd1',
    campaign: 'spring',
  },
  ...extra,
});

function click(data: unknown) {
  const close = vi.fn();
  return { event: { notification: { data, close } }, close };
}

afterEach(() => vi.useRealTimers());

describe('push', () => {
  it('shows the notification with title, body, image and tag', async () => {
    const h = await harness();
    await dispatch(h, 'push', pushWith(message())).settled();
    expect(h.shown).toEqual([
      {
        title: 'Hello',
        options: {
          body: 'World',
          image: 'https://cdn.example/i.png',
          tag: 'promo',
          data: { url: '/offers', notification_id: 'n1', delivery_id: 'd1' },
        },
      },
    ]);
  });

  it('keeps integrator data other than the click target out of the notification', async () => {
    const h = await harness();
    await dispatch(h, 'push', pushWith(message())).settled();
    const data = h.shown[0]?.options?.['data'] as Record<string, string>;
    expect(data).not.toHaveProperty('campaign');
  });

  it('reports received once with the Client key and the device token', async () => {
    const h = await harness();
    await dispatch(h, 'push', pushWith(message())).settled();
    expect(h.fetches).toHaveLength(1);
    expect(h.fetches[0]).toMatchObject({
      url: EVENTS,
      headers: { Authorization: 'Bearer ck_test' },
    });
    expect(h.fetches[0]?.raw).toBe(
      `{"delivery_id":"d1","type":"received","token":"${ENDPOINT}"}`
    );
  });

  it('omits image and tag when absent', async () => {
    const h = await harness();
    await dispatch(
      h,
      'push',
      pushWith(message({ image: undefined, tag: undefined }))
    ).settled();
    expect(h.shown[0]?.options).not.toHaveProperty('image');
    expect(h.shown[0]?.options).not.toHaveProperty('tag');
  });

  it.each([
    [
      'unparseable JSON',
      {
        data: {
          json: () => {
            throw new SyntaxError('x');
          },
        },
      },
    ],
    ['no data', { data: null }],
    ['a non-object', pushWith('just a string')],
    ['an empty object', pushWith({})],
    ['blank title and body', pushWith({ title: '  ', body: '' })],
    ['a null payload', pushWith(null)],
  ])('still shows a generic notification for %s', async (_name, event) => {
    const h = await harness();
    await dispatch(h, 'push', event).settled();
    expect(h.shown).toEqual([
      {
        title: 'site.example',
        options: { body: 'You have a new notification' },
      },
    ]);
    // Nothing identifies the delivery, so nothing is reported.
    expect(h.fetches).toHaveLength(0);
  });

  it('shows a body-only message under the body text', async () => {
    const h = await harness();
    await dispatch(
      h,
      'push',
      pushWith({
        body: 'Only a body',
        data: { notification_id: 'n1', delivery_id: 'd1' },
      })
    ).settled();
    expect(h.shown[0]).toMatchObject({
      title: 'Only a body',
      options: { body: '' },
    });
  });

  it('calls showNotification before any storage read or request', async () => {
    const h = await harness();
    dispatch(h, 'push', pushWith(message()));
    // Synchronously after dispatch, before anything was awaited.
    expect(h.showNotification).toHaveBeenCalledTimes(1);
    expect(h.fetches).toHaveLength(0);
  });

  it('is not delayed by a request that never answers, and still settles', async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.fetchImpl.current = () => new Promise<Response>(() => {});
    const { settled } = dispatch(h, 'push', pushWith(message()));
    expect(h.shown).toHaveLength(1);

    let done = false;
    void settled().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(19_000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(done).toBe(true);
    expect(h.order[0]).toBe('show');
  });

  it('does not report received when the notification could not be shown', async () => {
    const h = await harness();
    h.showNotification.mockRejectedValueOnce(new Error('denied'));
    await dispatch(h, 'push', pushWith(message())).settled();
    expect(h.fetches).toHaveLength(0);
  });

  it('shows the notification when the page never configured the worker', async () => {
    const h = await harness({ configured: false });
    await dispatch(h, 'push', pushWith(message())).settled();
    expect(h.shown).toHaveLength(1);
    expect(h.fetches).toHaveLength(0);
  });

  it('shows the notification when storage throws', async () => {
    const h = await harness();
    vi.spyOn(h.store, 'get').mockRejectedValue(new Error('idb'));
    await dispatch(h, 'push', pushWith(message())).settled();
    expect(h.shown).toHaveLength(1);
    expect(h.fetches).toHaveLength(0);
  });

  it('retries the report a bounded number of times then drops it', async () => {
    const h = await harness();
    h.fetchImpl.current = async () => jsonResponse(503, {});
    await dispatch(h, 'push', pushWith(message())).settled();
    expect(h.fetches).toHaveLength(3);
    expect(h.sleeps).toEqual([1000, 2000]);
  });

  it('succeeds after a transient failure', async () => {
    const h = await harness();
    let calls = 0;
    h.fetchImpl.current = async () =>
      ++calls < 2 ? jsonResponse(500, {}) : jsonResponse(201, {});
    await dispatch(h, 'push', pushWith(message())).settled();
    expect(h.fetches).toHaveLength(2);
  });

  it('does not retry a terminal answer', async () => {
    const h = await harness();
    h.fetchImpl.current = async () =>
      jsonResponse(403, { error: { code: 'forbidden' } });
    await dispatch(h, 'push', pushWith(message())).settled();
    expect(h.fetches).toHaveLength(1);
  });
});

describe('notificationclick', () => {
  const data = {
    url: '/offers',
    notification_id: 'n1',
    delivery_id: 'd1',
  };

  it('closes the notification, reports clicked then opened, and opens the target', async () => {
    const h = await harness();
    const { event, close } = click(data);
    await dispatch(h, 'notificationclick', event).settled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(h.openWindow).toHaveBeenCalledWith(`${ORIGIN}/offers`);
    expect(h.fetches.map((f) => JSON.parse(f.raw).type).sort()).toEqual([
      'clicked',
      'opened',
    ]);
    const opened = h.fetches.find((f) => f.raw.includes('"opened"'));
    expect(opened?.raw).toBe(
      `{"delivery_id":"d1","type":"opened","token":"${ENDPOINT}"}`
    );
  });

  it('focuses an existing window already on the target', async () => {
    const focus = vi.fn(async () => undefined);
    const h = await harness({
      windows: [
        { url: `${ORIGIN}/other`, focus: vi.fn(async () => undefined) },
        { url: `${ORIGIN}/offers#top`, focus },
      ],
    });
    await dispatch(h, 'notificationclick', click(data).event).settled();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(h.openWindow).not.toHaveBeenCalled();
    expect(h.fetches).toHaveLength(2);
  });

  it('opens a new window when no existing one is on the target', async () => {
    const focus = vi.fn(async () => undefined);
    const h = await harness({ windows: [{ url: `${ORIGIN}/other`, focus }] });
    await dispatch(h, 'notificationclick', click(data).event).settled();
    expect(focus).not.toHaveBeenCalled();
    expect(h.openWindow).toHaveBeenCalledWith(`${ORIGIN}/offers`);
  });

  it('opens the site root when the payload has no URL', async () => {
    const h = await harness();
    await dispatch(
      h,
      'notificationclick',
      click({ notification_id: 'n1', delivery_id: 'd1' }).event
    ).settled();
    expect(h.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });

  it('opens the site root for a generic notification with no data', async () => {
    const h = await harness();
    await dispatch(h, 'notificationclick', click(undefined).event).settled();
    expect(h.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
    expect(h.fetches).toHaveLength(0);
  });

  it('opens a cross-origin URL without ever focusing an existing client', async () => {
    const focus = vi.fn(async () => undefined);
    const h = await harness({
      windows: [{ url: 'https://elsewhere.example/page', focus }],
    });
    await dispatch(
      h,
      'notificationclick',
      click({ ...data, url: 'https://elsewhere.example/page' }).event
    ).settled();
    expect(h.matchAll).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(h.openWindow).toHaveBeenCalledWith('https://elsewhere.example/page');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'file:///etc/passwd',
  ])('never follows %s', async (url) => {
    const h = await harness();
    await dispatch(
      h,
      'notificationclick',
      click({ ...data, url }).event
    ).settled();
    expect(h.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });

  it('still reports clicked, but not opened, when the window cannot be opened', async () => {
    const h = await harness();
    h.openWindow.mockRejectedValueOnce(new Error('blocked'));
    await dispatch(h, 'notificationclick', click(data).event).settled();
    expect(h.fetches.map((f) => JSON.parse(f.raw).type)).toEqual(['clicked']);
  });

  it('reports nothing when the notification carries no delivery ids', async () => {
    const h = await harness();
    await dispatch(
      h,
      'notificationclick',
      click({ url: '/offers' }).event
    ).settled();
    expect(h.fetches).toHaveLength(0);
    expect(h.openWindow).toHaveBeenCalled();
  });

  it('has no handler for a dismiss, so nothing is reported', async () => {
    const h = await harness();
    expect(h.listeners.has('notificationclose')).toBe(false);
  });
});

describe('versioning and lifecycle', () => {
  it('carries the SDK version', () => {
    expect(WORKER_VERSION).toBe(SDK_VERSION);
  });

  it('answers the version request on the given port', async () => {
    const h = await harness();
    const postMessage = vi.fn();
    h.listeners.get('message')?.({
      data: VERSION_REQUEST,
      ports: [{ postMessage }],
    } as never);
    expect(postMessage).toHaveBeenCalledWith({ version: SDK_VERSION });
  });

  it('ignores other messages', async () => {
    const h = await harness();
    const postMessage = vi.fn();
    h.listeners.get('message')?.({
      data: 'something-else',
      ports: [{ postMessage }],
    } as never);
    h.listeners.get('message')?.({ data: VERSION_REQUEST } as never);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('takes over at once on install and activate', async () => {
    const h = await harness();
    await dispatch(h, 'install', {}).settled();
    await dispatch(h, 'activate', {}).settled();
    expect(h.scope.skipWaiting).toHaveBeenCalledTimes(1);
    expect(h.scope.clients.claim).toHaveBeenCalledTimes(1);
  });
});

describe('resolveClickTarget', () => {
  it('resolves paths against the origin', () => {
    expect(resolveClickTarget('/a?b=1#c', ORIGIN)).toEqual({
      url: `${ORIGIN}/a?b=1#c`,
      sameOrigin: true,
    });
  });
  it('flags another origin', () => {
    expect(resolveClickTarget('https://x.example/', ORIGIN)).toEqual({
      url: 'https://x.example/',
      sameOrigin: false,
    });
  });
  it('treats a lookalike host as another origin', () => {
    expect(
      resolveClickTarget('https://site.example.evil.test/', ORIGIN).sameOrigin
    ).toBe(false);
  });
  it('falls back to the root for empty, malformed or unsafe input', () => {
    for (const raw of [undefined, '', 'http://[bad', 'javascript:1']) {
      expect(resolveClickTarget(raw, ORIGIN)).toEqual({
        url: `${ORIGIN}/`,
        sameOrigin: true,
      });
    }
  });
});
