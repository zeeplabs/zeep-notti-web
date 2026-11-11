import { ApiError } from './api';
import { base64UrlToBytes, bytesEqual } from './base64';
import { ensureRegistered, readSubscription } from './register';
import { getState, type Runtime, type SdkState } from './runtime';
import { DEVICE_KEY, type StoredDevice } from './store';

export type PermissionState = 'granted' | 'denied' | 'default';

export interface PermissionResult {
  /** The permission state after the call. */
  permission: PermissionState;
  /** True when this browser is registered with Notti. */
  registered: boolean;
  deviceId?: string;
  /** Present when `registered` is false although permission is granted, or init was skipped. */
  reason?:
    'not_initialized' | 'not_enabled' | 'subscribe_failed' | 'register_failed';
}

interface NotificationApi {
  permission: PermissionState;
  requestPermission(
    callback?: (p: PermissionState) => void
  ): Promise<PermissionState> | undefined;
}

function notificationApi(runtime: Runtime): NotificationApi | undefined {
  return runtime.env.Notification as NotificationApi | undefined;
}

function serviceWorker(runtime: Runtime): ServiceWorkerContainer | undefined {
  return runtime.env.navigator?.serviceWorker as
    ServiceWorkerContainer | undefined;
}

const READY_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('service worker did not become active')),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    );
  });
}

/** Prompts, tolerating the callback-only form older Safari versions use. */
function askPermission(api: NotificationApi): Promise<PermissionState> {
  return new Promise((resolve, reject) => {
    try {
      const result = api.requestPermission(resolve);
      if (result && typeof result.then === 'function') {
        result.then(resolve, reject);
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Creates the subscription, or reuses the browser's when it was made with the
 * App's current key. A subscription made with another key (VAPID rotation) is
 * dropped and recreated silently: permission is already granted, so nothing
 * is shown to the visitor.
 */
async function obtainSubscription(
  state: SdkState,
  runtime: Runtime
): Promise<PushSubscription> {
  const sw = serviceWorker(runtime);
  if (!sw) throw new Error('no service worker');
  const registered = await sw.register(state.serviceWorkerPath);
  // `ready` never settles when the page is outside the worker's scope, so a
  // worker that is not active yet is awaited with a deadline.
  const registration = registered.active
    ? registered
    : await withTimeout(sw.ready, READY_TIMEOUT_MS);
  const key = base64UrlToBytes(state.publicKey);

  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    const current = existing.options?.applicationServerKey;
    let sameKey: boolean;
    if (current) {
      sameKey = bytesEqual(new Uint8Array(current), key);
    } else {
      // Some browsers do not expose the key; fall back to what we stored.
      const stored = await runtime.store.get<StoredDevice>(DEVICE_KEY);
      sameKey =
        stored?.endpoint === existing.endpoint &&
        stored.publicKey === state.publicKey;
    }
    if (sameKey) return existing;
    await existing.unsubscribe();
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
}

/** Subscribes and registers; never throws. */
async function subscribeAndRegister(
  state: SdkState,
  runtime: Runtime
): Promise<PermissionResult> {
  let sub: PushSubscription;
  try {
    sub = await obtainSubscription(state, runtime);
  } catch {
    return {
      permission: 'granted',
      registered: false,
      reason: 'subscribe_failed',
    };
  }
  const read = readSubscription(sub);
  if (!read) {
    return {
      permission: 'granted',
      registered: false,
      reason: 'subscribe_failed',
    };
  }
  try {
    const deviceId = await ensureRegistered(state, runtime, read);
    return { permission: 'granted', registered: true, deviceId };
  } catch (err) {
    const reason =
      err instanceof ApiError && err.code === 'web_push_not_enabled'
        ? 'not_enabled'
        : 'register_failed';
    return { permission: 'granted', registered: false, reason };
  }
}

/**
 * Asks for notification permission and registers the browser. Call it from a
 * user gesture. When permission is denied or dismissed nothing is registered,
 * and nothing in the SDK asks again on its own.
 */
export async function requestPermission(
  runtime: Runtime
): Promise<PermissionResult> {
  const api = notificationApi(runtime);
  const state = getState();
  if (!state || !api) {
    return {
      permission: api?.permission ?? 'default',
      registered: false,
      reason: 'not_initialized',
    };
  }

  let permission = api.permission;
  if (permission === 'default') {
    try {
      permission = await askPermission(api);
    } catch {
      permission = api.permission;
    }
  }
  if (permission !== 'granted') return { permission, registered: false };
  return subscribeAndRegister(state, runtime);
}

/**
 * Called by init. When the visitor already opted in through this SDK and
 * permission is still granted, re-checks the browser subscription and
 * re-registers if the endpoint or the App's key changed (covers a VAPID
 * rotation, and browsers that never fire `pushsubscriptionchange`). Does
 * nothing otherwise: it never prompts and never subscribes a visitor who did
 * not opt in. Never throws.
 */
export async function syncSubscription(
  state: SdkState,
  runtime: Runtime
): Promise<void> {
  try {
    if (notificationApi(runtime)?.permission !== 'granted') return;
    const stored = await runtime.store.get<StoredDevice>(DEVICE_KEY);
    if (!stored || stored.appId !== state.config.appId) return;
    await subscribeAndRegister(state, runtime);
  } catch {
    // init must never fail because of a sync problem.
  }
}
