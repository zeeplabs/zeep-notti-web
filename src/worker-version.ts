import { VERSION_REQUEST } from './sw/worker';
import { SDK_VERSION } from './version';

const ANSWER_TIMEOUT_MS = 3_000;

/** Asks the active worker for its version; null when it does not answer. */
function askVersion(worker: {
  postMessage(message: unknown, transfer: Transferable[]): void;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, ANSWER_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      channel.port1.close();
      const version = (event.data as { version?: unknown } | null)?.version;
      resolve(typeof version === 'string' ? version : null);
    };
    try {
      worker.postMessage(VERSION_REQUEST, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * Compares the running worker with this SDK build. A mismatch (or a worker
 * that predates the version handshake) asks the browser to re-fetch the file
 * and warns once, since the host may still be serving an old copy.
 */
export async function ensureFreshWorker(registration: {
  active: { postMessage(m: unknown, t: Transferable[]): void } | null;
  update(): Promise<unknown>;
}): Promise<void> {
  if (!registration.active) return;
  const running = await askVersion(registration.active);
  if (running === SDK_VERSION) return;
  try {
    await registration.update();
  } catch {
    // Offline or blocked; the next init checks again.
  }
  console.warn(
    `[notti] The service worker is ${running ?? 'an unknown version'} but the SDK is ${SDK_VERSION}. Serve the notti-sw.js that ships with this SDK version.`
  );
}
