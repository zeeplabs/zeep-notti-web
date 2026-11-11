import { vi } from 'vitest';
import { bytesToBase64Url, base64UrlToBytes } from '../src/base64';
import type { BrowserEnv } from '../src/capabilities';
import type { Runtime } from '../src/runtime';
import { memoryStore, type Store } from '../src/store';

/** A desktop browser with everything Web Push needs. */
export function supportedEnv(overrides: Partial<BrowserEnv> = {}): BrowserEnv {
  return {
    isSecureContext: true,
    navigator: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130',
      platform: 'MacIntel',
      maxTouchPoints: 0,
      serviceWorker: {},
    },
    PushManager: class {},
    Notification: class {},
    ...overrides,
  };
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  /** The exact bytes sent, for wire-format assertions. */
  raw: string | undefined;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface FakeRuntime {
  runtime: Runtime;
  requests: RecordedRequest[];
  store: Store;
  sleeps: number[];
}

/** A runtime whose fetch records every request and answers from `respond`. */
export function fakeRuntime(
  respond: (req: RecordedRequest) => Response | Promise<Response>,
  env: BrowserEnv = supportedEnv(),
  store: Store = memoryStore()
): FakeRuntime {
  const requests: RecordedRequest[] = [];
  const sleeps: number[] = [];
  const runtime: Runtime = {
    env,
    store,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    fetch: async (input, init) => {
      const req: RecordedRequest = {
        url: String(input),
        method: init?.method ?? 'GET',
        headers: { ...((init?.headers as Record<string, string>) ?? {}) },
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        raw: init?.body ? String(init.body) : undefined,
      };
      requests.push(req);
      return respond(req);
    },
  };
  return { runtime, requests, store, sleeps };
}

/** A 65-byte uncompressed P-256 point shape, enough for the SDK. */
export function fakeKey(seed: number): string {
  const bytes = new Uint8Array(65).fill(seed);
  bytes[0] = 4;
  return bytesToBase64Url(bytes);
}

export const PUBLIC_KEY = fakeKey(7);
export const OTHER_PUBLIC_KEY = fakeKey(9);

export interface FakeSubscription {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON: () => unknown;
  unsubscribe: ReturnType<typeof vi.fn>;
}

export function fakeSubscription(
  endpoint: string,
  publicKey: string | null = PUBLIC_KEY,
  keys: { p256dh?: string; auth?: string } = {
    p256dh: 'p256dh-' + endpoint.slice(-4),
    auth: 'auth-' + endpoint.slice(-4),
  }
): FakeSubscription {
  return {
    endpoint,
    options: {
      applicationServerKey: publicKey
        ? (base64UrlToBytes(publicKey).buffer as ArrayBuffer)
        : null,
    },
    toJSON: () => ({ endpoint, keys }),
    unsubscribe: vi.fn(async () => true),
  };
}

export interface FakeBrowserOptions {
  permission?: 'default' | 'granted' | 'denied';
  /** What the prompt resolves to; defaults to granted. */
  promptAnswer?: 'granted' | 'denied' | 'default';
  existing?: FakeSubscription | null;
  /** The subscription `subscribe()` creates. */
  created?: FakeSubscription;
  /** Make `requestPermission` use the callback-only (old Safari) form. */
  callbackOnly?: boolean;
  /** `register()` returns an already-active registration (default false). */
  activeOnRegister?: boolean;
  /** `navigator.serviceWorker.ready` never settles (page out of scope). */
  readyNeverSettles?: boolean;
}

export interface FakeBrowser {
  env: BrowserEnv;
  notification: {
    permission: 'default' | 'granted' | 'denied';
    requestPermission: ReturnType<typeof vi.fn>;
  };
  register: ReturnType<typeof vi.fn>;
  getSubscription: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  /** Replace what the browser currently holds. */
  setExisting(sub: FakeSubscription | null): void;
}

/** A browser with service worker, push manager and Notification fakes. */
export function fakeBrowser(options: FakeBrowserOptions = {}): FakeBrowser {
  let existing = options.existing ?? null;
  const created =
    options.created ?? fakeSubscription('https://push.example.com/send/0001');

  const notification = {
    permission: options.permission ?? 'default',
    requestPermission: vi.fn(
      (callback?: (p: 'default' | 'granted' | 'denied') => void) => {
        notification.permission = options.promptAnswer ?? 'granted';
        if (options.callbackOnly) {
          callback?.(notification.permission);
          return undefined;
        }
        return Promise.resolve(notification.permission);
      }
    ),
  };

  const getSubscription = vi.fn(async () => existing);
  const subscribe = vi.fn(async () => {
    existing = created;
    return created;
  });
  const registration = {
    active: options.activeOnRegister ? {} : null,
    pushManager: { getSubscription, subscribe },
  };
  const register = vi.fn(async () => registration);
  const ready = options.readyNeverSettles
    ? new Promise<never>(() => {})
    : Promise.resolve(registration);

  return {
    notification,
    register,
    getSubscription,
    subscribe,
    setExisting: (sub) => {
      existing = sub;
    },
    env: supportedEnv({
      Notification: notification,
      PushManager: class {},
      navigator: {
        userAgent: 'Mozilla/5.0 Chrome/130',
        platform: 'MacIntel',
        maxTouchPoints: 0,
        serviceWorker: { register, ready },
      },
    }),
  };
}
