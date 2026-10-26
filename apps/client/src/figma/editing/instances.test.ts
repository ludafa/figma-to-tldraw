import {
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  Editor,
} from 'tldraw';
import { beforeEach, describe, expect, it } from 'vitest';

import { COMPONENTS_PAGE, putSnapshot } from '../editor';
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
  swapMain,
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
    rect('1:2', 'Bg', box(0, 0, 100, 40), {
      rectangleCornerRadii: [1, 2, 3, 4],
    }),
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
    rect('I2:1;1:2', 'Bg', box(200, 0, 100, 40), {
      rectangleCornerRadii: [1, 2, 3, 4],
    }),
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
      fills: RED,
      absoluteBoundingBox: box(0, 100, 40, 20),
      children: [rect('3:2', 'Fill', box(0, 100, 40, 20))],
    },
    {
      id: '3:3',
      name: 'Size=L',
      type: 'COMPONENT',
      fills: BLUE,
      absoluteBoundingBox: box(100, 100, 80, 40),
      children: [
        rect('3:4', 'Fill', box(100, 100, 80, 40)),
        rect('3:5', 'Badge', box(160, 100), {
          constraints: { horizontal: 'RIGHT', vertical: 'TOP' },
        }),
      ],
    },
  ],
};

const chip: FigmaNode = {
  id: '4:1',
  name: 'Chip',
  type: 'INSTANCE',
  componentId: '3:1',
  fills: RED,
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

const icon: FigmaNode = {
  id: '6:1',
  name: 'Icon',
  type: 'COMPONENT',
  absoluteBoundingBox: box(0, 300, 10, 10),
  children: [rect('6:2', 'Glyph', box(0, 300))],
};

const star: FigmaNode = {
  id: '9:1',
  name: 'Star',
  type: 'COMPONENT',
  absoluteBoundingBox: box(20, 300, 10, 10),
  children: [rect('9:2', 'Glyph', box(20, 300))],
};

const button: FigmaNode = {
  id: '7:1',
  name: 'Button',
  type: 'COMPONENT',
  absoluteBoundingBox: box(40, 300, 50, 20),
  children: [
    {
      id: '7:2',
      name: 'Icon',
      type: 'INSTANCE',
      componentId: '6:1',
      absoluteBoundingBox: box(40, 300, 10, 10),
      overrides: [{ id: 'I7:2;6:2', overriddenFields: ['fills'] }],
      children: [rect('I7:2;6:2', 'Glyph', box(40, 300), { fills: GREEN })],
    },
  ],
};

const buttonInstance: FigmaNode = {
  id: '8:1',
  name: 'Button',
  type: 'INSTANCE',
  componentId: '7:1',
  absoluteBoundingBox: box(100, 300, 50, 20),
  children: [
    {
      id: 'I8:1;7:2',
      name: 'Icon',
      type: 'INSTANCE',
      componentId: '6:1',
      absoluteBoundingBox: box(100, 300, 10, 10),
      children: [
        rect('I8:1;7:2;6:2', 'Glyph', box(100, 300), { fills: GREEN }),
      ],
    },
  ],
};

const row: FigmaNode = {
  id: '30:1',
  name: 'Row',
  type: 'COMPONENT',
  absoluteBoundingBox: box(0, 400, 100, 40),
  children: [
    {
      ...cardInstance,
      id: '30:2',
      absoluteBoundingBox: box(0, 400, 100, 40),
      children: [
        rect('I30:2;1:2', 'Bg', box(0, 400, 100, 40), {
          rectangleCornerRadii: [1, 2, 3, 4],
        }),
        rect('I30:2;1:3', 'Dot', box(10, 410), {
          fills: BLUE,
          componentPropertyReferences: { visible: DOT },
        }),
      ],
    },
  ],
};

const rowInstance: FigmaNode = {
  id: '31:1',
  name: 'Row',
  type: 'INSTANCE',
  componentId: '30:1',
  absoluteBoundingBox: box(200, 400, 100, 40),
  children: [
    {
      ...cardInstance,
      id: 'I31:1;30:2',
      absoluteBoundingBox: box(200, 400, 100, 40),
      children: [
        rect('I31:1;30:2;1:2', 'Bg', box(200, 400, 100, 40), {
          rectangleCornerRadii: [1, 2, 3, 4],
        }),
        rect('I31:1;30:2;1:3', 'Dot', box(210, 410), {
          fills: BLUE,
          componentPropertyReferences: { visible: DOT },
        }),
      ],
    },
  ],
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
        children: [
          card,
          cardInstance,
          sizes,
          chip,
          plain,
          icon,
          star,
          button,
          buttonInstance,
          row,
          rowInstance,
        ],
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

  it('remove fields the main drops', () => {
    const s = layer('1:2');
    const { rectangleCornerRadii: _radii, ...node } = s.props.node;
    editor.updateShape<FigmaShape>({
      id: s.id,
      type: s.type,
      props: { node: { ...node, cornerRadius: 5 } },
    });
    expect(layer('I2:1;1:2').props.node).toMatchObject({ cornerRadius: 5 });
    expect(layer('I2:1;1:2').props.node.rectangleCornerRadii).toBeUndefined();
  });

  it('reach nested instances through the main around them', () => {
    edit('6:2', { fills: BLUE });
    expect(layer('I7:2;6:2').props.node.fills).toEqual(GREEN);
    expect(layer('I8:1;7:2;6:2').props.node.fills).toEqual(GREEN);
    edit('I7:2;6:2', { fills: RED });
    expect(layer('I8:1;7:2;6:2').props.node.fills).toEqual(RED);
  });

  it('swap nested instances in the instances too', () => {
    editor.run(() =>
      swapMain(editor, layer('7:2'), layer('9:1'), figmaComponentHooks(editor)),
    );
    expect(layer('I8:1;7:2').props.node.componentId).toBe('9:1');
    expect(childIds('I8:1;7:2')).toEqual(['I8:1;7:2;9:2']);
  });

  it('leave nested instances an instance-swap property picks', () => {
    edit('7:2', { componentPropertyReferences: { mainComponent: 'Icon#0:1' } });
    editor.run(() =>
      swapMain(editor, layer('7:2'), layer('9:1'), figmaComponentHooks(editor)),
    );
    expect(layer('I8:1;7:2').props.node.componentId).toBe('6:1');
  });

  it('turn nested copies into frames when the main detaches its instance', () => {
    detachInstance(editor, layer('7:2'));
    const copy = layer('I8:1;7:2').props.node;
    expect(copy.type).toBe('FRAME');
    expect(copy.componentId).toBeUndefined();
  });

  it('apply nested property changes to the copies', () => {
    setProperty(editor, layer('30:2'), DOT, false, figmaComponentHooks(editor));
    expect(
      layer('I31:1;30:2').props.node.componentProperties?.[DOT].value,
    ).toBe(false);
    expect(layer('I31:1;30:2;1:3').props.node.visible).toBe(false);
  });

  it('keep the copies when a nested instance in the main is reset', () => {
    editor.run(() =>
      resetInstance(editor, layer('7:2'), figmaComponentHooks(editor)),
    );
    expect(childIds('I8:1;7:2')).toEqual(['I8:1;7:2;6:2']);
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
    expect(node.props.node.fills).toEqual(BLUE);
  });

  it('switch variants keeping overrides', () => {
    edit('I4:1;3:2', { fills: GREEN });
    edit('4:1', { opacity: 0.5 });
    setProperty(editor, layer('4:1'), 'Size', 'L', figmaComponentHooks(editor));
    expect(layer('I4:1;3:4').props.node.fills).toEqual(GREEN);
    expect(layer('4:1').props.node.opacity).toBe(0.5);
    expect(layer('4:1').props.node.overrides).toEqual([
      { id: '4:1', overriddenFields: ['opacity'] },
      { id: 'I4:1;3:4', overriddenFields: ['fills', 'styles'] },
    ]);
  });

  it('switch variants by constraints when the instance was stretched', () => {
    const s = layer('4:1');
    editor.updateShape<FigmaShape>({
      id: s.id,
      type: s.type,
      props: { w: 60 },
    });
    setProperty(editor, layer('4:1'), 'Size', 'L', figmaComponentHooks(editor));
    expect(layer('4:1').props.w).toBe(60);
    expect(layer('I4:1;3:5').x).toBe(40);
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

  it('detach hands nested overrides to the nested instance', () => {
    edit('I8:1;7:2;6:2', { fills: BLUE });
    detachInstance(editor, layer('8:1'));
    expect(layer('I8:1;7:2').props.node.overrides).toEqual([
      { id: 'I8:1;7:2;6:2', overriddenFields: ['fills'] },
    ]);
    edit('6:2', { fills: RED });
    expect(layer('I8:1;7:2;6:2').props.node.fills).toEqual(BLUE);
  });

  it('reset of a nested instance shows it again', () => {
    edit('I8:1;7:2', { visible: false });
    expect(layer('8:1').props.node.overrides).toEqual([
      { id: 'I8:1;7:2', overriddenFields: ['visible'] },
    ]);
    resetInstance(editor, layer('I8:1;7:2'), figmaComponentHooks(editor));
    expect(layer('8:1').props.node.overrides).toEqual([]);
    expect(layer('I8:1;7:2').props.node.visible).not.toBe(false);
  });

  it('detach keeps what the main overrides on nested instances', () => {
    createInstance(editor, layer('7:1'));
    const id = (editor.getSelectedShapes()[0] as FigmaShape).props.node.id;
    detachInstance(editor, layer(id));
    edit('6:2', { fills: BLUE });
    expect(layer(`I${id};7:2;6:2`).props.node.fills).toEqual(GREEN);
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

describe('components page', () => {
  function withMains(): Snapshot {
    const s = snapshot();
    return {
      ...s,
      mains: {
        '10:0': {
          id: '10:0',
          name: 'Big set',
          type: 'COMPONENT_SET',
          partial: true,
          variantCount: 80,
          children: [
            {
              id: '10:1',
              name: 'V=1',
              type: 'COMPONENT',
              absoluteBoundingBox: box(500, 0, 10, 10),
              children: [rect('10:2', 'Fill', box(500, 0))],
            },
            {
              id: '10:3',
              name: 'V=2',
              type: 'COMPONENT',
              absoluteBoundingBox: box(520, 0, 10, 10),
              children: [rect('10:4', 'Fill', box(520, 0))],
            },
          ],
        },
        '11:1': {
          id: '11:1',
          name: 'Other',
          type: 'COMPONENT',
          absoluteBoundingBox: box(600, 0, 10, 10),
          children: [rect('11:2', 'Fill', box(600, 0))],
        },
      },
    };
  }

  it('lays out partial component sets', () => {
    putSnapshot(editor, withMains(), 'm', '/cases/m/', { mains: true });
    const set = shapesByNodeId(editor).get('10:0')!;
    expect(set.parentId).toBe(COMPONENTS_PAGE);
    expect([set.props.w, set.props.h]).toEqual([30, 10]);
    const indices = editor
      .getSortedChildIdsForParent(COMPONENTS_PAGE)
      .map((id) => editor.getShape(id)!.index);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it('starts empty on the next import', () => {
    putSnapshot(editor, withMains(), 'm', '/cases/m/', { mains: true });
    putSnapshot(editor, withMains(), 'n', '/cases/n/', { mains: true });
    const stale = editor.store.query
      .records('shape')
      .get()
      .filter((s) => s.id.startsWith('shape:figma:m:'));
    expect(stale).toEqual([]);
  });
});
