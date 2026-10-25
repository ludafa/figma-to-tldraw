import type { CaseIndex, CaseSummary } from '../figma/types';

// See apps/docs/figma-to-tldraw/tech.md §10.3.

const UNTITLED_UI = 'real/untitled-ui-free-figma-ui-kit-and-design';
const LANDING_50 = 'real/50-landing-page-designs-community';
const FRAMER = 'real/saas-website-ui-kit-framer-website-kit-c';
const E_LEARNING = 'real/mobile-e-learning-app-design-community';
const GOLIO = 'real/golio---free-landing-page-ui-kit-design';
const FURNITURE = 'real/furniture-e-commerce-community';

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
  component: {
    label: '组件：主组件和实例',
    note: '主组件就在用例里面。在调试页选中实例，右边面板有"实例"一节，改主组件时实例跟着变。',
  },
  'image-filter': {
    label: '图片滤镜：曝光、对比度、饱和度、色温、色调、高光、阴影',
    note: '滤镜不是浏览器算的：插件导出时让 Figma 渲染了一份带滤镜的图。剩下的差异只在色卡相邻两行的分界线上，一个像素宽，没加滤镜的那块色卡也一样，是图片放大时的取样方式不同，和滤镜无关。',
  },
  [UNTITLED_UI]: {
    label: '真实稿子：Untitled UI',
    note: '来自 Figma 社区的免费 UI 套件，只用 Inter 字体。第一次考试时没改任何渲染规则，24 页就都在 0.17% 以下。按钮、头像、下拉框都是组件集里的实例，每页的快照带着整套组件（81 个组件集），在调试页的"组件"页能看到，选中实例可以切变体。',
  },
  [LANDING_50]: {
    label: '真实稿子：50+ Landing page designs',
    note: '6 张落地页，用 Poppins、Montserrat、Lato。Figma 的 Lato 是 2.0 版（有 Medium、SemiBold、ExtraBold），Google Fonts 上的是只有 5 个字重的老版本，所以换成 lato-font 包里的 Lato 2.0。designs-29 有一个藏起填充、只留背景模糊的容器，Figma 不画这种模糊，我们原来画了，修掉后 1.17% → 0.36%。',
  },
  [FRAMER]: {
    label: '真实稿子：SaaS Website UI Kit（Framer）',
    note: '亮色、暗色两张桌面页。这套稿子暴露了三个问题：水平翻转的图层（Figma 数据里写成旋转 180°）、只有描边没有填充的图层的投影、文字里的 U+2028 换行符。DM Sans 要用老的 v1 版本，新版宽 1.5% 左右。手机页用了 Switzer 字体（npm 上没有），按只用开源字体的规则去掉了。按钮是带变体和文字属性的组件，在调试页可以切变体、改文字。',
  },
  [E_LEARNING]: {
    label: '真实稿子：Mobile E-Learning App',
    note: '4 张手机页，Urbanist 和 Inter。补上 Urbanist 和 Inter Light（300）以后都在 0.21% 以下。',
  },
  [GOLIO]: {
    label: '真实稿子：Golio 落地页',
    note: '3 张 1920 宽的整站长页，Lexend 和 Inter。补上 Lexend 字体以后没改别的规则，都在 0.12% 以下。',
  },
  [FURNITURE]: {
    label: '真实稿子：Furniture 家具电商',
    note: 'Lato 和 Montserrat。首页 6782 高，截图时 Chrome 会丢掉一些画面图块，同一页时好时坏（最多 9%）；改成浏览器窗口只开一段高、移动镜头分段截以后，每次都是 0.23%。',
  },
};

const HELD_OUT =
  '留作考试的一页：修渲染规则时没看过它的差异图，用来检验规则对没见过的稿子是不是也管用。';

const CASE_NOTES: Record<string, string> = {
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
