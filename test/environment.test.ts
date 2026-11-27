import { describe, expect, it, vi } from 'vitest';
import type { BrowserEnv } from '../src/capabilities';
import {
  collectEnvironment,
  environmentChanged,
  keepKnownVersion,
} from '../src/environment';

type Nav = NonNullable<BrowserEnv['navigator']>;

function env(nav: Nav | undefined, timeZone?: string): BrowserEnv {
  return {
    navigator: nav,
    ...(timeZone === undefined
      ? {}
      : {
          Intl: {
            DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }),
          },
        }),
  };
}

/** A browser with userAgentData: `platform` and, if allowed, `platformVersion`. */
function withHints(
  userAgent: string,
  platform: string,
  platformVersion: string | undefined,
  language = 'pt-BR'
): Nav {
  return {
    userAgent,
    language,
    userAgentData: {
      platform,
      getHighEntropyValues: async () =>
        platformVersion === undefined ? {} : { platformVersion },
    },
  };
}

const UA = {
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  edgeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  firefoxMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
  chromeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  edgeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  firefoxWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  // Chrome freezes the Android version in its UA at 10.
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  firefoxAndroid:
    'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1',
  chromeLinux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  firefoxLinux:
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
};

describe('collectEnvironment: userAgentData present (Chrome, Edge)', () => {
  const cases: [string, Nav, string][] = [
    ['Chrome on macOS', withHints(UA.chromeMac, 'macOS', '15.1.0'), 'macOS 15'],
    ['Edge on macOS', withHints(UA.edgeMac, 'macOS', '14.7.1'), 'macOS 14'],
    [
      'Chrome on Windows 11',
      withHints(UA.chromeWin, 'Windows', '15.0.0'),
      'Windows 11',
    ],
    [
      'Edge on Windows 11',
      withHints(UA.edgeWin, 'Windows', '13.0.0'),
      'Windows 11',
    ],
    [
      'Chrome on Windows 10',
      withHints(UA.chromeWin, 'Windows', '10.0.0'),
      'Windows 10',
    ],
    [
      'Chrome on Android',
      withHints(UA.chromeAndroid, 'Android', '14.0.0'),
      'Android 14',
    ],
    ['Chrome on Linux', withHints(UA.chromeLinux, 'Linux', '6.8.0'), 'Linux'],
    [
      'Chrome on ChromeOS',
      withHints(UA.chromeLinux, 'Chrome OS', '16093.0.0'),
      'ChromeOS',
    ],
  ];
  it.each(cases)('%s', async (_name, nav, expected) => {
    expect((await collectEnvironment(env(nav))).device_os).toBe(expected);
  });

  it('sends only the family when the version hint is denied', async () => {
    const nav = withHints(UA.chromeMac, 'macOS', undefined);
    expect((await collectEnvironment(env(nav))).device_os).toBe('macOS');
  });

  it('sends only the family when the hint call rejects', async () => {
    const nav = withHints(UA.chromeAndroid, 'Android', '14.0.0');
    nav.userAgentData!.getHighEntropyValues = () =>
      Promise.reject(new Error('NotAllowedError'));
    // Never the frozen "Android 10" from the UA.
    expect((await collectEnvironment(env(nav))).device_os).toBe('Android');
  });

  it('sends only the family when the hint never answers', async () => {
    vi.useFakeTimers();
    try {
      const nav = withHints(UA.chromeMac, 'macOS', '15.1.0');
      nav.userAgentData!.getHighEntropyValues = () => new Promise(() => {});
      const pending = collectEnvironment(env(nav));
      await vi.advanceTimersByTimeAsync(1500);
      expect((await pending).device_os).toBe('macOS');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends only the family for Windows 8 and older (platformVersion 0.x)', async () => {
    const nav = withHints(UA.chromeWin, 'Windows', '0.3.0');
    expect((await collectEnvironment(env(nav))).device_os).toBe('Windows');
  });

  it('falls back to the User-Agent when the platform is empty', async () => {
    const nav = withHints(UA.chromeLinux, '', undefined);
    expect((await collectEnvironment(env(nav))).device_os).toBe('Linux');
  });
});

describe('collectEnvironment: userAgentData absent (Safari, Firefox)', () => {
  const cases: [string, Nav, string][] = [
    [
      'Safari on macOS',
      {
        userAgent: UA.safariMac,
        platform: 'MacIntel',
        maxTouchPoints: 0,
        language: 'en-US',
      },
      'macOS',
    ],
    [
      'Firefox on macOS',
      { userAgent: UA.firefoxMac, platform: 'MacIntel', language: 'en-US' },
      'macOS',
    ],
    [
      'Firefox on Windows',
      { userAgent: UA.firefoxWin, language: 'en-US' },
      'Windows',
    ],
    [
      'Firefox on Android',
      { userAgent: UA.firefoxAndroid, language: 'es-MX' },
      'Android 14',
    ],
    [
      'Safari on iPhone',
      { userAgent: UA.safariIphone, language: 'pt-BR' },
      'iOS 18',
    ],
    [
      'Chrome on iPhone',
      { userAgent: UA.chromeIphone, language: 'pt-BR' },
      'iOS 18',
    ],
    [
      'Safari on iPadOS (Mac UA, touch)',
      { userAgent: UA.safariMac, platform: 'MacIntel', maxTouchPoints: 5 },
      'iOS',
    ],
    [
      'Firefox on Linux',
      { userAgent: UA.firefoxLinux, language: 'en-US' },
      'Linux',
    ],
    [
      'Chrome on Linux without hints API',
      { userAgent: UA.chromeLinux },
      'Linux',
    ],
  ];
  it.each(cases)('%s', async (_name, nav, expected) => {
    expect((await collectEnvironment(env(nav))).device_os).toBe(expected);
  });

  it('omits device_os for a User-Agent it does not recognise', async () => {
    const result = await collectEnvironment(env({ userAgent: 'Node.js/22' }));
    expect(result).not.toHaveProperty('device_os');
  });

  it('omits device_os for an empty User-Agent', async () => {
    const result = await collectEnvironment(env({ userAgent: '' }));
    expect(result).not.toHaveProperty('device_os');
  });
});

describe('collectEnvironment: language and time zone', () => {
  it.each([
    ['pt-BR', 'pt'],
    ['PT-br', 'pt'],
    ['en', 'en'],
    ['es-419', 'es'],
    ['zh-Hans-CN', 'zh'],
    ['fil', 'fil'],
  ])('language %s is sent as %s', async (tag, expected) => {
    const result = await collectEnvironment(env({ language: tag }));
    expect(result.language).toBe(expected);
  });

  it.each(['', '   ', 'und', 'x', '123', '-BR', 'toolong'])(
    'omits an undetermined language %j',
    async (tag) => {
      const result = await collectEnvironment(env({ language: tag }));
      expect(result).not.toHaveProperty('language');
    }
  );

  it('sends the IANA time zone', async () => {
    const result = await collectEnvironment(env({}, 'America/Sao_Paulo'));
    expect(result.timezone_id).toBe('America/Sao_Paulo');
  });

  it.each(['x'.repeat(129), 'America/Sao Paulo', 'a\nb', '<script>'])(
    'omits a time zone that is not a plausible IANA id %j',
    async (zone) => {
      expect(await collectEnvironment(env({}, zone))).not.toHaveProperty(
        'timezone_id'
      );
    }
  );

  it.each(['Etc/GMT+5', 'America/Argentina/Buenos_Aires', 'UTC'])(
    'keeps the IANA id %s',
    async (zone) => {
      expect((await collectEnvironment(env({}, zone))).timezone_id).toBe(zone);
    }
  );

  it('omits an empty or missing time zone', async () => {
    expect(await collectEnvironment(env({}, ''))).not.toHaveProperty(
      'timezone_id'
    );
    expect(await collectEnvironment(env({}))).not.toHaveProperty('timezone_id');
  });

  it('survives an Intl that throws', async () => {
    const broken: BrowserEnv = {
      navigator: { language: 'pt-BR' },
      Intl: {
        DateTimeFormat: () => {
          throw new Error('boom');
        },
      },
    };
    expect(await collectEnvironment(broken)).toEqual({ language: 'pt' });
  });
});

describe('collectEnvironment: outside a browser', () => {
  it('returns nothing, and does not throw, without navigator (SSR)', async () => {
    expect(await collectEnvironment({})).toEqual({});
    expect(await collectEnvironment({ navigator: undefined })).toEqual({});
  });

  it('works on the real global in Node', async () => {
    const result = await collectEnvironment(
      globalThis as unknown as BrowserEnv
    );
    for (const value of Object.values(result)) {
      expect(typeof value).toBe('string');
      expect(value).not.toBe('');
    }
  });
});

describe('collectEnvironment: minimisation', () => {
  it('only ever returns device_os, language and timezone_id, never the User-Agent', async () => {
    const nav = withHints(UA.chromeMac, 'macOS', '15.1.0');
    const result = await collectEnvironment(env(nav, 'America/Sao_Paulo'));
    expect(result).toEqual({
      device_os: 'macOS 15',
      language: 'pt',
      timezone_id: 'America/Sao_Paulo',
    });
    const json = JSON.stringify(result);
    for (const fragment of [
      'Mozilla',
      'AppleWebKit',
      'Chrome/',
      '10_15_7',
      '15.1',
    ]) {
      expect(json).not.toContain(fragment);
    }
  });

  it('never sends a minor or patch version, for any UA in the matrix', async () => {
    for (const ua of Object.values(UA)) {
      const nav: Nav = {
        userAgent: ua,
        platform: 'MacIntel',
        language: 'en-US',
      };
      const { device_os } = await collectEnvironment(env(nav));
      if (device_os) expect(device_os).toMatch(/^[A-Za-z]+(?: \d{1,3})?$/);
    }
  });
});

describe('iOS 26 keeps the OS in the User-Agent at 18_6', () => {
  const frozen = (tail: string) =>
    `Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ${tail}`;
  it('takes the major from Safari Version/', async () => {
    const nav = {
      userAgent: frozen('Version/26.0 Mobile/15E148 Safari/604.1'),
    };
    expect((await collectEnvironment(env(nav))).device_os).toBe('iOS 26');
  });
  it('sends the family alone for a Home Screen web app (no Version/)', async () => {
    const nav = { userAgent: frozen('Mobile/15E148') };
    expect((await collectEnvironment(env(nav))).device_os).toBe('iOS');
  });
  it('still trusts other 18.x values', async () => {
    const nav = {
      userAgent: frozen('Mobile/15E148').replace('18_6', '18_5'),
    };
    expect((await collectEnvironment(env(nav))).device_os).toBe('iOS 18');
  });
});

describe('keepKnownVersion', () => {
  it('drops a bare family that the reported version already covers', () => {
    expect(
      keepKnownVersion(
        { device_os: 'macOS 15' },
        { device_os: 'macOS', language: 'pt' }
      )
    ).toEqual({ language: 'pt' });
  });
  it('keeps a version, a different family and a first report', () => {
    expect(
      keepKnownVersion({ device_os: 'macOS 15' }, { device_os: 'macOS 16' })
    ).toEqual({ device_os: 'macOS 16' });
    expect(
      keepKnownVersion({ device_os: 'macOS 15' }, { device_os: 'Linux' })
    ).toEqual({ device_os: 'Linux' });
    expect(keepKnownVersion(undefined, { device_os: 'macOS' })).toEqual({
      device_os: 'macOS',
    });
  });
});

describe('environmentChanged', () => {
  it('is false when nothing can be told and nothing was reported', () => {
    expect(environmentChanged(undefined, {})).toBe(false);
  });
  it('is true the first time a field can be told', () => {
    expect(environmentChanged(undefined, { language: 'pt' })).toBe(true);
  });
  it('is false when every field matches', () => {
    const same = { device_os: 'macOS 15', language: 'pt', timezone_id: 'UTC' };
    expect(environmentChanged(same, { ...same })).toBe(false);
  });
  it('is true when one field differs', () => {
    expect(
      environmentChanged(
        { device_os: 'macOS 14', language: 'pt' },
        { device_os: 'macOS 15', language: 'pt' }
      )
    ).toBe(true);
  });
  it('ignores a field that can no longer be told', () => {
    expect(environmentChanged({ language: 'pt' }, {})).toBe(false);
  });
});
