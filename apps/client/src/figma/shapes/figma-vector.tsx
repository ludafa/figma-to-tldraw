import type { FigmaShape } from '../shape-types';
import { FigmaShapeContainer, FigmaShapeUtil } from './base';

// See apps/docs/figma-to-tldraw/tech.md §13.1.
function stretchable(svg: string): string {
  return /<svg[^>]*preserveAspectRatio/.test(svg)
    ? svg
    : svg.replace('<svg', '<svg preserveAspectRatio="none"');
}

export class FigmaVectorShapeUtil extends FigmaShapeUtil<'figma-vector'> {
  static override type = 'figma-vector' as const;

  component(shape: FigmaShape<'figma-vector'>) {
    const { w, h, svg, node } = shape.props;
    return (
      <FigmaShapeContainer shape={shape}>
        {!node.isMask && (
          <div
            className="figma-vector"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: w,
              height: h,
            }}
            dangerouslySetInnerHTML={{ __html: stretchable(svg) }}
          />
        )}
      </FigmaShapeContainer>
    );
  }
}
