import { describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '../../src/api';
import type { InAppClick, InAppMessage } from '../../src/inapp/types';
import {
  createInAppSession,
  type DismissReason,
  type InAppView,
  type ViewHandlers,
} from '../../src/inapp/session';
import type { SdkState } from '../../src/runtime';
import { DEVICE_KEY, type StoredDevice } from '../../src/store';
import { fakeRuntime, jsonResponse, type RecordedRequest } from '../helpers';

const config: ApiConfig = {
  appId: 'app-1',
  clientKey: 'ck_test',
  host: 'https://notti.example',
};
const state: SdkState = { config, publicKey: 'pk', serviceWorkerPath: '/notti-sw.js' };

const device: StoredDevice = {
  id: 'dev-1',
  appId: 'app-1',
  endpoint: 'https://push.example/endpoint-1',
  p256dh: 'p',
  auth: 'a',
  publicKey: 'pk',
};

function wire(id: string, trigger: unknown = { type: 'session_start' }): unknown {
  return {
    id,
    format: 'center',
    title: `title ${id}`,
    body: 'body',
    trigger,
    buttons: [{ id: 'b1', label: 'Go', action: { type: 'url', value: 'https://x.example' } }],
  };
}

const onEvent = (name: string) => wire(`ev-${name}`, { type: 'event', name });

/** A view that records what the session asked and lets the test act as the visitor. */
class FakeView implements InAppView {
  shown: string[] = [];
  closed = 0;
  handlers: ViewHandlers | undefined;
  /** Message ids `show` answers false for, as an image that did not load. */
  failing = new Set<string>();
  gate: Promise<void> | undefined;
  readonly log: string[];

  constructor(log: string[] = []) {
    this.log = log;
  }

  async show(message: InAppMessage, handlers: ViewHandlers): Promise<boolean> {
    if (this.gate) await this.gate;
    if (this.failing.has(message.id)) return false;
    this.shown.push(message.id);
    this.handlers = handlers;
    return true;
  }

  close(): void {
    this.closed++;
    this.log.push('close');
  }
}

interface Setup {
  view: FakeView;
  clicks: InAppClick[];
  warnings: string[];
  requests: RecordedRequest[];
  sleeps: number[];
  session: ReturnType<typeof createInAppSession>;
  start: () => Promise<void>;
}

function setup(
  respond: (req: RecordedRequest) => Response | Promise<Response>,
  options: { device?: StoredDevice | null; log?: string[] } = {}
): Setup {
  const fake = fakeRuntime(respond);
  const stored = options.device === undefined ? device : options.device;
  if (stored) void fake.store.set(DEVICE_KEY, stored);
  const view = new FakeView(options.log);
  const clicks: InAppClick[] = [];
  const warnings: string[] = [];
  let n = 0;
  const session = createInAppSession({
    view,
    onClick: (click) => {
      options.log?.push('listener');
      clicks.push(click);
    },
    warn: (message) => warnings.push(message),
    newEventId: () => `evt-${++n}`,
  });
  return {
    view,
    clicks,
    warnings,
    requests: fake.requests,
    sleeps: fake.sleeps,
    session,
    start: () => session.start(state, fake.runtime),
  };
}

const eligible = (...messages: unknown[]) => () => jsonResponse(200, { messages });

const eventsOf = (requests: RecordedRequest[]) =>
  requests.filter((r) => r.url.endsWith('/events'));

/** The microtask queue drained, so fire-and-forget reports have been sent. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('one fetch per page load (WIAM-04)', () => {
  it('makes no request when no device is stored', async () => {
    const s = setup(eligible(wire('m1')), { device: null });
    await s.start();
    expect(s.requests).toHaveLength(0);
    expect(s.view.shown).toEqual([]);
  });

  it('makes no request for a device of another App', async () => {
    const s = setup(eligible(wire('m1')), { device: { ...device, appId: 'other' } });
    await s.start();
    expect(s.requests).toHaveLength(0);
  });

  it('calls eligible once with the device id and the push endpoint as token', async () => {
    const s = setup(eligible());
    await s.start();
    await s.start();
    expect(s.requests).toHaveLength(1);
    expect(s.requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://notti.example/v1/apps/app-1/in-app-messages/eligible',
      body: { device_id: 'dev-1', token: 'https://push.example/endpoint-1' },
    });
    expect(s.requests[0]?.headers['Authorization']).toBe('Bearer ck_test');
  });
});

describe('session start message (WIAM-05)', () => {
  it('shows only the first session-start message and reports one impression', async () => {
    const s = setup(eligible(wire('m1'), wire('m2'), onEvent('buy')));
    await s.start();
    await settle();

    expect(s.view.shown).toEqual(['m1']);
    const events = eventsOf(s.requests);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      url: 'https://notti.example/v1/apps/app-1/in-app-messages/m1/events',
      body: {
        device_id: 'dev-1',
        token: 'https://push.example/endpoint-1',
        event_id: 'evt-1',
        type: 'impression',
      },
    });
    expect(typeof (events[0]?.body as { occurred_at: string }).occurred_at).toBe('string');
  });

  it('falls through to the next message when the first cannot be shown, without an impression for it', async () => {
    const s = setup(eligible(wire('m1'), wire('m2')));
    s.view.failing.add('m1');
    await s.start();
    await settle();

    expect(s.view.shown).toEqual(['m2']);
    const events = eventsOf(s.requests);
    expect(events.map((e) => e.url)).toEqual([
      'https://notti.example/v1/apps/app-1/in-app-messages/m2/events',
    ]);
  });

  it('shows nothing and reports nothing when no message can be shown', async () => {
    const s = setup(eligible(wire('m1')));
    s.view.failing.add('m1');
    await s.start();
    await settle();
    expect(eventsOf(s.requests)).toHaveLength(0);
  });

  it('ignores the unknown fields and messages the parser drops', async () => {
    const s = setup(eligible({ id: 'bad' }, wire('m1')));
    await s.start();
    expect(s.view.shown).toEqual(['m1']);
  });
});

describe('click and dismiss (WIAM-06)', () => {
  it('reports the click, closes, then calls the listener', async () => {
    const log: string[] = [];
    const s = setup(
      (req) => {
        log.push(`request:${(req.body as { type: string }).type ?? 'eligible'}`);
        return req.url.endsWith('/eligible')
          ? jsonResponse(200, { messages: [wire('m1')] })
          : jsonResponse(201, { duplicate: false });
      },
      { log }
    );
    await s.start();
    await settle();
    log.length = 0;

    s.view.handlers?.onClick('b1', { type: 'url', value: 'https://x.example' });
    await settle();

    expect(log).toEqual(['request:click', 'close', 'listener']);
    expect(s.clicks).toEqual([
      {
        messageId: 'm1',
        buttonId: 'b1',
        action: { type: 'url', value: 'https://x.example' },
      },
    ]);
    const click = eventsOf(s.requests).at(-1);
    expect(click?.body).toMatchObject({ type: 'click', button_id: 'b1' });
  });

  it('calls the listener even when the click report fails', async () => {
    const s = setup((req) =>
      req.url.endsWith('/eligible')
        ? jsonResponse(200, { messages: [wire('m1')] })
        : jsonResponse(422, { error: { code: 'invalid_body' } })
    );
    await s.start();
    await settle();

    s.view.handlers?.onClick('b1', { type: 'url', value: 'https://x.example' });
    await settle();

    expect(s.clicks).toHaveLength(1);
  });

  it('survives a listener that throws', async () => {
    const fake = fakeRuntime((req) =>
      req.url.endsWith('/eligible')
        ? jsonResponse(200, { messages: [wire('m1')] })
        : jsonResponse(201, {})
    );
    await fake.store.set(DEVICE_KEY, device);
    const view = new FakeView();
    const session = createInAppSession({
      view,
      onClick: () => {
        throw new Error('integrator bug');
      },
    });
    await session.start(state, fake.runtime);
    expect(() =>
      view.handlers?.onClick('b1', { type: 'url', value: 'https://x.example' })
    ).not.toThrow();
  });

  it.each<DismissReason>(['close_button', 'outside_tap', 'auto'])(
    'reports a %s dismiss and closes',
    async (reason) => {
      const s = setup(eligible(wire('m1')));
      await s.start();
      await settle();

      s.view.handlers?.onDismiss(reason);
      await settle();

      expect(s.view.closed).toBe(1);
      expect(eventsOf(s.requests).at(-1)?.body).toMatchObject({ type: 'dismiss', reason });
      expect(s.clicks).toEqual([]);
    }
  );

  it('sends the click at once, without waiting for a slow impression', async () => {
    let releaseImpression: (() => void) | undefined;
    const started: string[] = [];
    const s = setup(async (req) => {
      if (req.url.endsWith('/eligible')) return jsonResponse(200, { messages: [wire('m1')] });
      const type = (req.body as { type: string }).type;
      started.push(type);
      if (type === 'impression') {
        await new Promise<void>((resolve) => (releaseImpression = resolve));
      }
      return jsonResponse(201, {});
    });
    await s.start();
    await settle();
    expect(started).toEqual(['impression']);

    s.view.handlers?.onClick('b1', { type: 'url', value: 'https://x.example' });
    await settle();
    // The impression is still in flight and the click is already on its way.
    expect(started).toEqual(['impression', 'click']);

    releaseImpression?.();
    await settle();
  });

  it('sends the dismiss at once, without waiting for a slow impression', async () => {
    const started: string[] = [];
    const s = setup(async (req) => {
      if (req.url.endsWith('/eligible')) return jsonResponse(200, { messages: [wire('m1')] });
      const type = (req.body as { type: string }).type;
      started.push(type);
      if (type === 'impression') await new Promise<void>(() => undefined);
      return jsonResponse(201, {});
    });
    await s.start();
    await settle();

    s.view.handlers?.onDismiss('close_button');
    await settle();
    expect(started).toEqual(['impression', 'dismiss']);
  });

  it('counts one interaction per display: a second click or dismiss is ignored', async () => {
    const s = setup(eligible(wire('m1')));
    await s.start();
    await settle();

    const handlers = s.view.handlers;
    handlers?.onClick('b1', { type: 'url', value: 'https://x.example' });
    handlers?.onClick('b1', { type: 'url', value: 'https://x.example' });
    handlers?.onDismiss('close_button');
    await settle();

    expect(s.clicks).toHaveLength(1);
    expect(eventsOf(s.requests).map((e) => (e.body as { type: string }).type)).toEqual([
      'impression',
      'click',
    ]);
  });

  it('retries a failed event with the same event_id and then drops it', async () => {
    let calls = 0;
    const s = setup((req) => {
      if (req.url.endsWith('/eligible')) return jsonResponse(200, { messages: [wire('m1')] });
      calls++;
      return jsonResponse(503, { error: { code: 'unavailable' } });
    });
    await s.start();
    await settle();
    await settle();

    expect(calls).toBe(3);
    const ids = new Set(eventsOf(s.requests).map((e) => (e.body as { event_id: string }).event_id));
    expect(ids.size).toBe(1);
  });

  it('sends events with keepalive so a navigation does not cancel them', async () => {
    const seen: Array<boolean | undefined> = [];
    const fake = fakeRuntime((req) =>
      req.url.endsWith('/eligible')
        ? jsonResponse(200, { messages: [wire('m1')] })
        : jsonResponse(201, {})
    );
    const inner = fake.runtime.fetch;
    fake.runtime.fetch = (input, init) => {
      if (String(input).endsWith('/events')) seen.push(init?.keepalive);
      return inner(input, init);
    };
    await fake.store.set(DEVICE_KEY, device);
    const session = createInAppSession({ view: new FakeView(), onClick: () => undefined });
    await session.start(state, fake.runtime);
    await settle();
    expect(seen).toEqual([true]);
  });
});

describe('trackEvent (WIAM-07)', () => {
  it('shows the oldest held message of that event, once', async () => {
    const s = setup(
      eligible(
        wire('start'),
        wire('buy-1', { type: 'event', name: 'buy' }),
        wire('buy-2', { type: 'event', name: 'buy' })
      )
    );
    await s.start();
    s.view.handlers?.onDismiss('close_button');

    s.session.trackEvent('buy');
    await settle();
    expect(s.view.shown).toEqual(['start', 'buy-1']);

    s.view.handlers?.onDismiss('close_button');
    s.session.trackEvent('buy');
    await settle();
    expect(s.view.shown).toEqual(['start', 'buy-1', 'buy-2']);

    s.view.handlers?.onDismiss('close_button');
    s.session.trackEvent('buy');
    await settle();
    expect(s.view.shown).toHaveLength(3);
  });

  it('matches the name exactly and never sends it to the server', async () => {
    const s = setup(eligible(wire('buy', { type: 'event', name: 'checkout_done' })));
    await s.start();
    const before = s.requests.length;

    s.session.trackEvent('Checkout_Done');
    s.session.trackEvent('checkout');
    await settle();
    expect(s.view.shown).toEqual([]);

    s.session.trackEvent('checkout_done');
    await settle();
    expect(s.view.shown).toEqual(['buy']);
    expect(s.requests.slice(before).every((r) => r.url.endsWith('/events'))).toBe(true);
  });

  it('shows nothing while another message is visible, and the event is not kept', async () => {
    const s = setup(eligible(wire('start'), wire('buy', { type: 'event', name: 'buy' })));
    await s.start();

    s.session.trackEvent('buy');
    await settle();
    expect(s.view.shown).toEqual(['start']);

    s.view.handlers?.onDismiss('close_button');
    await settle();
    expect(s.view.shown).toEqual(['start']);
  });

  it('remembers names tracked before eligible answers and replays them in order', async () => {
    let release: (() => void) | undefined;
    const s = setup(async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return jsonResponse(200, {
        messages: [wire('a', { type: 'event', name: 'a' }), wire('b', { type: 'event', name: 'b' })],
      });
    });
    const started = s.start();
    await settle();

    s.session.trackEvent('b');
    release?.();
    await started;
    await settle();

    expect(s.view.shown).toEqual(['b']);
  });

  it('remembers names tracked before start() is called at all', async () => {
    const s = setup(eligible(wire('a', { type: 'event', name: 'a' })));
    s.session.trackEvent('a');
    await s.start();
    await settle();
    expect(s.view.shown).toEqual(['a']);
  });

  it('keeps at most 32 names; the 33rd is dropped', async () => {
    const s = setup(eligible(wire('late', { type: 'event', name: 'n32' })));
    for (let i = 0; i < 33; i++) s.session.trackEvent(`n${i}`);
    await s.start();
    await settle();
    expect(s.view.shown).toEqual([]);

    const t = setup(eligible(wire('last', { type: 'event', name: 'n31' })));
    for (let i = 0; i < 33; i++) t.session.trackEvent(`n${i}`);
    await t.start();
    await settle();
    expect(t.view.shown).toEqual(['last']);
  });

  it('ignores an empty or non-string name', async () => {
    const s = setup(eligible(wire('a', { type: 'event', name: '' })));
    await s.start();
    s.session.trackEvent('');
    s.session.trackEvent(undefined as unknown as string);
    await settle();
    expect(s.view.shown).toEqual([]);
  });

  it('shows one message per call even when two are triggered at the same time', async () => {
    let open: (() => void) | undefined;
    const s = setup(
      eligible(
        wire('x1', { type: 'event', name: 'x' }),
        wire('y1', { type: 'event', name: 'y' })
      )
    );
    await s.start();
    s.view.gate = new Promise<void>((resolve) => (open = resolve));

    s.session.trackEvent('x');
    s.session.trackEvent('y');
    open?.();
    await settle();

    expect(s.view.shown).toEqual(['x1']);
  });

  it('does nothing when there is no device', async () => {
    const s = setup(eligible(wire('a', { type: 'event', name: 'a' })), { device: null });
    await s.start();
    s.session.trackEvent('a');
    await settle();
    expect(s.requests).toHaveLength(0);
    expect(s.view.shown).toEqual([]);
  });
});

describe('errors and rate limits (WIAM-09)', () => {
  const failing = (status: number, headers: Record<string, string> = {}) => () =>
    new Response(JSON.stringify({ error: { code: 'x' } }), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });

  it('stops all In-App work on 401, silently', async () => {
    const s = setup(failing(401));
    await s.start();
    s.session.trackEvent('a');
    await settle();
    expect(s.requests).toHaveLength(1);
    expect(s.warnings).toEqual([]);
    expect(s.view.shown).toEqual([]);
  });

  it('stops on 403 and logs one warning that carries no identifier', async () => {
    const s = setup(failing(403));
    await s.start();
    expect(s.requests).toHaveLength(1);
    expect(s.warnings).toHaveLength(1);
    const warning = s.warnings[0] ?? '';
    expect(warning).not.toContain('dev-1');
    expect(warning).not.toContain('push.example');
    expect(warning).not.toContain('ck_test');
    expect(warning).not.toContain('app-1');
  });

  describe('an answer from /events that says the server does not accept this browser', () => {
    const eventsFail = (status: number) => (req: RecordedRequest) =>
      req.url.endsWith('/eligible')
        ? jsonResponse(200, { messages: [wire('m1'), onEvent('buy')] })
        : failing(status)();

    it.each([401, 403])('stops the session on a %i, so later events and messages stay quiet', async (status) => {
      const s = setup(eventsFail(status));
      await s.start();
      await settle();
      expect(s.view.shown).toEqual(['m1']);
      expect(eventsOf(s.requests)).toHaveLength(1);

      s.session.trackEvent('buy');
      await settle();

      expect(s.view.shown).toEqual(['m1']);
      expect(eventsOf(s.requests)).toHaveLength(1);
      expect(s.view.closed).toBeGreaterThan(0);
    });

    it('does not stop for an error it could not fix by stopping (422, 503)', async () => {
      for (const status of [422, 503]) {
        const s = setup(eventsFail(status));
        await s.start();
        await settle();
        s.view.handlers?.onDismiss('close_button');
        await settle();
        s.session.trackEvent('buy');
        await settle();
        expect(s.view.shown, String(status)).toEqual(['m1', 'ev-buy']);
      }
    });
  });

  it.each([
    ['422', 422],
    ['404', 404],
    ['500', 500],
    ['503', 503],
  ])('gives up quietly on %s', async (_label, status) => {
    const s = setup(failing(status));
    await s.start();
    expect(s.requests).toHaveLength(1);
    expect(s.warnings).toEqual([]);
  });

  it('gives up quietly on a network failure', async () => {
    const s = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    await s.start();
    expect(s.requests).toHaveLength(1);
    expect(s.warnings).toEqual([]);
  });

  it('waits Retry-After seconds on a 429 and then shows the message', async () => {
    let calls = 0;
    const s = setup(() => {
      calls++;
      return calls === 1
        ? failing(429, { 'Retry-After': '7' })()
        : jsonResponse(200, { messages: [wire('m1')] });
    });
    await s.start();
    expect(s.sleeps).toEqual([7000]);
    expect(s.view.shown).toEqual(['m1']);
  });

  it.each([
    ['0 up to 1', '0', 1000],
    ['1000 down to 300', '1000', 300_000],
  ])('clamps Retry-After (%s)', async (_label, header, expectedMs) => {
    let calls = 0;
    const s = setup(() => {
      calls++;
      return calls === 1 ? failing(429, { 'Retry-After': header })() : jsonResponse(200, { messages: [] });
    });
    await s.start();
    expect(s.sleeps).toEqual([expectedMs]);
  });

  it('waits 60 seconds when a 429 has no usable Retry-After', async () => {
    let calls = 0;
    const s = setup(() => {
      calls++;
      return calls === 1 ? failing(429)() : jsonResponse(200, { messages: [] });
    });
    await s.start();
    expect(s.sleeps).toEqual([60_000]);
  });

  it('gives up after three waits', async () => {
    const s = setup(failing(429, { 'Retry-After': '2' }));
    await s.start();
    expect(s.sleeps).toEqual([2000, 2000, 2000]);
    expect(s.requests).toHaveLength(4);
    expect(s.view.shown).toEqual([]);
  });

  it('discards a late response after stop()', async () => {
    let release: (() => void) | undefined;
    const s = setup(async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return jsonResponse(200, { messages: [wire('m1')] });
    });
    const started = s.start();
    await settle();

    s.session.stop();
    release?.();
    await started;
    await settle();

    expect(s.view.shown).toEqual([]);
    expect(eventsOf(s.requests)).toHaveLength(0);
  });

  it('discards a message whose view finishes after stop()', async () => {
    let open: (() => void) | undefined;
    const s = setup(eligible(wire('m1')));
    s.view.gate = new Promise<void>((resolve) => (open = resolve));
    const started = s.start();
    await settle();

    s.session.stop();
    open?.();
    await started;
    await settle();

    expect(eventsOf(s.requests)).toHaveLength(0);
    expect(s.view.closed).toBeGreaterThan(0);
  });

  it('closes the visible message on stop() without reporting a dismiss', async () => {
    const s = setup(eligible(wire('m1')));
    await s.start();
    await settle();
    const before = s.requests.length;

    s.session.stop();
    await settle();

    expect(s.view.closed).toBe(1);
    expect(s.requests).toHaveLength(before);
  });

  it('never throws out of start() when the store fails', async () => {
    const fake = fakeRuntime(eligible());
    fake.runtime.store = {
      get: () => Promise.reject(new Error('idb down')),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    const session = createInAppSession({ view: new FakeView(), onClick: vi.fn() });
    await expect(session.start(state, fake.runtime)).resolves.toBeUndefined();
    expect(fake.requests).toHaveLength(0);
  });
});

describe('a 403 from eligible is remembered for a day', () => {
  const denied = () =>
    new Response(JSON.stringify({ error: { code: 'forbidden' } }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  const DAY = 24 * 60 * 60 * 1000;

  /** One page load on a runtime that keeps its store between loads. */
  function pageLoad(fake: ReturnType<typeof fakeRuntime>) {
    const warnings: string[] = [];
    const view = new FakeView();
    const session = createInAppSession({ view, onClick: vi.fn(), warn: (m) => warnings.push(m) });
    return { warnings, view, start: () => session.start(state, fake.runtime) };
  }

  function sharedRuntime(respond: (req: RecordedRequest) => Response, deviceOverride = device) {
    const fake = fakeRuntime(respond);
    let now = Date.UTC(2026, 10, 13, 10, 0, 0);
    fake.runtime.now = () => now;
    void fake.store.set(DEVICE_KEY, deviceOverride);
    return { fake, advance: (ms: number) => (now += ms) };
  }

  it('logs once and does not ask again on the next page loads of the day', async () => {
    const { fake, advance } = sharedRuntime(() => denied());

    const first = pageLoad(fake);
    await first.start();
    expect(first.warnings).toHaveLength(1);
    expect(fake.requests).toHaveLength(1);

    advance(60 * 60 * 1000);
    const second = pageLoad(fake);
    await second.start();
    expect(second.warnings).toEqual([]);
    expect(fake.requests).toHaveLength(1);
    expect(second.view.shown).toEqual([]);
  });

  it('asks again after a day', async () => {
    const { fake, advance } = sharedRuntime(() => denied());
    await pageLoad(fake).start();

    advance(DAY);
    const later = pageLoad(fake);
    await later.start();
    expect(fake.requests).toHaveLength(2);
    expect(later.warnings).toHaveLength(1);
  });

  it('forgets the denial once the server accepts the browser again', async () => {
    let accept = false;
    const { fake, advance } = sharedRuntime(() =>
      accept ? jsonResponse(200, { messages: [wire('m1')] }) : denied()
    );
    await pageLoad(fake).start();

    advance(DAY);
    accept = true;
    const ok = pageLoad(fake);
    await ok.start();
    expect(ok.view.shown).toEqual(['m1']);
    expect(await fake.store.get('inapp-denied')).toBeUndefined();
  });

  it('does not apply a denial of another device', async () => {
    const { fake } = sharedRuntime(() => denied());
    await pageLoad(fake).start();
    await fake.store.set(DEVICE_KEY, { ...device, id: 'dev-2' });

    await pageLoad(fake).start();
    expect(fake.requests).toHaveLength(2);
  });

  it('does not remember an answer other than 403', async () => {
    const { fake } = sharedRuntime(() => jsonResponse(503, {}));
    await pageLoad(fake).start();
    await pageLoad(fake).start();
    expect(fake.requests).toHaveLength(2);
  });

  it('still logs and stops when the store cannot keep the memory', async () => {
    const { fake } = sharedRuntime(() => denied());
    const real = fake.store;
    fake.runtime.store = { ...real, set: (key, value) => (key === 'inapp-denied' ? Promise.reject(new Error('quota')) : real.set(key, value)) };
    const load = pageLoad(fake);
    await load.start();
    expect(load.warnings).toHaveLength(1);
    expect(load.view.shown).toEqual([]);
  });
});

