// See apps/docs/doc-system/tech.md §3.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const DOCS = 'apps/docs/';
const problems = [];

// See apps/docs/doc-system/tech.md §3.4.
if (
  spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' })
    .status !== 0
) {
  console.warn('check-refs: not inside a git work tree, skipped');
  process.exit(0);
}

// See apps/docs/doc-system/tech.md §3.1.
function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    if (error.status === 1) {
      return '';
    }
    throw error;
  }
}

const texts = new Map();
function textOf(file) {
  if (!texts.has(file)) {
    texts.set(file, readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
  }
  return texts.get(file);
}

function headingsOf(doc) {
  const titles = [];
  let fenced = false;
  for (const line of textOf(doc).split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
    }
    const match = !fenced && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (match) {
      titles.push({ level: match[1].length, title: match[2] });
    }
  }
  return titles;
}

const sectionCache = new Map();
function sectionsOf(doc) {
  if (!sectionCache.has(doc)) {
    const numbers = new Map();
    for (const { level, title } of headingsOf(doc)) {
      const match = level >= 2 && /^(\d+(?:\.\d+)*)\.?(?=\s)/.exec(title);
      if (match) {
        numbers.set(match[1], (numbers.get(match[1]) ?? 0) + 1);
      }
    }
    sectionCache.set(doc, numbers);
  }
  return sectionCache.get(doc);
}

// See apps/docs/doc-system/tech.md §3.3.
const anchorCache = new Map();
function anchorsOf(doc) {
  if (!anchorCache.has(doc)) {
    const seen = new Map();
    const anchors = new Set();
    for (const { title } of headingsOf(doc)) {
      const base = title
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
        .replace(/ /g, '-');
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      anchors.add(n === 0 ? base : `${base}-${n}`);
    }
    anchorCache.set(doc, anchors);
  }
  return anchorCache.get(doc);
}

// See apps/docs/doc-system/tech.md §3.3.
function resolveLink(file, url) {
  const [path, anchor = ''] = url.split('#');
  const decoded = decodeURI(path);
  let target = file;
  if (decoded.startsWith('/')) {
    target = normalize(decoded.slice(1));
  } else if (decoded) {
    target = normalize(join(dirname(file), decoded));
  }
  return { target, anchor: decodeURIComponent(anchor).toLowerCase() };
}

// See apps/docs/doc-system/tech.md §3.1.
const REF = /See (apps\/docs\/[\p{L}\p{N}_./-]+\.md)(?: §([\w.-]+))?/gu;
let refs = 0;
const hits = git([
  'grep',
  '-z',
  '-nI',
  '--untracked',
  '-E',
  'See apps/docs/',
  '--',
  '.',
  ':!apps/docs',
]);
for (const hit of hits.split('\n').filter(Boolean)) {
  const [file, line, text] = hit.split('\0');
  for (const [, doc, raw] of text.matchAll(REF)) {
    refs++;
    const where = `${file}:${line}`;
    const section = raw?.replace(/[.,;:)]+$/, '');
    if (!existsSync(doc)) {
      problems.push(`${where}: ${doc} does not exist`);
    } else if (section !== undefined && !/^\d+(?:\.\d+)*$/.test(section)) {
      problems.push(`${where}: "§${raw}" is not a section number`);
    } else if (section !== undefined && !sectionsOf(doc).has(section)) {
      problems.push(`${where}: ${doc} has no section §${section}`);
    }
  }
}

const markdown = git([
  'ls-files',
  '-z',
  '--cached',
  '--others',
  '--exclude-standard',
  '--',
  '*.md',
])
  .split('\0')
  .filter(
    (file) => file && existsSync(file) && !file.startsWith('node_modules/'),
  );

// See apps/docs/doc-system/tech.md §3.2.
for (const doc of markdown.filter((file) => file.startsWith(DOCS))) {
  for (const [number, times] of sectionsOf(doc)) {
    if (times > 1) {
      problems.push(`${doc}: section §${number} appears ${times} times`);
    }
  }
}

// See apps/docs/doc-system/tech.md §3.3.
let links = 0;
for (const file of markdown) {
  let fenced = false;
  textOf(file)
    .split('\n')
    .forEach((line, index) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return;
      }
      if (fenced) {
        return;
      }
      const prose = line.replace(/`[^`]*`/g, '');
      for (const [, url] of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^[a-z][\w+.-]*:/i.test(url) || url.includes('<')) {
          continue;
        }
        links++;
        const where = `${file}:${index + 1}`;
        let link;
        try {
          link = resolveLink(file, url);
        } catch {
          problems.push(`${where}: malformed link ${url}`);
          continue;
        }
        const { target, anchor } = link;
        if (!existsSync(target)) {
          problems.push(`${where}: link to missing ${target}`);
          continue;
        }
        if (anchor && target.endsWith('.md') && statSync(target).isFile()) {
          if (!anchorsOf(target).has(anchor)) {
            problems.push(`${where}: ${target} has no heading for #${anchor}`);
          }
        }
      }
    });
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(`${problems.length} problems`);
  process.exit(1);
}
console.log(`${refs} code references, ${links} doc links OK`);
