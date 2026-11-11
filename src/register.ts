import { createDevice, patchDevice, sdkFields } from './devices';
import type { Runtime, SdkState } from './runtime';
import { withRetry } from './retry';
import { DEVICE_KEY, type StoredDevice } from './store';

export interface ReadSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Extracts the endpoint and keys from a PushSubscription, or null if absent. */
export function readSubscription(
  sub: PushSubscription
): ReadSubscription | null {
  const json = sub.toJSON();
  const endpoint = json.endpoint ?? sub.endpoint;
  const p256dh = json.keys?.['p256dh'];
  const auth = json.keys?.['auth'];
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}

/**
 * Registers the subscription with Notti unless the Device already stored for
 * this App matches it exactly (same endpoint, keys and VAPID key), so a page
 * reload makes no request. A changed endpoint or key re-registers.
 *
 * `extra` carries the identity and tags the host set before subscribing.
 * Throws when the Device cannot be created; a failed follow-up PATCH does not
 * fail the registration, it only leaves the record unsaved so the next init
 * repeats it.
 */
export async function ensureRegistered(
  state: SdkState,
  runtime: Runtime,
  sub: ReadSubscription,
  extra: { external_user_id?: string; tags?: Record<string, unknown> } = {}
): Promise<string> {
  const stored = await runtime.store.get<StoredDevice>(DEVICE_KEY);
  if (
    stored &&
    stored.appId === state.config.appId &&
    stored.endpoint === sub.endpoint &&
    stored.p256dh === sub.p256dh &&
    stored.auth === sub.auth &&
    stored.publicKey === state.publicKey
  ) {
    return stored.id;
  }

  const id = await withRetry(
    () => createDevice(runtime.fetch, state.config, sub.endpoint, sub, extra),
    runtime.sleep
  );

  try {
    await withRetry(
      () =>
        patchDevice(runtime.fetch, state.config, id, sub.endpoint, sdkFields()),
      runtime.sleep
    );
  } catch {
    return id;
  }

  const record: StoredDevice = {
    id,
    appId: state.config.appId,
    endpoint: sub.endpoint,
    p256dh: sub.p256dh,
    auth: sub.auth,
    publicKey: state.publicKey,
  };
  await runtime.store.set(DEVICE_KEY, record);
  return id;
}
