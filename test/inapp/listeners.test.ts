import { describe, expect, it, vi } from 'vitest';
import { createClickListeners } from '../../src/inapp/listeners';
import type { InAppClick } from '../../src/inapp/types';

const click: InAppClick = {
  messageId: 'm1',
  buttonId: 'b1',
  action: { type: 'url', value: 'https://x.example' },
};

describe('click listeners', () => {
  it('hands every listener the click', () => {
    const listeners = createClickListeners();
    const a = vi.fn();
    const b = vi.fn();
    listeners.add(a);
    listeners.add(b);
    listeners.emit(click);
    expect(a).toHaveBeenCalledWith(click);
    expect(b).toHaveBeenCalledWith(click);
  });

  it('stops calling a listener once removed, and remove is safe twice', () => {
    const listeners = createClickListeners();
    const handler = vi.fn();
    const subscription = listeners.add(handler);
    subscription.remove();
    subscription.remove();
    listeners.emit(click);
    expect(handler).not.toHaveBeenCalled();
  });

  it('treats the same function added twice as two subscriptions', () => {
    const listeners = createClickListeners();
    const handler = vi.fn();
    const first = listeners.add(handler);
    listeners.add(handler);
    first.remove();
    listeners.emit(click);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('keeps going when a listener throws', () => {
    const listeners = createClickListeners();
    const after = vi.fn();
    listeners.add(() => {
      throw new Error('integrator bug');
    });
    listeners.add(after);
    expect(() => listeners.emit(click)).not.toThrow();
    expect(after).toHaveBeenCalled();
  });

  it('lets a listener remove itself while being called', () => {
    const listeners = createClickListeners();
    const other = vi.fn();
    const self = listeners.add(() => self.remove());
    listeners.add(other);
    listeners.emit(click);
    listeners.emit(click);
    expect(other).toHaveBeenCalledTimes(2);
  });

  it('ignores something that is not a function', () => {
    const listeners = createClickListeners();
    const subscription = listeners.add('nope' as never);
    expect(() => subscription.remove()).not.toThrow();
    expect(() => listeners.emit(click)).not.toThrow();
  });
});
