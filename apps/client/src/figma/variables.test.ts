import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  Editor,
} from '../engine';
import { indexMains, rebuildTree } from './components';
import { enableFigmaEditing, markUserResize } from './editing/engine';
import { shapesByNodeId } from './editing/instances';
import {
  readVariableSet,
  setShapeMode,
  setVariableValue,
} from './editing/variables';
import { putSnapshot } from './editor';
import type { FigmaShape } from './shape-types';
import { figmaShapeUtils } from './shapes';
import type {
  FigmaColor,
  FigmaNode,
  FigmaPaint,
  FigmaVariableAlias,
  Snapshot,
  SnapshotVariables,
} from './types';
import {
  applyVariables,
  detachEdited,
  effectiveModes,
  type FigmaVariableSet,
  resolveVariable,
  sameValue,
  slotValue,
  variableSlots,
  withCollectionValues,
  withTextBindings,
} from './variables';

// tldraw's Editor only needs a few DOM pieces to run headless.
function fakeElement(): unknown {
  return {
    style: {
      setProperty() {},
      getPropertyValue: () => '',
      removeProperty() {},
    },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    removeAttribute() {},
    appendChild: (c: unknown) => c,
    removeChild() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
  };
}

Object.assign(globalThis, {
  document: {
    createElement: fakeElement,
    addEventListener() {},
    removeEventListener() {},
    body: fakeElement(),
    documentElement: fakeElement(),
  },
  window: globalThis,
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame: () => 0,
  cancelAnimationFrame() {},
  devicePixelRatio: 1,
  matchMedia: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }),
});

const alias = (id: string): FigmaVariableAlias => ({
  type: 'VARIABLE_ALIAS',
  id,
});

const WHITE = { r: 1, g: 1, b: 1, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const BLUE = { r: 0, g: 0, b: 1, a: 1 };
const ORANGE = { r: 1, g: 0.5, b: 0, a: 1 };

// Palette (one mode) ← Theme (Light / Dark) ← Theme's own alias; Spacing (S / L).
const SET: SnapshotVariables = {
  collections: {
    'C:palette': {
      id: 'C:palette',
      name: 'Palette',
      modes: [{ modeId: 'p', name: 'Value' }],
      defaultModeId: 'p',
    },
    'C:theme': {
      id: 'C:theme',
      name: 'Theme',
      modes: [
        { modeId: 'light', name: 'Light' },
        { modeId: 'dark', name: 'Dark' },
      ],
      defaultModeId: 'light',
    },
    'C:space': {
      id: 'C:space',
      name: 'Spacing',
      modes: [
        { modeId: 's', name: 'S' },
        { modeId: 'l', name: 'L' },
      ],
      defaultModeId: 's',
    },
  },
  variables: {
    'V:blue': {
      id: 'V:blue',
      name: 'blue',
      variableCollectionId: 'C:palette',
      resolvedType: 'COLOR',
      valuesByMode: { p: { r: 0, g: 0, b: 1 } },
    },
    'V:orange': {
      id: 'V:orange',
      name: 'orange',
      variableCollectionId: 'C:palette',
      resolvedType: 'COLOR',
      valuesByMode: { p: { r: 1, g: 0.5, b: 0, a: 1 } },
    },
    'V:bg': {
      id: 'V:bg',
      name: 'bg',
      variableCollectionId: 'C:theme',
      resolvedType: 'COLOR',
      valuesByMode: { light: WHITE, dark: BLACK },
    },
    'V:accent': {
      id: 'V:accent',
      name: 'accent',
      variableCollectionId: 'C:theme',
      resolvedType: 'COLOR',
      valuesByMode: { light: alias('V:blue'), dark: alias('V:orange') },
    },
    'V:button': {
      id: 'V:button',
      name: 'button',
      variableCollectionId: 'C:theme',
      resolvedType: 'COLOR',
      valuesByMode: { light: alias('V:accent'), dark: alias('V:accent') },
    },
    'V:label': {
      id: 'V:label',
      name: 'label',
      variableCollectionId: 'C:theme',
      resolvedType: 'STRING',
      valuesByMode: { light: 'Light', dark: 'Dark' },
    },
    'V:style': {
      id: 'V:style',
      name: 'style',
      variableCollectionId: 'C:theme',
      resolvedType: 'STRING',
      valuesByMode: { light: 'Regular', dark: 'Bold Italic' },
    },
    'V:badge': {
      id: 'V:badge',
      name: 'badge',
      variableCollectionId: 'C:theme',
      resolvedType: 'BOOLEAN',
      valuesByMode: { light: true, dark: false },
    },
    'V:pad': {
      id: 'V:pad',
      name: 'pad',
      variableCollectionId: 'C:space',
      resolvedType: 'FLOAT',
      valuesByMode: { s: 8, l: 20 },
    },
    'V:radius': {
      id: 'V:radius',
      name: 'radius',
      variableCollectionId: 'C:space',
      resolvedType: 'FLOAT',
      valuesByMode: { s: 4, l: 16 },
    },
    'V:opacity': {
      id: 'V:opacity',
      name: 'opacity',
      variableCollectionId: 'C:space',
      resolvedType: 'FLOAT',
      valuesByMode: { s: 100, l: 50 },
    },
    'V:width': {
      id: 'V:width',
      name: 'width',
      variableCollectionId: 'C:space',
      resolvedType: 'FLOAT',
      valuesByMode: { s: 120, l: 220 },
    },
  },
  modes: {},
  inherited: {},
  missing: [],
};

const set: FigmaVariableSet = SET;

function bound(color: FigmaColor, id: string): FigmaPaint {
  return { type: 'SOLID', color, boundVariables: { color: alias(id) } };
}

describe('resolveVariable', () => {
  it('uses the default mode when no layer picks one', () => {
    expect(resolveVariable(set, 'V:bg', {})).toEqual(WHITE);
  });

  it('follows aliases, each hop in its own collection', () => {
    expect(resolveVariable(set, 'V:button', { 'C:theme': 'dark' })).toEqual(
      ORANGE,
    );
    expect(resolveVariable(set, 'V:button', {})).toEqual({ r: 0, g: 0, b: 1 });
  });

  it('gives up on cycles and missing variables', () => {
    const loop: FigmaVariableSet = {
      collections: set.collections,
      variables: {
        a: {
          ...set.variables['V:bg'],
          id: 'a',
          valuesByMode: { light: alias('b') },
        },
        b: {
          ...set.variables['V:bg'],
          id: 'b',
          valuesByMode: { light: alias('a') },
        },
      },
    };
    expect(resolveVariable(loop, 'a', {})).toBeUndefined();
    expect(resolveVariable(set, 'V:nope', {})).toBeUndefined();
  });
});

describe('effectiveModes', () => {
  it('lets nearer layers win and starts from what the root inherits', () => {
    const root = {
      id: '1',
      name: 'root',
      type: 'FRAME',
      inheritedVariableModes: { 'C:theme': 'dark', 'C:space': 'l' },
    } as FigmaNode;
    const panel = {
      id: '2',
      name: 'panel',
      type: 'FRAME',
      explicitVariableModes: { 'C:theme': 'light' },
    } as FigmaNode;
    expect(effectiveModes([root, panel])).toEqual({
      'C:theme': 'light',
      'C:space': 'l',
    });
  });
});

describe('applyVariables', () => {
  const node = {
    id: '1',
    name: 'card',
    type: 'FRAME',
    opacity: 1,
    cornerRadius: 4,
    paddingLeft: 8,
    fills: [bound(WHITE, 'V:bg')],
    strokes: [
      {
        type: 'GRADIENT_LINEAR',
        gradientStops: [
          {
            position: 0,
            color: BLUE,
            boundVariables: { color: alias('V:accent') },
          },
          { position: 1, color: WHITE },
        ],
      },
    ],
    effects: [
      {
        type: 'DROP_SHADOW',
        visible: true,
        radius: 8,
        color: BLUE,
        boundVariables: { color: alias('V:accent'), radius: alias('V:pad') },
      },
    ],
    boundVariables: {
      size: { x: alias('V:width') },
      paddingLeft: alias('V:pad'),
      opacity: alias('V:opacity'),
      visible: alias('V:badge'),
      rectangleCornerRadii: {
        RECTANGLE_TOP_LEFT_CORNER_RADIUS: alias('V:radius'),
        RECTANGLE_TOP_RIGHT_CORNER_RADIUS: alias('V:radius'),
        RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS: alias('V:radius'),
        RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS: alias('V:radius'),
      },
    },
  } as FigmaNode;

  it('keeps the same node when the values already match', () => {
    const r = applyVariables(node, set, {});
    expect(r.node).toBe(node);
    expect(r.w).toBe(120);
  });

  it('writes every bound field for other modes', () => {
    const r = applyVariables(node, set, { 'C:theme': 'dark', 'C:space': 'l' });
    expect(r.node.fills?.[0].color).toEqual(BLACK);
    expect(r.node.strokes?.[0].gradientStops?.[0].color).toEqual(ORANGE);
    expect(r.node.strokes?.[0].gradientStops?.[1].color).toEqual(WHITE);
    expect(r.node.effects?.[0].color).toEqual(ORANGE);
    expect(r.node.effects?.[0].radius).toBe(20);
    expect(r.node.paddingLeft).toBe(20);
    expect(r.node.opacity).toBe(0.5);
    expect(r.node.visible).toBe(false);
    expect(r.node.cornerRadius).toBe(16);
    expect(r.node.rectangleCornerRadii).toBeUndefined();
    expect(r.w).toBe(220);
  });

  it('writes text fields and per-range styles', () => {
    const text = {
      id: '2',
      name: 'label',
      type: 'TEXT',
      characters: 'Light',
      style: {
        fontSize: 14,
        lineHeightPercentFontSize: 120,
        lineHeightUnit: 'FONT_SIZE_%',
        boundVariables: {
          fontSize: alias('V:pad'),
          lineHeight: alias('V:width'),
        },
      },
      styleOverrideTable: {
        '1': { fills: [bound(BLUE, 'V:accent')] },
      },
      boundVariables: { characters: alias('V:label') },
    } as FigmaNode;
    const r = applyVariables(text, set, { 'C:theme': 'dark', 'C:space': 'l' });
    expect(r.node.characters).toBe('Dark');
    expect(r.node.style?.fontSize).toBe(20);
    expect(r.node.style?.lineHeightPx).toBe(220);
    expect(r.node.style?.lineHeightUnit).toBe('PIXELS');
    expect(r.node.style?.lineHeightPercentFontSize).toBeUndefined();
    expect(r.node.styleOverrideTable?.['1'].fills?.[0].color).toEqual(ORANGE);
  });

  it('writes the weight of a font style and paragraph spacing in segments', () => {
    const text = {
      id: '3',
      name: 'body',
      type: 'TEXT',
      characters: 'Hello',
      style: {
        fontStyle: 'Regular',
        fontWeight: 400,
        paragraphSpacing: 8,
        boundVariables: {
          fontStyle: alias('V:style'),
          paragraphSpacing: alias('V:pad'),
        },
      },
      textSegments: [{ start: 0, end: 5, paragraphSpacing: 8 }],
    } as FigmaNode;
    const r = applyVariables(text, set, { 'C:theme': 'dark', 'C:space': 'l' });
    expect(r.node.style?.fontStyle).toBe('Bold Italic');
    expect(r.node.style?.fontWeight).toBe(700);
    expect(r.node.style?.italic).toBe(true);
    expect(r.node.style?.paragraphSpacing).toBe(20);
    expect(r.node.textSegments?.[0].paragraphSpacing).toBe(20);

    const { fontWeight: _w, ...withoutWeight } = text.style!;
    const other = applyVariables(
      {
        ...text,
        style: withoutWeight,
        textSegments: [
          { start: 0, end: 2, paragraphSpacing: 8 },
          { start: 3, end: 5, paragraphSpacing: 16 },
        ],
      } as FigmaNode,
      {
        ...set,
        variables: {
          ...set.variables,
          'V:style': {
            ...set.variables['V:style'],
            valuesByMode: { light: 'Regular', dark: 'Oblique' },
          },
        },
      },
      { 'C:theme': 'dark', 'C:space': 'l' },
    ).node;
    expect('fontWeight' in other.style!).toBe(false);
    expect(other.textSegments?.map((g) => g.paragraphSpacing)).toEqual([
      20, 16,
    ]);
  });

  it('splits corners that stop being equal', () => {
    const one = {
      ...node,
      boundVariables: { topLeftRadius: alias('V:radius') },
    } as FigmaNode;
    expect(
      applyVariables(one, set, { 'C:space': 'l' }).node.rectangleCornerRadii,
    ).toEqual([16, 4, 4, 4]);
  });

  it('lists the bound fields with labels', () => {
    expect(variableSlots(node).map((s) => s.label)).toEqual([
      '宽',
      '左内边距',
      '不透明度',
      '显示',
      '左上圆角',
      '右上圆角',
      '右下圆角',
      '左下圆角',
      '填充',
      '描边 色标 1',
      '效果 1 颜色',
      '效果 1 模糊',
    ]);
  });
});

describe('detachEdited', () => {
  const node = {
    id: '1',
    name: 'r',
    type: 'RECTANGLE',
    paddingLeft: 8,
    fills: [bound(WHITE, 'V:bg')],
    boundVariables: { paddingLeft: alias('V:pad') },
  } as FigmaNode;

  it('drops the binding of a field the user typed over', () => {
    const next = { ...node, fills: [{ ...node.fills![0], color: BLUE }] };
    const out = detachEdited(node, next);
    expect(out.fills?.[0].boundVariables).toBeUndefined();
    expect(out.fills?.[0].color).toEqual(BLUE);
    expect(out.boundVariables).toEqual(node.boundVariables);
  });

  it('removes the empty boundVariables object', () => {
    const out = detachEdited(node, { ...node, paddingLeft: 12 });
    expect(out.boundVariables).toBeUndefined();
  });

  it('leaves untouched fields alone', () => {
    const next = { ...node, name: 'renamed' };
    expect(detachEdited(node, next)).toBe(next);
  });
});

describe('in the editor', () => {
  let editor: Editor;

  function snapshot(): Snapshot {
    return {
      meta: {
        name: 'test',
        nodeId: '0:1',
        type: 'FRAME',
        width: 400,
        height: 300,
        expectedScale: 2,
        fonts: [],
        images: {},
        warnings: [],
      },
      rest: {
        document: {
          id: '0:1',
          name: 'Page',
          type: 'FRAME',
          absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
          fills: [bound(WHITE, 'V:bg')],
          children: [
            {
              id: '0:2',
              name: 'Button',
              type: 'RECTANGLE',
              absoluteBoundingBox: { x: 10, y: 10, width: 120, height: 40 },
              fills: [bound(BLUE, 'V:button')],
              boundVariables: { size: { x: alias('V:width') } },
            },
            {
              id: '0:3',
              name: 'Light',
              type: 'TEXT',
              absoluteBoundingBox: { x: 10, y: 60, width: 60, height: 20 },
              characters: 'Light',
              style: { fontFamily: 'Inter', fontSize: 14 },
              boundVariables: { characters: alias('V:label') },
            },
            {
              id: '1:1',
              name: 'Chip',
              type: 'COMPONENT',
              absoluteBoundingBox: { x: 10, y: 100, width: 100, height: 40 },
              children: [
                {
                  id: '1:2',
                  name: 'Fill',
                  type: 'RECTANGLE',
                  absoluteBoundingBox: {
                    x: 10,
                    y: 100,
                    width: 100,
                    height: 40,
                  },
                  fills: [bound(BLUE, 'V:button')],
                  opacity: 1,
                  boundVariables: {
                    opacity: alias('V:opacity'),
                    visible: alias('V:badge'),
                  },
                },
              ],
            },
            {
              id: '2:1',
              name: 'Chip',
              type: 'INSTANCE',
              componentId: '1:1',
              absoluteBoundingBox: { x: 200, y: 100, width: 100, height: 40 },
              children: [
                {
                  id: 'I2:1;1:2',
                  name: 'Fill',
                  type: 'RECTANGLE',
                  absoluteBoundingBox: {
                    x: 200,
                    y: 100,
                    width: 100,
                    height: 40,
                  },
                  fills: [bound(ORANGE, 'V:button')],
                  opacity: 1,
                  visible: false,
                  boundVariables: {
                    opacity: alias('V:opacity'),
                    visible: alias('V:badge'),
                  },
                },
              ],
            },
          ],
        },
      },
      svgs: {},
      variables: {
        ...SET,
        modes: {
          '0:1': { 'C:theme': 'light' },
          '2:1': { 'C:theme': 'dark' },
        },
      },
    };
  }

  function layer(nodeId: string): FigmaShape {
    return shapesByNodeId(editor).get(nodeId)!;
  }

  beforeEach(() => {
    const shapeUtils = [...defaultShapeUtils, ...figmaShapeUtils];
    editor = new Editor({
      store: createTLStore({ shapeUtils, bindingUtils: defaultBindingUtils }),
      shapeUtils,
      bindingUtils: defaultBindingUtils,
      tools: [],
      getContainer: () => fakeElement() as HTMLElement,
    });
    enableFigmaEditing(editor, () => ({ w: 10, h: 10 }));
    putSnapshot(editor, snapshot(), 't', '/cases/t/');
  });

  it('keeps the variables and modes from the snapshot', () => {
    expect(Object.keys(readVariableSet(editor)!.variables)).toContain('V:bg');
    expect(layer('0:1').props.node.explicitVariableModes).toEqual({
      'C:theme': 'light',
    });
  });

  it('switches a frame to another mode, and undo brings it back', () => {
    editor.markHistoryStoppingPoint('mode');
    setShapeMode(editor, layer('0:1'), 'C:theme', 'dark');
    expect(layer('0:1').props.node.fills?.[0].color).toEqual(BLACK);
    expect(layer('0:2').props.node.fills?.[0].color).toEqual(ORANGE);
    editor.undo();
    expect(layer('0:1').props.node.fills?.[0].color).toEqual(WHITE);
    expect(layer('0:2').props.node.fills?.[0].color).toEqual(BLUE);
  });

  it('updates bound layers when a value changes', () => {
    editor.markHistoryStoppingPoint('value');
    setVariableValue(editor, 'V:blue', 'p', { r: 0, g: 1, b: 0, a: 1 });
    expect(layer('0:2').props.node.fills?.[0].color).toEqual({
      r: 0,
      g: 1,
      b: 0,
      a: 1,
    });
    setVariableValue(editor, 'V:width', 's', 150);
    expect(layer('0:2').props.w).toBe(150);
    editor.undo();
    expect(layer('0:2').props.node.fills?.[0].color).toEqual(BLUE);
    expect(layer('0:2').props.w).toBe(120);
  });

  it('detaches a variable when the user edits its field', () => {
    const s = layer('0:2');
    editor.updateShape<FigmaShape>({
      id: s.id,
      type: s.type,
      props: {
        node: {
          ...s.props.node,
          fills: [{ ...s.props.node.fills![0], color: WHITE }],
        },
      },
    });
    expect(layer('0:2').props.node.fills?.[0].boundVariables).toBeUndefined();
    setShapeMode(editor, layer('0:1'), 'C:theme', 'dark');
    expect(layer('0:2').props.node.fills?.[0].color).toEqual(WHITE);
  });

  it('keeps the typed text of a layer named after its bound text', () => {
    const s = layer('0:3');
    editor.updateShape<FigmaShape>({
      id: s.id,
      type: s.type,
      props: { node: { ...s.props.node, characters: 'Hello' } },
    });
    expect(layer('0:3').props.node.characters).toBe('Hello');
    expect(layer('0:3').props.node.name).toBe('Hello');
    expect(layer('0:3').props.node.boundVariables).toBeUndefined();
    setShapeMode(editor, layer('0:1'), 'C:theme', 'dark');
    expect(layer('0:3').props.node.characters).toBe('Hello');
  });

  it('keeps a bound width when something else resizes a selected layer', () => {
    const s = layer('0:2');
    editor.select(s.id);
    editor.updateShape<FigmaShape>({
      id: s.id,
      type: s.type,
      props: { w: 300 },
    });
    expect(layer('0:2').props.node.boundVariables?.size?.x).toEqual(
      alias('V:width'),
    );
  });

  it('detaches a bound width when the user resizes the layer', () => {
    const s = layer('0:2');
    markUserResize(editor, [s.id]);
    editor.updateShape<FigmaShape>({
      id: s.id,
      type: s.type,
      props: { w: 300 },
    });
    expect(layer('0:2').props.node.boundVariables).toBeUndefined();
    setVariableValue(editor, 'V:width', 's', 150);
    expect(layer('0:2').props.w).toBe(300);
  });

  it('does not take values that come from the instance mode as overrides', () => {
    const fields = (layer('2:1').props.node.overrides ?? []).flatMap(
      (o) => o.overriddenFields,
    );
    expect(fields).not.toContain('fills');
    expect(fields).not.toContain('visible');
  });

  it('keeps a detach made on an instance when the main drops another binding', () => {
    const copy = layer('I2:1;1:2');
    editor.updateShape<FigmaShape>({
      id: copy.id,
      type: copy.type,
      props: { node: { ...copy.props.node, opacity: 0.3 } },
    });
    const main = layer('1:2');
    editor.updateShape<FigmaShape>({
      id: main.id,
      type: main.type,
      props: { node: { ...main.props.node, visible: false } },
    });
    expect(layer('1:2').props.node.boundVariables?.visible).toBeUndefined();
    expect(layer('I2:1;1:2').props.node.boundVariables).toBeUndefined();
    expect(layer('I2:1;1:2').props.node.opacity).toBe(0.3);
  });

  it('keeps following the main for the binding keys an instance left alone', () => {
    const resize = (nodeId: string, props: { w?: number; h?: number }) => {
      const s = layer(nodeId);
      markUserResize(editor, [s.id]);
      editor.updateShape<FigmaShape>({ id: s.id, type: s.type, props });
    };
    for (const id of ['1:2', 'I2:1;1:2']) {
      const s = layer(id);
      editor.updateShape<FigmaShape>({
        id: s.id,
        type: s.type,
        props: {
          node: {
            ...s.props.node,
            boundVariables: {
              ...s.props.node.boundVariables,
              size: { x: alias('V:width'), y: alias('V:width') },
            },
          },
        },
      });
    }
    resize('I2:1;1:2', { w: 90 });
    resize('1:2', { h: 70 });
    expect(layer('I2:1;1:2').props.node.boundVariables?.size).toBeUndefined();
    setVariableValue(editor, 'V:width', 's', 150);
    expect(layer('I2:1;1:2').props.w).toBe(90);
    expect(layer('I2:1;1:2').props.h).toBe(120);
  });

  it('recalculates what the main sends an instance in its own mode', () => {
    const main = layer('1:1');
    editor.markHistoryStoppingPoint('add');
    editor.createShape<FigmaShape>({
      type: 'figma-rect',
      parentId: main.id,
      x: 50,
      y: 10,
      props: {
        ...layer('1:2').props,
        w: 10,
        h: 10,
        node: {
          id: '1:9',
          name: 'Dot',
          type: 'RECTANGLE',
          absoluteBoundingBox: { x: 60, y: 110, width: 10, height: 10 },
          fills: [bound(BLUE, 'V:accent')],
        },
      },
    });
    expect(layer('I2:1;1:9').props.node.fills?.[0].color).toEqual(ORANGE);
    const s = layer('1:2');
    editor.updateShape<FigmaShape>({
      id: s.id,
      type: s.type,
      props: { node: { ...s.props.node, cornerRadius: 6 } },
    });
    expect(layer('I2:1;1:2').props.node.cornerRadius).toBe(6);
    expect(layer('I2:1;1:2').props.node.fills?.[0].color).toEqual(ORANGE);
  });
});

describe('rebuilding instances on import', () => {
  it('does not take a REST default that comes from the instance mode as an override', () => {
    const child = (id: string, extra: Partial<FigmaNode>) =>
      ({
        id,
        name: 'Badge',
        type: 'RECTANGLE',
        absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
        boundVariables: { visible: alias('V:badge') },
        ...extra,
      }) as FigmaNode;
    const main = {
      id: '1:1',
      name: 'Chip',
      type: 'COMPONENT',
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      children: [child('1:2', { visible: false })],
    } as FigmaNode;
    const instance = {
      id: '2:1',
      name: 'Chip',
      type: 'INSTANCE',
      componentId: '1:1',
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      children: [child('I2:1;1:2', {})],
    } as FigmaNode;
    const page = {
      id: '0:1',
      name: 'Page',
      type: 'FRAME',
      children: [main, instance],
    } as FigmaNode;
    const built = rebuildTree(
      page,
      indexMains({ rest: { document: page } } as Snapshot),
    );
    const fields = (built.children?.[1].overrides ?? []).flatMap(
      (o) => o.overriddenFields,
    );
    expect(fields).not.toContain('visible');
  });
});

describe('REST shapes seen in the exported cases', () => {
  const pad = alias('V:pad');
  const set = { collections: SET.collections, variables: SET.variables };

  it('writes per-side stroke bindings back to strokeWeight when all sides agree', () => {
    const node = {
      id: '1:1',
      name: 'Stroked',
      type: 'RECTANGLE',
      strokeWeight: 1,
      boundVariables: {
        individualStrokeWeights: {
          BORDER_TOP_WEIGHT: pad,
          BORDER_RIGHT_WEIGHT: pad,
          BORDER_BOTTOM_WEIGHT: pad,
          BORDER_LEFT_WEIGHT: pad,
        },
      },
    } as FigmaNode;
    expect(variableSlots(node).map((s) => s.label)).toEqual([
      '上描边粗细',
      '右描边粗细',
      '下描边粗细',
      '左描边粗细',
    ]);
    const r = applyVariables(node, set, { 'C:space': 'l' }).node;
    expect(r.strokeWeight).toBe(20);
    expect(r.individualStrokeWeights).toBeUndefined();
  });

  it('moves the whole-text binding out of the node arrays into style', () => {
    const size = alias('V:pad');
    const range = alias('V:other');
    const node = {
      id: '1:2',
      name: 'Text',
      type: 'TEXT',
      style: { fontSize: 8 },
      styleOverrideTable: {
        1: { fontSize: 30, boundVariables: { fontSize: range } },
      },
      boundVariables: { fontSize: [size, range], fills: [alias('V:bg')] },
    } as unknown as FigmaNode;
    const out = withTextBindings(node);
    expect(out.style?.boundVariables).toEqual({ fontSize: size });
    expect(out.boundVariables).toEqual({ fills: [alias('V:bg')] });
    const onlyRange = withTextBindings({
      ...node,
      boundVariables: { fontSize: [range] },
    } as unknown as FigmaNode);
    expect(onlyRange.style?.boundVariables).toBeUndefined();
    expect(onlyRange.boundVariables).toBeUndefined();
  });
});

describe('withCollectionValues', () => {
  const twoSets: FigmaVariableSet = {
    collections: {
      'C:l': {
        id: 'C:l',
        name: 'Light',
        modes: [{ modeId: 'l', name: 'L' }],
        defaultModeId: 'l',
      },
      'C:d': {
        id: 'C:d',
        name: 'Dark',
        modes: [{ modeId: 'd', name: 'D' }],
        defaultModeId: 'd',
      },
    },
    variables: {
      'V:l-accent': {
        id: 'V:l-accent',
        name: 'accent',
        variableCollectionId: 'C:l',
        resolvedType: 'COLOR',
        valuesByMode: { l: BLUE },
      },
      'V:l-button': {
        id: 'V:l-button',
        name: 'button',
        variableCollectionId: 'C:l',
        resolvedType: 'COLOR',
        valuesByMode: { l: alias('V:l-accent') },
      },
      'V:l-only': {
        id: 'V:l-only',
        name: 'only',
        variableCollectionId: 'C:l',
        resolvedType: 'FLOAT',
        valuesByMode: { l: 1 },
      },
      'V:d-accent': {
        id: 'V:d-accent',
        name: 'accent',
        variableCollectionId: 'C:d',
        resolvedType: 'COLOR',
        valuesByMode: { d: ORANGE },
      },
      'V:d-button': {
        id: 'V:d-button',
        name: 'button',
        variableCollectionId: 'C:d',
        resolvedType: 'COLOR',
        valuesByMode: { d: alias('V:d-accent') },
      },
    },
  };

  it('copies same-named values and keeps aliases inside the target collection', () => {
    const next = withCollectionValues(twoSets, 'C:l', 'C:d');
    expect(next.variables['V:l-accent'].valuesByMode).toEqual({ l: ORANGE });
    expect(next.variables['V:l-button'].valuesByMode).toEqual({
      l: alias('V:l-accent'),
    });
    expect(next.variables['V:l-only'].valuesByMode).toEqual({ l: 1 });
    expect(resolveVariable(next, 'V:l-button', {})).toEqual(ORANGE);
    expect(next.variables['V:d-accent']).toBe(twoSets.variables['V:d-accent']);
  });
});

// See apps/docs/figma-to-tldraw/tech.md §21.7.
const CASES = path.resolve(__dirname, '../../../../cases');

function loadCase(dir: string): Snapshot {
  return JSON.parse(
    readFileSync(path.join(CASES, dir, 'snapshot.json'), 'utf8'),
  ) as Snapshot;
}

/** The snapshot's nodes as the editor sees them: text bindings and modes merged in like to-shapes.ts does. */
function withModes(raw: FigmaNode, snap: Snapshot): FigmaNode {
  const v = snap.variables;
  const node = withTextBindings(raw);
  return {
    ...node,
    explicitVariableModes: v?.modes[node.id] ?? node.explicitVariableModes,
    inheritedVariableModes: v?.inherited[node.id],
  };
}

function close(a: unknown, b: unknown): boolean {
  if (typeof a === 'object' && a && typeof b === 'object' && b) {
    return Object.keys(a).every((k) =>
      close(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k] ?? (k === 'a' ? 1 : undefined),
      ),
    );
  }
  return typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) < 2e-3
    : sameValue(a, b);
}

/** Bound fields of `a`, worked out from `set`, that differ from the same layer in `b`. */
function compareTrees(
  snapA: Snapshot,
  snapB: Snapshot,
  set: FigmaVariableSet = snapA.variables!,
): { checked: number; diffs: string[] } {
  let checked = 0;
  const diffs: string[] = [];
  const walk = (a: FigmaNode, b: FigmaNode, above: FigmaNode[]) => {
    const nodeA = withModes(a, snapA);
    const chain = [...above, nodeA];
    const r = applyVariables(nodeA, set, effectiveModes(chain));
    for (const slot of variableSlots(nodeA)) {
      checked++;
      const want =
        slot.kind === 'width'
          ? b.absoluteBoundingBox?.width
          : slot.kind === 'height'
            ? b.absoluteBoundingBox?.height
            : slotValue(b, slot);
      const got =
        slot.kind === 'width'
          ? r.w
          : slot.kind === 'height'
            ? r.h
            : slotValue(r.node, slot);
      if (!close(got, want)) {
        diffs.push(
          `${a.name}（${a.id}）${slot.label}：算出 ${JSON.stringify(got)}，Figma ${JSON.stringify(want)}`,
        );
      }
    }
    (a.children ?? []).forEach((child, i) => {
      const other = b.children?.[i];
      if (other) {
        walk(child, other, chain);
      }
    });
  };
  walk(snapA.rest.document, snapB.rest.document, []);
  for (const id of Object.keys(snapA.mains ?? {})) {
    const other = snapB.mains?.[id];
    if (other) {
      walk(snapA.mains![id], other, []);
    }
  }
  return { checked, diffs };
}

// [from, compare with, collection whose values change, collection the values come from]
const SWAPS: [string, string, string, string][] = [
  [
    'variables/theme-light',
    'variables/theme-dark',
    'FT Theme',
    'FT Theme Dark',
  ],
  [
    'variables/theme-dark',
    'variables/theme-light',
    'FT Theme Dark',
    'FT Theme',
  ],
  [
    'variables/spacing-compact',
    'variables/spacing-comfortable',
    'FT Spacing',
    'FT Spacing Comfortable',
  ],
  [
    'variables/spacing-comfortable',
    'variables/spacing-compact',
    'FT Spacing Comfortable',
    'FT Spacing',
  ],
];

describe.skipIf(
  !existsSync(path.join(CASES, 'variables/theme-light/snapshot.json')),
)('Figma variable cases', () => {
  for (const [from, to, targetName, sourceName] of SWAPS) {
    it(`${from} with ${targetName} taking ${sourceName}'s values matches ${to}`, () => {
      const a = loadCase(from);
      const set = a.variables!;
      const byName = (name: string) =>
        Object.values(set.collections).find((c) => c.name === name)!;
      const { checked, diffs } = compareTrees(
        a,
        loadCase(to),
        withCollectionValues(set, byName(targetName).id, byName(sourceName).id),
      );
      expect(diffs).toEqual([]);
      expect(checked).toBeGreaterThan(5);
    });
  }

  const index = existsSync(path.join(CASES, 'index.json'))
    ? (JSON.parse(readFileSync(path.join(CASES, 'index.json'), 'utf8')) as {
        cases: { dir: string }[];
      })
    : { cases: [] };
  for (const { dir } of index.cases.filter((c) =>
    c.dir.startsWith('variables/'),
  )) {
    it(`${dir} already holds its variables' values`, () => {
      const snap = loadCase(dir);
      const { checked, diffs } = compareTrees(snap, snap);
      expect(diffs).toEqual([]);
      expect(checked).toBeGreaterThan(0);
    });
  }
});
