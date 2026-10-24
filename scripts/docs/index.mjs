// See apps/docs/doc-system/tech.md §2.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

const DOCS = 'apps/docs';
const INDEX = join(DOCS, 'README.md');

const Meta = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  description: z.string().min(1),
  changes: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
  status: z.enum(['已上线', '开发中', '设计中']),
  code: z.array(z.string()).default([]),
});

const unquote = (value) => value.replace(/^(["'])(.*)\1$/, '$2');

// See apps/docs/doc-system/tech.md §2.1.
function parseFrontmatter(raw, file) {
  const text = raw.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) {
    throw new Error(`${file}: no frontmatter`);
  }
  const data = {};
  let listKey = null;
  for (const line of match[1].split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(unquote(item[1].trim()));
      continue;
    }
    const pair = /^([a-z]+):\s*(.*)$/.exec(line);
    if (!pair) {
      throw new Error(`${file}: cannot read line "${line}"`);
    }
    const [, key, value] = pair;
    listKey = null;
    if (value === '') {
      data[key] = [];
      listKey = key;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = unquote(value)
        .slice(1, -1)
        .split(',')
        .map((v) => unquote(v.trim()))
        .filter(Boolean);
    } else {
      data[key] = unquote(value);
    }
  }
  const parsed = Meta.safeParse(data);
  if (!parsed.success) {
    throw new Error(`${file}: ${parsed.error.message}`);
  }
  return parsed.data;
}

// See apps/docs/doc-system/tech.md §2.2.
const modules = readdirSync(DOCS, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() && existsSync(join(DOCS, entry.name, 'README.md')),
  )
  .map((entry) => {
    const file = join(DOCS, entry.name, 'README.md');
    const meta = parseFrontmatter(readFileSync(file, 'utf8'), file);
    if (meta.name !== entry.name) {
      throw new Error(`${file}: name "${meta.name}" ≠ directory`);
    }
    const missing =
      meta.status === '已上线'
        ? meta.code.filter((path) => !existsSync(path))
        : [];
    if (missing.length > 0) {
      throw new Error(`${file}: code paths not found: ${missing.join(', ')}`);
    }
    return meta;
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const cell = (text) => text.replaceAll('|', '\\|');

const lines = [
  '# 文档索引',
  '',
  '<!-- 由 scripts/docs/index.mjs 从各模块 README.md 的 frontmatter 生成，不要手改；改了模块头部后运行 pnpm docs:index。 -->',
  '',
  '文档按功能模块组织。先在下表找到模块，再打开它的 `README.md`：里面有概要、关键决定，以及本模块每个文件讲什么。写文档的规则见 [`.claude/skills/feature-docs`](../../.claude/skills/feature-docs/SKILL.md)。',
  '',
  '| 模块 | 管什么 | 施工日期 | 状态 |',
  '| ---- | ------ | -------- | ---- |',
  ...modules.map(
    (m) =>
      `| [${m.title}](${m.name}/README.md) \`${m.name}\` | ${cell(m.description)} | ${m.changes.join(' ')} | ${m.status} |`,
  ),
  '',
  '## 按时间',
  '',
  '| 日期 | 涉及模块 |',
  '| ---- | -------- |',
];
const dates = [...new Set(modules.flatMap((m) => m.changes))].sort().reverse();
for (const date of dates) {
  const touched = modules.filter((m) => m.changes.includes(date));
  lines.push(
    `| ${date} | ${touched.map((m) => `[${m.title}](${m.name}/README.md)`).join(' · ')} |`,
  );
}

// See apps/docs/doc-system/tech.md §2.3.
const formatted = spawnSync(
  'node_modules/.bin/oxfmt',
  ['--stdin-filepath', INDEX],
  {
    input: lines.join('\n') + '\n',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  },
);
if (formatted.status !== 0) {
  throw new Error(`oxfmt failed: ${formatted.stderr}`);
}
const output = formatted.stdout;

if (process.argv.includes('--check')) {
  const current = existsSync(INDEX) ? readFileSync(INDEX, 'utf8') : '';
  if (current !== output) {
    console.error(`${INDEX} is out of date: run pnpm docs:index`);
    process.exit(1);
  }
} else {
  writeFileSync(INDEX, output);
  console.log(`wrote ${INDEX} (${modules.length} modules)`);
}
