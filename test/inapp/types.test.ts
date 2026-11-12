import { describe, expect, it } from 'vitest';
import { parseEligibleResponse } from '../../src/inapp/types';

const base = {
  id: '5b2f0c0e-1111-4222-8333-444455556666',
  format: 'center',
  title: 'Hello',
  body: 'World',
  style: null,
  dismiss_after_seconds: null,
  trigger: { type: 'session_start' },
  buttons: [],
};

function parse(overrides: Record<string, unknown> = {}) {
  return parseEligibleResponse({ messages: [{ ...base, ...overrides }] });
}

describe('parseEligibleResponse', () => {
  it('parses a plain message', () => {
    expect(parse()).toEqual([
      {
        id: base.id,
        format: 'center',
        title: 'Hello',
        body: 'World',
        imageUrl: undefined,
        imageAction: undefined,
        style: {
          backgroundColor: undefined,
          textColor: undefined,
          buttonColor: undefined,
          buttonTextColor: undefined,
          textAlign: 'left',
          margin: true,
        },
        dismissAfterSeconds: undefined,
        trigger: { type: 'session_start' },
        buttons: [],
      },
    ]);
  });

  it('ignores fields it does not know', () => {
    const [message] = parse({ future_field: { a: 1 }, style: { future: 1 } });
    expect(message?.id).toBe(base.id);
  });

  it.each(['top', 'center', 'bottom', 'full'])('keeps the %s layout', (format) => {
    expect(parse({ format })[0]?.format).toBe(format);
  });

  it.each(['modal', 'toast', '', 7, undefined])('renders %j as center', (format) => {
    expect(parse({ format })[0]?.format).toBe('center');
  });

  it('returns nothing for a body that is not an eligible answer', () => {
    expect(parseEligibleResponse(undefined)).toEqual([]);
    expect(parseEligibleResponse({ messages: 'x' })).toEqual([]);
    expect(parseEligibleResponse({})).toEqual([]);
  });

  it('drops a message without an id, without text, or with an unknown trigger', () => {
    expect(parse({ id: '' })).toEqual([]);
    expect(parse({ title: '', body: '' })).toEqual([]);
    expect(parse({ trigger: { type: 'location' } })).toEqual([]);
    expect(parse({ trigger: { type: 'event', name: '' } })).toEqual([]);
    expect(parse({ trigger: undefined })).toEqual([]);
  });

  it('keeps an event trigger with its name', () => {
    expect(parse({ trigger: { type: 'event', name: 'checkout_done' } })[0]?.trigger).toEqual({
      type: 'event',
      name: 'checkout_done',
    });
  });

  it('accepts a message with only a title or only a body', () => {
    expect(parse({ title: '' })).toHaveLength(1);
    expect(parse({ body: '' })).toHaveLength(1);
  });

  describe('image', () => {
    it('keeps an https image and its action', () => {
      const [message] = parse({
        image_url: 'https://cdn.example.com/a.png',
        image_action: { type: 'url', value: 'https://example.com/offer' },
      });
      expect(message?.imageUrl).toBe('https://cdn.example.com/a.png');
      expect(message?.imageAction).toEqual({ type: 'url', value: 'https://example.com/offer' });
    });

    it.each(['http://cdn.example.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'not a url', 7])(
      'ignores the image %j',
      (imageUrl) => {
        expect(parse({ image_url: imageUrl })[0]?.imageUrl).toBeUndefined();
      }
    );

    it('ignores an image action that is not a link', () => {
      expect(parse({ image_action: { type: 'push_permission' } })[0]?.imageAction).toBeUndefined();
      expect(parse({ image_action: { type: 'url' } })[0]?.imageAction).toBeUndefined();
    });
  });

  describe('buttons', () => {
    const link = { type: 'url', value: 'https://example.com/docs' };

    it('keeps up to two buttons in order', () => {
      const buttons = parse({
        buttons: [
          { id: 'b1', label: 'One', action: link },
          { id: 'b2', label: 'Two', action: { type: 'deeplink', value: 'exampleapp://offers/42' } },
          { id: 'b3', label: 'Three', action: link },
        ],
      })[0]?.buttons;
      expect(buttons?.map((b) => b.id)).toEqual(['b1', 'b2']);
    });

    it('drops a button without id or label, or whose action it cannot hand over', () => {
      const buttons = parse({
        buttons: [
          { id: '', label: 'No id', action: link },
          { id: 'b2', label: '', action: link },
          { id: 'b3', label: 'Push', action: { type: 'push_permission' } },
          { id: 'b4', label: 'No value', action: { type: 'url' } },
          { id: 'b5', label: 'Fine', action: link },
        ],
      })[0]?.buttons;
      expect(buttons?.map((b) => b.id)).toEqual(['b5']);
    });
  });

  describe('style', () => {
    it('keeps valid tokens', () => {
      const [message] = parse({
        style: {
          background_color: '#112233',
          text_color: '#AABBCC',
          button_color: '#E94B8B',
          button_text_color: '#FFFFFF',
          text_align: 'center',
          margin: false,
        },
      });
      expect(message?.style).toEqual({
        backgroundColor: '#112233',
        textColor: '#AABBCC',
        buttonColor: '#E94B8B',
        buttonTextColor: '#FFFFFF',
        textAlign: 'center',
        margin: false,
      });
    });

    it.each(['red', '#FFF', '#GGGGGG', '#11223344', 'rgb(0,0,0)', 'url(x)', '#112233; x: y', 5, null])(
      'falls back to the default for the colour %j',
      (color) => {
        expect(parse({ style: { background_color: color } })[0]?.style.backgroundColor).toBeUndefined();
      }
    );

    it('falls back for an unknown text_align and a non-boolean margin', () => {
      const style = parse({ style: { text_align: 'justify', margin: 'yes' } })[0]?.style;
      expect(style?.textAlign).toBe('left');
      expect(style?.margin).toBe(true);
    });
  });

  describe('dismiss_after_seconds', () => {
    it.each([1, 30, 300])('keeps %i', (seconds) => {
      expect(parse({ dismiss_after_seconds: seconds })[0]?.dismissAfterSeconds).toBe(seconds);
    });

    it.each([0, -1, 301, 1.5, '5', null])('ignores %j', (seconds) => {
      expect(parse({ dismiss_after_seconds: seconds })[0]?.dismissAfterSeconds).toBeUndefined();
    });
  });
});
