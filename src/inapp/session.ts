import { ApiError } from '../api';
import { nowOf, type Runtime, type SdkState } from '../runtime';
import {
  DEVICE_KEY,
  INAPP_DENIED_KEY,
  type StoredDevice,
  type StoredInAppDenial,
} from '../store';
import {
  fetchEligible,
  newEventId,
  reportInAppEvent,
  type InAppEvent,
} from './api';
import type { InAppClick, InAppMessage, LinkAction } from './types';

export type DismissReason = 'close_button' | 'outside_tap' | 'auto';

/** What the view tells the session about the visitor. */
export interface ViewHandlers {
  /** A button, or the image (`image`). */
  onClick(buttonId: string, action: LinkAction | null): void;
  onDismiss(reason: DismissReason): void;
}

/** The overlay. The session never touches the DOM. */
export interface InAppView {
  /**
   * Resolves true once the message is on screen, false when it could not be
   * shown (the image failed). It waits for the document to be visible first.
   */
  show(message: InAppMessage, handlers: ViewHandlers): Promise<boolean>;
  /** Idempotent. */
  close(): void;
}

export interface SessionDeps {
  view: InAppView;
  /** Runs after the message closed; its errors never reach the SDK. */
  onClick(click: InAppClick): void;
  warn?: (message: string) => void;
  newEventId?: () => string;
}

export interface InAppSession {
  /** Fetches once; a second call does nothing. Never throws. */
  start(state: SdkState, runtime: Runtime): Promise<void>;
  /** Safe to call before `start` finished, or before it was called at all. */
  trackEvent(name: string): void;
  /** Ends the session: closes what is visible and discards late answers. */
  stop(): void;
}

const MAX_REMEMBERED_EVENTS = 32;
const MAX_RATE_LIMIT_WAITS = 3;
const DEFAULT_RETRY_AFTER_SECONDS = 60;
const MIN_RETRY_AFTER_SECONDS = 1;
const MAX_RETRY_AFTER_SECONDS = 300;
/** How long a 403 from `eligible` keeps later page loads from asking again. */
const DENIAL_MEMORY_MS = 24 * 60 * 60 * 1000;

interface Visible {
  message: InAppMessage;
  /** The first interaction wins; later ones are ignored. */
  done: boolean;
}

export function createInAppSession(deps: SessionDeps): InAppSession {
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const makeEventId = deps.newEventId ?? newEventId;

  let started = false;
  let stopped = false;
  // True from the moment a message is being shown until it closes: one at a time.
  let busy = false;
  // False until eligible answered and the session-start message had its turn.
  let ready = false;
  let held: InAppMessage[] = [];
  const shown = new Set<string>();
  const remembered: string[] = [];
  let visible: Visible | null = null;
  let context: { runtime: Runtime; state: SdkState; device: StoredDevice } | null = null;

  /** Fire and forget: the visitor is never kept waiting for a report. */
  function report(message: InAppMessage, partial: Omit<InAppEvent, 'eventId' | 'occurredAt'>): void {
    if (!context) return;
    const { runtime, state, device } = context;
    const event: InAppEvent = {
      ...partial,
      eventId: makeEventId(),
      occurredAt: (runtime.now ?? Date.now)(),
    };
    // Each event leaves at once, not behind the one before it: a click that waited for a
    // slow impression would be lost when the listener navigates away. The server does not
    // need them in order (it keeps `occurred_at` and ignores a repeated `event_id`).
    void reportInAppEvent(runtime, state.config, device, message.id, event).catch((err: unknown) => {
      // The server no longer accepts this browser: stop asking, like a 401 or 403 from eligible.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) endSession();
    });
  }

  /** Ends the session: closes what is visible and discards late answers. */
  function endSession(): void {
    if (stopped && !visible) return;
    stopped = true;
    held = [];
    if (visible) closeVisible();
  }

  function closeVisible(): Visible | null {
    const current = visible;
    visible = null;
    busy = false;
    deps.view.close();
    return current;
  }

  const handlers: ViewHandlers = {
    onClick(buttonId, action) {
      if (!visible || visible.done) return;
      visible.done = true;
      const message = visible.message;
      report(message, { type: 'click', buttonId });
      closeVisible();
      try {
        deps.onClick({ messageId: message.id, buttonId, action });
      } catch {
        // A listener of the integrator must not break the SDK.
      }
    },
    onDismiss(reason) {
      if (!visible || visible.done) return;
      visible.done = true;
      const message = visible.message;
      report(message, { type: 'dismiss', reason });
      closeVisible();
    },
  };

  async function present(message: InAppMessage): Promise<boolean> {
    shown.add(message.id);
    let ok = false;
    try {
      ok = await deps.view.show(message, handlers);
    } catch {
      ok = false;
    }
    if (stopped) {
      deps.view.close();
      return false;
    }
    if (!ok) return false;
    visible = { message, done: false };
    report(message, { type: 'impression' });
    return true;
  }

  /** The first of `candidates` that can be shown. Leaves `busy` set when one is. */
  async function presentFirst(candidates: InAppMessage[]): Promise<boolean> {
    if (busy || stopped) return false;
    busy = true;
    for (const message of candidates) {
      if (shown.has(message.id)) continue;
      if (await present(message)) return true;
      if (stopped) break;
    }
    busy = false;
    return false;
  }

  function showForEvent(name: string): Promise<boolean> {
    const candidates = held.filter((m) => m.trigger.type === 'event' && m.trigger.name === name);
    return presentFirst(candidates);
  }

  async function rememberDenial(runtime: Runtime, device: StoredDevice): Promise<void> {
    const denial: StoredInAppDenial = { deviceId: device.id, at: nowOf(runtime) };
    try {
      await runtime.store.set(INAPP_DENIED_KEY, denial);
    } catch {
      // Without the memory the next page load asks once more, which is only noise.
    }
  }

  /** The 403 an earlier page load stored for this very device, if it is less than a day old. */
  async function recentDenial(runtime: Runtime, device: StoredDevice): Promise<'recent' | 'stale' | 'none'> {
    try {
      const denial = await runtime.store.get<StoredInAppDenial>(INAPP_DENIED_KEY);
      if (!denial) return 'none';
      const age = nowOf(runtime) - denial.at;
      return denial.deviceId === device.id && age >= 0 && age < DENIAL_MEMORY_MS ? 'recent' : 'stale';
    } catch {
      return 'none';
    }
  }

  async function fetchWithWaits(): Promise<InAppMessage[] | null> {
    if (!context) return null;
    const { runtime, state, device } = context;
    for (let waits = 0; ; waits++) {
      try {
        return await fetchEligible(runtime, state.config, device);
      } catch (err) {
        if (!(err instanceof ApiError)) return null;
        if (err.status === 403) {
          // No ids: this line can end up in a customer's console and bug reports.
          warn('[Notti] In-App messages are off for this page: the server did not accept this browser.');
          await rememberDenial(runtime, device);
          return null;
        }
        if (err.status !== 429 || waits >= MAX_RATE_LIMIT_WAITS || stopped) return null;
        const seconds = Math.min(
          MAX_RETRY_AFTER_SECONDS,
          Math.max(MIN_RETRY_AFTER_SECONDS, err.retryAfter ?? DEFAULT_RETRY_AFTER_SECONDS)
        );
        await runtime.sleep(seconds * 1000);
        if (stopped) return null;
      }
    }
  }

  async function run(state: SdkState, runtime: Runtime): Promise<void> {
    let device: StoredDevice | undefined;
    try {
      device = await runtime.store.get<StoredDevice>(DEVICE_KEY);
    } catch {
      device = undefined;
    }
    // No device means the visitor never accepted push: nothing to ask, nobody to prompt.
    if (!device || device.appId !== state.config.appId) {
      stopped = true;
      return;
    }
    context = { runtime, state, device };

    // A 403 earlier today (a device deleted on the server stays stored here): no request, no log.
    const denial = await recentDenial(runtime, device);
    if (denial === 'recent') {
      stopped = true;
      return;
    }

    const messages = await fetchWithWaits();
    // The server accepts this browser again: forget the old 403.
    if (messages && denial === 'stale') await runtime.store.delete(INAPP_DENIED_KEY).catch(() => undefined);
    if (stopped) return;
    if (!messages) {
      stopped = true;
      return;
    }

    held = messages.filter((m) => m.trigger.type === 'event');
    await presentFirst(messages.filter((m) => m.trigger.type === 'session_start'));
    if (stopped) return;

    ready = true;
    for (const name of remembered.splice(0)) {
      if (stopped) break;
      await showForEvent(name);
    }
  }

  return {
    async start(state, runtime) {
      if (started || stopped) return;
      started = true;
      try {
        await run(state, runtime);
      } catch {
        // An In-App failure must never change what `init` reports.
        stopped = true;
      }
    },

    trackEvent(name) {
      if (stopped || typeof name !== 'string' || !name) return;
      if (!ready) {
        if (remembered.length < MAX_REMEMBERED_EVENTS) remembered.push(name);
        return;
      }
      void showForEvent(name);
    },

    stop: endSession,
  };
}
