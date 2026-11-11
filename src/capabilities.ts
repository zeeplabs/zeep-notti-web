/** Why Web Push cannot be used right now. */
export type UnsupportedReason =
  | 'insecure_context'
  | 'ios_requires_home_screen'
  | 'no_service_worker'
  | 'no_push_manager'
  | 'not_enabled'
  | 'request_failed'
  | 'invalid_options';

/** Result of `Notti.init`. `reason` is present only when `supported` is false. */
export interface SupportResult {
  supported: boolean;
  reason?: UnsupportedReason;
}

/**
 * The slice of the browser global the SDK reads. Injected so detection can be
 * tested without a DOM.
 */
export interface BrowserEnv {
  isSecureContext?: boolean;
  navigator?: {
    userAgent?: string;
    platform?: string;
    maxTouchPoints?: number;
    standalone?: boolean;
    serviceWorker?: unknown;
  };
  PushManager?: unknown;
  Notification?: unknown;
  matchMedia?: (query: string) => { matches: boolean };
}

/** Reads the real browser global. Safe to call outside a browser. */
export function browserEnv(): BrowserEnv {
  return globalThis as unknown as BrowserEnv;
}

function isIOS(env: BrowserEnv): boolean {
  const nav = env.navigator;
  if (!nav) return false;
  if (/iPad|iPhone|iPod/.test(nav.userAgent ?? '')) return true;
  // iPadOS 13+ reports itself as a Mac but has a touch screen.
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
}

function isInstalledToHomeScreen(env: BrowserEnv): boolean {
  if (env.navigator?.standalone === true) return true;
  try {
    return env.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    return false;
  }
}

/**
 * Checks whether this browser can use Web Push. Never prompts and never
 * throws. The order matters: on iOS, `PushManager` only exists once the site
 * is on the Home Screen, so the Home Screen check must run before the
 * `PushManager` one to give the actionable reason.
 */
export function detectSupport(env: BrowserEnv): SupportResult {
  if (env.isSecureContext !== true) {
    return { supported: false, reason: 'insecure_context' };
  }
  if (isIOS(env) && !isInstalledToHomeScreen(env)) {
    return { supported: false, reason: 'ios_requires_home_screen' };
  }
  if (!env.navigator || !('serviceWorker' in env.navigator)) {
    return { supported: false, reason: 'no_service_worker' };
  }
  if (env.PushManager === undefined || env.Notification === undefined) {
    return { supported: false, reason: 'no_push_manager' };
  }
  return { supported: true };
}
