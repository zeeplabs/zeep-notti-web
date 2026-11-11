import { init, type InitOptions } from './init';
import { defaultRuntime } from './runtime';
import { DEVICE_KEY, type StoredDevice } from './store';
import { requestPermission } from './subscribe';

export type { UnsupportedReason, SupportResult } from './capabilities';
export type { InitOptions } from './init';
export type { PermissionResult, PermissionState } from './subscribe';
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

  /** The Device this browser registered, or null. */
  getSubscription: async (): Promise<{
    deviceId: string;
    endpoint: string;
  } | null> => {
    const device = await defaultRuntime().store.get<StoredDevice>(DEVICE_KEY);
    return device ? { deviceId: device.id, endpoint: device.endpoint } : null;
  },
};
