import { describe, expect, it } from 'vitest';

import type { Editor } from '../../engine';
import { newNode } from './create';

function editorWith(names: string[]): Editor {
  const shapes = names.map((name) => ({
    type: 'figma-rect',
    props: { node: { id: name, name, type: 'RECTANGLE' } },
  }));
  return { getCurrentPageShapes: () => shapes } as unknown as Editor;
}

describe('newNode', () => {
  it('numbers new layers after the highest existing number', () => {
    const editor = editorWith([
      'Rectangle',
      'Rectangle 3',
      'Frame 1',
      'Rectangle 2b',
    ]);
    expect(newNode(editor, 'RECTANGLE', 'a').name).toBe('Rectangle 4');
    expect(newNode(editor, 'FRAME', 'b').name).toBe('Frame 2');
    expect(newNode(editor, 'ELLIPSE', 'c').name).toBe('Ellipse 1');
  });

  it('uses Figma defaults: gray shapes, white clipping frames', () => {
    const editor = editorWith([]);
    const rect = newNode(editor, 'RECTANGLE', 'a');
    expect(rect.fills?.[0]).toMatchObject({
      type: 'SOLID',
      color: { r: 0xd9 / 255, g: 0xd9 / 255, b: 0xd9 / 255, a: 1 },
    });
    expect(rect.layoutSizingHorizontal).toBe('FIXED');
    const frame = newNode(editor, 'FRAME', 'b');
    expect(frame.clipsContent).toBe(true);
    expect(frame.fills?.[0]).toMatchObject({ color: { r: 1, g: 1, b: 1 } });
  });

  it('makes empty auto-width Inter 12 text that names itself after its content', () => {
    const text = newNode(editorWith([]), 'TEXT', 'a');
    expect(text).toMatchObject({
      name: '',
      autoRename: true,
      characters: '',
      layoutSizingHorizontal: 'HUG',
      layoutSizingVertical: 'HUG',
    });
    expect(text.style).toMatchObject({
      fontFamily: 'Inter',
      fontSize: 12,
      textAutoResize: 'WIDTH_AND_HEIGHT',
      lineHeightUnit: 'INTRINSIC_%',
    });
    expect(text.style?.lineHeightPx).toBeCloseTo(12 * 1.2102);
    expect(text.fills?.[0]).toMatchObject({ color: { r: 0, g: 0, b: 0 } });
  });
});
