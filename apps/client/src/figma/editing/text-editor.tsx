import { type CSSProperties, useCallback, useState } from 'react';

import { RichTextArea, type TLRichText, useEditor } from '../../engine';
import { fontFamilyCss, fontStyleCss, fontVariationCss } from '../fonts';
import { rgba } from '../geometry';
import type { FigmaShape } from '../shape-types';
import { visiblePaints } from '../skia/paints';
import { resolvedLineHeight } from '../skia/text';
import type { FigmaNode, FigmaTypeStyle } from '../types';
import { figmaTextOptions, fromRichText, toRichText } from './rich-text';

// See apps/docs/skia-engine/tech.md §6.7.

const TEXT_TRANSFORM: Partial<
  Record<
    NonNullable<FigmaTypeStyle['textCase']>,
    CSSProperties['textTransform']
  >
> = {
  UPPER: 'uppercase',
  LOWER: 'lowercase',
  TITLE: 'capitalize',
};

const UNITLESS = new Set(['fontWeight', 'lineHeight', 'opacity', 'zIndex']);

function cssText(css: CSSProperties): string {
  return Object.entries(css)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => {
      const prop = k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      return `${prop}:${typeof v === 'number' && !UNITLESS.has(k) ? `${v}px` : v}`;
    })
    .join(';');
}

/** The color typed text shows in: the solid fill, or a gradient's first stop. */
function editingColor(style: FigmaTypeStyle, node: FigmaNode): string {
  const fills = visiblePaints(style.fills ?? node.fills);
  const solid = fills.find((p) => p.type === 'SOLID');
  if (solid?.color) {
    return rgba(solid.color, solid.opacity ?? 1);
  }
  const stop = fills.find((p) => p.gradientStops?.length)?.gradientStops?.[0];
  return stop ? rgba(stop.color) : '#000';
}

function runCss(style: FigmaTypeStyle, node: FigmaNode): CSSProperties {
  return {
    fontFamily: fontFamilyCss(style),
    fontVariationSettings: fontVariationCss(style),
    fontWeight: style.fontWeight,
    fontStyle: fontStyleCss(style),
    fontSize: style.fontSize,
    color: editingColor(style, node),
    letterSpacing: style.letterSpacing ? `${style.letterSpacing}px` : undefined,
    textTransform: style.textCase ? TEXT_TRANSFORM[style.textCase] : undefined,
    fontVariant: style.textCase === 'SMALL_CAPS' ? 'small-caps' : undefined,
    textDecorationLine:
      style.textDecoration === 'UNDERLINE'
        ? 'underline'
        : style.textDecoration === 'STRIKETHROUGH'
          ? 'line-through'
          : undefined,
  };
}

function overrideCss(node: FigmaNode, key: number): string {
  const base = node.style ?? {};
  const override = node.styleOverrideTable?.[String(key)];
  return cssText({
    ...runCss({ ...base, ...override }, node),
    lineHeight: `${resolvedLineHeight(base, override)}px`,
  });
}

/** The DOM editor laid over a text layer while it is being edited. */
export function FigmaTextEditor({ shape }: { shape: FigmaShape }) {
  const editor = useEditor();
  const { w, h, node } = shape.props;
  const [richText] = useState(() =>
    toRichText(node, (k) => overrideCss(node, k)),
  );
  const style = node.style ?? {};
  const auto = style.textAutoResize ?? 'NONE';
  const handleChange = useCallback(
    (doc: TLRichText) => {
      const current = editor.getShape<FigmaShape>(shape.id);
      if (!current || editor.getEditingShapeId() !== shape.id) {
        return;
      }
      editor.updateShape<FigmaShape>({
        id: shape.id,
        type: shape.type,
        props: { node: fromRichText(doc, current.props.node) },
      });
    },
    [editor, shape.id, shape.type],
  );
  const handleDone = useCallback(() => {
    if (editor.getEditingShapeId() === shape.id) {
      editor.complete();
    }
  }, [editor, shape.id]);

  const justify =
    style.textAlignVertical === 'CENTER'
      ? 'center'
      : style.textAlignVertical === 'BOTTOM'
        ? 'flex-end'
        : 'flex-start';
  return (
    <div
      className="figma-text-editing"
      style={{
        ['--figma-paragraph-spacing' as string]: `${style.paragraphSpacing ?? 0}px`,
        position: 'absolute',
        left: 0,
        top: 0,
        width: auto === 'WIDTH_AND_HEIGHT' ? 'max-content' : w,
        minWidth: w,
        height: h,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: justify,
      }}
    >
      <RichTextArea
        richText={richText}
        extensions={figmaTextOptions.tipTapConfig.extensions}
        selectAll
        onChange={handleChange}
        onDone={handleDone}
        style={{
          ...runCss(style, node),
          lineHeight: `${resolvedLineHeight(style)}px`,
          textAlign:
            style.textAlignHorizontal === 'JUSTIFIED'
              ? 'justify'
              : ((style.textAlignHorizontal?.toLowerCase() ??
                  'left') as CSSProperties['textAlign']),
          whiteSpace: auto === 'WIDTH_AND_HEIGHT' ? 'pre' : 'pre-wrap',
          overflowWrap: 'break-word',
          outline: 'none',
        }}
      />
    </div>
  );
}
