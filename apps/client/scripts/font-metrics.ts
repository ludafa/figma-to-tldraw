import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import zlib from 'node:zlib';

// See apps/docs/skia-engine/tech.md §7.2.

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'src/figma/font-metrics.json');
const require = createRequire(path.join(ROOT, 'package.json'));

interface Face {
  family: string;
  weight: string;
  style: string;
  file: string;
}

function resolveCss(spec: string, from: string): string {
  if (spec.startsWith('.')) {
    return path.resolve(path.dirname(from), spec);
  }
  return require.resolve(spec);
}

function collectFaces(cssFile: string, out: Face[], seen = new Set<string>()) {
  if (seen.has(cssFile)) {
    return;
  }
  seen.add(cssFile);
  const css = fs.readFileSync(cssFile, 'utf8');
  for (const m of css.matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
    collectFaces(resolveCss(m[1], cssFile), out, seen);
  }
  for (const block of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const body = block[1];
    const get = (prop: string) =>
      new RegExp(`${prop}\\s*:\\s*([^;]+);`).exec(body)?.[1].trim() ?? '';
    const range = get('unicode-range');
    // Only the subset with Latin letters decides the metrics.
    if (range && !/U\+0000-00FF|U\+0020|U\+0041/i.test(range)) {
      continue;
    }
    const url = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(get('src'))?.[1];
    if (!url) {
      continue;
    }
    const file = url.startsWith('.')
      ? path.resolve(path.dirname(cssFile), url)
      : require.resolve(url);
    out.push({
      family: get('font-family').replace(/^['"]|['"]$/g, ''),
      weight: get('font-weight') || '400',
      style: get('font-style').split(/\s+/)[0] || 'normal',
      file,
    });
  }
}

function readBase128(buf: Buffer, at: { i: number }): number {
  let v = 0;
  for (let k = 0; k < 5; k++) {
    const b = buf[at.i++];
    v = v * 128 + (b & 0x7f);
    if (!(b & 0x80)) {
      return v;
    }
  }
  return v;
}

const WOFF2_TAGS = [
  'cmap',
  'head',
  'hhea',
  'hmtx',
  'maxp',
  'name',
  'OS/2',
  'post',
  'cvt ',
  'fpgm',
  'glyf',
  'loca',
  'prep',
  'CFF ',
  'VORG',
  'EBDT',
  'EBLC',
  'gasp',
  'hdmx',
  'kern',
  'LTSH',
  'PCLT',
  'VDMX',
  'vhea',
  'vmtx',
  'BASE',
  'GDEF',
  'GPOS',
  'GSUB',
  'EBSC',
  'JSTF',
  'MATH',
  'CBDT',
  'CBLC',
  'COLR',
  'CPAL',
  'SVG ',
  'sbix',
  'acnt',
  'avar',
  'bdat',
  'bloc',
  'bsln',
  'cvar',
  'fdsc',
  'feat',
  'fmtx',
  'fvar',
  'gvar',
  'hsty',
  'just',
  'lcar',
  'mort',
  'morx',
  'opbd',
  'prop',
  'trak',
  'Zapf',
  'Silf',
  'Glat',
  'Gloc',
  'Feat',
  'Sill',
];

function tables(buf: Buffer): Map<string, Buffer> {
  const sig = buf.toString('latin1', 0, 4);
  const out = new Map<string, Buffer>();
  if (sig === 'wOF2') {
    const numTables = buf.readUInt16BE(12);
    const at = { i: 48 };
    const dir: { tag: string; length: number }[] = [];
    for (let t = 0; t < numTables; t++) {
      const flags = buf[at.i++];
      const idx = flags & 0x3f;
      let tag: string;
      if (idx === 63) {
        tag = buf.toString('latin1', at.i, at.i + 4);
        at.i += 4;
      } else {
        tag = WOFF2_TAGS[idx];
      }
      const version = flags >> 6;
      const orig = readBase128(buf, at);
      const transformed =
        tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
      const length = transformed ? readBase128(buf, at) : orig;
      dir.push({ tag, length });
    }
    const data = zlib.brotliDecompressSync(buf.subarray(at.i));
    let off = 0;
    for (const d of dir) {
      out.set(d.tag, data.subarray(off, off + d.length));
      off += d.length;
    }
    return out;
  }
  if (sig === 'wOFF') {
    const numTables = buf.readUInt16BE(12);
    for (let t = 0; t < numTables; t++) {
      const e = 44 + t * 20;
      const tag = buf.toString('latin1', e, e + 4);
      const offset = buf.readUInt32BE(e + 4);
      const comp = buf.readUInt32BE(e + 8);
      const orig = buf.readUInt32BE(e + 12);
      const raw = buf.subarray(offset, offset + comp);
      out.set(tag, comp < orig ? zlib.inflateSync(raw) : raw);
    }
    return out;
  }
  const numTables = buf.readUInt16BE(4);
  for (let t = 0; t < numTables; t++) {
    const e = 12 + t * 16;
    const tag = buf.toString('latin1', e, e + 4);
    const offset = buf.readUInt32BE(e + 8);
    const length = buf.readUInt32BE(e + 12);
    out.set(tag, buf.subarray(offset, offset + length));
  }
  return out;
}

function metrics(file: string) {
  const t = tables(fs.readFileSync(file));
  const head = t.get('head')!;
  const hhea = t.get('hhea')!;
  const os2 = t.get('OS/2')!;
  const upem = head.readUInt16BE(18);
  return {
    upem,
    typo: [os2.readInt16BE(68), -os2.readInt16BE(70), os2.readInt16BE(72)],
    hhea: [hhea.readInt16BE(4), -hhea.readInt16BE(6), hhea.readInt16BE(8)],
    win: [os2.readUInt16BE(74), os2.readUInt16BE(76)],
    useTypo: (os2.readUInt16BE(62) & 0x80) !== 0,
  };
}

const faces: Face[] = [];
collectFaces(path.join(ROOT, 'src/figma/figma.css'), faces);
const result: Record<string, ReturnType<typeof metrics>> = {};
for (const f of faces) {
  const m = metrics(f.file);
  const prev = result[f.family];
  if (prev && JSON.stringify(prev) !== JSON.stringify(m)) {
    console.warn(`${f.family} ${f.weight} ${f.style}: metrics differ`);
  }
  result[f.family] ??= m;
}
fs.writeFileSync(OUT, `${JSON.stringify(result, null, 1)}\n`);
console.log(
  `${Object.keys(result).length} faces → ${path.relative(ROOT, OUT)}`,
);
