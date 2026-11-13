import type { InAppClick } from './types';

export type ClickHandler = (click: InAppClick) => void;

/** What `addClickListener` hands back; `remove` is safe to call twice. */
export interface ClickSubscription {
  remove(): void;
}

export interface ClickListeners {
  add(handler: ClickHandler): ClickSubscription;
  emit(click: InAppClick): void;
}

/** The integrator's click handlers. The SDK never opens a link itself; they do. */
export function createClickListeners(): ClickListeners {
  const handlers = new Set<ClickHandler>();
  return {
    add(handler) {
      if (typeof handler !== 'function') return { remove: () => undefined };
      // A wrapper, so the same function added twice is two subscriptions.
      const entry: ClickHandler = (click) => handler(click);
      handlers.add(entry);
      return { remove: () => void handlers.delete(entry) };
    },
    emit(click) {
      for (const handler of [...handlers]) {
        try {
          handler(click);
        } catch {
          // One integrator's bug must not stop the others or the SDK.
        }
      }
    },
  };
}
