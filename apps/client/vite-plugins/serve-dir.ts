import fs from 'node:fs';
import path from 'node:path';

import type { Connect, Plugin } from 'vite';

// See apps/docs/figma-to-tldraw/tech.md §1.1.

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export function serveDir(prefix: string, dir: string): Plugin {
  const root = path.resolve(dir);
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(prefix)) {
      next();
      return;
    }
    const file = path.resolve(
      root,
      decodeURIComponent(url.pathname.slice(prefix.length)),
    );
    if (
      !file.startsWith(root + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    res.setHeader(
      'Content-Type',
      CONTENT_TYPES[path.extname(file).toLowerCase()] ??
        'application/octet-stream',
    );
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(file).pipe(res);
  };
  return {
    name: `figma-serve-dir:${prefix}`,
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
