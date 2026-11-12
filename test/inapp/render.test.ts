// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDomView, preloadImage, type ViewEnv } from '../../src/inapp/render';
import type { DismissReason, ViewHandlers } from '../../src/inapp/session';
import type { InAppButton, InAppMessage } from '../../src/inapp/types';

const url = (value: string) => ({ type: 'url' as const, value });

function button(id: string, label = id): InAppButton {
  return { id, label, action: url(`https://x.example/${id}`) };
}

function message(overrides: Partial<InAppMessage> = {}): InAppMessage {
  return {
    id: 'm1',
    format: 'center',
    title: 'Hello',
    body: 'World',
    imageUrl: undefined,
    imageAction: undefined,
    style: {
      backgroundColor: undefined,
      textColor: undefined,
      buttonColor: undefined,
      buttonTextColor: undefined,
      textAlign: 'left',
      margin: true,
    },
    dismissAfterSeconds: undefined,
    trigger: { type: 'session_start' },
    buttons: [],
    ...overrides,
  };
}

interface Calls {
  clicks: Array<[string, unknown]>;
  dismisses: DismissReason[];
}

function handlers(): { calls: Calls; handlers: ViewHandlers } {
  const calls: Calls = { clicks: [], dismisses: [] };
  return {
    calls,
    handlers: {
      onClick: (id, action) => calls.clicks.push([id, action]),
      onDismiss: (reason) => calls.dismisses.push(reason),
    },
  };
}

const host = () => document.querySelector<HTMLElement>('[data-notti-in-app]');
const root = () => host()?.shadowRoot ?? null;
const q = <T extends Element = HTMLElement>(selector: string) => root()?.querySelector<T>(selector) ?? null;
const qa = (selector: string) => Array.from(root()?.querySelectorAll<HTMLElement>(selector) ?? []);

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

function key(name: string, options: KeyboardEventInit = {}, target: EventTarget = document): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true, ...options }));
}

function view(env: Partial<ViewEnv> = {}) {
  return createDomView({ loadImage: () => Promise.resolve(true), language: 'en-US', ...env });
}

beforeEach(() => {
  document.body.innerHTML = '';
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('isolation (WIAM-10)', () => {
  it('lives in one host with an open Shadow root appended to the body', async () => {
    const v = view();
    expect(await v.show(message(), handlers().handlers)).toBe(true);

    const hosts = document.querySelectorAll('[data-notti-in-app]');
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.parentElement).toBe(document.body);
    expect(host()?.shadowRoot?.mode).toBe('open');
    expect(document.body.textContent).not.toContain('Hello');
  });

  it('resets what the page can reach on the host element', async () => {
    await view().show(message(), handlers().handlers);
    expect(host()?.style.getPropertyValue('all')).toBe('initial');
  });

  it('removes everything on close and is idempotent', async () => {
    const v = view();
    await v.show(message(), handlers().handlers);
    v.close();
    v.close();
    expect(host()).toBeNull();
  });

  it('shows the second message after the first closed, in a fresh host', async () => {
    const v = view();
    await v.show(message({ id: 'a', title: 'First' }), handlers().handlers);
    v.close();
    await v.show(message({ id: 'b', title: 'Second' }), handlers().handlers);
    expect(document.querySelectorAll('[data-notti-in-app]')).toHaveLength(1);
    expect(q('.title')?.textContent).toBe('Second');
  });

  it('renders markup as text, never as HTML (WIAM-08)', async () => {
    await view().show(
      message({
        title: '<img src=x onerror=alert(1)>',
        body: '<b>bold</b> <script>1</script>',
        buttons: [button('b1', '<i>go</i>')],
      }),
      handlers().handlers
    );
    expect(q('.title')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(q('.body')?.textContent).toBe('<b>bold</b> <script>1</script>');
    expect(root()?.querySelector('b, script, i, img[onerror]')).toBeNull();
    expect(q('.btn')?.textContent).toBe('<i>go</i>');
  });

  it('applies the style tokens through CSSOM and flags custom button colours', async () => {
    await view().show(
      message({
        style: {
          backgroundColor: '#112233',
          textColor: '#FFFFFF',
          buttonColor: '#E94B8B',
          buttonTextColor: undefined,
          textAlign: 'center',
          margin: false,
        },
        buttons: [button('b1')],
      }),
      handlers().handlers
    );
    const ni = q('.ni');
    expect(ni?.style.getPropertyValue('--ni-bg')).toBe('#112233');
    expect(ni?.style.getPropertyValue('--ni-fg')).toBe('#FFFFFF');
    expect(ni?.style.getPropertyValue('--ni-btn-bg')).toBe('#E94B8B');
    expect(ni?.style.getPropertyValue('--ni-align')).toBe('center');
    expect(ni?.classList.contains('no-margin')).toBe(true);
    expect(ni?.classList.contains('custom-buttons')).toBe(true);
    expect(ni?.getAttribute('style')).not.toBeNull();
  });

  it('carries the stylesheet inside the root', async () => {
    await view().show(message(), handlers().handlers);
    expect(q('style')?.textContent).toContain('.panel');
  });
});

describe('layouts and semantics (WIAM-10, WIAM-11)', () => {
  it.each(['center', 'full'] as const)('%s is a modal dialog named by its title', async (format) => {
    await view().show(message({ format, buttons: [button('b1')] }), handlers().handlers);
    const panel = q('.panel');
    expect(panel?.getAttribute('role')).toBe('dialog');
    expect(panel?.getAttribute('aria-modal')).toBe('true');
    const labelledBy = panel?.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(root()?.getElementById(labelledBy ?? '')?.textContent).toBe('Hello');
    expect(q('.ni')?.classList.contains(`layout-${format}`)).toBe(true);
  });

  it.each(['top', 'bottom'] as const)('%s is a region named by its title, with no trap', async (format) => {
    await view().show(message({ format }), handlers().handlers);
    const panel = q('.panel');
    expect(panel?.getAttribute('role')).toBe('region');
    expect(panel?.getAttribute('aria-modal')).toBeNull();
    expect(panel?.getAttribute('aria-label')).toBe('Hello');
    expect(q('.backdrop')).toBeNull();
  });

  it('names a dialog without a title by its body', async () => {
    await view().show(message({ title: '', body: 'Only body' }), handlers().handlers);
    expect(q('.panel')?.getAttribute('aria-label')).toBe('Only body');
    expect(q('.title')).toBeNull();
  });

  it('has a backdrop only on center', async () => {
    const v = view();
    await v.show(message({ format: 'center' }), handlers().handlers);
    expect(q('.backdrop')).not.toBeNull();
    v.close();
    await v.show(message({ format: 'full' }), handlers().handlers);
    expect(q('.backdrop')).toBeNull();
  });

  it('always has a close control, with the visitor language', async () => {
    const en = view({ language: 'en-US' });
    await en.show(message({ dismissAfterSeconds: 5 }), handlers().handlers);
    expect(q('.close')?.getAttribute('aria-label')).toBe('Close');
    en.close();

    const pt = view({ language: 'pt-BR' });
    await pt.show(message(), handlers().handlers);
    expect(q('.close')?.getAttribute('aria-label')).toBe('Fechar');
  });

  it.each([
    ['center', true],
    ['full', true],
    ['top', false],
    ['bottom', false],
  ] as const)('marks a %s message with an image for the close backing: %s', async (format, expected) => {
    await view().show(message({ format, imageUrl: 'https://cdn.example/a.png' }), handlers().handlers);
    expect(q('.panel')?.classList.contains('has-image')).toBe(expected);
  });

  it('does not mark a message without an image', async () => {
    await view().show(message(), handlers().handlers);
    expect(q('.panel')?.classList.contains('has-image')).toBe(false);
  });

  it('shows at most two buttons, the first primary', async () => {
    await view().show(message({ buttons: [button('a'), button('b')] }), handlers().handlers);
    const buttons = qa('.btn');
    expect(buttons.map((b) => b.className)).toEqual(['btn primary', 'btn secondary']);
  });
});

describe('interactions (WIAM-06)', () => {
  it('reports a button click with its id and action', async () => {
    const h = handlers();
    await view().show(message({ buttons: [button('a'), button('b')] }), h.handlers);
    qa('.btn')[1]?.click();
    expect(h.calls.clicks).toEqual([['b', url('https://x.example/b')]]);
  });

  it('close button dismisses with close_button', async () => {
    const h = handlers();
    await view().show(message(), h.handlers);
    q('.close')?.click();
    expect(h.calls.dismisses).toEqual(['close_button']);
  });

  it('backdrop tap dismisses with outside_tap on center only', async () => {
    const h = handlers();
    await view().show(message({ format: 'center' }), h.handlers);
    q('.backdrop')?.click();
    expect(h.calls.dismisses).toEqual(['outside_tap']);
  });

  it('a tap inside the card is not an outside tap', async () => {
    const h = handlers();
    await view().show(message({ format: 'center' }), h.handlers);
    q('.panel')?.click();
    q('.text')?.click();
    expect(h.calls).toEqual({ clicks: [], dismisses: [] });
  });

  it('a tap on the image runs the image action as "image"', async () => {
    const h = handlers();
    await view().show(
      message({ imageUrl: 'https://cdn.example/a.png', imageAction: url('https://x.example/img') }),
      h.handlers
    );
    q('.image-button')?.click();
    expect(h.calls.clicks).toEqual([['image', url('https://x.example/img')]]);
  });

  it('an image without an action is a plain picture, not a control', async () => {
    await view().show(message({ imageUrl: 'https://cdn.example/a.png' }), handlers().handlers);
    expect(q('.image')).not.toBeNull();
    expect(q('.image-button')).toBeNull();
    expect(q<HTMLImageElement>('.image')?.getAttribute('alt')).toBe('');
  });

  it.each(['top', 'bottom'] as const)('a tap on the body of a %s bar runs the first button', async (format) => {
    const h = handlers();
    await view().show(message({ format, buttons: [button('a'), button('b')] }), h.handlers);
    q('.text')?.click();
    expect(h.calls.clicks).toEqual([['a', url('https://x.example/a')]]);
  });

  it('a bar without buttons ignores a tap on the body', async () => {
    const h = handlers();
    await view().show(message({ format: 'top' }), h.handlers);
    q('.text')?.click();
    expect(h.calls.clicks).toEqual([]);
    expect(q('.tappable')).toBeNull();
  });
});

describe('keyboard and focus (WIAM-10)', () => {
  it('moves focus to the first button and returns it on close', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    const v = view();
    await v.show(message({ buttons: [button('a'), button('b')] }), handlers().handlers);
    expect(root()?.activeElement).toBe(qa('.btn')[0]);

    v.close();
    expect(document.activeElement).toBe(opener);
  });

  it('focuses the close control when the message has no button', async () => {
    await view().show(message(), handlers().handlers);
    expect(root()?.activeElement).toBe(q('.close'));
  });

  it('wraps Tab and Shift+Tab inside a dialog', async () => {
    await view().show(message({ buttons: [button('a'), button('b')] }), handlers().handlers);
    const [first, second] = qa('.btn');
    const close = q('.close');

    close?.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, composed: true, cancelable: true });
    close?.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(root()?.activeElement).toBe(first);

    first?.focus();
    const back = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    first?.dispatchEvent(back);
    expect(back.defaultPrevented).toBe(true);
    expect(root()?.activeElement).toBe(close);

    second?.focus();
    const mid = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, composed: true, cancelable: true });
    second?.dispatchEvent(mid);
    expect(mid.defaultPrevented).toBe(false);
  });

  it('closes a dialog with Esc as close_button', async () => {
    const h = handlers();
    await view().show(message({ buttons: [button('a')] }), h.handlers);
    key('Escape');
    expect(h.calls.dismisses).toEqual(['close_button']);
  });

  it('closes a bar with Esc only while focus is inside it', async () => {
    const h = handlers();
    await view().show(message({ format: 'top', buttons: [button('a')] }), h.handlers);

    key('Escape');
    expect(h.calls.dismisses).toEqual([]);

    key('Escape', {}, qa('.btn')[0] as HTMLElement);
    expect(h.calls.dismisses).toEqual(['close_button']);
  });

  it('does not take focus when a bar opens', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    await view().show(message({ format: 'bottom', buttons: [button('a')] }), handlers().handlers);
    expect(document.activeElement).toBe(opener);
  });

  it('stops listening for Esc after close', async () => {
    const h = handlers();
    const v = view();
    await v.show(message(), h.handlers);
    v.close();
    key('Escape');
    expect(h.calls.dismisses).toEqual([]);
  });
});

describe('auto dismiss (WIAM-06)', () => {
  it('closes with auto after the configured seconds and keeps the close control', async () => {
    vi.useFakeTimers();
    const h = handlers();
    await view().show(message({ dismissAfterSeconds: 5 }), h.handlers);
    expect(q('.close')).not.toBeNull();

    vi.advanceTimersByTime(4999);
    expect(h.calls.dismisses).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(h.calls.dismisses).toEqual(['auto']);
  });

  it('is cancelled by an earlier close', async () => {
    vi.useFakeTimers();
    const h = handlers();
    const v = view();
    await v.show(message({ dismissAfterSeconds: 5 }), h.handlers);
    v.close();
    vi.advanceTimersByTime(10_000);
    expect(h.calls.dismisses).toEqual([]);
  });

  it('pauses while the document is hidden and resumes with what was left', async () => {
    vi.useFakeTimers();
    const h = handlers();
    await view().show(message({ dismissAfterSeconds: 10 }), h.handlers);

    vi.advanceTimersByTime(4000);
    setVisibility('hidden');
    vi.advanceTimersByTime(60_000);
    expect(h.calls.dismisses).toEqual([]);

    setVisibility('visible');
    vi.advanceTimersByTime(5999);
    expect(h.calls.dismisses).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(h.calls.dismisses).toEqual(['auto']);
  });

  it('has no timer without dismiss_after_seconds', async () => {
    vi.useFakeTimers();
    const h = handlers();
    await view().show(message(), h.handlers);
    vi.advanceTimersByTime(600_000);
    expect(h.calls.dismisses).toEqual([]);
  });
});

describe('visibility wait', () => {
  it('waits for the first visible moment before rendering', async () => {
    setVisibility('hidden');
    const v = view();
    let resolved = false;
    const shown = v.show(message(), handlers().handlers).then((ok) => {
      resolved = ok;
      return ok;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(host()).toBeNull();
    expect(resolved).toBe(false);

    setVisibility('visible');
    expect(await shown).toBe(true);
    expect(host()).not.toBeNull();
  });

  it('answers false and renders nothing when closed while waiting', async () => {
    setVisibility('hidden');
    const v = view();
    const shown = v.show(message(), handlers().handlers);
    v.close();
    setVisibility('visible');
    expect(await shown).toBe(false);
    expect(host()).toBeNull();
  });
});

describe('image gate (WIAM-08)', () => {
  it('does not render, and answers false, when the image fails', async () => {
    const h = handlers();
    const ok = await view({ loadImage: () => Promise.resolve(false) }).show(
      message({ imageUrl: 'https://cdn.example/a.png' }),
      h.handlers
    );
    expect(ok).toBe(false);
    expect(host()).toBeNull();
  });

  it('loads the image before rendering and uses the same url', async () => {
    const asked: string[] = [];
    await view({
      loadImage: (src) => {
        asked.push(src);
        return Promise.resolve(true);
      },
    }).show(message({ imageUrl: 'https://cdn.example/a.png' }), handlers().handlers);
    expect(asked).toEqual(['https://cdn.example/a.png']);
    expect(q<HTMLImageElement>('.image')?.getAttribute('src')).toBe('https://cdn.example/a.png');
  });

  it('never loads anything for a message without an image', async () => {
    const loadImage = vi.fn(() => Promise.resolve(true));
    await view({ loadImage }).show(message(), handlers().handlers);
    expect(loadImage).not.toHaveBeenCalled();
  });

  it('sends no referrer for the rendered image', async () => {
    await view().show(message({ imageUrl: 'https://cdn.example/a.png' }), handlers().handlers);
    expect(q<HTMLImageElement>('.image')?.referrerPolicy).toBe('no-referrer');
  });
});

describe('preloadImage', () => {
  class FakeImage {
    referrerPolicy = '';
    crossOrigin: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = '';
  }

  function loaderWith(image: FakeImage) {
    return preloadImage('https://cdn.example/a.png', { create: () => image, timeoutMs: 3000 });
  }

  it('resolves true on load, with no referrer and no CORS mode', async () => {
    const image = new FakeImage();
    const result = loaderWith(image);
    expect(image.referrerPolicy).toBe('no-referrer');
    expect(image.crossOrigin).toBeNull();
    expect(image.src).toBe('https://cdn.example/a.png');
    image.onload?.();
    expect(await result).toBe(true);
  });

  it('resolves false on error (a CSP block surfaces the same way)', async () => {
    const image = new FakeImage();
    const result = loaderWith(image);
    image.onerror?.();
    expect(await result).toBe(false);
  });

  it('resolves false after the cap and stops the download', async () => {
    vi.useFakeTimers();
    const image = new FakeImage();
    const result = loaderWith(image);
    vi.advanceTimersByTime(2999);
    vi.advanceTimersByTime(1);
    expect(await result).toBe(false);
    expect(image.src).toBe('');
  });

  it('ignores a load that arrives after the cap', async () => {
    vi.useFakeTimers();
    const image = new FakeImage();
    const result = loaderWith(image);
    vi.advanceTimersByTime(3000);
    image.onload?.();
    expect(await result).toBe(false);
  });
});
