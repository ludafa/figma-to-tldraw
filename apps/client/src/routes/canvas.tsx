import { createFileRoute } from '@tanstack/react-router';

import { CanvasPage } from '../pages/canvas';

export const Route = createFileRoute('/canvas')({
  component: CanvasPage,
});
