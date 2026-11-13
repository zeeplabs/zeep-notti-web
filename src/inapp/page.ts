import { createClickListeners } from './listeners';
import { createDomView } from './render';
import { createInAppSession, type InAppSession } from './session';

const listeners = createClickListeners();

let session: InAppSession | undefined;

/**
 * The one session of this page load. Created on first use, so a
 * `trackEvent` before `init` finishes still has somewhere to be remembered.
 */
export function pageSession(): InAppSession {
  return (session ??= createInAppSession({
    view: createDomView(),
    onClick: (click) => listeners.emit(click),
  }));
}

export const addClickListener = listeners.add;

/** Never throws, whatever the caller passes. */
export function trackEvent(name: string): void {
  try {
    pageSession().trackEvent(name);
  } catch {
    // In-App must not break the host page.
  }
}
