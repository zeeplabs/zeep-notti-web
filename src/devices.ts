import { request, type ApiConfig, type Fetcher } from './api';
import { SDK_NAME, SDK_VERSION } from './version';

export interface WebKeys {
  p256dh: string;
  auth: string;
}

function devicesPath(config: ApiConfig): string {
  return `/v1/apps/${encodeURIComponent(config.appId)}/devices`;
}

/**
 * `POST /devices`: an upsert keyed by (app, endpoint, platform), so repeating
 * it never creates a duplicate. Returns the Device id.
 */
export async function createDevice(
  fetcher: Fetcher,
  config: ApiConfig,
  endpoint: string,
  keys: WebKeys,
  extra: { external_user_id?: string; tags?: Record<string, unknown> } = {}
): Promise<string> {
  const body = (await request(fetcher, config, 'POST', devicesPath(config), {
    token: endpoint,
    platform: 'web',
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    ...extra,
  })) as { id?: unknown } | undefined;
  if (!body || typeof body.id !== 'string' || !body.id) {
    throw new Error('device registration returned no id');
  }
  return body.id;
}

/**
 * `PATCH /devices/{id}`. A Client key must carry the Device's own token (the
 * push endpoint) as proof of ownership.
 */
export async function patchDevice(
  fetcher: Fetcher,
  config: ApiConfig,
  deviceId: string,
  endpoint: string,
  fields: Record<string, unknown>
): Promise<void> {
  await request(
    fetcher,
    config,
    'PATCH',
    `${devicesPath(config)}/${encodeURIComponent(deviceId)}`,
    { token: endpoint, ...fields }
  );
}

/** What the SDK reports about itself after every registration. */
export function sdkFields(): Record<string, unknown> {
  return {
    sdk_name: SDK_NAME,
    sdk_version: SDK_VERSION,
    permission_status: 'granted',
  };
}
