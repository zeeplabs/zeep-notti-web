import { patchDevice } from './devices';
import { getState, type Runtime } from './runtime';
import { withRetry } from './retry';
import {
  DEVICE_KEY,
  PROFILE_KEY,
  type StoredDevice,
  type StoredProfile,
} from './store';
import type { ApiConfig } from './api';

export type TagValue = string | number | boolean;

/** Tags to set; a `null` value removes that key. */
export type TagInput = Record<string, TagValue | null>;

type PendingField = StoredProfile['pending'][number];

const empty = (): StoredProfile => ({ tags: {}, pending: [] });

async function load(runtime: Runtime): Promise<StoredProfile> {
  const stored = await runtime.store.get<StoredProfile>(PROFILE_KEY);
  return stored ? { ...empty(), ...stored, tags: { ...stored.tags } } : empty();
}

// Profile calls read-modify-write the store, so two quick calls must not
// interleave or the second would overwrite the first.
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

function markPending(profile: StoredProfile, field: PendingField): void {
  if (!profile.pending.includes(field)) profile.pending.push(field);
}

async function registeredDevice(
  runtime: Runtime,
  config: ApiConfig
): Promise<StoredDevice | undefined> {
  const device = await runtime.store.get<StoredDevice>(DEVICE_KEY);
  return device && device.appId === config.appId ? device : undefined;
}

/**
 * Sends what the server has not acknowledged yet, as the current state of the
 * profile: the latest identity (or `null` after logout) and the full tag map,
 * the same wire shape as the mobile SDKs. Failures leave the fields pending
 * for the next registration. Never throws.
 */
export async function flushProfile(
  runtime: Runtime,
  config: ApiConfig,
  device: StoredDevice
): Promise<void> {
  if (config.appId !== device.appId) return;
  try {
    const profile = await load(runtime);
    if (profile.pending.length === 0) return;
    const fields: Record<string, unknown> = {};
    if (profile.pending.includes('external_user_id')) {
      fields['external_user_id'] = profile.external_user_id ?? null;
    }
    if (profile.pending.includes('tags')) fields['tags'] = profile.tags;
    await withRetry(
      () =>
        patchDevice(runtime.fetch, config, device.id, device.endpoint, fields),
      runtime.sleep
    );
    // Re-read: the host may have changed the profile while the request ran.
    const latest = await load(runtime);
    const sent = Object.keys(fields) as PendingField[];
    const unchanged = sent.every((f) =>
      f === 'tags'
        ? JSON.stringify(latest.tags) === JSON.stringify(fields['tags'])
        : (latest.external_user_id ?? null) === fields['external_user_id']
    );
    if (unchanged) {
      latest.pending = latest.pending.filter((f) => !sent.includes(f));
      await runtime.store.set(PROFILE_KEY, latest);
    }
  } catch {
    // Stays pending; retried at the next registration.
  }
}

/** What a first registration should carry so the Device starts identified. */
export async function profileForRegistration(
  runtime: Runtime
): Promise<{ external_user_id?: string; tags?: Record<string, TagValue> }> {
  const profile = await load(runtime);
  const out: { external_user_id?: string; tags?: Record<string, TagValue> } =
    {};
  if (profile.external_user_id) out.external_user_id = profile.external_user_id;
  if (Object.keys(profile.tags).length > 0) out.tags = profile.tags;
  return out;
}

/** Called after a registration that carried the profile in its POST body. */
export async function markRegistrationCarried(
  runtime: Runtime,
  carried: { external_user_id?: string; tags?: Record<string, TagValue> }
): Promise<void> {
  await exclusive(async () => {
    const profile = await load(runtime);
    profile.pending = profile.pending.filter(
      (f) =>
        !(f === 'external_user_id' && carried.external_user_id !== undefined) &&
        !(f === 'tags' && carried.tags !== undefined)
    );
    await runtime.store.set(PROFILE_KEY, profile);
  });
}

async function applyAndSync(
  runtime: Runtime,
  field: PendingField,
  change: (profile: StoredProfile) => void
): Promise<void> {
  const target = await exclusive(async () => {
    const profile = await load(runtime);
    change(profile);
    markPending(profile, field);
    await runtime.store.set(PROFILE_KEY, profile);
    const state = getState();
    return state
      ? {
          device: await registeredDevice(runtime, state.config),
          config: state.config,
        }
      : undefined;
  });
  if (target?.device) await flushProfile(runtime, target.config, target.device);
}

/**
 * Links this browser to your own user id. Before the browser is registered
 * the id is kept and sent at registration. Never throws.
 */
export async function identify(
  runtime: Runtime,
  externalUserId: string
): Promise<void> {
  const id = typeof externalUserId === 'string' ? externalUserId.trim() : '';
  // An empty id is a no-op, like on the server and the mobile SDKs.
  if (!id) return;
  try {
    await applyAndSync(runtime, 'external_user_id', (p) => {
      p.external_user_id = id;
    });
  } catch {
    // Storage failure: nothing to retry from.
  }
}

/**
 * Sets tags, merging into the ones already set; a `null` value removes that
 * key. The full resulting map is sent, as the mobile SDKs do. Entries that are
 * not a string, number, boolean or null are ignored. Never throws.
 */
export async function setTags(runtime: Runtime, tags: TagInput): Promise<void> {
  if (!tags || typeof tags !== 'object') return;
  try {
    await applyAndSync(runtime, 'tags', (p) => {
      for (const [key, value] of Object.entries(tags)) {
        if (!key) continue;
        if (value === null) delete p.tags[key];
        else if (['string', 'number', 'boolean'].includes(typeof value)) {
          p.tags[key] = value;
        }
      }
    });
  } catch {
    // Storage failure: nothing to retry from.
  }
}

/** Removes tag keys. The full resulting map is sent. Never throws. */
export async function removeTags(
  runtime: Runtime,
  keys: string[]
): Promise<void> {
  if (!Array.isArray(keys)) return;
  try {
    await applyAndSync(runtime, 'tags', (p) => {
      for (const key of keys) delete p.tags[key];
    });
  } catch {
    // Storage failure: nothing to retry from.
  }
}

/**
 * Unlinks this browser from the user: sends `external_user_id: null`, so
 * pushes addressed to the previous user stop reaching it. Tags and the
 * subscription are kept. If the request fails it is repeated at the next
 * registration. Never throws.
 */
export async function logout(runtime: Runtime): Promise<void> {
  try {
    await applyAndSync(runtime, 'external_user_id', (p) => {
      delete p.external_user_id;
    });
  } catch {
    // Storage failure: nothing to retry from.
  }
}
