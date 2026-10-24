import type { CaseIndex, CaseSummary } from '../figma/types';

// See apps/docs/figma-to-tldraw/tech.md §10.3.

const UNTITLED_UI = 'real/untitled-ui-free-figma-ui-kit-and-design';
const GEMINI = 'real/google-gemini---built-with-material-3-de';

const GROUPS: Record<string, { label: string; note?: string }> = {
  fill: { label: '填充：纯色、线性 / 径向 / 角度 / 菱形渐变、多层填充' },
  stroke: { label: '描边：内 / 外 / 居中、虚线、单边粗细、渐变、端点' },
  text: { label: '文字：换行、行高、字距、对齐、混排样式、中英混排、截断' },
  container: { label: '容器：嵌套 frame、裁剪、旋转、分组和组透明度' },
  effect: { label: '效果：投影、扩展、多重阴影、内阴影、图层模糊、背景模糊' },
  image: { label: '图片：填满、适应、裁剪、平铺、圆角头像、透明度' },
  shape: { label: '形状：椭圆、圆弧、多边形、星形、线' },
  vector: { label: '矢量：路径、图标描边、开放曲线、填充规则' },
  radius: { label: '圆角：统一、四角不同、胶囊、平滑圆角' },
  boolean: { label: '布尔运算：合并、减去、相交、排除' },
  layout: { label: '自动布局：横排、竖排撑满、换行、绝对定位' },
  page: { label: '整页小样：登录页、商品列表、相册' },
  mask: { label: '蒙版：椭圆蒙图片、星形蒙渐变' },
  misc: { label: '其他：隐藏图层、亚像素位置' },
  blend: { label: '混合模式' },
  component: { label: '组件实例' },
  'image-filter': {
    label: '图片滤镜：曝光、对比度、饱和度、色温、色调、高光、阴影',
    note: '滤镜不是浏览器算的：插件导出时让 Figma 渲染了一份带滤镜的图。剩下的差异只在色卡相邻两行的分界线上，一个像素宽，没加滤镜的那块色卡也一样，是图片放大时的取样方式不同，和滤镜无关。',
  },
  [UNTITLED_UI]: {
    label: '真实稿子：Untitled UI',
    note: '来自 Figma 社区的免费 UI 套件，只用 Inter 字体。第一次考试时没改任何渲染规则，24 页就都在 0.17% 以下。',
  },
  [GEMINI]: {
    label: '真实稿子：Google Gemini',
    note: '用到 Product Sans，这是 Google 的专有字体，没有网页版，所以用开源的 Google Sans Flex（字宽 93.5）近似代替，剩下的差异大多是字形不一样。考试时还发现并修好了 First on top 叠放、Red Hat Display 字体、文字渐变填充和图片滤镜。',
  },
};

const HELD_OUT =
  '留作考试的一页：修渲染规则时没看过它的差异图，用来检验规则对没见过的稿子是不是也管用。';

const CASE_NOTES: Record<string, string> = {
  [`${GEMINI}/gemini-macbook-pro-14---public-links-screen`]: HELD_OUT,
  [`${UNTITLED_UI}/informational-pages-mobile-2`]: HELD_OUT,
};

export interface CaseGroup {
  key: string;
  label: string;
  note?: string;
  cases: CaseSummary[];
}

export function groupKey(dir: string): string {
  const parts = dir.split('/');
  return parts[0] === 'real' ? parts.slice(0, 2).join('/') : parts[0];
}

export function caseName(dir: string): string {
  return dir.slice(groupKey(dir).length + 1);
}

export function groupCases(index: CaseIndex): CaseGroup[] {
  const groups = new Map<string, CaseGroup>();
  for (const c of index.cases) {
    const key = groupKey(c.dir);
    const group = groups.get(key) ?? {
      key,
      label: GROUPS[key]?.label ?? key,
      note: GROUPS[key]?.note,
      cases: [],
    };
    group.cases.push(c);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function notesFor(dir: string): string[] {
  return [GROUPS[groupKey(dir)]?.note, CASE_NOTES[dir]].filter(
    (n): n is string => Boolean(n),
  );
}
