import type { Editor } from './editor';

// See apps/docs/skia-engine/tech.md §3.

/** Migration sequences of tldraw 3.15.6's own records, so its apps can open our files. */
const TLDRAW_SEQUENCES: Record<string, number> = {
  'com.tldraw.store': 4,
  'com.tldraw.asset': 1,
  'com.tldraw.camera': 1,
  'com.tldraw.document': 2,
  'com.tldraw.instance': 25,
  'com.tldraw.instance_page_state': 5,
  'com.tldraw.page': 1,
  'com.tldraw.instance_presence': 6,
  'com.tldraw.pointer': 1,
  'com.tldraw.shape': 4,
  'com.tldraw.asset.bookmark': 2,
  'com.tldraw.asset.image': 5,
  'com.tldraw.asset.video': 5,
  'com.tldraw.shape.arrow': 6,
  'com.tldraw.shape.bookmark': 2,
  'com.tldraw.shape.draw': 2,
  'com.tldraw.shape.embed': 4,
  'com.tldraw.shape.frame': 1,
  'com.tldraw.shape.geo': 10,
  'com.tldraw.shape.group': 0,
  'com.tldraw.shape.highlight': 1,
  'com.tldraw.shape.image': 5,
  'com.tldraw.shape.line': 5,
  'com.tldraw.shape.note': 9,
  'com.tldraw.shape.text': 3,
  'com.tldraw.shape.video': 4,
  'com.tldraw.binding.arrow': 1,
};

/** The document as a `.tldr` file (tldraw's file format version 1). */
export async function serializeTldrawJson(editor: Editor): Promise<string> {
  const sequences = { ...TLDRAW_SEQUENCES };
  const records: unknown[] = [];
  for (const record of editor.store.allRecords()) {
    if (record.typeName === 'shape') {
      sequences[`com.tldraw.shape.${record.type}`] ??= 0;
    }
    records.push(record);
  }
  return JSON.stringify({
    tldrawFileFormatVersion: 1,
    schema: { schemaVersion: 2, sequences },
    records,
  });
}
