import type { BrowserEnv } from './capabilities';

/**
 * The only browser facts the SDK reports, and in these exact shapes:
 *
 * - `device_os`: the OS family plus its major version when it is known
 *   ("macOS 15", "Windows 11", "Android 14", "iOS 18"), or the family alone
 *   ("Linux", "ChromeOS", "Windows"). Never a minor or patch version.
 * - `language`: the primary language subtag, lower case ("pt", "en"), the same
 *   as the Android and iOS SDKs send. The region is dropped on purpose.
 * - `timezone_id`: the IANA id ("America/Sao_Paulo").
 *
 * A field that cannot be determined is absent: the server rejects an empty
 * string. Nothing else is read: no full User-Agent, no screen, fonts or canvas.
 */
export interface Environment {
  device_os?: string;
  language?: string;
  timezone_id?: string;
}

/** How long to wait for the browser to answer a high entropy hint. */
const HINT_TIMEOUT_MS = 300;

/** The server rejects a profile field longer than 128 bytes with a 422. */
const IANA_ZONE = /^[A-Za-z0-9_+\-/]{1,128}$/;

const MAJOR = /^(\d{1,3})(?:[._]|$)/;

function major(version: string | undefined): number | undefined {
  const match = MAJOR.exec(version ?? '');
  return match ? Number(match[1]) : undefined;
}

function withVersion(family: string, version: number | undefined): string {
  return version === undefined ? family : `${family} ${version}`;
}

/** Windows 11 reports platformVersion 13+ and Windows 10 reports 1 to 12. */
function windowsName(platformMajor: number | undefined): string {
  if (platformMajor === undefined || platformMajor < 1) return 'Windows';
  return platformMajor >= 13 ? 'Windows 11' : 'Windows 10';
}

function osFromPlatform(
  platform: string,
  platformVersion: string | undefined
): string | undefined {
  const name = platform.trim();
  const version = major(platformVersion);
  switch (name) {
    case 'macOS':
    case 'Android':
    case 'iOS':
      return withVersion(name, version);
    case 'Windows':
      return windowsName(version);
    case 'Chrome OS':
    case 'ChromeOS':
      return 'ChromeOS';
    case 'Linux':
      // The version a Linux browser reports is a kernel or empty, not a release.
      return 'Linux';
    default:
      // "", "Unknown" and anything new: nothing worth sending.
      return undefined;
  }
}

/**
 * A minimal read of the User-Agent, for browsers without `userAgentData`
 * (Safari, Firefox). Only the OS family and, where the UA does not freeze it,
 * the major version. Windows 10 and 11 both say "NT 10.0" and macOS says
 * 10_15_7 whatever it is, so those give the family alone.
 */
function osFromUserAgent(
  nav: NonNullable<BrowserEnv['navigator']>
): string | undefined {
  const ua = nav.userAgent ?? '';
  const ios = /\b(?:iPhone|iPad|iPod)\b.*?\bOS (\d{1,3})[._](\d{1,3})/.exec(ua);
  if (ios) {
    const osMajor = Number(ios[1]);
    // From iOS 26 Safari keeps the OS in the UA at 18_6 (the last 18.x), so
    // 18_6 cannot be trusted. Safari's own "Version/NN" tracks the iOS major;
    // a Home Screen web app has none, and then only the family is known.
    if (osMajor === 18 && Number(ios[2]) === 6) {
      const safari = /\bVersion\/(\d{1,3})[._]/.exec(ua);
      return withVersion('iOS', safari ? Number(safari[1]) : undefined);
    }
    return withVersion('iOS', osMajor);
  }
  if (/\b(?:iPhone|iPad|iPod)\b/.test(ua)) return 'iOS';
  // iPadOS 13+ presents itself as a Mac with a touch screen.
  if (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1) {
    return 'iOS';
  }
  const android = /\bAndroid (\d{1,3})(?:[._]|\b)/.exec(ua);
  if (android) return withVersion('Android', Number(android[1]));
  if (/\bAndroid\b/.test(ua)) return 'Android';
  if (/\bCrOS\b/.test(ua)) return 'ChromeOS';
  if (/\bWindows\b/.test(ua)) return 'Windows';
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return 'macOS';
  if (/\bLinux\b|\bX11\b/.test(ua)) return 'Linux';
  return undefined;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function readDeviceOs(env: BrowserEnv): Promise<string | undefined> {
  const nav = env.navigator;
  if (!nav) return undefined;
  const data = nav.userAgentData;
  if (typeof data?.platform === 'string') {
    // The browser told us the platform; its User-Agent can be frozen or
    // reduced (Chrome says "Android 10" and "Mac OS X 10_15_7" always), so the
    // version comes from the hint or not at all.
    let platformVersion: string | undefined;
    try {
      if (typeof data.getHighEntropyValues === 'function') {
        const hints = await withTimeout(
          data.getHighEntropyValues(['platformVersion']),
          HINT_TIMEOUT_MS
        );
        platformVersion = hints?.platformVersion;
      }
    } catch {
      // Not allowed or not answered: report the family.
    }
    const fromPlatform = osFromPlatform(data.platform, platformVersion);
    if (fromPlatform) return fromPlatform;
  }
  return osFromUserAgent(nav);
}

function readLanguage(env: BrowserEnv): string | undefined {
  const tag = env.navigator?.language;
  if (typeof tag !== 'string') return undefined;
  const primary = tag.trim().split(/[-_]/)[0]?.toLowerCase();
  // ISO 639 codes are two or three letters; "und" means undetermined.
  if (!primary || !/^[a-z]{2,3}$/.test(primary) || primary === 'und') {
    return undefined;
  }
  return primary;
}

function readTimezone(env: BrowserEnv): string | undefined {
  const zone = env.Intl?.DateTimeFormat().resolvedOptions().timeZone;
  if (typeof zone !== 'string') return undefined;
  const trimmed = zone.trim();
  // An overlong or odd value (a tampered or polyfilled Intl) would make the
  // server refuse the whole PATCH, sdk_name and sdk_version included.
  return IANA_ZONE.test(trimmed) ? trimmed : undefined;
}

/**
 * Reads the OS, language and time zone of this browser. Never throws and
 * never rejects, outside a browser (SSR, a worker without `navigator`) it
 * returns `{}`, and each field it cannot read is left out.
 */
export async function collectEnvironment(
  env: BrowserEnv
): Promise<Environment> {
  const result: Environment = {};
  try {
    const deviceOs = await readDeviceOs(env);
    if (deviceOs) result.device_os = deviceOs;
  } catch {
    // Left out.
  }
  try {
    const language = readLanguage(env);
    if (language) result.language = language;
  } catch {
    // Left out.
  }
  try {
    const timezone = readTimezone(env);
    if (timezone) result.timezone_id = timezone;
  } catch {
    // Left out.
  }
  return result;
}

/**
 * True when a field the browser can tell now differs from the one the server
 * last acknowledged. A field that cannot be told now never counts as changed.
 */
export function environmentChanged(
  reported: Environment | undefined,
  current: Environment
): boolean {
  return (['device_os', 'language', 'timezone_id'] as const).some(
    (key) => current[key] !== undefined && current[key] !== reported?.[key]
  );
}

/**
 * Keeps a version the server already has when this read only got the family:
 * a slow or refused hint must not turn "macOS 15" into "macOS" and back.
 */
export function keepKnownVersion(
  reported: Environment | undefined,
  current: Environment
): Environment {
  const before = reported?.device_os;
  const now = current.device_os;
  if (before && now && !now.includes(' ') && before.startsWith(`${now} `)) {
    const rest = { ...current };
    delete rest.device_os;
    return rest;
  }
  return current;
}
