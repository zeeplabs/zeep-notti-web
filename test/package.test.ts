import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as {
  sideEffects: boolean | string[];
  exports: Record<string, unknown>;
  files: string[];
};

describe('package.json', () => {
  it('keeps the service worker file from being tree-shaken away', () => {
    // `import 'notti-web-sdk/sw'` in a bundled worker has no binding, so a
    // package that says it has no side effects would lose the import.
    expect(pkg.sideEffects).toEqual(['./dist/notti-sw.js']);
    expect(pkg.exports['./sw']).toBe('./dist/notti-sw.js');
  });

  it('publishes only dist', () => {
    expect(pkg.files).toEqual(['dist']);
  });
});
