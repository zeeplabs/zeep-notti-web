import { createDevice, patchDevice, sdkFields } from './devices';
import type { Runtime, SdkState } from './runtime';
import {
  flushProfile,
  markRegistrationCarried,
  profileForRegistration,
} from './profile';
import { withRetry } from './retry';
import { DEVICE_KEY, type StoredDevice } from './store';
import type { ApiConfig } from './api';

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
 * Throws when the Device cannot be created. The Device is stored as soon as
 * the server has it, so the worker can report events at once; a failed
 * follow-up PATCH does not fail the registration, it only leaves the record
 * marked unsynced so the next init repeats that PATCH.
 */
export async function ensureRegistered(
  state: SdkState,
  runtime: Runtime,
  sub: ReadSubscription
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
    // Nothing to register, but an sdk PATCH or a profile change that failed
    // earlier is still owed to the server.
    if (stored.sdkSynced === false) {
      await reportSdkFields(runtime, state.config, stored);
    }
    await flushProfile(runtime, state.config, stored);
    return stored.id;
  }

  // The profile the host set before subscribing goes along in the POST.
  const extra = await profileForRegistration(runtime);
  const id = await withRetry(
    () => createDevice(runtime.fetch, state.config, sub.endpoint, sub, extra),
    runtime.sleep
  );

  // Stored before anything else is sent: from here on the worker can report
  // events and identify/setTags reach the server, whatever happens next.
  const record: StoredDevice = {
    id,
    appId: state.config.appId,
    endpoint: sub.endpoint,
    p256dh: sub.p256dh,
    auth: sub.auth,
    publicKey: state.publicKey,
    sdkSynced: false,
  };
  await runtime.store.set(DEVICE_KEY, record);
  await markRegistrationCarried(runtime, extra);
  await reportSdkFields(runtime, state.config, record);
  // A logout that is still pending must reach the server even though the POST
  // omitted external_user_id (an omitted id keeps the stored one).
  await flushProfile(runtime, state.config, record);
  return id;
}

/** Sends sdk_name and sdk_version; marks the stored Device synced on success. */
async function reportSdkFields(
  runtime: Runtime,
  config: ApiConfig,
  device: StoredDevice
): Promise<void> {
  try {
    await withRetry(
      () =>
        patchDevice(
          runtime.fetch,
          config,
          device.id,
          device.endpoint,
          sdkFields()
        ),
      runtime.sleep
    );
    await runtime.store.set(DEVICE_KEY, { ...device, sdkSynced: true });
  } catch {
    // Left unsynced; the next init repeats it.
  }
}
