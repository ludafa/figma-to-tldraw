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
  'Google Gemini - Built with Material 3 Design Kit (Community)': {
    key: 'pEMazdUunFWfr0VeG0Dlwy',
    label: 'Google Gemini - Built with Material 3 Design Kit',
    community:
      'https://www.figma.com/community/file/1346359039607478680/google-gemini-built-with-material-3-design-kit',
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
