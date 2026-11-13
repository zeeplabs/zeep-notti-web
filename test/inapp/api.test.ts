import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '../../src/api';
import { newEventId, reportInAppEvent } from '../../src/inapp/api';
import type { StoredDevice } from '../../src/store';
import { fakeRuntime, jsonResponse } from '../helpers';

const config: ApiConfig = { appId: 'app-1', clientKey: 'ck_test', host: 'https://notti.example' };
const device: StoredDevice = {
  id: 'dev-1',
  appId: 'app-1',
  endpoint: 'https://push.example/e',
  p256dh: 'p',
  auth: 'a',
  publicKey: 'pk',
};
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe('newEventId', () => {
  it('returns a UUID v4', () => {
    expect(newEventId()).toMatch(UUID_V4);
  });

  it('falls back to getRandomValues where randomUUID is missing (insecure context)', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0xab),
    });
    expect(newEventId()).toMatch(UUID_V4);
  });

  it('falls back to Math.random when there is no crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newEventId()).toMatch(UUID_V4);
  });

  it('does not repeat', () => {
    expect(newEventId()).not.toBe(newEventId());
  });
});

describe('reportInAppEvent', () => {
  it('sends only the fields the type allows, with the moment it happened', async () => {
    const fake = fakeRuntime(() => jsonResponse(201, { duplicate: false }));
    const occurredAt = Date.UTC(2026, 10, 12, 20, 0, 0);

    await reportInAppEvent(fake.runtime, config, device, 'm 1', {
      eventId: 'e1',
      type: 'dismiss',
      reason: 'auto',
      occurredAt,
    });

    expect(fake.requests[0]?.url).toBe('https://notti.example/v1/apps/app-1/in-app-messages/m%201/events');
    expect(fake.requests[0]?.body).toEqual({
      device_id: 'dev-1',
      token: 'https://push.example/e',
      event_id: 'e1',
      type: 'dismiss',
      reason: 'auto',
      occurred_at: '2026-11-12T20:00:00.000Z',
    });
  });

  it('does not retry a terminal 4xx', async () => {
    const fake = fakeRuntime(() => jsonResponse(422, { error: { code: 'invalid_body' } }));
    await expect(
      reportInAppEvent(fake.runtime, config, device, 'm1', { eventId: 'e', type: 'impression', occurredAt: 0 })
    ).rejects.toMatchObject({ status: 422 });
    expect(fake.requests).toHaveLength(1);
  });

  describe('keepalive', () => {
    const event = { eventId: 'e1', type: 'impression' as const, occurredAt: 0 };

    /** A fetch that records `keepalive` and refuses it the way a browser does for a preflighted request. */
    function refusingKeepalive(refuse: boolean) {
      const sent: Array<boolean | undefined> = [];
      const fake = fakeRuntime(() => jsonResponse(201, { duplicate: false }));
      fake.runtime.fetch = (_input, init) => {
        sent.push(init?.keepalive);
        if (refuse && init?.keepalive) return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve(jsonResponse(201, { duplicate: false }));
      };
      return { fake, sent };
    }

    it('asks for keepalive first', async () => {
      const { fake, sent } = refusingKeepalive(false);
      await reportInAppEvent(fake.runtime, config, device, 'm1', event);
      expect(sent).toEqual([true]);
    });

    it('repeats once without keepalive when the browser refuses it, without waiting', async () => {
      const { fake, sent } = refusingKeepalive(true);
      await reportInAppEvent(fake.runtime, config, device, 'm1', event);
      expect(sent).toEqual([true, undefined]);
      expect(fake.sleeps).toEqual([]);
    });

    it('keeps the same event_id on the repeat', async () => {
      const bodies: unknown[] = [];
      const fake = fakeRuntime(() => jsonResponse(201, {}));
      fake.runtime.fetch = (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return init?.keepalive
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve(jsonResponse(201, {}));
      };
      await reportInAppEvent(fake.runtime, config, device, 'm1', event);
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toEqual(bodies[0]);
    });

    it('does not turn keepalive off for an answer from the server', async () => {
      const sent: Array<boolean | undefined> = [];
      const fake = fakeRuntime(() => jsonResponse(503, {}));
      fake.runtime.fetch = (_input, init) => {
        sent.push(init?.keepalive);
        return Promise.resolve(jsonResponse(503, {}));
      };
      await expect(reportInAppEvent(fake.runtime, config, device, 'm1', event)).rejects.toMatchObject({
        status: 503,
      });
      expect(sent).toEqual([true, true, true]);
    });

    it('still gives up when the network is really down', async () => {
      const fake = fakeRuntime(() => jsonResponse(201, {}));
      let calls = 0;
      fake.runtime.fetch = () => {
        calls++;
        return Promise.reject(new TypeError('Failed to fetch'));
      };
      await expect(reportInAppEvent(fake.runtime, config, device, 'm1', event)).rejects.toThrow(TypeError);
      // 3 attempts; the first one also tried again without keepalive.
      expect(calls).toBe(4);
    });
  });
});
