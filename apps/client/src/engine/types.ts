import type { IndexKey } from './indices';

// See apps/docs/skia-engine/tech.md §3.1.

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type TLShapeId = string & { __brand: 'shapeId' };
export type TLPageId = string & { __brand: 'pageId' };
export type TLParentId = TLShapeId | TLPageId;
export type TLRecordId = TLShapeId | TLPageId;

export interface TLBaseShape<Type extends string, Props extends object> {
  readonly id: TLShapeId;
  readonly typeName: 'shape';
  type: Type;
  x: number;
  y: number;
  rotation: number;
  index: IndexKey;
  parentId: TLParentId;
  isLocked: boolean;
  opacity: number;
  props: Props;
  meta: JsonObject;
}

export type TLUnknownShape = TLBaseShape<string, object>;
// oxlint-disable-next-line typescript/no-explicit-any -- tldraw's TLShape is open over props.
export type TLShape = TLBaseShape<string, any>;

export interface TLPage {
  readonly id: TLPageId;
  readonly typeName: 'page';
  name: string;
  index: IndexKey;
  meta: JsonObject;
}

// See apps/docs/figma-to-tldraw/tech.md §21.3.
export interface TLDocument {
  readonly id: typeof TLDOCUMENT_ID;
  readonly typeName: 'document';
  gridSize: number;
  name: string;
  meta: JsonObject;
}

export const TLDOCUMENT_ID = 'document:document';

export type TLRecord = TLShape | TLPage | TLDocument;

export type TLShapePartial<T extends TLShape = TLShape> = T extends T
  ? {
      id: TLShapeId;
      type: T['type'];
      props?: Partial<T['props']>;
      meta?: Partial<T['meta']>;
    } & Partial<Omit<T, 'type' | 'id' | 'props' | 'meta'>>
  : never;

export interface TLCamera {
  x: number;
  y: number;
  z: number;
}

export function isShapeId(id: unknown): id is TLShapeId {
  return typeof id === 'string' && id.startsWith('shape:');
}

export function isPageId(id: unknown): id is TLPageId {
  return typeof id === 'string' && id.startsWith('page:');
}

let idCounter = 0;

function uniqueId(): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${idCounter.toString(36)}`;
}

export function createShapeId(id?: string): TLShapeId {
  return `shape:${id ?? uniqueId()}` as TLShapeId;
}

export function createPageId(id?: string): TLPageId {
  return `page:${id ?? uniqueId()}` as TLPageId;
}

export const PageRecordType = {
  createId: createPageId,
  create(page: Partial<TLPage> & { name: string; index: IndexKey }): TLPage {
    return {
      id: page.id ?? createPageId(),
      typeName: 'page',
      name: page.name,
      index: page.index,
      meta: page.meta ?? {},
    };
  },
};
