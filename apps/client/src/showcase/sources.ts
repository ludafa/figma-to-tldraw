import type { CaseIndex, CaseSummary } from '../figma/types';

// See apps/docs/figma-to-tldraw/tech.md §10.1.

interface FigmaFile {
  key: string;
  label: string;
  community?: string;
}

const FIGMA_FILES: Record<string, FigmaFile> = {
  Untitled: { key: 'tY0108yTzx8IscbAgC0CHm', label: '测试用例（插件生成）' },
  '❖ Untitled UI – FREE Figma UI kit and design system v2.0 (Community)': {
    key: 'gIeQ0EM8UyFXDW5aQhvpFX',
    label: 'Untitled UI – FREE Figma UI kit and design system v2.0',
    community:
      'https://www.figma.com/community/file/1020079203222518115/untitled-ui-free-figma-ui-kit-and-design-system-v2-0',
  },
  '50+ Landing page designs (Community)': {
    key: 'z9f9CmmXW9p5cO7JGRHkni',
    label: '50+ Landing page designs',
    community:
      'https://www.figma.com/community/file/1127302394641561751/50-landing-page-designs',
  },
  'SaaS Website UI Kit — Framer Website Kit (Community)': {
    key: '0yc5GNnaqKvnUbeMCmz30Y',
    label: 'SaaS Website UI Kit — Framer Website Kit',
    community:
      'https://www.figma.com/community/file/1347551304372055519/saas-website-ui-kit-framer-website-kit',
  },
  'Mobile E-Learning App Design (Community)': {
    key: 'gtXoGbT1BRL1XbYZlA1deZ',
    label: 'Mobile E-Learning App Design',
    community:
      'https://www.figma.com/community/file/1116625179283253250/mobile-e-learning-app-design',
  },
  'Golio - Free Landing Page UI Kit & Design System (Community) (Community)': {
    key: 'IZPGzu51gvasdMcsoypRvQ',
    label: 'Golio - Free Landing Page UI Kit & Design System',
    community:
      'https://www.figma.com/community/file/1189062521764333549/golio-free-landing-page-ui-kit-design-system-community',
  },
  'Furniture E-commerce (Community)': {
    key: 'of4AwsPW6SxzwCKfVRwK3y',
    label: 'Furniture E-commerce',
    community:
      'https://www.figma.com/community/file/1248473833364609849/furniture-e-commerce',
  },
};

export interface CaseSource {
  file: string;
  page: string;
  exportedAt: string;
  nodeUrl?: string;
  community?: string;
}

export function sourceOf(index: CaseIndex, c: CaseSummary): CaseSource {
  const name = c.source?.figmaFile ?? index.figmaFile;
  const file = FIGMA_FILES[name];
  return {
    file: file?.label ?? name,
    page: c.source?.page ?? index.page,
    exportedAt: c.source?.exportedAt ?? index.exportedAt,
    nodeUrl:
      file &&
      `https://www.figma.com/design/${file.key}/?node-id=${encodeURIComponent(c.nodeId.replaceAll(':', '-'))}`,
    community: file?.community,
  };
}
