import { describe, expect, it } from 'vitest';
import { STYLESHEET, styleVariables } from '../../src/inapp/styles';

const tokens = (overrides: Partial<Parameters<typeof styleVariables>[0]> = {}) =>
  styleVariables({
    backgroundColor: undefined,
    textColor: undefined,
    buttonColor: undefined,
    buttonTextColor: undefined,
    textAlign: 'left',
    margin: true,
    ...overrides,
  });

describe('styleVariables', () => {
  it('is empty-but-for-alignment when no colour token is set', () => {
    expect(tokens()).toEqual({ '--ni-align': 'left' });
  });

  it('keeps every token the author set, as it is', () => {
    expect(
      tokens({
        backgroundColor: '#112233',
        textColor: '#EEEEEE',
        buttonColor: '#E94B8B',
        buttonTextColor: '#000000',
        textAlign: 'right',
      })
    ).toMatchObject({
      '--ni-bg': '#112233',
      '--ni-fg': '#EEEEEE',
      '--ni-btn-bg': '#E94B8B',
      '--ni-btn-fg': '#000000',
      '--ni-align': 'right',
    });
  });

  describe('a token whose partner was not set (the default would follow the visitor, not the author)', () => {
    it('gives light text to a dark background and dark text to a light one', () => {
      expect(tokens({ backgroundColor: '#102030' })).toMatchObject({
        '--ni-bg': '#102030',
        '--ni-fg': '#FFFFFF',
      });
      expect(tokens({ backgroundColor: '#FFFFFF' })).toMatchObject({ '--ni-fg': '#1A1A1A' });
      expect(tokens({ backgroundColor: '#F2F2F2' })).toMatchObject({ '--ni-fg': '#1A1A1A' });
    });

    it('does not override a text colour the author chose', () => {
      expect(tokens({ backgroundColor: '#102030', textColor: '#102030' })['--ni-fg']).toBe('#102030');
    });

    it('gives a panel to a lone text colour', () => {
      expect(tokens({ textColor: '#FFFFFF' })).toMatchObject({ '--ni-fg': '#FFFFFF', '--ni-bg': '#1F1F1F' });
      expect(tokens({ textColor: '#111111' })).toMatchObject({ '--ni-fg': '#111111', '--ni-bg': '#FFFFFF' });
    });

    it('draws the outline of the secondary button for the panel it sits on', () => {
      expect(tokens({ backgroundColor: '#102030' })['--ni-border']).toBe('rgba(255, 255, 255, 0.24)');
      expect(tokens({ backgroundColor: '#FFFFFF' })['--ni-border']).toBe('rgba(0, 0, 0, 0.18)');
      expect(tokens({})['--ni-border']).toBeUndefined();
    });

    it('gives readable text to a lone button colour', () => {
      expect(tokens({ buttonColor: '#FFFFFF' })).toMatchObject({
        '--ni-btn-bg': '#FFFFFF',
        '--ni-btn-fg': '#1A1A1A',
      });
      expect(tokens({ buttonColor: '#E94B8B' })['--ni-btn-fg']).toBe('#1A1A1A');
      expect(tokens({ buttonColor: '#102030' })['--ni-btn-fg']).toBe('#FFFFFF');
    });

    it('gives a button to a lone button text colour', () => {
      expect(tokens({ buttonTextColor: '#FFFFFF' })).toMatchObject({
        '--ni-btn-fg': '#FFFFFF',
        '--ni-btn-bg': '#1A1A1A',
      });
      expect(tokens({ buttonTextColor: '#1A1A1A' })['--ni-btn-bg']).toBe('#FFFFFF');
    });

    it('leaves the panel alone when only the button was styled', () => {
      expect(tokens({ buttonColor: '#E94B8B' })['--ni-bg']).toBeUndefined();
    });

    it('keeps a button colour the author chose even on a styled panel', () => {
      expect(tokens({ backgroundColor: '#102030', buttonColor: '#1A1A1A' })['--ni-btn-bg']).toBe('#1A1A1A');
    });

    describe('the button stands out from a panel the author coloured', () => {
      const luminance = (hex: string) => {
        const c = (i: number) => {
          const v = parseInt(hex.slice(i, i + 2), 16) / 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * c(1) + 0.7152 * c(3) + 0.0722 * c(5);
      };
      const contrast = (a: string, b: string) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
        return (hi + 0.05) / (lo + 0.05);
      };

      // Neither default may survive on these panels: the dark button (#1A1A1A) of the light
      // scheme melts into the dark panels, the light one (#F2F2F2) of the dark scheme into the light ones.
      const panels = ['#102030', '#000000', '#1F1F1F', '#0B3D91', '#FFFFFF', '#F2F2F2', '#FFF4D6', '#E8F0FE'];

      it.each(panels)('with only background_color %s', (backgroundColor) => {
        const t = tokens({ backgroundColor });
        expect(t['--ni-btn-bg']).toBeDefined();
        expect(contrast(t['--ni-btn-bg']!, backgroundColor)).toBeGreaterThanOrEqual(3);
        expect(contrast(t['--ni-btn-fg']!, t['--ni-btn-bg']!)).toBeGreaterThanOrEqual(4.5);
      });

      it('with only a light text colour, which gets a dark panel', () => {
        const t = tokens({ textColor: '#FFFFFF' });
        expect(contrast(t['--ni-btn-bg']!, t['--ni-bg']!)).toBeGreaterThanOrEqual(3);
        expect(t['--ni-btn-bg']).toBe('#FFFFFF');
        expect(t['--ni-btn-fg']).toBe('#1A1A1A');
      });

      it('with only a dark text colour, which gets a light panel', () => {
        const t = tokens({ textColor: '#111111' });
        expect(contrast(t['--ni-btn-bg']!, t['--ni-bg']!)).toBeGreaterThanOrEqual(3);
        expect(t['--ni-btn-bg']).toBe('#1A1A1A');
      });

      it('picks the stock colour that reads best under a button text colour, if it still stands out', () => {
        const t = tokens({ backgroundColor: '#102030', buttonTextColor: '#102030' });
        expect(t['--ni-btn-bg']).toBe('#FFFFFF');
        expect(t['--ni-btn-fg']).toBe('#102030');
      });

      it('gives up the button text colour before letting the button vanish or the label go unreadable', () => {
        // White text asks for the dark button, which would melt into this dark panel.
        const t = tokens({ backgroundColor: '#102030', buttonTextColor: '#FFFFFF' });
        expect(contrast(t['--ni-btn-bg']!, '#102030')).toBeGreaterThanOrEqual(3);
        expect(contrast(t['--ni-btn-fg']!, t['--ni-btn-bg']!)).toBeGreaterThanOrEqual(4.5);
      });

      it('does not touch the button when the author set nothing about the panel', () => {
        expect(tokens({ buttonTextColor: '#FFFFFF' })['--ni-btn-bg']).toBe('#1A1A1A');
        expect(tokens()['--ni-btn-bg']).toBeUndefined();
      });
    });
  });
});

describe('STYLESHEET', () => {
  it('follows the visitor colour scheme and motion preference', () => {
    expect(STYLESHEET).toContain('prefers-color-scheme: dark');
    expect(STYLESHEET).toContain('prefers-reduced-motion: reduce');
  });

  it('resets what the host page could inherit', () => {
    expect(STYLESHEET).toContain('all: initial');
  });

  it('never loads anything from the network', () => {
    expect(STYLESHEET).not.toMatch(/url\(|@import|@font-face/);
  });

  it('sits above the host page with the highest z-index', () => {
    expect(STYLESHEET).toContain('z-index: 2147483647');
  });

  it('keeps the bar content clear of the close control', () => {
    expect(STYLESHEET).toMatch(/\.layout-top \.panel,\s*\.layout-bottom \.panel \{[^}]*padding: 14px 56px 14px 16px/);
  });

  it('backs the close control when it sits over an image', () => {
    expect(STYLESHEET).toMatch(/\.has-image \.close \{[^}]*background: rgba\(0, 0, 0, 0\.5\)/);
  });

  it('respects the safe areas', () => {
    expect(STYLESHEET).toContain('env(safe-area-inset-top');
    expect(STYLESHEET).toContain('env(safe-area-inset-bottom');
  });
});
