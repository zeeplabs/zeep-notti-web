import { ESLint } from 'eslint';
import { describe, expect, it, vi } from 'vitest';
import { init } from '../../src/init';
import { createInAppSession } from '../../src/inapp/session';
import { Notti } from '../../src/index';
import { fakeRuntime, jsonResponse, supportedEnv } from '../helpers';

const opts = { appId: 'app_123', clientKey: 'ck_test_abc' };
const config = () => jsonResponse(200, { public_key: 'BPublicKey' });

function withInApp(inApp: NonNullable<ReturnType<typeof fakeRuntime>['runtime']['inApp']>) {
  const fake = fakeRuntime(config);
  fake.runtime.inApp = inApp;
  return fake;
}

describe('init starts In-App (WIAM-04)', () => {
  it('starts the session once, with the state it just built', async () => {
    const start = vi.fn(() => Promise.resolve());
    const fake = withInApp({ start });
    await expect(init(opts, fake.runtime)).resolves.toEqual({ supported: true });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ publicKey: 'BPublicKey', config: expect.objectContaining({ appId: 'app_123' }) }),
      fake.runtime
    );
  });

  it('does not start when the page turns In-App off with inApp: false', async () => {
    const start = vi.fn(() => Promise.resolve());
    const fake = withInApp({ start });
    await expect(init({ ...opts, inApp: false }, fake.runtime)).resolves.toEqual({ supported: true });
    expect(start).not.toHaveBeenCalled();
  });

  it.each([true, undefined, null, 0, 'false'])('keeps In-App on for inApp: %s', async (value) => {
    const start = vi.fn(() => Promise.resolve());
    const fake = withInApp({ start });
    await init({ ...opts, inApp: value as unknown as boolean }, fake.runtime);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('makes no In-App request with inApp: false even when a device is stored', async () => {
    const fake = fakeRuntime(config);
    await fake.runtime.store.set('device', {
      id: 'dev-1',
      appId: 'app_123',
      token: 'https://push.example/abc',
    });
    fake.runtime.inApp = createInAppSession({
      view: { show: () => Promise.resolve(true), close: () => undefined },
      onClick: () => undefined,
    });

    await init({ ...opts, inApp: false }, fake.runtime);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fake.requests.some((r) => r.url.includes('/in-app-messages'))).toBe(false);
  });

  it('does not wait for the session', async () => {
    const fake = withInApp({ start: () => new Promise<void>(() => undefined) });
    await expect(init(opts, fake.runtime)).resolves.toEqual({ supported: true });
  });

  it('is not affected by a session that rejects', async () => {
    const fake = withInApp({ start: () => Promise.reject(new Error('boom')) });
    await expect(init(opts, fake.runtime)).resolves.toEqual({ supported: true });
  });

  it('is not affected by a session that throws on the spot', async () => {
    const fake = withInApp({
      start: () => {
        throw new Error('boom');
      },
    });
    await expect(init(opts, fake.runtime)).resolves.toEqual({ supported: true });
  });

  it('does not start when the options are invalid, the browser is unsupported or the config fails', async () => {
    const start = vi.fn(() => Promise.resolve());

    const invalid = withInApp({ start });
    await init({ appId: '', clientKey: 'x' }, invalid.runtime);

    const unsupported = fakeRuntime(config, supportedEnv({ isSecureContext: false }));
    unsupported.runtime.inApp = { start };
    await init(opts, unsupported.runtime);

    const failing = fakeRuntime(() => jsonResponse(500, {}));
    failing.runtime.inApp = { start };
    await init(opts, failing.runtime);

    expect(start).not.toHaveBeenCalled();
  });

  it('makes no In-App request when no device is stored', async () => {
    const fake = fakeRuntime(config);
    const session = createInAppSession({
      view: { show: () => Promise.resolve(true), close: () => undefined },
      onClick: () => undefined,
    });
    fake.runtime.inApp = session;

    await init(opts, fake.runtime);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fake.requests.map((r) => r.url)).toEqual([
      'https://app.zeepnotti.app/v1/apps/app_123/web-push/config',
    ]);
  });
});

describe('public API', () => {
  it('exposes trackEvent and InAppMessages.addClickListener', () => {
    expect(typeof Notti.trackEvent).toBe('function');
    const subscription = Notti.InAppMessages.addClickListener(() => undefined);
    expect(typeof subscription.remove).toBe('function');
    subscription.remove();
  });

  it('never throws from trackEvent, whatever it is given', () => {
    expect(() => Notti.trackEvent('x')).not.toThrow();
    expect(() => Notti.trackEvent(undefined as unknown as string)).not.toThrow();
    expect(() => Notti.trackEvent({} as unknown as string)).not.toThrow();
  });
});

describe('lint rule', () => {
  const eslint = new ESLint();
  const lint = async (filePath: string, code: string) =>
    (await eslint.lintText(code, { filePath }))[0]?.messages.map((m) => m.ruleId) ?? [];

  it.each(['innerHTML', 'outerHTML', 'insertAdjacentHTML'])('bans %s in src/inapp/', async (property) => {
    const code = `export function f(el: HTMLElement): void { el.${property}${property === 'insertAdjacentHTML' ? "('beforeend', 'x')" : " = 'x'"}; }\n`;
    expect(await lint('src/inapp/example.ts', code)).toContain('no-restricted-properties');
  });

  it('leaves the rest of the SDK alone', async () => {
    const code = "export function f(el: HTMLElement): void { el.innerHTML = 'x'; }\n";
    expect(await lint('src/example.ts', code)).not.toContain('no-restricted-properties');
  });
});
