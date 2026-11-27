import { beforeEach, describe, expect, it } from 'vitest';
import type { BrowserEnv } from '../src/capabilities';
import { init } from '../src/init';
import { setState } from '../src/runtime';
import { requestPermission } from '../src/subscribe';
import { DEVICE_KEY, memoryStore } from '../src/store';
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
const FULL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function server(patchStatus = () => 200) {
  return (req: RecordedRequest): Response => {
    const key = `${req.method} ${new URL(req.url).pathname}`;
    if (key === 'GET /v1/apps/app_1/web-push/config') {
      return jsonResponse(200, { public_key: PUBLIC_KEY });
    }
    if (key === 'POST /v1/apps/app_1/devices') {
      return jsonResponse(201, { id: 'dev_1' });
    }
    if (key === 'PATCH /v1/apps/app_1/devices/dev_1') {
      return jsonResponse(patchStatus(), { id: 'dev_1' });
    }
    return jsonResponse(404, {});
  };
}

interface Profile {
  platformVersion?: string;
  language?: string;
  timeZone?: string;
}

/** The browser env of Chrome on a Mac, with `profile` as what it reports. */
function chromeEnv(base: BrowserEnv, profile: Profile): BrowserEnv {
  return {
    ...base,
    navigator: {
      ...base.navigator,
      userAgent: FULL_UA,
      language: profile.language,
      userAgentData: {
        platform: 'macOS',
        getHighEntropyValues: async () => ({
          platformVersion: profile.platformVersion,
        }),
      },
    },
    Intl: {
      DateTimeFormat: () => ({
        resolvedOptions: () => ({ timeZone: profile.timeZone }),
      }),
    },
  };
}

const patches = (requests: RecordedRequest[]) =>
  requests.filter((r) => r.method === 'PATCH');

const SAO_PAULO: Profile = {
  platformVersion: '15.1.0',
  language: 'pt-BR',
  timeZone: 'America/Sao_Paulo',
};

beforeEach(() => setState(null));

function session(profile: Profile, respond = server(), store = memoryStore()) {
  const browser = fakeBrowser({ created: fakeSubscription(ENDPOINT) });
  browser.env = chromeEnv(browser.env, profile);
  return { browser, ...fakeRuntime(respond, browser.env, store) };
}

/** A later page load: same browser and store, possibly another profile. */
function reload(
  first: ReturnType<typeof session>,
  profile: Profile,
  respond = server()
) {
  setState(null);
  return fakeRuntime(
    respond,
    chromeEnv(first.browser.env, profile),
    first.store
  );
}

describe('device_os, language and timezone_id', () => {
  it('go in the PATCH after registration, and nowhere else', async () => {
    const s = session(SAO_PAULO);
    await init(opts, s.runtime);
    await requestPermission(s.runtime);

    const post = s.requests.find((r) => r.method === 'POST');
    expect(post?.body).not.toHaveProperty('device_os');
    expect(patches(s.requests)).toHaveLength(1);
    expect(patches(s.requests)[0]?.body).toEqual({
      token: ENDPOINT,
      sdk_name: 'web',
      sdk_version: expect.any(String),
      permission_status: 'granted',
      device_os: 'macOS 15',
      language: 'pt',
      timezone_id: 'America/Sao_Paulo',
    });
  });

  it('never put the full User-Agent on the wire', async () => {
    const s = session(SAO_PAULO);
    await init(opts, s.runtime);
    await requestPermission(s.runtime);
    for (const req of s.requests) {
      expect(req.raw ?? '').not.toContain('Mozilla');
      expect(req.raw ?? '').not.toContain('AppleWebKit');
      expect(req.raw ?? '').not.toContain('10_15_7');
    }
  });

  it('are left out when the browser cannot tell them', async () => {
    const s = session({});
    await init(opts, s.runtime);
    await requestPermission(s.runtime);
    const body = patches(s.requests)[0]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('language');
    expect(body).not.toHaveProperty('timezone_id');
    expect(body.device_os).toBe('macOS');
  });

  it('are sent again, once, when they change, and not when they do not', async () => {
    const first = session(SAO_PAULO);
    await init(opts, first.runtime);
    await requestPermission(first.runtime);

    const same = reload(first, SAO_PAULO);
    await init(opts, same.runtime);
    expect(patches(same.requests)).toHaveLength(0);

    const moved = {
      ...SAO_PAULO,
      platformVersion: '16.0.0',
      language: 'en-US',
    };
    const changed = reload(first, moved);
    await init(opts, changed.runtime);
    expect(patches(changed.requests)).toHaveLength(1);
    expect(patches(changed.requests)[0]?.body).toMatchObject({
      device_os: 'macOS 16',
      language: 'en',
      timezone_id: 'America/Sao_Paulo',
    });

    const again = reload(first, moved);
    await init(opts, again.runtime);
    expect(patches(again.requests)).toHaveLength(0);
  });

  it('reach a browser registered before they existed, once', async () => {
    const first = session({});
    await init(opts, first.runtime);
    await requestPermission(first.runtime);
    const stored = await first.store.get<Record<string, unknown>>(DEVICE_KEY);
    await first.store.set(DEVICE_KEY, { ...stored, reported: undefined });

    const upgraded = reload(first, SAO_PAULO);
    await init(opts, upgraded.runtime);
    expect(patches(upgraded.requests)).toHaveLength(1);
    expect(patches(upgraded.requests)[0]?.body).toMatchObject({
      language: 'pt',
    });
  });

  it('a failed PATCH does not fail init or the registration, and is repeated next init', async () => {
    const first = session(
      SAO_PAULO,
      server(() => 500)
    );
    const initResult = await init(opts, first.runtime);
    const result = await requestPermission(first.runtime);
    expect(initResult).toEqual({ supported: true });
    expect(result).toMatchObject({ registered: true, deviceId: 'dev_1' });
    expect(await first.store.get(DEVICE_KEY)).toMatchObject({
      sdkSynced: false,
    });

    const next = reload(first, SAO_PAULO);
    await init(opts, next.runtime);
    expect(patches(next.requests)).toHaveLength(1);
    expect(patches(next.requests)[0]?.body).toMatchObject({
      device_os: 'macOS 15',
    });
  });

  it('a throwing collector does not break init or the registration', async () => {
    const s = session(SAO_PAULO);
    const nav = s.runtime.env.navigator!;
    Object.defineProperty(nav, 'language', {
      get() {
        throw new Error('boom');
      },
    });
    nav.userAgentData!.getHighEntropyValues = () => {
      throw new Error('boom');
    };
    expect(await init(opts, s.runtime)).toEqual({ supported: true });
    const result = await requestPermission(s.runtime);
    expect(result).toMatchObject({ registered: true });
    expect(patches(s.requests)[0]?.body).toMatchObject({
      sdk_name: 'web',
      timezone_id: 'America/Sao_Paulo',
    });
  });
});
