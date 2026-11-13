import { request, type ApiConfig } from '../api';
import type { Runtime } from '../runtime';
import { withRetry } from '../retry';
import type { StoredDevice } from '../store';
import { parseEligibleResponse, type InAppMessage } from './types';

export type InAppEventType = 'impression' | 'click' | 'dismiss';

/** One interaction, with the identity it keeps across retries. */
export interface InAppEvent {
  eventId: string;
  type: InAppEventType;
  /** For `click`: a button id, or `image`. */
  buttonId?: string;
  /** For `dismiss`. */
  reason?: string;
  /** Epoch ms of the moment it happened, not of the moment it is sent. */
  occurredAt: number;
}

function inAppPath(config: ApiConfig): string {
  return `/v1/apps/${encodeURIComponent(config.appId)}/in-app-messages`;
}

/**
 * `POST /in-app-messages/eligible`. The token of a web device is its push
 * endpoint. A single attempt: the caller decides what each status means.
 */
export async function fetchEligible(
  runtime: Runtime,
  config: ApiConfig,
  device: StoredDevice
): Promise<InAppMessage[]> {
  const body = await request(
    runtime.fetch,
    config,
    'POST',
    `${inAppPath(config)}/eligible`,
    { device_id: device.id, token: device.endpoint }
  );
  return parseEligibleResponse(body);
}

/**
 * `POST /in-app-messages/{id}/events`, with `keepalive` so a page that
 * navigates away does not cancel it. Retried with the bounded backoff; the
 * same `event_id` goes out each time, so a retry cannot double count.
 *
 * A browser may refuse `keepalive` on a request that needs a CORS preflight
 * (this one carries `Authorization`): `fetch` then rejects with a TypeError, the
 * same error a network failure gives. The first such failure turns `keepalive`
 * off for the rest of this event, so a refusal costs one repeated request and
 * never the event.
 */
export async function reportInAppEvent(
  runtime: Runtime,
  config: ApiConfig,
  device: StoredDevice,
  messageId: string,
  event: InAppEvent
): Promise<void> {
  const body: Record<string, unknown> = {
    device_id: device.id,
    token: device.endpoint,
    event_id: event.eventId,
    type: event.type,
    occurred_at: new Date(event.occurredAt).toISOString(),
  };
  if (event.buttonId !== undefined) body['button_id'] = event.buttonId;
  if (event.reason !== undefined) body['reason'] = event.reason;

  const path = `${inAppPath(config)}/${encodeURIComponent(messageId)}/events`;
  let keepalive = true;
  const send = () => request(runtime.fetch, config, 'POST', path, body, undefined, keepalive);

  await withRetry(async () => {
    try {
      await send();
    } catch (err) {
      if (!keepalive || !(err instanceof TypeError)) throw err;
      keepalive = false;
      await send();
    }
  }, runtime.sleep);
}

/** A UUID v4. `randomUUID` needs a secure context; the fallback does not. */
export function newEventId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
