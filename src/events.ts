import { request, type ApiConfig, type Fetcher } from './api';
import { withRetry, type Sleep } from './retry';

export type EventType = 'received' | 'opened' | 'clicked';

/** Per-attempt cap for an event request, so a dead network fails fast. */
const EVENT_TIMEOUT_MS = 5_000;
const EVENT_ATTEMPTS = 3;

/**
 * `POST /notifications/{id}/events`, authenticated by the Client key with the
 * device's push endpoint as ownership proof. Retries a small, bounded number
 * of times (network errors, 5xx, 408, 429), then gives up: an engagement
 * event is never worth blocking anything. Never throws.
 */
export async function reportEvent(
  fetcher: Fetcher,
  config: ApiConfig,
  sleep: Sleep,
  event: {
    notificationId: string;
    deliveryId: string;
    type: EventType;
    token: string;
  }
): Promise<void> {
  try {
    await withRetry(
      () =>
        request(
          fetcher,
          config,
          'POST',
          `/v1/apps/${encodeURIComponent(config.appId)}/notifications/${encodeURIComponent(event.notificationId)}/events`,
          {
            delivery_id: event.deliveryId,
            type: event.type,
            token: event.token,
          },
          EVENT_TIMEOUT_MS
        ),
      sleep,
      EVENT_ATTEMPTS
    );
  } catch {
    // Dropped after the bounded retries.
  }
}
