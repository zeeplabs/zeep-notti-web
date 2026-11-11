import type { ApiConfig, Fetcher } from './api';
import { browserEnv, type BrowserEnv } from './capabilities';

/** Everything the SDK touches outside its own code, injectable for tests. */
export interface Runtime {
  env: BrowserEnv;
  fetch: Fetcher;
}

export function defaultRuntime(): Runtime {
  return {
    env: browserEnv(),
    fetch: (input, init) => globalThis.fetch(input, init),
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
