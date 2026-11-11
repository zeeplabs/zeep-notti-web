/** Default Notti host; override with `host` for a self-hosted instance. */
export const DEFAULT_HOST = 'https://app.zeepnotti.app';

const REQUEST_TIMEOUT_MS = 10_000;

export interface ApiConfig {
  appId: string;
  clientKey: string;
  /** Normalized: no trailing slash. */
  host: string;
}

/** A non-2xx answer from the Notti API. Never carries the request body. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code?: string) {
    super(`Notti API answered ${status}${code ? ` ${code}` : ''}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Normalizes the host option. Returns null when it is not a usable origin:
 * https, or http only for localhost development.
 */
export function normalizeHost(host: string | undefined): string | null {
  const raw = (host ?? DEFAULT_HOST).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return null;
  }
  if (url.username || url.password) return null;
  return url.origin;
}

export type Fetcher = typeof fetch;

/**
 * Sends one JSON request authenticated with the Client key (never a REST
 * key). Throws ApiError on a non-2xx answer; network failures propagate as
 * the underlying error so callers can tell them apart.
 */
export async function request(
  fetcher: Fetcher,
  config: ApiConfig,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.clientKey}`,
      Accept: 'application/json',
    };
    const init: RequestInit = { method, headers, signal: controller.signal };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetcher(`${config.host}${path}`, init);
    if (!res.ok) {
      throw new ApiError(res.status, await errorCode(res));
    }
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const parsed = (await res.json()) as {
      error?: { code?: unknown } | string;
    };
    const err = parsed.error;
    if (typeof err === 'string') return err;
    if (err && typeof err.code === 'string') return err.code;
  } catch {
    // Body is not JSON; the status alone is enough.
  }
  return undefined;
}

/** `GET /v1/apps/{app_id}/web-push/config`. */
export async function getWebPushConfig(
  fetcher: Fetcher,
  config: ApiConfig
): Promise<string> {
  const body = (await request(
    fetcher,
    config,
    'GET',
    `/v1/apps/${encodeURIComponent(config.appId)}/web-push/config`
  )) as { public_key?: unknown } | undefined;
  if (!body || typeof body.public_key !== 'string' || !body.public_key) {
    throw new ApiError(200, 'invalid_config');
  }
  return body.public_key;
}
