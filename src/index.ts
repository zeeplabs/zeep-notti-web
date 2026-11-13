import { init, type InitOptions } from './init';
import { addClickListener, trackEvent } from './inapp/page';
import { defaultRuntime } from './runtime';
import { DEVICE_KEY, type StoredDevice } from './store';
import {
  identify,
  logout,
  removeTags,
  setTags,
  type TagInput,
} from './profile';
import { requestPermission } from './subscribe';

export type { UnsupportedReason, SupportResult } from './capabilities';
export type { InitOptions } from './init';
export type { PermissionResult, PermissionState } from './subscribe';
export type { TagInput, TagValue } from './profile';
export type { ClickHandler, ClickSubscription } from './inapp/listeners';
export type { InAppClick, LinkAction } from './inapp/types';
export { SDK_NAME, SDK_VERSION } from './version';

export const Notti = {
  /**
   * Loads the App's public key and checks browser support, without prompting.
   * Never throws; see `SupportResult.reason`.
   */
  init: (options: InitOptions) => init(options),

  /**
   * Asks for notification permission and registers this browser. Call it from
   * a user gesture. Denied or dismissed registers nothing and is not retried.
   */
  requestPermission: () => requestPermission(defaultRuntime()),

  /**
   * Links this browser to your own user id. Before the browser is registered
   * the id is kept and sent at registration. Never throws.
   */
  identify: (externalUserId: string) =>
    identify(defaultRuntime(), externalUserId),

  /**
   * Sets tags, merging into the ones already set; a `null` value removes that
   * key. Never throws.
   */
  setTags: (tags: TagInput) => setTags(defaultRuntime(), tags),

  /** Removes tag keys. Never throws. */
  removeTags: (keys: string[]) => removeTags(defaultRuntime(), keys),

  /**
   * Unlinks this browser from the user (`external_user_id: null`). Tags and
   * the subscription are kept. Never throws.
   */
  logout: () => logout(defaultRuntime()),

  /**
   * Tells Notti an event happened, so an In-App message triggered by that
   * exact name can show. Matched in the browser; the name is never sent.
   * Names tracked before `init` finishes are remembered (up to 32).
   */
  trackEvent: (name: string) => trackEvent(name),

  InAppMessages: {
    /**
     * Called after the visitor pressed a button or the image of a message,
     * once the message closed, with `{ messageId, buttonId, action }`.
     * The SDK opens nothing itself: `action` is a `url` or `deeplink` for you
     * to handle. Returns `{ remove() }`.
     */
    addClickListener,
  },

  /** The Device this browser registered, or null. */
  getSubscription: async (): Promise<{
    deviceId: string;
    endpoint: string;
  } | null> => {
    const device = await defaultRuntime().store.get<StoredDevice>(DEVICE_KEY);
    return device ? { deviceId: device.id, endpoint: device.endpoint } : null;
  },
};
