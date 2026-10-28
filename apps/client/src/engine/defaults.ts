import { ArrowShapeTool, ArrowShapeUtil } from './shapes/arrow';
import { DrawShapeTool, DrawShapeUtil } from './shapes/draw';
import { HandTool } from './tools/hand';
import { SelectTool } from './tools/select';

// See apps/docs/skia-engine/tech.md §6.8.

export const defaultShapeUtils = [DrawShapeUtil, ArrowShapeUtil] as const;
export const defaultShapeTools = [DrawShapeTool, ArrowShapeTool] as const;
export const defaultTools = [SelectTool, HandTool] as const;
export const defaultBindingUtils = [] as const;
