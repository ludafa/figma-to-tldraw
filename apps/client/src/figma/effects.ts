import { rgba } from './geometry';
import type { FigmaEffect } from './types';

// See apps/docs/figma-to-tldraw/tech.md §6.3.

function visibleEffects(effects: FigmaEffect[] | undefined) {
  return (effects ?? []).filter((e) => e.visible !== false);
}

export function boxShadowCss(
  effects: FigmaEffect[] | undefined,
): string | undefined {
  const parts = visibleEffects(effects)
    .filter((e) => e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW')
    .reverse()
    .map((e) => {
      const color = e.color ? rgba(e.color) : 'rgba(0, 0, 0, 0.25)';
      const inset = e.type === 'INNER_SHADOW' ? 'inset ' : '';
      return `${inset}${e.offset?.x ?? 0}px ${e.offset?.y ?? 0}px ${e.radius}px ${e.spread ?? 0}px ${color}`;
    });
  return parts.length ? parts.join(', ') : undefined;
}

export function textShadowCss(
  effects: FigmaEffect[] | undefined,
): string | undefined {
  const parts = visibleEffects(effects)
    .filter((e) => e.type === 'DROP_SHADOW')
    .map((e) => {
      const color = e.color ? rgba(e.color) : 'rgba(0, 0, 0, 0.25)';
      return `${e.offset?.x ?? 0}px ${e.offset?.y ?? 0}px ${e.radius}px ${color}`;
    });
  return parts.length ? parts.join(', ') : undefined;
}

export function layerBlurCss(
  effects: FigmaEffect[] | undefined,
): string | undefined {
  const blur = visibleEffects(effects).find((e) => e.type === 'LAYER_BLUR');
  return blur ? `blur(${blur.radius / 2}px)` : undefined;
}

export function backgroundBlurCss(
  effects: FigmaEffect[] | undefined,
): string | undefined {
  const blur = visibleEffects(effects).find(
    (e) => e.type === 'BACKGROUND_BLUR',
  );
  return blur ? `blur(${blur.radius / 2}px)` : undefined;
}
