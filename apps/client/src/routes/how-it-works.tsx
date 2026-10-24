import { createFileRoute } from '@tanstack/react-router';

import { HowItWorksPage } from '../pages/how-it-works';

export const Route = createFileRoute('/how-it-works')({
  component: HowItWorksPage,
});
