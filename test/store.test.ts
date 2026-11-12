import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DB_NAME, idbStore, memoryStore } from '../src/store';

describe('idbStore', () => {
  it('round-trips and deletes values', async () => {
    const store = idbStore(new IDBFactory());
    expect(await store.get('k')).toBeUndefined();
    await store.set('k', { a: 1 });
    expect(await store.get('k')).toEqual({ a: 1 });
    await store.delete('k');
    expect(await store.get('k')).toBeUndefined();
  });

  it('shares data between two connections to the same database', async () => {
    const factory = new IDBFactory();
    await idbStore(factory).set('k', 'v');
    expect(await idbStore(factory).get('k')).toBe('v');
  });

  it('does not block a newer version of the database', async () => {
    const factory = new IDBFactory();
    const store = idbStore(factory);
    await store.set('k', 'v');

    // A later SDK that bumps the schema must not wait for this connection (an
    // open tab or worker on this version) to go away.
    const upgraded = await Promise.race([
      new Promise<'opened'>((resolve, reject) => {
        const req = factory.open(DB_NAME, 2);
        req.onsuccess = () => {
          req.result.close();
          resolve('opened');
        };
        req.onerror = () => reject(req.error);
      }),
      new Promise<'blocked'>((resolve) =>
        setTimeout(() => resolve('blocked'), 200)
      ),
    ]);
    expect(upgraded).toBe('opened');
  });

  it('opens a fresh connection after the old one was closed for an upgrade', async () => {
    const factory = new IDBFactory();
    const store = idbStore(factory);
    await store.set('k', 'v');
    await new Promise<void>((resolve, reject) => {
      const req = factory.open(DB_NAME, 2);
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });

    // The store reopens instead of holding on to the closed connection; the
    // database is now newer than this version, which the open reports.
    await expect(store.get('k')).rejects.toBeDefined();
  });

  it('falls back to memory when IndexedDB is missing', async () => {
    const store = idbStore(undefined);
    await store.set('k', 1);
    expect(await store.get('k')).toBe(1);
  });
});

describe('memoryStore', () => {
  it('isolates instances', async () => {
    const a = memoryStore();
    await a.set('k', 1);
    expect(await memoryStore().get('k')).toBeUndefined();
  });
});
