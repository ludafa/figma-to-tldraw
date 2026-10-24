// Figma → tldraw 还原度测试用例
// 功能 1：在新页面里自动生成测试用例（一个顶层 frame = 一个用例）
// 功能 2：把当前页面上的顶层 frame 批量导出成测试数据（由 ui.html 打包成 zip）

figma.showUI(__html__, { width: 380, height: 460 });

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

var FRAME_W = 400;
var FRAME_H = 300;
var GAP = 80;
var COLS = 8;

var F = {}; // 字体，prepareFonts() 里填充

function hex(h) {
  h = h.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

function rgba(h, a) {
  var c = hex(h);
  c.a = a === undefined ? 1 : a;
  return c;
}

function solid(h, opacity) {
  var p = { type: 'SOLID', color: hex(h) };
  if (opacity !== undefined) p.opacity = opacity;
  return p;
}

function stop(position, h, a) {
  return { position: position, color: rgba(h, a) };
}

function gradient(type, stops, transform) {
  return {
    type: type,
    gradientTransform: transform || [[1, 0, 0], [0, 1, 0]],
    gradientStops: stops,
  };
}

// 从上到下的线性渐变
var TOP_TO_BOTTOM = [[0, 1, 0], [-1, 0, 1]];

function imagePaint(hash, scaleMode, extra) {
  var p = { type: 'IMAGE', imageHash: hash, scaleMode: scaleMode || 'FILL' };
  if (extra) {
    for (var k in extra) p[k] = extra[k];
  }
  return p;
}

function shadow(type, color, alpha, x, y, radius, spread) {
  return {
    type: type,
    color: rgba(color, alpha),
    offset: { x: x, y: y },
    radius: radius,
    spread: spread || 0,
    visible: true,
    blendMode: 'NORMAL',
  };
}

function blur(type, radius) {
  return { type: type, radius: radius, visible: true };
}

// 不同版本的 Figma 对模糊效果的字段要求不一样，先按旧格式设置，失败再加上 blurType
function setEffects(node, effects) {
  try {
    node.effects = effects;
  } catch (e) {
    node.effects = effects.map(function (ef) {
      if (ef.type === 'LAYER_BLUR' || ef.type === 'BACKGROUND_BLUR') {
        var copy = {};
        for (var k in ef) copy[k] = ef[k];
        copy.blurType = 'NORMAL';
        return copy;
      }
      return ef;
    });
  }
}

function isAutoLayout(node) {
  return !!(node && node.layoutMode && node.layoutMode !== 'NONE');
}

function place(node, parent, x, y) {
  if (isAutoLayout(parent)) return;
  if (x !== undefined) node.x = x;
  if (y !== undefined) node.y = y;
}

function apply(node, props) {
  if (!props) return;
  for (var k in props) {
    if (k === 'effects') setEffects(node, props[k]);
    else node[k] = props[k];
  }
}

function rect(parent, x, y, w, h, fills, props) {
  var r = figma.createRectangle();
  parent.appendChild(r);
  place(r, parent, x, y);
  r.resize(w, h);
  r.fills = fills || [];
  apply(r, props);
  return r;
}

function ellipse(parent, x, y, w, h, fills, props) {
  var e = figma.createEllipse();
  parent.appendChild(e);
  place(e, parent, x, y);
  e.resize(w, h);
  e.fills = fills || [];
  apply(e, props);
  return e;
}

function frame(parent, x, y, w, h, fill, radius) {
  var fr = figma.createFrame();
  parent.appendChild(fr);
  place(fr, parent, x, y);
  fr.resize(w, h);
  fr.fills = fill ? [solid(fill)] : [];
  if (radius) fr.cornerRadius = radius;
  fr.clipsContent = true;
  return fr;
}

function text(parent, str, o) {
  o = o || {};
  var t = figma.createText();
  parent.appendChild(t);
  t.fontName = o.font || F.regular;
  t.characters = str;
  t.fontSize = o.size || 16;
  t.fills = [solid(o.color || '#111827')];
  if (o.lineHeight) t.lineHeight = o.lineHeight;
  if (o.letterSpacing) t.letterSpacing = o.letterSpacing;
  if (o.align) t.textAlignHorizontal = o.align;
  if (o.width) {
    t.resize(o.width, t.height);
    t.textAutoResize = 'HEIGHT';
  }
  if (o.fillW) t.layoutSizingHorizontal = 'FILL';
  place(t, parent, o.x, o.y);
  if (o.name) t.name = o.name;
  return t;
}

function vec(parent, data, o) {
  o = o || {};
  var v = figma.createVector();
  parent.appendChild(v);
  v.vectorPaths = [{ windingRule: o.winding || 'NONZERO', data: data }];
  if (o.stroke) {
    v.strokes = [solid(o.stroke)];
    v.strokeWeight = o.weight || 2;
    v.strokeCap = o.cap || 'ROUND';
    v.strokeJoin = o.join || 'ROUND';
    v.fills = o.fill ? [solid(o.fill)] : [];
  } else {
    v.fills = [solid(o.fill || '#111827')];
    v.strokes = [];
  }
  place(v, parent, o.x, o.y);
  if (o.name) v.name = o.name;
  return v;
}

// 自动布局 frame。dir: 'H' 横向 / 'V' 纵向
function al(dir, o) {
  o = o || {};
  var fr = figma.createFrame();
  if (o.parent) o.parent.appendChild(fr);
  fr.name = o.name || (dir === 'H' ? 'Row' : 'Column');
  fr.layoutMode = dir === 'H' ? 'HORIZONTAL' : 'VERTICAL';
  fr.primaryAxisSizingMode = 'AUTO';
  fr.counterAxisSizingMode = 'AUTO';
  fr.itemSpacing = o.gap || 0;
  var p = o.pad === undefined ? 0 : o.pad;
  if (typeof p === 'number') p = [p, p, p, p];
  else if (p.length === 2) p = [p[0], p[1], p[0], p[1]];
  fr.paddingTop = p[0];
  fr.paddingRight = p[1];
  fr.paddingBottom = p[2];
  fr.paddingLeft = p[3];
  fr.fills = o.fill ? [solid(o.fill)] : [];
  if (o.radius) fr.cornerRadius = o.radius;
  if (o.align) fr.counterAxisAlignItems = o.align;
  if (o.justify) fr.primaryAxisAlignItems = o.justify;
  if (o.stroke) {
    fr.strokes = [solid(o.stroke)];
    fr.strokeWeight = o.strokeWeight || 1;
    fr.strokeAlign = 'INSIDE';
  }
  fr.clipsContent = !!o.clip;
  return fr;
}

function setFixed(fr, w, h) {
  if (w !== null && w !== undefined) fr.layoutSizingHorizontal = 'FIXED';
  if (h !== null && h !== undefined) fr.layoutSizingVertical = 'FIXED';
  fr.resize(
    w !== null && w !== undefined ? w : fr.width,
    h !== null && h !== undefined ? h : fr.height
  );
}

function fillW(node) {
  node.layoutSizingHorizontal = 'FILL';
  return node;
}

// 让一个自动布局页面 frame 保持固定尺寸
function pageLayout(f, w, h, pad, gap) {
  f.layoutMode = 'VERTICAL';
  f.primaryAxisSizingMode = 'FIXED';
  f.counterAxisSizingMode = 'FIXED';
  f.resize(w, h);
  f.paddingTop = pad[0];
  f.paddingRight = pad[1];
  f.paddingBottom = pad[2];
  f.paddingLeft = pad[3];
  f.itemSpacing = gap;
}

function stripes(f) {
  rect(f, 0, 0, f.width / 2, f.height, [solid('#111827')], { name: 'Stripe dark' });
  rect(f, f.width / 2, 0, f.width / 2, f.height, [solid('#FDE047')], { name: 'Stripe light' });
}

async function tryLoadFont(font) {
  try {
    await figma.loadFontAsync(font);
    return true;
  } catch (e) {
    return false;
  }
}

async function pickFont(candidates, fallback) {
  for (var i = 0; i < candidates.length; i++) {
    if (await tryLoadFont(candidates[i])) return candidates[i];
  }
  return fallback;
}

async function prepareFonts() {
  F.regular = { family: 'Inter', style: 'Regular' };
  await figma.loadFontAsync(F.regular);
  F.medium = await pickFont([{ family: 'Inter', style: 'Medium' }], F.regular);
  F.semibold = await pickFont([{ family: 'Inter', style: 'Semi Bold' }, { family: 'Inter', style: 'SemiBold' }], F.medium);
  F.bold = await pickFont([{ family: 'Inter', style: 'Bold' }], F.semibold);
  F.italic = await pickFont([{ family: 'Inter', style: 'Italic' }], F.regular);
  F.cjk = await pickFont(
    [
      { family: 'Noto Sans SC', style: 'Regular' },
      { family: 'PingFang SC', style: 'Regular' },
      { family: 'Source Han Sans SC', style: 'Regular' },
      { family: 'Microsoft YaHei', style: 'Regular' },
    ],
    F.regular
  );
}

// 24×24 的线条图标
var ICON = {
  search: 'M 10 3 C 13.866 3 17 6.134 17 10 C 17 13.866 13.866 17 10 17 C 6.134 17 3 13.866 3 10 C 3 6.134 6.134 3 10 3 Z M 15 15 L 21 21',
  cart: 'M 3 4 L 6 4 L 8 15 L 19 15 L 21 7 L 7 7',
  eye: 'M 2 12 C 5 6 19 6 22 12 C 19 18 5 18 2 12 Z M 12 9 C 13.657 9 15 10.343 15 12 C 15 13.657 13.657 15 12 15 C 10.343 15 9 13.657 9 12 C 9 10.343 10.343 9 12 9 Z',
  home: 'M 3 11 L 12 3 L 21 11 L 21 21 L 3 21 Z',
  heart: 'M 12 21 C 5 16 2 12.5 2 8.5 C 2 5.4 4.4 3 7.5 3 C 9.4 3 11 4 12 5.5 C 13 4 14.6 3 16.5 3 C 19.6 3 22 5.4 22 8.5 C 22 12.5 19 16 12 21 Z',
  user: 'M 12 12 C 14.761 12 17 9.761 17 7 C 17 4.239 14.761 2 12 2 C 9.239 2 7 4.239 7 7 C 7 9.761 9.239 12 12 12 Z M 3 22 C 3 17.582 7.03 14 12 14 C 16.97 14 21 17.582 21 22',
  grid: 'M 3 3 L 10 3 L 10 10 L 3 10 Z M 14 3 L 21 3 L 21 10 L 14 10 Z M 3 14 L 10 14 L 10 21 L 3 21 Z M 14 14 L 21 14 L 21 21 L 14 21 Z',
  lock: 'M 5 11 L 19 11 L 19 21 L 5 21 Z M 8 11 L 8 7 C 8 4.791 9.791 3 12 3 C 14.209 3 16 4.791 16 7 L 16 11',
};

var LOREM =
  'Design-to-canvas fidelity matters. This paragraph is long enough to wrap onto several lines, so we can compare line breaks, line height and letter spacing between Figma and the browser.';

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

var CASES = [];
var PAGES = [];

function add(name, build, w, h) {
  CASES.push({ name: name, build: build, w: w || FRAME_W, h: h || FRAME_H });
}

function addPage(name, build, w, h) {
  PAGES.push({ name: name, build: build, w: w, h: h });
}

// ---- 填充 ----
add('fill/solid', function (f) {
  rect(f, 100, 90, 200, 120, [solid('#3B82F6')]);
});
add('fill/linear-gradient', function (f) {
  rect(f, 50, 50, 300, 200, [gradient('GRADIENT_LINEAR', [stop(0, '#F97316'), stop(1, '#8B5CF6')])]);
});
add('fill/linear-gradient-rotated', function (f) {
  rect(f, 50, 50, 300, 200, [
    gradient('GRADIENT_LINEAR', [stop(0, '#22C55E'), stop(0.5, '#FACC15'), stop(1, '#EF4444')], [[0.5, 0.5, 0], [-0.5, 0.5, 0.5]]),
  ]);
});
add('fill/radial-gradient', function (f) {
  rect(f, 50, 50, 300, 200, [gradient('GRADIENT_RADIAL', [stop(0, '#FDE68A'), stop(0.6, '#F59E0B'), stop(1, '#B45309')])]);
});
add('fill/angular-gradient', function (f) {
  ellipse(f, 100, 50, 200, 200, [
    gradient('GRADIENT_ANGULAR', [stop(0, '#EF4444'), stop(0.33, '#22C55E'), stop(0.66, '#3B82F6'), stop(1, '#EF4444')]),
  ]);
});
add('fill/diamond-gradient', function (f) {
  rect(f, 80, 60, 240, 180, [gradient('GRADIENT_DIAMOND', [stop(0, '#FFFFFF'), stop(1, '#0EA5E9')])]);
});
add('fill/gradient-alpha', function (f) {
  stripes(f);
  rect(f, 50, 50, 300, 200, [gradient('GRADIENT_LINEAR', [stop(0, '#2563EB', 1), stop(1, '#2563EB', 0)])]);
});
add('fill/opacity', function (f) {
  stripes(f);
  rect(f, 40, 60, 140, 180, [solid('#EF4444', 0.5)], { name: 'Fill opacity 0.5' });
  rect(f, 220, 60, 140, 180, [solid('#EF4444')], { name: 'Layer opacity 0.5', opacity: 0.5 });
});
add('fill/multiple-fills', function (f) {
  rect(f, 50, 50, 300, 200, [
    solid('#0EA5E9'),
    gradient('GRADIENT_LINEAR', [stop(0, '#FFFFFF', 0.8), stop(1, '#FFFFFF', 0)]),
  ]);
});

// ---- 圆角 ----
add('radius/uniform', function (f) {
  rect(f, 80, 70, 240, 160, [solid('#6366F1')], { cornerRadius: 24 });
});
add('radius/mixed', function (f) {
  rect(f, 80, 70, 240, 160, [solid('#6366F1')], {
    topLeftRadius: 0,
    topRightRadius: 40,
    bottomRightRadius: 8,
    bottomLeftRadius: 80,
  });
});
add('radius/pill-clamped', function (f) {
  rect(f, 80, 110, 240, 80, [solid('#6366F1')], { cornerRadius: 100 });
});
add('radius/smoothing', function (f) {
  rect(f, 40, 80, 140, 140, [solid('#6366F1')], { cornerRadius: 40, name: 'No smoothing' });
  rect(f, 220, 80, 140, 140, [solid('#6366F1')], { cornerRadius: 40, cornerSmoothing: 0.6, name: 'Smoothing 60%' });
});

// ---- 基础形状 ----
add('shape/ellipse', function (f) {
  ellipse(f, 80, 70, 240, 160, [solid('#14B8A6')]);
});
add('shape/arc', function (f) {
  ellipse(f, 100, 50, 200, 200, [solid('#14B8A6')], {
    arcData: { startingAngle: 0, endingAngle: Math.PI * 1.5, innerRadius: 0.6 },
  });
});
add('shape/polygon', function (f) {
  var p = figma.createPolygon();
  f.appendChild(p);
  p.pointCount = 6;
  p.resize(200, 200);
  p.x = 100;
  p.y = 50;
  p.fills = [solid('#F43F5E')];
});
add('shape/star', function (f) {
  var s = figma.createStar();
  f.appendChild(s);
  s.pointCount = 5;
  s.innerRadius = 0.4;
  s.resize(200, 200);
  s.x = 100;
  s.y = 50;
  s.fills = [solid('#F59E0B')];
});
add('shape/line', function (f) {
  var widths = [1, 4, 12];
  for (var i = 0; i < widths.length; i++) {
    var l = figma.createLine();
    f.appendChild(l);
    l.resize(280, 0);
    l.x = 60;
    l.y = 80 + i * 70;
    l.strokes = [solid('#111827')];
    l.strokeWeight = widths[i];
    l.strokeCap = i === 2 ? 'ROUND' : 'NONE';
  }
});

// ---- 描边 ----
function strokeAlignCase(align) {
  return function (f) {
    rect(f, 120, 90, 160, 120, [solid('#DBEAFE')], {
      strokes: [solid('#1D4ED8')],
      strokeWeight: 12,
      strokeAlign: align,
      cornerRadius: 12,
    });
  };
}
add('stroke/inside', strokeAlignCase('INSIDE'));
add('stroke/center', strokeAlignCase('CENTER'));
add('stroke/outside', strokeAlignCase('OUTSIDE'));
add('stroke/dashed', function (f) {
  rect(f, 80, 50, 240, 120, [], {
    strokes: [solid('#111827')],
    strokeWeight: 4,
    dashPattern: [16, 8],
    cornerRadius: 16,
  });
  var l = figma.createLine();
  f.appendChild(l);
  l.resize(240, 0);
  l.x = 80;
  l.y = 230;
  l.strokes = [solid('#DC2626')];
  l.strokeWeight = 4;
  l.dashPattern = [4, 8];
  l.strokeCap = 'ROUND';
});
add('stroke/individual-weights', function (f) {
  rect(f, 100, 80, 200, 140, [solid('#F3F4F6')], {
    strokes: [solid('#111827')],
    strokeAlign: 'INSIDE',
    strokeTopWeight: 2,
    strokeRightWeight: 8,
    strokeBottomWeight: 16,
    strokeLeftWeight: 4,
  });
});
add('stroke/gradient', function (f) {
  ellipse(f, 100, 50, 200, 200, [], {
    strokes: [gradient('GRADIENT_LINEAR', [stop(0, '#EC4899'), stop(1, '#8B5CF6')])],
    strokeWeight: 16,
  });
});
add('stroke/cap-join', function (f) {
  vec(f, 'M 0 80 L 60 0 L 120 80 L 180 0', { x: 110, y: 40, stroke: '#111827', weight: 16, cap: 'NONE', join: 'MITER', name: 'Miter + no cap' });
  vec(f, 'M 0 80 L 60 0 L 120 80 L 180 0', { x: 110, y: 170, stroke: '#2563EB', weight: 16, cap: 'ROUND', join: 'ROUND', name: 'Round' });
});

// ---- 特效 ----
add('effect/drop-shadow', function (f) {
  f.fills = [solid('#F3F4F6')];
  rect(f, 100, 70, 200, 160, [solid('#FFFFFF')], {
    cornerRadius: 16,
    effects: [shadow('DROP_SHADOW', '#000000', 0.25, 0, 8, 24, 0)],
  });
});
add('effect/shadow-spread', function (f) {
  f.fills = [solid('#F3F4F6')];
  rect(f, 100, 70, 200, 160, [solid('#FFFFFF')], {
    cornerRadius: 16,
    effects: [shadow('DROP_SHADOW', '#2563EB', 0.5, 0, 0, 0, 8)],
  });
});
add('effect/multiple-shadows', function (f) {
  f.fills = [solid('#F3F4F6')];
  rect(f, 100, 70, 200, 160, [solid('#FFFFFF')], {
    cornerRadius: 16,
    effects: [
      shadow('DROP_SHADOW', '#000000', 0.06, 0, 1, 2, 0),
      shadow('DROP_SHADOW', '#000000', 0.12, 0, 12, 32, -4),
      shadow('DROP_SHADOW', '#7C3AED', 0.3, 16, 16, 0, 0),
    ],
  });
});
add('effect/inner-shadow', function (f) {
  rect(f, 100, 70, 200, 160, [solid('#E5E7EB')], {
    cornerRadius: 16,
    effects: [shadow('INNER_SHADOW', '#000000', 0.35, 0, 4, 12, 0)],
  });
});
add('effect/layer-blur', function (f) {
  var s = figma.createStar();
  f.appendChild(s);
  s.resize(160, 160);
  s.x = 120;
  s.y = 70;
  s.fills = [solid('#F97316')];
  setEffects(s, [blur('LAYER_BLUR', 8)]);
});
add('effect/background-blur', function (f) {
  ellipse(f, 40, 40, 160, 160, [solid('#EC4899')]);
  ellipse(f, 200, 100, 160, 160, [solid('#3B82F6')]);
  ellipse(f, 140, 20, 100, 100, [solid('#FACC15')]);
  rect(f, 60, 90, 280, 120, [solid('#FFFFFF', 0.3)], {
    cornerRadius: 16,
    effects: [blur('BACKGROUND_BLUR', 20)],
    name: 'Glass',
  });
});

// ---- 文字 ----
add('text/single-line', function (f) {
  text(f, 'The quick brown fox jumps', { x: 40, y: 130, size: 24 });
});
add('text/wrap', function (f) {
  text(f, LOREM, { x: 40, y: 40, width: 320, size: 16 });
});
add('text/paragraphs', function (f) {
  var t = text(f, 'First paragraph has a single line.\nSecond paragraph is a bit longer so that it wraps onto the next line.\nThird.', {
    x: 40,
    y: 40,
    width: 320,
    size: 16,
  });
  t.paragraphSpacing = 16;
});
add('text/line-height', function (f) {
  text(f, 'Line height 32px. ' + LOREM.slice(0, 60), { x: 30, y: 30, width: 160, size: 16, lineHeight: { value: 32, unit: 'PIXELS' } });
  text(f, 'Line height 150%. ' + LOREM.slice(0, 60), { x: 215, y: 30, width: 160, size: 16, lineHeight: { value: 150, unit: 'PERCENT' } });
});
add('text/letter-spacing', function (f) {
  text(f, 'Letter spacing 0', { x: 40, y: 60, size: 24 });
  text(f, 'Letter spacing 4px', { x: 40, y: 130, size: 24, letterSpacing: { value: 4, unit: 'PIXELS' } });
  text(f, 'Letter spacing -5%', { x: 40, y: 200, size: 24, letterSpacing: { value: -5, unit: 'PERCENT' } });
});
add('text/align-horizontal', function (f) {
  var aligns = ['LEFT', 'CENTER', 'RIGHT'];
  for (var i = 0; i < aligns.length; i++) {
    var y = 50 + i * 80;
    rect(f, 40, y, 320, 40, [solid('#E5E7EB')], { name: 'Box' });
    text(f, 'Align ' + aligns[i].toLowerCase(), { x: 40, y: y + 8, width: 320, size: 18, align: aligns[i] });
  }
});
add('text/align-vertical', function (f) {
  var aligns = ['TOP', 'CENTER', 'BOTTOM'];
  for (var i = 0; i < aligns.length; i++) {
    var x = 30 + i * 120;
    rect(f, x, 50, 100, 200, [solid('#E5E7EB')], { name: 'Box' });
    var t = text(f, aligns[i].toLowerCase(), { x: x, y: 50, size: 16 });
    t.textAutoResize = 'NONE';
    t.resize(100, 200);
    t.textAlignHorizontal = 'CENTER';
    t.textAlignVertical = aligns[i];
  }
});
add('text/mixed-styles', function (f) {
  var str = 'Regular, Bold, Italic, Big, Red and Underline in one text.';
  var t = text(f, str, { x: 30, y: 60, width: 340, size: 20 });
  function range(word) {
    var s = str.indexOf(word);
    return [s, s + word.length];
  }
  var r = range('Bold');
  t.setRangeFontName(r[0], r[1], F.bold);
  r = range('Italic');
  t.setRangeFontName(r[0], r[1], F.italic);
  r = range('Big');
  t.setRangeFontSize(r[0], r[1], 32);
  r = range('Red');
  t.setRangeFills(r[0], r[1], [solid('#DC2626')]);
  r = range('Underline');
  t.setRangeTextDecoration(r[0], r[1], 'UNDERLINE');
});
add('text/decoration-case', function (f) {
  var t1 = text(f, 'Underlined text', { x: 40, y: 40, size: 22 });
  t1.textDecoration = 'UNDERLINE';
  var t2 = text(f, 'Strikethrough text', { x: 40, y: 100, size: 22 });
  t2.textDecoration = 'STRIKETHROUGH';
  var t3 = text(f, 'uppercase via text case', { x: 40, y: 160, size: 22 });
  t3.textCase = 'UPPER';
  var t4 = text(f, 'title case via text case', { x: 40, y: 220, size: 22 });
  t4.textCase = 'TITLE';
});
add('text/cjk-mixed', function (f) {
  text(f, '设计稿还原度测试：Fidelity 测试 123，中英文混排。第二行会自动换行，看看标点挤压和行高是否一致。', {
    x: 30,
    y: 40,
    width: 340,
    size: 18,
    font: F.cjk,
  });
});
add('text/truncation', function (f) {
  var t = text(f, LOREM, { x: 40, y: 60, width: 320, size: 16 });
  try {
    t.textTruncation = 'ENDING';
    t.maxLines = 2;
  } catch (e) {
    t.name = 'Truncation not supported';
  }
  var t2 = text(f, 'A single line that is too long to fit the box', { x: 40, y: 180, size: 16 });
  t2.textAutoResize = 'NONE';
  t2.resize(200, 24);
  try {
    t2.textTruncation = 'ENDING';
  } catch (e) {}
});
add('text/fixed-overflow', function (f) {
  rect(f, 80, 80, 240, 60, [solid('#FEE2E2')], { name: 'Text box' });
  var t = text(f, LOREM.slice(0, 120), { x: 80, y: 80, size: 16 });
  t.textAutoResize = 'NONE';
  t.resize(240, 60);
});

// ---- 矢量 ----
add('vector/filled-path', function (f) {
  vec(f, 'M 0 0 L 200 0 L 140 160 L 60 160 Z', { x: 100, y: 70, fill: '#10B981' });
});
add('vector/heart', function (f) {
  vec(f, 'M 100 180 C 40 140 0 100 0 60 C 0 20 30 0 60 0 C 80 0 94 10 100 24 C 106 10 120 0 140 0 C 170 0 200 20 200 60 C 200 100 160 140 100 180 Z', {
    x: 100,
    y: 60,
    fill: '#EF4444',
  });
});
add('vector/icons-stroke', function (f) {
  var names = Object.keys(ICON);
  for (var i = 0; i < names.length; i++) {
    var col = i % 4;
    var row = Math.floor(i / 4);
    vec(f, ICON[names[i]], { x: 70 + col * 80, y: 90 + row * 80, stroke: '#111827', weight: 2, name: names[i] });
  }
});
add('vector/open-curve', function (f) {
  vec(f, 'M 0 60 C 40 0 80 120 120 60 C 160 0 200 120 240 60 C 260 30 280 30 300 60', {
    x: 50,
    y: 90,
    stroke: '#2563EB',
    weight: 6,
  });
});
add('vector/winding-rule', function (f) {
  var d = 'M 0 0 L 140 0 L 140 140 L 0 140 Z M 35 35 L 105 35 L 105 105 L 35 105 Z';
  vec(f, d, { x: 40, y: 80, fill: '#7C3AED', winding: 'NONZERO', name: 'Nonzero' });
  vec(f, d, { x: 220, y: 80, fill: '#7C3AED', winding: 'EVENODD', name: 'Even-odd' });
});

// ---- 布尔运算 ----
function boolCase(op) {
  return function (f) {
    var a = rect(f, 80, 70, 160, 160, [solid('#6366F1')]);
    var b = ellipse(f, 160, 70, 160, 160, [solid('#6366F1')]);
    var r = figma[op]([a, b], f);
    r.fills = [solid('#6366F1')];
    r.name = op;
  };
}
add('boolean/union', boolCase('union'));
add('boolean/subtract', boolCase('subtract'));
add('boolean/intersect', boolCase('intersect'));
add('boolean/exclude', boolCase('exclude'));

// ---- 图片 ----
add('image/fill', function (f, ctx) {
  rect(f, 80, 60, 240, 180, [imagePaint(ctx.img.portrait, 'FILL')]);
});
add('image/fit', function (f, ctx) {
  rect(f, 80, 60, 240, 180, [solid('#E5E7EB'), imagePaint(ctx.img.portrait, 'FIT')]);
});
add('image/crop', function (f, ctx) {
  rect(f, 80, 60, 240, 180, [imagePaint(ctx.img.square, 'CROP', { imageTransform: [[0.5, 0, 0.25], [0, 0.5, 0.25]] })]);
});
add('image/tile', function (f, ctx) {
  rect(f, 40, 40, 320, 220, [imagePaint(ctx.img.landscape, 'TILE', { scalingFactor: 0.25 })]);
});
add('image/rounded-and-avatar', function (f, ctx) {
  rect(f, 30, 60, 200, 180, [imagePaint(ctx.img.landscape, 'FILL')], { cornerRadius: 24 });
  ellipse(f, 260, 100, 100, 100, [imagePaint(ctx.img.square, 'FILL')], {
    strokes: [solid('#FFFFFF')],
    strokeWeight: 6,
    strokeAlign: 'OUTSIDE',
    effects: [shadow('DROP_SHADOW', '#000000', 0.3, 0, 4, 12, 0)],
  });
});
add('image/opacity', function (f, ctx) {
  stripes(f);
  rect(f, 80, 60, 240, 180, [imagePaint(ctx.img.landscape, 'FILL', { opacity: 0.5 })]);
});

// ---- 容器 ----
add('container/nested-frames', function (f) {
  var outer = frame(f, 20, 20, 360, 260, '#EEF2FF', 16);
  outer.name = 'Outer';
  var inner = frame(outer, 30, 30, 220, 150, '#C7D2FE', 12);
  inner.name = 'Inner';
  rect(inner, 20, 20, 100, 60, [solid('#4F46E5')], { cornerRadius: 8 });
  text(inner, 'Nested', { x: 20, y: 100, size: 16 });
  text(outer, 'Outer frame', { x: 30, y: 200, size: 14, color: '#4338CA' });
});
function clipCase(on) {
  return function (f) {
    var c = frame(f, 100, 75, 200, 150, '#E5E7EB', 8);
    c.clipsContent = on;
    ellipse(c, 120, 40, 160, 160, [solid('#F59E0B')]);
    text(c, 'clipsContent: ' + on, { x: 12, y: 12, size: 12 });
  };
}
add('container/clip-on', clipCase(true));
add('container/clip-off', clipCase(false));
add('container/radius-clip', function (f, ctx) {
  var c = frame(f, 80, 50, 240, 200, null, 32);
  rect(c, 0, 0, 240, 200, [imagePaint(ctx.img.landscape, 'FILL')]);
  text(c, 'Clipped corners', { x: 20, y: 160, size: 16, color: '#FFFFFF' });
});
add('container/rotation', function (f) {
  var r = rect(f, 80, 100, 120, 80, [solid('#3B82F6')], { name: 'Rect 30°' });
  r.rotation = 30;
  var c = frame(f, 230, 90, 120, 120, '#FDE68A', 8);
  c.name = 'Frame -15°';
  text(c, 'Rotated', { x: 24, y: 48, size: 18 });
  c.rotation = -15;
});
add('container/group', function (f) {
  var nodes = [
    rect(f, 60, 80, 120, 120, [solid('#22C55E')]),
    ellipse(f, 140, 120, 140, 140, [solid('#3B82F6')]),
    text(f, 'Group', { x: 80, y: 40, size: 20 }),
  ];
  var g = figma.group(nodes, f);
  g.name = 'Group';
});
add('container/group-opacity', function (f) {
  ellipse(f, 30, 90, 110, 110, [solid('#EF4444')], { opacity: 0.5, name: 'Item opacity' });
  ellipse(f, 90, 90, 110, 110, [solid('#3B82F6')], { opacity: 0.5, name: 'Item opacity' });
  var a = ellipse(f, 210, 90, 110, 110, [solid('#EF4444')]);
  var b = ellipse(f, 270, 90, 110, 110, [solid('#3B82F6')]);
  var g = figma.group([a, b], f);
  g.name = 'Group opacity';
  g.opacity = 0.5;
});
add('container/frame-shadow', function (f) {
  f.fills = [solid('#F3F4F6')];
  var card = frame(f, 80, 60, 240, 180, '#FFFFFF', 16);
  setEffects(card, [shadow('DROP_SHADOW', '#000000', 0.15, 0, 10, 30, 0)]);
  text(card, 'Card with shadow', { x: 20, y: 20, size: 18, font: F.semibold });
  ellipse(card, 170, 110, 120, 120, [solid('#A78BFA')], { name: 'Clipped by card' });
});

// ---- 混合模式 ----
add('blend/modes', function (f) {
  rect(f, 0, 0, 400, 300, [gradient('GRADIENT_LINEAR', [stop(0, '#FDE047'), stop(1, '#F472B6')])], { name: 'Background' });
  var modes = ['MULTIPLY', 'SCREEN', 'OVERLAY'];
  for (var i = 0; i < modes.length; i++) {
    var x = 25 + i * 125;
    ellipse(f, x, 70, 110, 110, [solid('#2563EB')], { blendMode: modes[i], name: modes[i] });
    text(f, modes[i].toLowerCase(), { x: x, y: 200, width: 110, size: 14, align: 'CENTER' });
  }
});

// ---- 蒙版 ----
add('mask/ellipse-image', function (f, ctx) {
  var m = ellipse(f, 100, 50, 200, 200, [solid('#000000')], { name: 'Mask' });
  var p = rect(f, 60, 40, 280, 220, [imagePaint(ctx.img.landscape, 'FILL')], { name: 'Image' });
  m.isMask = true;
  var g = figma.group([m, p], f);
  g.name = 'Masked image';
});
add('mask/star-gradient', function (f) {
  var s = figma.createStar();
  f.appendChild(s);
  s.resize(200, 200);
  s.x = 100;
  s.y = 50;
  s.fills = [solid('#000000')];
  s.name = 'Mask';
  var r = rect(f, 60, 40, 280, 220, [gradient('GRADIENT_LINEAR', [stop(0, '#06B6D4'), stop(1, '#A855F7')])], { name: 'Gradient' });
  s.isMask = true;
  var g = figma.group([s, r], f);
  g.name = 'Masked gradient';
});

// ---- 组件 ----
add('component/instances', function (f) {
  var comp = figma.createComponent();
  f.appendChild(comp);
  comp.name = 'Button';
  comp.layoutMode = 'HORIZONTAL';
  comp.primaryAxisSizingMode = 'AUTO';
  comp.counterAxisSizingMode = 'AUTO';
  comp.paddingTop = 12;
  comp.paddingBottom = 12;
  comp.paddingLeft = 20;
  comp.paddingRight = 20;
  comp.itemSpacing = 8;
  comp.counterAxisAlignItems = 'CENTER';
  comp.cornerRadius = 8;
  comp.fills = [solid('#2563EB')];
  vec(comp, ICON.heart, { stroke: '#FFFFFF', weight: 2, name: 'Icon' });
  text(comp, 'Button', { color: '#FFFFFF', font: F.semibold, size: 16 });
  comp.x = 40;
  comp.y = 40;

  var inst1 = comp.createInstance();
  f.appendChild(inst1);
  inst1.x = 40;
  inst1.y = 120;

  var inst2 = comp.createInstance();
  f.appendChild(inst2);
  inst2.x = 40;
  inst2.y = 200;
  var t = inst2.findOne(function (n) {
    return n.type === 'TEXT';
  });
  if (t) t.characters = 'Longer override text';
  inst2.fills = [solid('#16A34A')];
});

// ---- 自动布局 ----
add('layout/horizontal', function (f) {
  var row = al('H', { parent: f, gap: 12, pad: 16, fill: '#F3F4F6', radius: 12, align: 'CENTER' });
  row.x = 24;
  row.y = 118;
  ['Design', 'Code', 'Fidelity'].forEach(function (label) {
    var chip = al('H', { parent: row, pad: [8, 16], fill: '#DBEAFE', radius: 999 });
    text(chip, label, { color: '#1D4ED8', font: F.medium, size: 14 });
  });
});
add('layout/vertical-fill', function (f) {
  var col = al('V', { parent: f, gap: 12, pad: 20, fill: '#F9FAFB', radius: 12, stroke: '#E5E7EB' });
  col.x = 40;
  col.y = 40;
  setFixed(col, 320, null);
  text(col, 'Title', { font: F.bold, size: 20 });
  fillW(rect(col, 0, 0, 100, 12, [solid('#3B82F6')], { cornerRadius: 6, name: 'Fill bar' }));
  text(col, 'This text fills the container width and wraps when it gets too long.', { fillW: true, size: 14, color: '#4B5563' });
  var row = al('H', { parent: col, justify: 'SPACE_BETWEEN', align: 'CENTER' });
  fillW(row);
  text(row, 'Left');
  text(row, 'Right', { color: '#2563EB' });
});
add('layout/wrap', function (f) {
  var wrap = al('H', { parent: f, gap: 8, pad: 16, fill: '#F3F4F6', radius: 12 });
  wrap.x = 30;
  wrap.y = 60;
  setFixed(wrap, 340, null);
  wrap.layoutWrap = 'WRAP';
  wrap.counterAxisSpacing = 8;
  ['React', 'tldraw', 'Figma', 'Canvas', 'SVG', 'Auto Layout', 'Text', 'Fidelity', 'Shadow', 'Blur'].forEach(function (label) {
    var chip = al('H', { parent: wrap, pad: [6, 12], fill: '#FFFFFF', radius: 999, stroke: '#D1D5DB' });
    text(chip, label, { size: 13 });
  });
});
add('layout/absolute-child', function (f) {
  var card = al('V', { parent: f, gap: 8, pad: 20, fill: '#FFFFFF', radius: 16, stroke: '#E5E7EB' });
  card.x = 80;
  card.y = 90;
  setFixed(card, 240, null);
  text(card, 'Notifications', { font: F.semibold, size: 18 });
  text(card, 'You have 3 unread messages', { size: 14, color: '#6B7280' });
  var badge = al('H', { parent: card, pad: [2, 8], fill: '#EF4444', radius: 999 });
  text(badge, '3', { color: '#FFFFFF', size: 12, font: F.bold });
  badge.layoutPositioning = 'ABSOLUTE';
  badge.x = 214;
  badge.y = -8;
});

// ---- 其他 ----
add('misc/hidden-layer', function (f) {
  rect(f, 100, 80, 200, 140, [solid('#22C55E')], { name: 'Visible' });
  rect(f, 120, 100, 160, 100, [solid('#EF4444')], { name: 'Hidden', visible: false });
  text(f, 'Only green should be visible', { x: 100, y: 240, size: 14 });
});
add('misc/subpixel', function (f) {
  rect(f, 10.5, 10.5, 100.25, 50.75, [solid('#3B82F6')], { name: 'Subpixel rect' });
  rect(f, 140, 20, 240, 1, [solid('#111827')], { name: 'Hairline 1px' });
  rect(f, 140, 40, 240, 0.5, [solid('#111827')], { name: 'Hairline 0.5px' });
  rect(f, 20, 100, 160, 100, [], { strokes: [solid('#111827')], strokeWeight: 0.5, name: 'Stroke 0.5px' });
  rect(f, 220, 100, 160, 100, [], { strokes: [solid('#111827')], strokeWeight: 1, name: 'Stroke 1px' });
  text(f, 'Tiny 10px text for rounding checks', { x: 20, y: 240, size: 10 });
});

// ---------------------------------------------------------------------------
// 真实页面
// ---------------------------------------------------------------------------

addPage('page/mobile-login', function (f) {
  f.fills = [solid('#FFFFFF')];
  pageLayout(f, 375, 812, [88, 24, 40, 24], 16);

  var logo = figma.createEllipse();
  f.appendChild(logo);
  logo.resize(56, 56);
  logo.fills = [gradient('GRADIENT_LINEAR', [stop(0, '#6366F1'), stop(1, '#EC4899')])];
  logo.name = 'Logo';

  text(f, 'Welcome back', { font: F.bold, size: 28, fillW: true });
  text(f, '登录后继续使用你的工作区', { font: F.cjk, size: 15, color: '#6B7280', fillW: true });

  function input(placeholder, withIcon) {
    var box = al('H', { parent: f, pad: [0, 16], stroke: '#D1D5DB', radius: 10, align: 'CENTER', justify: 'SPACE_BETWEEN', fill: '#FFFFFF', name: 'Input' });
    setFixed(box, null, 48);
    fillW(box);
    text(box, placeholder, { color: '#9CA3AF', size: 15 });
    if (withIcon) vec(box, ICON.eye, { stroke: '#6B7280', name: 'Eye' });
  }
  input('Email address', false);
  input('Password', true);

  var row = al('H', { parent: f, justify: 'SPACE_BETWEEN', align: 'CENTER', name: 'Options' });
  fillW(row);
  var left = al('H', { parent: row, gap: 8, align: 'CENTER' });
  rect(left, 0, 0, 18, 18, [solid('#FFFFFF')], { cornerRadius: 4, strokes: [solid('#9CA3AF')], strokeWeight: 1.5, name: 'Checkbox' });
  text(left, 'Remember me', { size: 14, color: '#374151' });
  text(row, 'Forgot password?', { size: 14, color: '#2563EB', font: F.medium });

  var btn = al('H', { parent: f, pad: [14, 0], fill: '#2563EB', radius: 10, justify: 'CENTER', align: 'CENTER', name: 'Primary button' });
  fillW(btn);
  setEffects(btn, [shadow('DROP_SHADOW', '#2563EB', 0.3, 0, 6, 16, 0)]);
  text(btn, 'Sign in', { color: '#FFFFFF', font: F.semibold, size: 16 });

  var dv = al('H', { parent: f, gap: 12, align: 'CENTER', name: 'Divider' });
  fillW(dv);
  rect(dv, 0, 0, 10, 1, [solid('#E5E7EB')]).layoutGrow = 1;
  text(dv, 'or', { size: 13, color: '#9CA3AF' });
  rect(dv, 0, 0, 10, 1, [solid('#E5E7EB')]).layoutGrow = 1;

  var sso = al('H', { parent: f, pad: [13, 0], gap: 10, stroke: '#D1D5DB', radius: 10, justify: 'CENTER', align: 'CENTER', fill: '#FFFFFF', name: 'SSO button' });
  fillW(sso);
  vec(sso, ICON.lock, { stroke: '#111827', name: 'Lock' });
  text(sso, 'Continue with SSO', { font: F.medium, size: 15 });

  var spacer = figma.createFrame();
  f.appendChild(spacer);
  spacer.fills = [];
  spacer.name = 'Spacer';
  spacer.resize(10, 10);
  spacer.layoutGrow = 1;

  var footer = "Don't have an account? Sign up";
  var ft = text(f, footer, { size: 14, color: '#6B7280', fillW: true, align: 'CENTER' });
  var s = footer.indexOf('Sign up');
  ft.setRangeFills(s, footer.length, [solid('#2563EB')]);
  ft.setRangeFontName(s, footer.length, F.semibold);
}, 375, 812);

addPage('page/product-list', function (f, ctx) {
  f.fills = [solid('#F9FAFB')];
  pageLayout(f, 375, 812, [0, 0, 0, 0], 0);

  var header = al('H', { parent: f, pad: [56, 20, 14, 20], justify: 'SPACE_BETWEEN', align: 'CENTER', fill: '#FFFFFF', name: 'Header' });
  fillW(header);
  text(header, 'Products', { font: F.bold, size: 22 });
  vec(header, ICON.cart, { stroke: '#111827', name: 'Cart' });

  var sw = al('H', { parent: f, pad: [4, 20, 12, 20], fill: '#FFFFFF', name: 'Search wrap' });
  fillW(sw);
  var search = al('H', { parent: sw, pad: [0, 14], gap: 8, fill: '#F3F4F6', radius: 20, align: 'CENTER', name: 'Search' });
  setFixed(search, null, 40);
  fillW(search);
  vec(search, ICON.search, { stroke: '#9CA3AF', name: 'Search icon' });
  text(search, 'Search products', { size: 14, color: '#9CA3AF' });

  var list = al('V', { parent: f, pad: [12, 20], gap: 12, name: 'List' });
  fillW(list);
  list.layoutGrow = 1;

  var products = [
    { name: 'Wireless Headphones', desc: 'Noise cancelling over-ear headphones with 30-hour battery life and fast charging.', price: '$129.00', tag: 'In stock', img: 'landscape' },
    { name: 'Ceramic Mug Set', desc: 'Set of four handmade mugs. Dishwasher safe.', price: '$36.50', tag: 'New', img: 'portrait' },
    { name: 'Desk Plant', desc: 'Low maintenance succulent in a 4-inch pot, perfect for your desk or windowsill.', price: '$18.00', tag: 'Sale', img: 'square' },
  ];
  products.forEach(function (p) {
    var card = al('H', { parent: list, pad: 12, gap: 12, fill: '#FFFFFF', radius: 16, name: 'Product card' });
    fillW(card);
    setEffects(card, [shadow('DROP_SHADOW', '#000000', 0.04, 0, 1, 2, 0), shadow('DROP_SHADOW', '#000000', 0.06, 0, 4, 12, 0)]);
    rect(card, 0, 0, 88, 88, [imagePaint(ctx.img[p.img], 'FILL')], { cornerRadius: 12, name: 'Photo' });
    var info = al('V', { parent: card, gap: 4, name: 'Info' });
    fillW(info);
    text(info, p.name, { font: F.semibold, size: 16, fillW: true });
    var d = text(info, p.desc, { size: 13, color: '#6B7280', fillW: true, lineHeight: { value: 18, unit: 'PIXELS' } });
    try {
      d.textTruncation = 'ENDING';
      d.maxLines = 2;
    } catch (e) {}
    var pr = al('H', { parent: info, justify: 'SPACE_BETWEEN', align: 'CENTER', name: 'Price row' });
    fillW(pr);
    text(pr, p.price, { font: F.bold, size: 16, color: '#DC2626' });
    var chip = al('H', { parent: pr, pad: [2, 8], fill: '#DCFCE7', radius: 999, name: 'Tag' });
    text(chip, p.tag, { size: 11, color: '#15803D', font: F.medium });
  });

  var tab = al('H', { parent: f, pad: [10, 28, 30, 28], justify: 'SPACE_BETWEEN', fill: '#FFFFFF', name: 'Tab bar' });
  fillW(tab);
  tab.strokes = [solid('#E5E7EB')];
  tab.strokeAlign = 'INSIDE';
  tab.strokeTopWeight = 1;
  tab.strokeRightWeight = 0;
  tab.strokeBottomWeight = 0;
  tab.strokeLeftWeight = 0;
  [['Home', 'home', true], ['Browse', 'grid'], ['Saved', 'heart'], ['Profile', 'user']].forEach(function (item) {
    var color = item[2] ? '#2563EB' : '#9CA3AF';
    var t = al('V', { parent: tab, gap: 4, align: 'CENTER', name: item[0] });
    vec(t, ICON[item[1]], { stroke: color, name: item[1] });
    text(t, item[0], { size: 11, color: color, font: item[2] ? F.semibold : F.regular });
  });
}, 375, 812);

addPage('page/gallery', function (f, ctx) {
  f.fills = [solid('#0F172A')];
  pageLayout(f, 375, 812, [56, 16, 16, 16], 12);

  text(f, 'Gallery', { font: F.bold, size: 28, color: '#FFFFFF' });
  text(f, 'Recent shots · 6 items', { size: 14, color: '#94A3B8' });

  var grid = al('H', { parent: f, gap: 12, name: 'Grid' });
  fillW(grid);
  grid.layoutWrap = 'WRAP';
  grid.counterAxisSpacing = 12;

  var tiles = [
    { h: 200, img: 'landscape', mode: 'FILL', label: 'Harbor' },
    { h: 140, img: 'portrait', mode: 'FILL', label: 'Tower' },
    { h: 140, img: 'square', mode: 'FIT', label: 'Fit mode' },
    { h: 200, img: 'portrait', mode: 'FILL', label: 'Sunset' },
    { h: 160, img: 'square', mode: 'CROP', label: 'Crop mode' },
    { h: 160, img: 'landscape', mode: 'TILE', label: 'Tile mode' },
  ];
  tiles.forEach(function (t) {
    var extra = null;
    if (t.mode === 'CROP') extra = { imageTransform: [[0.6, 0, 0.2], [0, 0.6, 0.1]] };
    if (t.mode === 'TILE') extra = { scalingFactor: 0.3 };
    var tile = frame(grid, 0, 0, 165.5, t.h, null, 14);
    tile.name = 'Tile ' + t.label;
    tile.fills = [solid('#1E293B'), imagePaint(ctx.img[t.img], t.mode, extra)];
    rect(tile, 0, t.h - 70, 165.5, 70, [gradient('GRADIENT_LINEAR', [stop(0, '#000000', 0), stop(1, '#000000', 0.7)], TOP_TO_BOTTOM)], { name: 'Overlay' });
    text(tile, t.label, { x: 12, y: t.h - 30, size: 14, color: '#FFFFFF', font: F.semibold });
  });
}, 375, 812);

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

function post(msg) {
  figma.ui.postMessage(msg);
}

function uniquePageName(base) {
  var names = figma.root.children.map(function (p) {
    return p.name;
  });
  if (names.indexOf(base) < 0) return base;
  var i = 2;
  while (names.indexOf(base + ' ' + i) >= 0) i++;
  return base + ' ' + i;
}

async function generate(images) {
  post({ type: 'log', text: '加载字体…' });
  await prepareFonts();
  post({ type: 'log', text: '中文字体：' + F.cjk.family + ' ' + F.cjk.style });

  var hashes = {};
  for (var k in images) {
    hashes[k] = figma.createImage(images[k]).hash;
  }
  var ctx = { img: hashes };

  var page = figma.createPage();
  page.name = uniquePageName('Test Cases');
  await figma.setCurrentPageAsync(page);

  var failed = [];
  var ok = 0;
  var all = CASES.concat(PAGES);
  var rows = Math.ceil(CASES.length / COLS);
  var pageX = 0;

  for (var i = 0; i < all.length; i++) {
    var c = all[i];
    var isPage = i >= CASES.length;
    post({ type: 'progress', done: i, total: all.length, text: c.name });
    var f = null;
    try {
      f = figma.createFrame();
      page.appendChild(f);
      f.name = c.name;
      f.resize(c.w, c.h);
      f.fills = [solid('#FFFFFF')];
      f.clipsContent = true;
      if (isPage) {
        f.x = pageX;
        f.y = rows * (FRAME_H + GAP) + 200;
        pageX += c.w + 120;
      } else {
        f.x = (i % COLS) * (FRAME_W + GAP);
        f.y = Math.floor(i / COLS) * (FRAME_H + GAP);
      }
      await c.build(f, ctx);
      ok++;
    } catch (e) {
      failed.push(c.name + '：' + (e && e.message ? e.message : String(e)));
      if (f) {
        try {
          f.remove();
        } catch (e2) {}
      }
    }
  }

  figma.viewport.scrollAndZoomIntoView(page.children);
  post({ type: 'generate-done', ok: ok, total: all.length, failed: failed, page: page.name });
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

var SVG_TYPES = { VECTOR: 1, BOOLEAN_OPERATION: 1, STAR: 1, POLYGON: 1, LINE: 1, ELLIPSE: 1 };
var EXPORT_TYPES = { FRAME: 1, COMPONENT: 1, COMPONENT_SET: 1, SECTION: 1, INSTANCE: 1, GROUP: 1 };

function imageExt(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'webp';
  return 'bin';
}

// 插件沙箱里不一定有 TextDecoder，自己解一下 UTF-8
function utf8Decode(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; ) {
    var b = bytes[i++];
    if (b < 0x80) s += String.fromCharCode(b);
    else if (b < 0xe0) s += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b < 0xf0) s += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      var cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      cp -= 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return s;
}

function slug(part) {
  return part.trim().replace(/[^\w\-.一-龥]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
}

function caseDir(name) {
  return name.split('/').map(slug).join('/');
}

// "Test Cases" 页面上的用例按名字分类；其他页面（比如从社区文件里挑的稿子）放到 real/<文件名>/<页面名>-<frame 名>，重名的加序号
function exportDirs(nodes, fileName, pageName) {
  var used = {};
  return nodes.map(function (node) {
    var base =
      pageName.indexOf('Test Cases') === 0
        ? caseDir(node.name)
        : 'real/' + slug(fileName).toLowerCase().slice(0, 40).replace(/-+$/, '') + '/' + slug(pageName).toLowerCase() + '-' + slug(node.name).toLowerCase();
    var dir = base;
    for (var n = 2; used[dir]; n++) dir = base + '-' + n;
    used[dir] = true;
    return dir;
  });
}

async function collect(node, out) {
  if (node.visible === false) return;

  // 节点本身的宽高和绝对变换：REST 格式里没有，旋转的节点要靠它摆放
  if ('absoluteTransform' in node) {
    out.transforms[node.id] = { m: node.absoluteTransform, w: node.width, h: node.height };
  }
  // 蒙版图层单独导出 SVG 会失败，改为导出它的填充路径（节点自己的坐标系）
  if (node.isMask) {
    try {
      out.masks[node.id] = node.fillGeometry
        .map(function (g) {
          return g.data;
        })
        .join(' ');
    } catch (e) {
      out.warnings.push('读取蒙版形状失败：' + node.name + '（' + node.id + '）');
    }
  }

  if ('fills' in node && node.fills !== figma.mixed && Array.isArray(node.fills)) {
    node.fills.forEach(function (p) {
      if (p.type === 'IMAGE' && p.imageHash) out.images[p.imageHash] = true;
    });
  }
  if (node.type === 'TEXT') {
    try {
      node.getStyledTextSegments(['fontName']).forEach(function (s) {
        out.fonts[s.fontName.family + ' / ' + s.fontName.style] = true;
      });
    } catch (e) {
      out.warnings.push('读取字体失败：' + node.name);
    }
  }
  // absoluteRenderBounds 为 null 表示什么都画不出来（比如整个被父容器裁掉），导出 SVG 必然失败，直接跳过
  if (SVG_TYPES[node.type] && !node.isMask && node.absoluteRenderBounds !== null) {
    try {
      var svg = await node.exportAsync({ format: 'SVG_STRING' });
      out.svgs[node.id] = typeof svg === 'string' ? svg : utf8Decode(svg);
    } catch (e) {
      out.warnings.push('导出 SVG 失败：' + node.name + '（' + node.id + '）');
    }
    if (node.type === 'BOOLEAN_OPERATION') return; // 布尔运算整体当成一个 SVG
  }
  if ('children' in node) {
    for (var i = 0; i < node.children.length; i++) {
      await collect(node.children[i], out);
    }
  }
}

async function exportOne(node, dir) {
  var rest = await node.exportAsync({ format: 'JSON_REST_V1' });
  var out = { svgs: {}, images: {}, fonts: {}, warnings: [], transforms: {}, masks: {} };
  await collect(node, out);

  var files = [];
  var imageFiles = {};
  var imageSizes = {};
  var hashes = Object.keys(out.images);
  for (var i = 0; i < hashes.length; i++) {
    var img = figma.getImageByHash(hashes[i]);
    if (!img) {
      out.warnings.push('找不到图片：' + hashes[i]);
      continue;
    }
    var bytes = await img.getBytesAsync();
    var rel = 'images/' + hashes[i] + '.' + imageExt(bytes);
    imageFiles[hashes[i]] = rel;
    try {
      imageSizes[hashes[i]] = await img.getSizeAsync();
    } catch (e) {
      out.warnings.push('读取图片尺寸失败：' + hashes[i]);
    }
    files.push({ path: dir + '/' + rel, bytes: bytes });
  }

  var png = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
  files.push({ path: dir + '/expected@2x.png', bytes: png });

  var meta = {
    name: node.name,
    nodeId: node.id,
    type: node.type,
    width: node.width,
    height: node.height,
    expectedScale: 2,
    fonts: Object.keys(out.fonts),
    images: imageFiles,
    imageSizes: imageSizes,
    masks: out.masks,
    warnings: out.warnings,
  };
  var snapshot = { meta: meta, rest: rest, svgs: out.svgs, transforms: out.transforms };
  files.push({ path: dir + '/snapshot.json', text: JSON.stringify(snapshot, null, 2) });

  return {
    files: files,
    summary: {
      name: node.name,
      dir: dir,
      nodeId: node.id,
      width: node.width,
      height: node.height,
      svgCount: Object.keys(out.svgs).length,
      imageCount: Object.keys(imageFiles).length,
      fonts: meta.fonts,
      warnings: out.warnings,
    },
  };
}

async function exportCases() {
  var page = figma.currentPage;
  // 有选中时导出选中的节点（可以在 section 里面），没选中时导出页面上所有顶层 frame
  var selected = page.selection.length > 0;
  var source = selected ? page.selection : page.children;
  var targets = source.filter(function (n) {
    return (selected || n.parent === page) && EXPORT_TYPES[n.type] && n.visible !== false;
  });
  if (!targets.length) {
    post({ type: 'error', text: '当前页面上没有可导出的顶层 frame。' });
    return;
  }

  var dirs = exportDirs(targets, figma.root.name, page.name);
  post({ type: 'export-start', total: targets.length, fileName: figma.root.name, pageName: page.name });
  for (var i = 0; i < targets.length; i++) {
    var node = targets[i];
    post({ type: 'progress', done: i, total: targets.length, text: node.name });
    try {
      var data = await exportOne(node, dirs[i]);
      post({ type: 'export-case', files: data.files, summary: data.summary });
    } catch (e) {
      post({ type: 'export-error', name: node.name, text: e && e.message ? e.message : String(e) });
    }
  }
  post({ type: 'export-done' });
}

// ---------------------------------------------------------------------------
// 消息
// ---------------------------------------------------------------------------

figma.ui.onmessage = async function (msg) {
  try {
    if (msg.type === 'generate') await generate(msg.images);
    else if (msg.type === 'export') await exportCases();
    else if (msg.type === 'close') figma.closePlugin();
  } catch (e) {
    post({ type: 'error', text: e && e.message ? e.message : String(e) });
  }
};
