import { createDevice, patchDevice, sdkFields } from './devices';
import { nowOf, type Runtime, type SdkState } from './runtime';
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
    // The POST just made the server see this browser.
    seenAt: nowOf(runtime),
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
    // The PATCH is also a sign of life.
    await runtime.store.set(DEVICE_KEY, {
      ...device,
      sdkSynced: true,
      seenAt: nowOf(runtime),
    });
  } catch {
    // Left unsynced; the next init repeats it.
  }
}

/**
 * The server counts a browser as active (MAU, and the order in which an App
 * over its limit is cut) from the last time it heard from it. A returning
 * visitor makes no other request, so without this the browser would drop out
 * after 30 days of perfectly good visits. One light PATCH a day is enough; it
 * carries nothing but the token that proves ownership and the permission, and a
 * failure is simply tried again at the next init.
 */
export const HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function reportSeen(
  runtime: Runtime,
  config: ApiConfig,
  device: StoredDevice
): Promise<void> {
  const now = nowOf(runtime);
  if (device.seenAt !== undefined) {
    // A stored time in the future (the clock went back) counts as stale.
    const age = now - device.seenAt;
    if (age >= 0 && age < HEARTBEAT_INTERVAL_MS) return;
  }
  await patchDevice(runtime.fetch, config, device.id, device.endpoint, {
    permission_status: 'granted',
  });
  // Read again: another write (the sdk flag) may have changed the record while
  // the PATCH was in flight, and this one must not put it back.
  const latest = await runtime.store.get<StoredDevice>(DEVICE_KEY);
  if (latest?.id === device.id) {
    await runtime.store.set(DEVICE_KEY, { ...latest, seenAt: now });
  }
}
