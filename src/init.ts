import { ApiError, getWebPushConfig, normalizeHost } from './api';
import { detectSupport, type SupportResult } from './capabilities';
import { defaultRuntime, setState, type Runtime } from './runtime';
import { CONFIG_KEY, type StoredConfig } from './store';
import { syncSubscription } from './subscribe';

export interface InitOptions {
  /** The Notti App ID. */
  appId: string;
  /** The App's Client key. Never a REST key. */
  clientKey: string;
  /** Notti host. Defaults to https://app.zeepnotti.app; set it for self-hosted. */
  host?: string;
  /** Path the service worker file is served from. Defaults to /notti-sw.js. */
  serviceWorkerPath?: string;
}

export const DEFAULT_SERVICE_WORKER_PATH = '/notti-sw.js';

/**
 * Loads the App's public key and reports whether this browser can use Web
 * Push. Never prompts and never throws: every failure is a typed reason.
 * The browser is checked first, so an unsupported browser makes no request.
 */
export async function init(
  options: InitOptions,
  runtime: Runtime = defaultRuntime()
): Promise<SupportResult> {
  setState(null);

  const host = normalizeHost(options?.host);
  if (
    !host ||
    typeof options?.appId !== 'string' ||
    !options.appId.trim() ||
    typeof options.clientKey !== 'string' ||
    !options.clientKey.trim()
  ) {
    return { supported: false, reason: 'invalid_options' };
  }

  const support = detectSupport(runtime.env);
  if (!support.supported) return support;

  const config = { appId: options.appId, clientKey: options.clientKey, host };
  let publicKey: string;
  try {
    publicKey = await getWebPushConfig(runtime.fetch, config);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'web_push_not_enabled') {
      return { supported: false, reason: 'not_enabled' };
    }
    return { supported: false, reason: 'request_failed' };
  }

  const state = {
    config,
    publicKey,
    serviceWorkerPath: options.serviceWorkerPath ?? DEFAULT_SERVICE_WORKER_PATH,
  };
  setState(state);

  // The service worker reads this to report events and refresh the Device.
  try {
    const stored: StoredConfig = { ...config, publicKey };
    await runtime.store.set(CONFIG_KEY, stored);
  } catch {
    // Storage can be unavailable; the page-side SDK still works.
  }

  await syncSubscription(state, runtime);
  return { supported: true };
}
