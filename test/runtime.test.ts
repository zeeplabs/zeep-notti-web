import { describe, expect, it } from 'vitest';
import { defaultRuntime } from '../src/runtime';

describe('defaultRuntime', () => {
  it('shares one store, so each call does not open its own IndexedDB connection', () => {
    expect(defaultRuntime().store).toBe(defaultRuntime().store);
  });
});
