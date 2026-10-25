import {
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  Editor,
} from 'tldraw';
import { beforeEach, describe, expect, it } from 'vitest';

import { putSnapshot } from '../editor';
import type { FigmaShape } from '../shape-types';
import { figmaShapeUtils } from '../shapes';
import type { FigmaNode, FigmaPaint, Snapshot } from '../types';
import { enableFigmaEditing, figmaComponentHooks } from './engine';
import {
  createComponents,
  createInstance,
  detachInstance,
  resetInstance,
  setProperty,
  shapesByNodeId,
} from './instances';

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

function box(x: number, y: number, width = 10, height = 10) {
  return { x, y, width, height };
}

function solid(r: number, g: number, b: number): FigmaPaint[] {
  return [{ type: 'SOLID', color: { r, g, b, a: 1 } }];
}

const RED = solid(1, 0, 0);
const BLUE = solid(0, 0, 1);
const GREEN = solid(0, 1, 0);

function rect(
  id: string,
  name: string,
  at: ReturnType<typeof box>,
  extra = {},
) {
  return {
    id,
    name,
    type: 'RECTANGLE',
    fills: RED,
    absoluteBoundingBox: at,
    ...extra,
  } as FigmaNode;
}

const DOT = 'Dot#1:0';

const card: FigmaNode = {
  id: '1:1',
  name: 'Card',
  type: 'COMPONENT',
  absoluteBoundingBox: box(0, 0, 100, 40),
  componentPropertyDefinitions: {
    [DOT]: { type: 'BOOLEAN', defaultValue: true },
  },
  children: [
    rect('1:2', 'Bg', box(0, 0, 100, 40)),
    rect('1:3', 'Dot', box(10, 10), {
      fills: BLUE,
      componentPropertyReferences: { visible: DOT },
    }),
  ],
};

const cardInstance: FigmaNode = {
  id: '2:1',
  name: 'Card',
  type: 'INSTANCE',
  componentId: '1:1',
  componentProperties: { [DOT]: { type: 'BOOLEAN', value: true } },
  absoluteBoundingBox: box(200, 0, 100, 40),
  children: [
    rect('I2:1;1:2', 'Bg', box(200, 0, 100, 40)),
    rect('I2:1;1:3', 'Dot', box(210, 10), {
      fills: BLUE,
      componentPropertyReferences: { visible: DOT },
    }),
  ],
};

const sizes: FigmaNode = {
  id: '3:0',
  name: 'Chip',
  type: 'COMPONENT_SET',
  absoluteBoundingBox: box(0, 100, 200, 40),
  componentPropertyDefinitions: {
    Size: { type: 'VARIANT', defaultValue: 'S', variantOptions: ['S', 'L'] },
  },
  children: [
    {
      id: '3:1',
      name: 'Size=S',
      type: 'COMPONENT',
      absoluteBoundingBox: box(0, 100, 40, 20),
      children: [rect('3:2', 'Fill', box(0, 100, 40, 20))],
    },
    {
      id: '3:3',
      name: 'Size=L',
      type: 'COMPONENT',
      absoluteBoundingBox: box(100, 100, 80, 40),
      children: [
        rect('3:4', 'Fill', box(100, 100, 80, 40)),
        rect('3:5', 'Badge', box(160, 100)),
      ],
    },
  ],
};

const chip: FigmaNode = {
  id: '4:1',
  name: 'Chip',
  type: 'INSTANCE',
  componentId: '3:1',
  componentProperties: { Size: { type: 'VARIANT', value: 'S' } },
  absoluteBoundingBox: box(200, 100, 40, 20),
  children: [rect('I4:1;3:2', 'Fill', box(200, 100, 40, 20))],
};

const plain: FigmaNode = {
  id: '5:1',
  name: 'Plain',
  type: 'FRAME',
  absoluteBoundingBox: box(0, 200, 50, 50),
  children: [rect('5:2', 'Inner', box(0, 200, 20, 20))],
};

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
        absoluteBoundingBox: box(0, 0, 400, 300),
        children: [card, cardInstance, sizes, chip, plain],
      },
    },
    svgs: {},
  };
}

let editor: Editor;

function layer(nodeId: string): FigmaShape {
  const shape = shapesByNodeId(editor).get(nodeId);
  if (!shape) {
    throw new Error(`no layer ${nodeId}`);
  }
  return shape;
}

function edit(nodeId: string, node: Partial<FigmaNode>) {
  const s = layer(nodeId);
  editor.markHistoryStoppingPoint('edit');
  editor.updateShape<FigmaShape>({
    id: s.id,
    type: s.type,
    props: { node: { ...s.props.node, ...node } },
  });
}

function childIds(nodeId: string): string[] {
  const s = layer(nodeId);
  return [...editor.getShapeAndDescendantIds([s.id])]
    .filter((id) => id !== s.id)
    .map((id) => editor.getShape<FigmaShape>(id)!.props.node.id);
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

describe('main edits', () => {
  it('reach the copies in instances', () => {
    edit('1:2', { fills: GREEN });
    expect(layer('I2:1;1:2').props.node.fills).toEqual(GREEN);
  });

  it('skip fields the instance overrides', () => {
    edit('I2:1;1:3', { fills: RED });
    expect(layer('2:1').props.node.overrides).toEqual([
      { id: 'I2:1;1:3', overriddenFields: ['fills'] },
    ]);
    edit('1:3', { fills: GREEN });
    expect(layer('I2:1;1:3').props.node.fills).toEqual(RED);
  });

  it('come back out on undo', () => {
    edit('1:2', { fills: GREEN });
    editor.undo();
    expect(layer('1:2').props.node.fills).toEqual(RED);
    expect(layer('I2:1;1:2').props.node.fills).toEqual(RED);
  });

  it('add new layers to the instances', () => {
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
        node: rect('1:9', 'New', box(50, 10)),
      },
    });
    expect(childIds('2:1')).toContain('I2:1;1:9');
  });
});

describe('editing an instance', () => {
  it('hides a deleted layer instead of removing it', () => {
    editor.deleteShapes([layer('I2:1;1:3').id]);
    expect(layer('I2:1;1:3').props.node.visible).toBe(false);
    expect(layer('2:1').props.node.overrides).toEqual([
      { id: 'I2:1;1:3', overriddenFields: ['visible'] },
    ]);
  });

  it('gives a duplicate its own ids that still follow the main', () => {
    editor.duplicateShapes([layer('2:1').id]);
    const dup = editor.getSelectedShapes()[0] as FigmaShape;
    const id = dup.props.node.id;
    expect(id).not.toBe('2:1');
    expect(childIds(id)).toEqual([`I${id};1:2`, `I${id};1:3`]);
    edit('1:2', { fills: GREEN });
    expect(layer(`I${id};1:2`).props.node.fills).toEqual(GREEN);
  });

  it('turns a pasted main into an instance of it', () => {
    const content = editor.getContentFromCurrentPage([layer('1:1').id])!;
    editor.putContentOntoCurrentPage(content, { select: true });
    const pasted = editor.getSelectedShapes()[0] as FigmaShape;
    const id = pasted.props.node.id;
    expect(pasted.props.node).toMatchObject({
      type: 'INSTANCE',
      componentId: '1:1',
    });
    expect(childIds(id)).toEqual([`I${id};1:2`, `I${id};1:3`]);
  });
});

describe('component properties', () => {
  it('switch variants by rebuilding from the other main', () => {
    setProperty(editor, layer('4:1'), 'Size', 'L', figmaComponentHooks(editor));
    const node = layer('4:1');
    expect(node.props.node.componentId).toBe('3:3');
    expect(node.props.node.componentProperties?.Size.value).toBe('L');
    expect(childIds('4:1')).toEqual(['I4:1;3:4', 'I4:1;3:5']);
    expect([node.props.w, node.props.h]).toEqual([80, 40]);
  });

  it('show and hide layers with a boolean', () => {
    setProperty(editor, layer('2:1'), DOT, false, figmaComponentHooks(editor));
    expect(layer('I2:1;1:3').props.node.visible).toBe(false);
    expect(layer('2:1').props.node.overrides).toEqual([]);
  });
});

describe('instance actions', () => {
  it('reset drops overrides', () => {
    edit('I2:1;1:2', { fills: BLUE });
    resetInstance(editor, layer('2:1'), figmaComponentHooks(editor));
    expect(layer('2:1').props.node.overrides).toEqual([]);
    expect(layer('I2:1;1:2').props.node.fills).toEqual(RED);
  });

  it('detach turns the instance into a frame', () => {
    detachInstance(editor, layer('2:1'));
    expect(layer('2:1').props.node.type).toBe('FRAME');
    expect(layer('2:1').props.node.componentId).toBeUndefined();
    edit('1:2', { fills: GREEN });
    expect(layer('I2:1;1:2').props.node.fills).toEqual(RED);
  });

  it('a new component gets instances that follow it', () => {
    createComponents(editor, [layer('5:1')]);
    expect(layer('5:1').props.node.type).toBe('COMPONENT');
    createInstance(editor, layer('5:1'));
    const inst = editor.getSelectedShapes()[0] as FigmaShape;
    const id = inst.props.node.id;
    expect(childIds(id)).toEqual([`I${id};5:2`]);
    edit('5:2', { fills: GREEN });
    expect(layer(`I${id};5:2`).props.node.fills).toEqual(GREEN);
  });
});
