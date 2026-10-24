import type { FigmaShape } from '../shape-types';
import { FigmaShapeContainer, FigmaShapeUtil } from './base';
import { BackdropBlur, BoxContent } from './box';

export class FigmaFrameShapeUtil extends FigmaShapeUtil<'figma-frame'> {
  static override type = 'figma-frame' as const;

  component(shape: FigmaShape<'figma-frame'>) {
    return (
      <FigmaShapeContainer
        shape={shape}
        backdrop={(clipPath) => (
          <BackdropBlur shape={shape} clipPath={clipPath} />
        )}
      >
        <BoxContent shape={shape} />
      </FigmaShapeContainer>
    );
  }
}
