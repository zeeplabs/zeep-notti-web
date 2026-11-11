import { describe, expect, it } from 'vitest';
import { detectSupport } from '../src/capabilities';
import { supportedEnv } from './helpers';

describe('detectSupport', () => {
  it('supports a modern desktop browser', () => {
    expect(detectSupport(supportedEnv())).toEqual({ supported: true });
  });

  it('reports insecure_context first', () => {
    expect(detectSupport(supportedEnv({ isSecureContext: false }))).toEqual({
      supported: false,
      reason: 'insecure_context',
    });
  });

  it('reports no_service_worker', () => {
    const env = supportedEnv();
    delete (env.navigator as { serviceWorker?: unknown }).serviceWorker;
    expect(detectSupport(env)).toEqual({
      supported: false,
      reason: 'no_service_worker',
    });
  });

  it('reports no_push_manager when PushManager is missing', () => {
    expect(detectSupport(supportedEnv({ PushManager: undefined }))).toEqual({
      supported: false,
      reason: 'no_push_manager',
    });
  });

  it('reports no_push_manager when Notification is missing', () => {
    expect(detectSupport(supportedEnv({ Notification: undefined }))).toEqual({
      supported: false,
      reason: 'no_push_manager',
    });
  });

  it('asks an iPhone browser tab to be added to the Home Screen', () => {
    const env = supportedEnv({
      PushManager: undefined,
      navigator: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)',
        platform: 'iPhone',
        serviceWorker: {},
      },
    });
    expect(detectSupport(env)).toEqual({
      supported: false,
      reason: 'ios_requires_home_screen',
    });
  });

  it('treats an iPad that reports as a Mac the same way', () => {
    const env = supportedEnv({
      PushManager: undefined,
      navigator: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari',
        platform: 'MacIntel',
        maxTouchPoints: 5,
        serviceWorker: {},
      },
    });
    expect(detectSupport(env).reason).toBe('ios_requires_home_screen');
  });

  it('supports iOS once installed to the Home Screen (navigator.standalone)', () => {
    const env = supportedEnv({
      navigator: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)',
        platform: 'iPhone',
        standalone: true,
        serviceWorker: {},
      },
    });
    expect(detectSupport(env)).toEqual({ supported: true });
  });

  it('supports iOS once installed to the Home Screen (display-mode)', () => {
    const env = supportedEnv({
      matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' }),
      navigator: {
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X)',
        platform: 'iPad',
        serviceWorker: {},
      },
    });
    expect(detectSupport(env)).toEqual({ supported: true });
  });

  it('does not throw when matchMedia throws', () => {
    const env = supportedEnv({
      PushManager: undefined,
      matchMedia: () => {
        throw new Error('boom');
      },
      navigator: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)',
        serviceWorker: {},
      },
    });
    expect(detectSupport(env).reason).toBe('ios_requires_home_screen');
  });

  it('does not throw outside a browser', () => {
    expect(detectSupport({})).toEqual({
      supported: false,
      reason: 'insecure_context',
    });
  });
});
