import type { ApiConfig, Fetcher } from '../api';
import { reportEvent, type EventType } from '../events';
import type { Sleep } from '../retry';
import {
  CONFIG_KEY,
  DEVICE_KEY,
  type Store,
  type StoredConfig,
  type StoredDevice,
} from '../store';
import { SDK_VERSION } from '../version';

/** Version of this worker file. Equal to the SDK version that built it. */
export const WORKER_VERSION = SDK_VERSION;

/** How the page asks a running worker which version it is. */
export const VERSION_REQUEST = 'notti:get-version';

/** Upper bound on one push's engagement report, so waitUntil always settles. */
const REPORT_DEADLINE_MS = 20_000;

// The slice of the service worker global the handlers use. Declared here
// (not the DOM lib types) so tests can hand in a plain fake.
export interface WindowClientLike {
  url: string;
  focus(): Promise<unknown>;
}

export interface WorkerScope {
  addEventListener(type: string, listener: (event: never) => void): void;
  skipWaiting(): Promise<void>;
  registration: {
    showNotification(
      title: string,
      options?: Record<string, unknown>
    ): Promise<void>;
  };
  clients: {
    matchAll(options: {
      type: 'window';
      includeUncontrolled: boolean;
    }): Promise<WindowClientLike[]>;
    openWindow(url: string): Promise<unknown>;
    claim(): Promise<void>;
  };
  location: { origin: string; hostname: string };
}

export interface WorkerDeps {
  fetch: Fetcher;
  store: Store;
  sleep: Sleep;
}

interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface PushEventLike extends ExtendableEventLike {
  data: { json(): unknown } | null;
}

interface ClickEventLike extends ExtendableEventLike {
  notification: { data?: unknown; close(): void };
}

interface MessageEventLike {
  data?: unknown;
  ports?: ReadonlyArray<{ postMessage(message: unknown): void }>;
}

/** What a push message (design.md "Message payload") may carry. */
interface ParsedPush {
  title: string;
  body: string;
  image?: string;
  tag?: string;
  data: Record<string, string>;
}

interface NotificationData {
  url?: string;
  notification_id?: string;
  delivery_id?: string;
}

const isString = (v: unknown): v is string => typeof v === 'string';

/**
 * Parses the push payload. Anything unusable yields null so the caller shows
 * a generic notification: a push that shows nothing can get the site's
 * permission revoked by the browser.
 */
function parsePush(event: PushEventLike): ParsedPush | null {
  let raw: unknown;
  try {
    raw = event.data?.json();
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as Record<string, unknown>;
  const title = isString(msg['title']) ? msg['title'].trim() : '';
  const body = isString(msg['body']) ? msg['body'].trim() : '';
  if (!title && !body) return null;

  const data: Record<string, string> = {};
  if (msg['data'] && typeof msg['data'] === 'object') {
    for (const [k, v] of Object.entries(msg['data'])) {
      if (isString(v)) data[k] = v;
    }
  }
  const parsed: ParsedPush = { title, body, data };
  if (isString(msg['image']) && msg['image']) parsed.image = msg['image'];
  if (isString(msg['tag']) && msg['tag']) parsed.tag = msg['tag'];
  return parsed;
}

/**
 * Resolves the click target against the site origin. Only http(s) is
 * followed: a `javascript:` or `data:` URL from a payload is dropped and the
 * origin root is opened instead (WEB-33 default for an absent URL too).
 */
export function resolveClickTarget(
  raw: string | undefined,
  origin: string
): { url: string; sameOrigin: boolean } {
  const root = { url: `${origin}/`, sameOrigin: true };
  if (!raw) return root;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return root;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return root;
  return { url: url.href, sameOrigin: url.origin === origin };
}

/** Compares two URLs ignoring the fragment. */
function sameDocument(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    ua.hash = '';
    ub.hash = '';
    return ua.href === ub.href;
  } catch {
    return false;
  }
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      }
    );
  });
}

function on<E>(
  scope: WorkerScope,
  type: string,
  handler: (event: E) => void
): void {
  scope.addEventListener(type, handler as (event: never) => void);
}

/**
 * Registers the push, click and message handlers on the worker scope.
 * Everything that talks to the network goes through `deps`.
 */
export function installWorker(scope: WorkerScope, deps: WorkerDeps): void {
  /** Config and Device are written by the page; the worker only reads them. */
  async function context(): Promise<{
    config: ApiConfig;
    token: string;
  } | null> {
    try {
      const config = await deps.store.get<StoredConfig>(CONFIG_KEY);
      const device = await deps.store.get<StoredDevice>(DEVICE_KEY);
      if (!config || !device || device.appId !== config.appId) return null;
      return {
        config: {
          appId: config.appId,
          clientKey: config.clientKey,
          host: config.host,
        },
        token: device.endpoint,
      };
    } catch {
      return null;
    }
  }

  async function report(
    type: EventType,
    data: NotificationData | undefined
  ): Promise<void> {
    if (!data?.notification_id || !data.delivery_id) return;
    const ctx = await context();
    if (!ctx) return;
    await reportEvent(deps.fetch, ctx.config, deps.sleep, {
      notificationId: data.notification_id,
      deliveryId: data.delivery_id,
      type,
      token: ctx.token,
    });
  }

  // A new worker file takes over at once so a stale one does not linger.
  on<ExtendableEventLike>(scope, 'install', (event) => {
    event.waitUntil(scope.skipWaiting());
  });
  on<ExtendableEventLike>(scope, 'activate', (event) => {
    event.waitUntil(scope.clients.claim());
  });

  on<PushEventLike>(scope, 'push', (event) => {
    const parsed = parsePush(event);
    // showNotification is called before anything else, synchronously, so no
    // storage read or network call can ever delay it (WEB-32).
    const shown = parsed
      ? scope.registration.showNotification(parsed.title || parsed.body, {
          body: parsed.title ? parsed.body : '',
          ...(parsed.image ? { image: parsed.image } : {}),
          ...(parsed.tag ? { tag: parsed.tag } : {}),
          data: {
            ...(parsed.data['url'] ? { url: parsed.data['url'] } : {}),
            ...(parsed.data['notification_id']
              ? { notification_id: parsed.data['notification_id'] }
              : {}),
            ...(parsed.data['delivery_id']
              ? { delivery_id: parsed.data['delivery_id'] }
              : {}),
          } satisfies NotificationData,
        })
      : scope.registration.showNotification(scope.location.hostname, {
          body: 'You have a new notification',
        });

    // `received` is reported only for a notification that was actually shown,
    // and once per push. The deadline keeps waitUntil from outliving a dead
    // network.
    event.waitUntil(
      shown.then(
        () =>
          withDeadline(
            report('received', parsed?.data as NotificationData | undefined),
            REPORT_DEADLINE_MS
          ),
        () => undefined
      )
    );
  });

  on<ClickEventLike>(scope, 'notificationclick', (event) => {
    event.notification.close();
    const data = (event.notification.data ?? undefined) as
      NotificationData | undefined;
    const target = resolveClickTarget(data?.url, scope.location.origin);

    const open = async (): Promise<boolean> => {
      try {
        // Only a same-origin target may reuse an existing window; a
        // cross-origin one is always opened and never focuses a client.
        if (target.sameOrigin) {
          const windows = await scope.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
          });
          const existing = windows.find((w) => sameDocument(w.url, target.url));
          if (existing) {
            await existing.focus();
            return true;
          }
        }
        await scope.clients.openWindow(target.url);
        return true;
      } catch {
        return false;
      }
    };

    event.waitUntil(
      (async () => {
        // Click first: it is true even when the window cannot be opened.
        const clicked = report('clicked', data);
        const landed = await open();
        if (landed) await report('opened', data);
        await clicked;
      })()
    );
  });

  // The page asks which version is running to detect a stale worker.
  on<MessageEventLike>(scope, 'message', (event) => {
    if (event.data !== VERSION_REQUEST) return;
    event.ports?.[0]?.postMessage({ version: WORKER_VERSION });
  });
}
