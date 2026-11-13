import type { DismissReason, InAppView, ViewHandlers } from './session';
import { STYLESHEET, styleVariables } from './styles';
import type { InAppButton, InAppMessage } from './types';

/** What the view needs from the page, injectable for tests. */
export interface ViewEnv {
  document: Document;
  /** Resolves true when the image loaded; false on error or after the cap. */
  loadImage(src: string): Promise<boolean>;
  /** The visitor's language, for the close control. */
  language: string;
  /**
   * Whether the overlay's stylesheet took effect. Only asked when the styles went in as a
   * `<style>` element, which a strict `style-src` blocks without telling anyone.
   */
  stylesApplied(root: HTMLElement): boolean;
}

export const IMAGE_TIMEOUT_MS = 3000;

const LABELS = {
  en: { close: 'Close' },
  'pt-BR': { close: 'Fechar' },
} as const;

const SVG_NS = 'http://www.w3.org/2000/svg';
const FOCUSABLE = 'button:not([disabled])';

interface ImageLike {
  referrerPolicy: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
}

/**
 * Loads the image before the message is shown, so a broken or blocked image
 * (a page CSP surfaces as `error`) means no message and no impression. No
 * referrer and no CORS mode: the host the author chose learns as little as
 * an `<img>` allows.
 */
export function preloadImage(
  src: string,
  options: { create?: () => ImageLike; timeoutMs?: number } = {}
): Promise<boolean> {
  const create = options.create ?? (() => new Image());
  const timeoutMs = options.timeoutMs ?? IMAGE_TIMEOUT_MS;
  return new Promise((resolve) => {
    const image = create();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      // Stops the download that the cap gave up on.
      if (!ok) image.src = '';
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    image.referrerPolicy = 'no-referrer';
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = src;
  });
}

function defaultEnv(): ViewEnv {
  return {
    document: globalThis.document,
    loadImage: (src) => preloadImage(src),
    language: globalThis.navigator?.language ?? 'en',
    stylesApplied: (root) => {
      const view = root.ownerDocument.defaultView;
      // The stylesheet makes the overlay `position: fixed`; unstyled, it is `static`.
      return !view || view.getComputedStyle(root).position === 'fixed';
    },
  };
}

function labelsFor(language: string): (typeof LABELS)[keyof typeof LABELS] {
  return language.toLowerCase().startsWith('pt') ? LABELS['pt-BR'] : LABELS.en;
}

/**
 * Constructable stylesheets are not blocked by a strict `style-src`; a <style> element is.
 * Says which way the styles went in, because only the second can be silently refused.
 */
function applyStyles(shadow: ShadowRoot, doc: Document): 'adopted' | 'element' {
  try {
    if (
      'adoptedStyleSheets' in shadow &&
      typeof CSSStyleSheet === 'function' &&
      'replaceSync' in CSSStyleSheet.prototype
    ) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLESHEET);
      shadow.adoptedStyleSheets = [sheet];
      return 'adopted';
    }
  } catch {
    // Fall through to the element.
  }
  const style = doc.createElement('style');
  style.textContent = STYLESHEET;
  shadow.append(style);
  return 'element';
}

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function closeIcon(doc: Document): SVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M6 6l12 12M18 6L6 18');
  svg.append(path);
  return svg;
}

interface Built {
  host: HTMLElement;
  shadow: ShadowRoot;
  root: HTMLElement;
  panel: HTMLElement;
  modal: boolean;
  /** True when the styles went in as a `<style>` element, the path a strict CSP can refuse. */
  elementStyles: boolean;
}

interface Active extends Built {
  /** Undoes listeners and timers. */
  cleanups: Array<() => void>;
  /** The element that had focus before a dialog took it. */
  returnFocusTo: HTMLElement | null;
}

function build(
  doc: Document,
  message: InAppMessage,
  handlers: ViewHandlers,
  labels: { close: string }
): Built {
  const modal = message.format === 'center' || message.format === 'full';
  const name = message.title || message.body;

  const host = doc.createElement('div');
  host.setAttribute('data-notti-in-app', '');
  // The page's own `div` rules must not reach the host; the overlay is `position: fixed` inside.
  host.style.cssText = 'all: initial !important; display: block !important;';
  const shadow = host.attachShadow({ mode: 'open' });
  const styleWay = applyStyles(shadow, doc);

  const root = element(doc, 'div', `ni layout-${message.format}`);
  if (!message.style.margin) root.classList.add('no-margin');
  if (message.style.buttonColor || message.style.buttonTextColor) root.classList.add('custom-buttons');
  // CSSOM, not a `style` attribute: a strict `style-src` blocks the attribute form.
  for (const [property, value] of Object.entries(styleVariables(message.style))) {
    root.style.setProperty(property, value);
  }

  // A click on the page behind a dialog must not take focus out of it (focus on `body` ends the Tab trap).
  const keepFocus = (event: Event) => event.preventDefault();
  if (message.format === 'center') {
    const backdrop = element(doc, 'div', 'backdrop');
    backdrop.addEventListener('mousedown', keepFocus);
    backdrop.addEventListener('click', () => handlers.onDismiss('outside_tap'));
    root.append(backdrop);
  } else if (message.format === 'full') {
    // `full` is modal too, but it has no outside to tap: the margin around the panel is a transparent
    // shield, so the page behind it is not clickable and focus stays inside. It does not dismiss.
    const shield = element(doc, 'div', 'backdrop shield');
    shield.addEventListener('mousedown', keepFocus);
    root.append(shield);
  }

  const panel = element(doc, 'div', 'panel');
  if (modal) {
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
  } else {
    panel.setAttribute('role', 'region');
  }

  if (message.imageUrl) {
    // On a dialog the picture sits under the close control, which then needs its own backing.
    if (modal) panel.classList.add('has-image');
    const image = element(doc, 'img', 'image');
    image.src = message.imageUrl;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    const action = message.imageAction;
    if (action) {
      const control = element(doc, 'button', 'image-button');
      control.type = 'button';
      control.setAttribute('aria-label', name);
      control.addEventListener('click', () => handlers.onClick('image', action));
      control.append(image);
      panel.append(control);
    } else {
      panel.append(image);
    }
  }

  const text = element(doc, 'div', 'text');
  // A bar is not a dialog, so nothing announces it: its text is a polite live region.
  if (!modal) text.setAttribute('aria-live', 'polite');
  if (message.title) {
    const title = element(doc, 'h2', 'title', message.title);
    title.id = 'ni-title';
    text.append(title);
  }
  if (message.body) text.append(element(doc, 'p', 'body', message.body));
  panel.append(text);

  if (modal && message.title) {
    panel.setAttribute('aria-labelledby', 'ni-title');
  } else {
    panel.setAttribute('aria-label', name);
  }

  const first = message.buttons[0];
  if (!modal && first) {
    // On a bar, a tap on the body runs the first button (contract).
    text.classList.add('tappable');
    text.addEventListener('click', () => handlers.onClick(first.id, first.action));
  }

  if (message.buttons.length > 0) {
    const buttons = element(doc, 'div', 'buttons');
    message.buttons.forEach((definition: InAppButton, index) => {
      const control = element(
        doc,
        'button',
        `btn ${index === 0 ? 'primary' : 'secondary'}`,
        definition.label
      );
      control.type = 'button';
      control.addEventListener('click', () => handlers.onClick(definition.id, definition.action));
      buttons.append(control);
    });
    panel.append(buttons);
  }

  // Last in the DOM so the first Tab stop is the content; it is positioned top right.
  const close = element(doc, 'button', 'close');
  close.type = 'button';
  close.setAttribute('aria-label', labels.close);
  close.append(closeIcon(doc));
  close.addEventListener('click', () => handlers.onDismiss('close_button'));
  panel.append(close);

  root.append(panel);
  shadow.append(root);
  return { host, shadow, root, panel, modal, elementStyles: styleWay === 'element' };
}

/** The real overlay: one host with an open Shadow root, removed on close. */
export function createDomView(overrides: Partial<ViewEnv> = {}): InAppView {
  // Resolved per call, not at import: the page may not have a document when the SDK loads.
  const envNow = (): ViewEnv => ({ ...defaultEnv(), ...overrides });

  // Bumped by every close(), so a `show` still waiting on the image or on
  // visibility knows it was cancelled.
  let generation = 0;
  let stopWaiting: (() => void) | null = null;
  let active: Active | null = null;

  function close(): void {
    generation++;
    stopWaiting?.();
    stopWaiting = null;
    const current = active;
    active = null;
    if (!current) return;
    for (const undo of current.cleanups.splice(0)) undo();
    current.host.remove();
    const target = current.returnFocusTo;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }

  function waitUntilVisible(doc: Document): Promise<void> {
    return new Promise((resolve) => {
      const onChange = () => {
        if (doc.visibilityState === 'visible') release();
      };
      const release = () => {
        doc.removeEventListener('visibilitychange', onChange);
        stopWaiting = null;
        resolve();
      };
      stopWaiting = release;
      doc.addEventListener('visibilitychange', onChange);
    });
  }

  function startAutoDismiss(
    doc: Document,
    seconds: number,
    onDismiss: (reason: DismissReason) => void,
    cleanups: Array<() => void>,
    /** A bar: the countdown also waits while the visitor points at it or has focus inside it. */
    holdOn?: HTMLElement
  ): void {
    let remaining = seconds * 1000;
    let startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hidden = doc.visibilityState === 'hidden';
    let hovered = false;
    let focused = false;

    const pause = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      remaining -= Date.now() - startedAt;
    };
    const resume = () => {
      if (timer !== undefined) return;
      startedAt = Date.now();
      timer = setTimeout(() => onDismiss('auto'), Math.max(0, remaining));
    };
    // The countdown does not run while nobody can see the message, or is reading it.
    const sync = () => (hidden || hovered || focused ? pause() : resume());

    const onVisibility = () => {
      hidden = doc.visibilityState === 'hidden';
      sync();
    };
    doc.addEventListener('visibilitychange', onVisibility);
    cleanups.push(() => {
      doc.removeEventListener('visibilitychange', onVisibility);
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    });

    if (holdOn) {
      const target = holdOn;
      const on = (type: string, handler: (event: Event) => void) => {
        target.addEventListener(type, handler);
        cleanups.push(() => target.removeEventListener(type, handler));
      };
      on('mouseenter', () => {
        hovered = true;
        sync();
      });
      on('mouseleave', () => {
        hovered = false;
        sync();
      });
      on('focusin', () => {
        focused = true;
        sync();
      });
      on('focusout', (event) => {
        const next = (event as FocusEvent).relatedTarget;
        focused = next instanceof Node && target.contains(next);
        sync();
      });
    }
    sync();
  }

  function trapTab(built: Built, event: KeyboardEvent): void {
    const items = Array.from(built.panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const current = built.shadow.activeElement;
    if (event.shiftKey && (current === first || !current || !items.includes(current as HTMLElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return {
    async show(message, handlers) {
      close();
      const token = generation;
      const env = envNow();
      const doc = env.document;

      if (message.imageUrl) {
        const loaded = await env.loadImage(message.imageUrl);
        if (token !== generation || !loaded) return false;
      }
      if (doc.visibilityState !== 'visible') {
        await waitUntilVisible(doc);
        if (token !== generation) return false;
      }

      const built = build(doc, message, handlers, labelsFor(env.language));
      const cleanups: Array<() => void> = [];
      const previous = doc.activeElement;
      doc.body.append(built.host);
      // A page whose CSP blocks the `<style>` fallback would show the text unstyled at the end of the
      // page. Better nothing, and no impression for something nobody saw.
      if (built.elementStyles && !env.stylesApplied(built.root)) {
        built.host.remove();
        return false;
      }
      active = {
        ...built,
        cleanups,
        returnFocusTo:
          built.modal && previous instanceof HTMLElement && previous !== doc.body ? previous : null,
      };

      if (built.modal) {
        // Esc is heard on the document so it works wherever focus ended up.
        const onKey = (event: KeyboardEvent) => {
          if (event.key === 'Escape') handlers.onDismiss('close_button');
        };
        doc.addEventListener('keydown', onKey);
        cleanups.push(() => doc.removeEventListener('keydown', onKey));
        built.root.addEventListener('keydown', (event) => {
          if (event.key === 'Tab') trapTab(built, event);
        });
        built.shadow.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      } else {
        // A bar is not modal: Esc counts only while focus is inside it.
        built.root.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') handlers.onDismiss('close_button');
        });
      }

      if (message.dismissAfterSeconds !== undefined) {
        startAutoDismiss(
          doc,
          message.dismissAfterSeconds,
          handlers.onDismiss,
          cleanups,
          built.modal ? undefined : built.panel
        );
      }
      return true;
    },

    close,
  };
}
