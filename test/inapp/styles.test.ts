import { describe, expect, it } from 'vitest';
import { STYLESHEET, styleVariables } from '../../src/inapp/styles';

describe('styleVariables', () => {
  it('maps the tokens to custom properties and skips the absent ones', () => {
    expect(
      styleVariables({
        backgroundColor: '#112233',
        textColor: undefined,
        buttonColor: '#E94B8B',
        buttonTextColor: undefined,
        textAlign: 'right',
        margin: true,
      })
    ).toEqual({
      '--ni-bg': '#112233',
      '--ni-btn-bg': '#E94B8B',
      '--ni-align': 'right',
    });
  });

  it('is empty-but-for-alignment when no colour token is set', () => {
    expect(
      styleVariables({
        backgroundColor: undefined,
        textColor: undefined,
        buttonColor: undefined,
        buttonTextColor: undefined,
        textAlign: 'left',
        margin: true,
      })
    ).toEqual({ '--ni-align': 'left' });
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

  it('respects the safe areas', () => {
    expect(STYLESHEET).toContain('env(safe-area-inset-top');
    expect(STYLESHEET).toContain('env(safe-area-inset-bottom');
  });
});
