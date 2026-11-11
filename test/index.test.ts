import { describe, expect, it } from 'vitest';
import { SDK_NAME } from '../src/index';

describe('package', () => {
  it('reports the web sdk name', () => {
    expect(SDK_NAME).toBe('web');
  });
});
