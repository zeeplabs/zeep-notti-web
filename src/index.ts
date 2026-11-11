import { init, type InitOptions } from './init';

export type { UnsupportedReason, SupportResult } from './capabilities';
export type { InitOptions } from './init';
export { SDK_NAME, SDK_VERSION } from './version';

export const Notti = {
  /**
   * Loads the App's public key and checks browser support, without prompting.
   * Never throws; see `SupportResult.reason`.
   */
  init: (options: InitOptions) => init(options),
};
