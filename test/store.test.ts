import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { idbStore, memoryStore } from '../src/store';

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
