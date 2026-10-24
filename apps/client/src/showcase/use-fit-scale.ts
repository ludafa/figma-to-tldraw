import { useEffect, useState } from 'react';

import type { RenderArea } from '../figma/render-area';

// See apps/docs/figma-to-tldraw/tech.md §10.4.

const MAX_SCALE = 2;
const MIN_TALL_SCALE = 0.5;
const MIN_HEIGHT = 320;
const CHROME_HEIGHT = 260;

export function useFitScale(area: RenderArea | null, pad: number) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [room, setRoom] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!el) {
      return;
    }
    const update = () =>
      setRoom({
        width: el.clientWidth,
        height: Math.max(MIN_HEIGHT, window.innerHeight - CHROME_HEIGHT),
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [el]);

  const scale =
    area && room.width > 0
      ? Math.min(
          (room.width - pad * 2) / area.width,
          Math.max((room.height - pad * 2) / area.height, MIN_TALL_SCALE),
          MAX_SCALE,
        )
      : 0;
  return { measureRef: setEl, scale };
}
