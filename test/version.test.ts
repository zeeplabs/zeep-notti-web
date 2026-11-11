import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SDK_NAME, SDK_VERSION } from '../src/version';

describe('version', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { version: string };
    expect(SDK_VERSION).toBe(pkg.version);
  });

  it('reports the web sdk name', () => {
    expect(SDK_NAME).toBe('web');
  });
});
