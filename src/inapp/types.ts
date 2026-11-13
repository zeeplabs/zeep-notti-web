export type Layout = 'top' | 'center' | 'bottom' | 'full';

export interface LinkAction {
  type: 'url' | 'deeplink';
  value: string;
}

export interface InAppButton {
  id: string;
  label: string;
  action: LinkAction;
}

export type Trigger = { type: 'session_start' } | { type: 'event'; name: string };

export interface InAppStyle {
  backgroundColor: string | undefined;
  textColor: string | undefined;
  buttonColor: string | undefined;
  buttonTextColor: string | undefined;
  textAlign: 'left' | 'center' | 'right';
  margin: boolean;
}

export interface InAppMessage {
  id: string;
  format: Layout;
  title: string;
  body: string;
  imageUrl: string | undefined;
  imageAction: LinkAction | undefined;
  style: InAppStyle;
  dismissAfterSeconds: number | undefined;
  trigger: Trigger;
  buttons: InAppButton[];
}

/** What the click listener receives. `buttonId` is `"image"` for a tap on the image. */
export interface InAppClick {
  messageId: string;
  buttonId: string;
  action: LinkAction | null;
}

const LAYOUTS: readonly string[] = ['top', 'center', 'bottom', 'full'];
const ALIGNMENTS: readonly string[] = ['left', 'center', 'right'];
const COLOR = /^#[0-9A-Fa-f]{6}$/;
const MAX_BUTTONS = 2;
const MAX_DISMISS_SECONDS = 300;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function color(value: unknown): string | undefined {
  return typeof value === 'string' && COLOR.test(value) ? value : undefined;
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Schemes a deeplink must never carry: they run code or read files in the page that follows it. */
const UNSAFE_SCHEME = /^(javascript|data|vbscript|file):/i;

/**
 * The SDK is the last barrier before a link reaches the integrator's page, so it
 * does not rely on the server alone: a `url` must be https, and a `deeplink` must
 * not be a script-running scheme. Leading whitespace and control characters are
 * ignored by browsers when they read a scheme, so they are ignored here too.
 */
function linkAction(value: unknown): LinkAction | undefined {
  if (!isObject(value)) return undefined;
  const { type, value: target } = value;
  if ((type !== 'url' && type !== 'deeplink') || typeof target !== 'string' || !target) {
    return undefined;
  }
  if (type === 'url') {
    return httpsUrl(target) === undefined ? undefined : { type, value: target };
  }
  // eslint-disable-next-line no-control-regex
  const scheme = target.replace(/^[\u0000-\u0020]+/, '').replace(/[\t\r\n]/g, '');
  return UNSAFE_SCHEME.test(scheme) ? undefined : { type, value: target };
}

function parseButtons(value: unknown): InAppButton[] {
  if (!Array.isArray(value)) return [];
  const buttons: InAppButton[] = [];
  for (const raw of value as unknown[]) {
    if (!isObject(raw)) continue;
    const id = text(raw['id']);
    const label = text(raw['label']);
    const action = linkAction(raw['action']);
    if (id && label && action) buttons.push({ id, label, action });
  }
  return buttons.slice(0, MAX_BUTTONS);
}

function parseStyle(value: unknown): InAppStyle {
  const style = isObject(value) ? value : {};
  const align = style['text_align'];
  return {
    backgroundColor: color(style['background_color']),
    textColor: color(style['text_color']),
    buttonColor: color(style['button_color']),
    buttonTextColor: color(style['button_text_color']),
    textAlign:
      typeof align === 'string' && ALIGNMENTS.includes(align)
        ? (align as InAppStyle['textAlign'])
        : 'left',
    margin: typeof style['margin'] === 'boolean' ? style['margin'] : true,
  };
}

function parseTrigger(value: unknown): Trigger | undefined {
  if (!isObject(value)) return undefined;
  if (value['type'] === 'session_start') return { type: 'session_start' };
  const name = text(value['name']);
  if (value['type'] === 'event' && name) return { type: 'event', name };
  return undefined;
}

function parseDismissAfter(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_DISMISS_SECONDS
    ? value
    : undefined;
}

function parseMessage(value: unknown): InAppMessage | undefined {
  if (!isObject(value)) return undefined;
  const id = text(value['id']);
  const title = text(value['title']);
  const body = text(value['body']);
  const trigger = parseTrigger(value['trigger']);
  if (!id || (!title && !body) || !trigger) return undefined;

  const format = value['format'];
  return {
    id,
    format:
      typeof format === 'string' && LAYOUTS.includes(format) ? (format as Layout) : 'center',
    title,
    body,
    imageUrl: httpsUrl(value['image_url']),
    imageAction: linkAction(value['image_action']),
    style: parseStyle(value['style']),
    dismissAfterSeconds: parseDismissAfter(value['dismiss_after_seconds']),
    trigger,
    buttons: parseButtons(value['buttons']),
  };
}

/**
 * Reads the answer of `eligible`. Fields it does not know are ignored; a
 * message it cannot show (no id, no text, a trigger it does not know) is
 * dropped instead of failing the others.
 */
export function parseEligibleResponse(body: unknown): InAppMessage[] {
  if (!isObject(body) || !Array.isArray(body['messages'])) return [];
  const messages: InAppMessage[] = [];
  for (const raw of body['messages'] as unknown[]) {
    const message = parseMessage(raw);
    if (message) messages.push(message);
  }
  return messages;
}
