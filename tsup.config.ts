import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
    sourcemap: true,
    target: 'es2020',
  },
  {
    // The service worker is a standalone script the integrator serves from
    // their own origin, so it is bundled as a self-contained IIFE.
    entry: { 'notti-sw': 'src/sw/notti-sw.ts' },
    format: ['iife'],
    platform: 'browser',
    minify: true,
    outExtension: () => ({ js: '.js' }),
    sourcemap: true,
    target: 'es2020',
  },
]);
