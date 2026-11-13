import type { ApiConfig, Fetcher } from './api';
import { browserEnv, type BrowserEnv } from './capabilities';
import { realSleep, type Sleep } from './retry';
import { pageSession } from './inapp/page';
import { idbStore, type Store } from './store';

/** Everything the SDK touches outside its own code, injectable for tests. */
export interface Runtime {
  env: BrowserEnv;
  fetch: Fetcher;
  store: Store;
  sleep: Sleep;
  /** Milliseconds since the epoch; defaults to `Date.now`. */
  now?: () => number;
  /** Web Locks, shared by the tabs of one origin; absent where unsupported. */
  locks?: Pick<LockManager, 'request'>;
  /** Starts In-App messages once `init` is done; absent in tests that do not cover it. */
  inApp?: { start(state: SdkState, runtime: Runtime): Promise<void> };
}

export const nowOf = (runtime: Runtime): number =>
  (runtime.now ?? Date.now)();

// One store, so each Notti.* call does not open its own IndexedDB connection.
let sharedStore: Store | undefined;

export function defaultRuntime(): Runtime {
  return {
    env: browserEnv(),
    fetch: (input, init) => globalThis.fetch(input, init),
    store: (sharedStore ??= idbStore()),
    sleep: realSleep,
    locks: globalThis.navigator?.locks,
    inApp: pageSession(),
  };
}

/** What `init` learned; later calls (subscribe, identify) read it. */
export interface SdkState {
  config: ApiConfig;
  /** VAPID public key, base64url. */
  publicKey: string;
  /** Path the host serves the service worker from. */
  serviceWorkerPath: string;
}

let current: SdkState | null = null;

export function setState(state: SdkState | null): void {
  current = state;
}

export function getState(): SdkState | null {
  return current;
}
