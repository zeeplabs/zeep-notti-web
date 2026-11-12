import type { InAppStyle } from './types';

/**
 * Custom properties for the tokens the author set. An absent token adds
 * nothing, so the stylesheet default (and its dark variant) stays in force.
 */
export function styleVariables(style: InAppStyle): Record<string, string> {
  const variables: Record<string, string> = {};
  if (style.backgroundColor) variables['--ni-bg'] = style.backgroundColor;
  if (style.textColor) variables['--ni-fg'] = style.textColor;
  if (style.buttonColor) variables['--ni-btn-bg'] = style.buttonColor;
  if (style.buttonTextColor) variables['--ni-btn-fg'] = style.buttonTextColor;
  variables['--ni-align'] = style.textAlign;
  return variables;
}

/** Lives inside the Shadow root, so the host page's CSS never reaches it and it never leaks out. */
export const STYLESHEET = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }

.ni {
  --ni-bg: #FFFFFF;
  --ni-fg: #1A1A1A;
  --ni-btn-bg: #1A1A1A;
  --ni-btn-fg: #FFFFFF;
  --ni-border: rgba(0, 0, 0, 0.18);
  --ni-gap: 16px;
  --ni-radius: 16px;
  --ni-align: left;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ni-fg);
  animation: ni-fade 150ms ease-out;
}
.ni.no-margin { --ni-gap: 0px; --ni-radius: 0px; }

@media (prefers-color-scheme: dark) {
  .ni {
    --ni-bg: #1F1F1F;
    --ni-fg: #F2F2F2;
    --ni-btn-bg: #F2F2F2;
    --ni-btn-fg: #1A1A1A;
    --ni-border: rgba(255, 255, 255, 0.24);
  }
}

@keyframes ni-fade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ni { animation: none; } }

.backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.5); pointer-events: auto; }

.panel {
  position: absolute;
  background: var(--ni-bg);
  color: var(--ni-fg);
  text-align: var(--ni-align);
  border-radius: var(--ni-radius);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
  padding: 20px;
  overflow: auto;
  pointer-events: auto;
}

.layout-center .panel {
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(90vw, 420px);
  max-height: 90vh;
}

.layout-top .panel,
.layout-bottom .panel {
  left: var(--ni-gap);
  right: var(--ni-gap);
  max-width: 720px;
  max-height: 40vh;
  margin: 0 auto;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  /* The close control sits at the right edge, 48px wide with its offset: keep content clear of it. */
  padding: 14px 56px 14px 16px;
}
.layout-top .panel { top: calc(env(safe-area-inset-top, 0px) + var(--ni-gap)); }
.layout-bottom .panel { bottom: calc(env(safe-area-inset-bottom, 0px) + var(--ni-gap)); }
.layout-top .text, .layout-bottom .text { flex: 1 1 200px; min-width: 0; }
.layout-top .buttons, .layout-bottom .buttons { margin-top: 0; }

.layout-full .panel {
  inset:
    calc(env(safe-area-inset-top, 0px) + var(--ni-gap))
    calc(env(safe-area-inset-right, 0px) + var(--ni-gap))
    calc(env(safe-area-inset-bottom, 0px) + var(--ni-gap))
    calc(env(safe-area-inset-left, 0px) + var(--ni-gap));
  display: flex;
  flex-direction: column;
  padding: 24px;
}
.layout-full .text { flex: 1; }
.layout-full .image { max-height: 45vh; }

.image { display: block; width: 100%; max-height: 240px; object-fit: cover; border-radius: 10px; margin-bottom: 12px; }
.layout-top .image, .layout-bottom .image { width: 56px; height: 56px; margin: 0; flex: none; }
.image-button { display: block; padding: 0; margin: 0; border: 0; background: none; cursor: pointer; width: 100%; font: inherit; color: inherit; }
.layout-top .image-button, .layout-bottom .image-button { width: auto; flex: none; }

.title { margin: 0 0 6px; font-size: 17px; line-height: 1.3; font-weight: 700; }
/* Whatever comes first (the title, or the body when there is none) stays clear of the close control. */
.layout-center .text > :first-child, .layout-full .text > :first-child { padding-right: 36px; }
.body { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.tappable { cursor: pointer; }

.buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.btn {
  flex: 1 1 120px;
  min-height: 44px;
  padding: 10px 14px;
  border: 1px solid transparent;
  border-radius: 10px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.btn.primary { background: var(--ni-btn-bg); color: var(--ni-btn-fg); }
.btn.secondary { background: transparent; color: var(--ni-fg); border-color: var(--ni-border); }
.custom-buttons .btn.secondary { background: var(--ni-btn-bg); color: var(--ni-btn-fg); border-color: transparent; }

.close {
  position: absolute;
  top: 4px;
  right: 4px;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.close svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; }

.has-image .close { background: rgba(0, 0, 0, 0.5); color: #FFFFFF; }

.btn:focus-visible, .close:focus-visible, .image-button:focus-visible, .tappable:focus-visible {
  outline: 2px solid var(--ni-fg);
  outline-offset: 2px;
  box-shadow: 0 0 0 5px var(--ni-bg);
}
`;
