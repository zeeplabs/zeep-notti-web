/**
 * Small key-value store the page and the service worker share. localStorage
 * is not visible to a worker, so IndexedDB is the only place both can read.
 */
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export const DB_NAME = 'notti-web';
const STORE_NAME = 'kv';

/** In-memory store. Fallback when IndexedDB is unavailable (private modes). */
export function memoryStore(): Store {
  const data = new Map<string, unknown>();
  return {
    get: <T>(key: string) => Promise.resolve(data.get(key) as T | undefined),
    set: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
  };
}

/**
 * Opens the database. `onClosed` runs when the connection is closed because
 * another context (a newer SDK, a worker) asked to upgrade the database: this
 * connection must not hold that upgrade back, and the next call opens again.
 */
function openDb(idb: IDBFactory, onClosed: () => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        onClosed();
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('indexeddb open failed'));
    req.onblocked = () => reject(new Error('indexeddb open blocked'));
  });
}

function run<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const req = op(tx.objectStore(STORE_NAME));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = () => reject(tx.error ?? new Error('indexeddb failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexeddb aborted'));
  });
}

/** IndexedDB-backed store. Falls back to memory when IndexedDB is missing. */
export function idbStore(
  idb: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory })
    .indexedDB
): Store {
  if (!idb) return memoryStore();
  let db: Promise<IDBDatabase> | null = null;
  const conn = () =>
    (db ??= openDb(idb, () => {
      db = null;
    }).catch((err: unknown) => {
      // A failed open is tried again by the next call.
      db = null;
      throw err;
    }));
  return {
    get: async <T>(key: string) =>
      run<T | undefined>(await conn(), 'readonly', (s) => s.get(key)),
    set: async (key, value) => {
      await run(await conn(), 'readwrite', (s) => s.put(value, key));
    },
    delete: async (key) => {
      await run(await conn(), 'readwrite', (s) => s.delete(key));
    },
  };
}

/** What the service worker needs to report events and refresh the Device. */
export interface StoredConfig {
  appId: string;
  clientKey: string;
  host: string;
  /** VAPID public key (base64url) the subscription was created with. */
  publicKey: string;
}

/** The Device the SDK last registered. */
export interface StoredDevice {
  id: string;
  appId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  publicKey: string;
  /**
   * False while the sdk_name/sdk_version PATCH that follows the registration
   * has not been acknowledged, so the next init repeats it. A record written
   * by 0.1.0 has no flag and counts as acknowledged.
   */
  sdkSynced?: boolean;
  /**
   * When the server last saw this browser (epoch ms): the registration, the
   * sdk PATCH or a heartbeat. A record written by 0.1.0 or 0.1.1 has none.
   */
  seenAt?: number;
}

/** Set when the visitor opted in through `requestPermission`, whatever came next. */
export interface StoredOptIn {
  appId: string;
}

export const CONFIG_KEY = 'config';
export const DEVICE_KEY = 'device';
export const OPT_IN_KEY = 'optin';

/** Profile fields the host set; sent now if registered, else at registration. */
export interface StoredProfile {
  external_user_id?: string;
  tags: Record<string, string | number | boolean>;
  /** Fields not yet acknowledged by the server. */
  pending: ('external_user_id' | 'tags')[];
}

export const PROFILE_KEY = 'profile';
