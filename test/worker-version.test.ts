import { afterEach, describe, expect, it, vi } from 'vitest';
import { SDK_VERSION } from '../src/version';
import { ensureFreshWorker } from '../src/worker-version';

function registration(reply: string | null | 'silent') {
  const update = vi.fn(async () => undefined);
  return {
    update,
    reg: {
      update,
      active: {
        postMessage: (_m: unknown, transfer: MessagePort[]) => {
          if (reply === 'silent') return;
          transfer[0]?.postMessage(reply === null ? {} : { version: reply });
        },
      },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ensureFreshWorker', () => {
  it('does nothing when the worker matches the SDK', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { reg, update } = registration(SDK_VERSION);
    await ensureFreshWorker(reg);
    expect(update).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('asks the browser to update and warns on a stale worker', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { reg, update } = registration('0.0.0-old');
    await ensureFreshWorker(reg);
    expect(update).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('0.0.0-old');
  });

  it('treats a worker that gives no version as stale', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { reg, update } = registration(null);
    await ensureFreshWorker(reg);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('treats a worker that never answers as stale after a deadline', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { reg, update } = registration('silent');
    const pending = ensureFreshWorker(reg);
    await vi.advanceTimersByTimeAsync(3_000);
    await pending;
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('survives an update that fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { reg } = registration('old');
    reg.update = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(ensureFreshWorker(reg)).resolves.toBeUndefined();
  });

  it('does nothing without an active worker', async () => {
    const update = vi.fn();
    await ensureFreshWorker({ active: null, update });
    expect(update).not.toHaveBeenCalled();
  });
});
