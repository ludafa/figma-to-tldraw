import type { FigmaShape } from '../shape-types';
import { FigmaShapeContainer, FigmaShapeUtil } from './base';
import { BackdropBlur, BoxContent } from './box';

export class FigmaRectShapeUtil extends FigmaShapeUtil<'figma-rect'> {
  static override type = 'figma-rect' as const;

  component(shape: FigmaShape<'figma-rect'>) {
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
