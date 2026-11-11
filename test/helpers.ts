import type { BrowserEnv } from '../src/capabilities';
import type { Runtime } from '../src/runtime';

/** A desktop browser with everything Web Push needs. */
export function supportedEnv(overrides: Partial<BrowserEnv> = {}): BrowserEnv {
  return {
    isSecureContext: true,
    navigator: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130',
      platform: 'MacIntel',
      maxTouchPoints: 0,
      serviceWorker: {},
    },
    PushManager: class {},
    Notification: class {},
    ...overrides,
  };
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A runtime whose fetch records every request and answers from `respond`. */
export function fakeRuntime(
  respond: (req: RecordedRequest) => Response | Promise<Response>,
  env: BrowserEnv = supportedEnv()
): { runtime: Runtime; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const runtime: Runtime = {
    env,
    fetch: async (input, init) => {
      const req: RecordedRequest = {
        url: String(input),
        method: init?.method ?? 'GET',
        headers: { ...((init?.headers as Record<string, string>) ?? {}) },
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      requests.push(req);
      return respond(req);
    },
  };
  return { runtime, requests };
}
