import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

import { serveDir } from './vite-plugins/serve-dir';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load shared config from the repo root .env (see <repo>/.env.example).
  // Server-only secrets in apps/server/.env are NOT read here — and even if
  // the path were widened, only `VITE_*` vars are exposed to the client bundle.
  const env = loadEnv(mode, path.resolve(__dirname, '../..'), '');

  const serverPort = Number(env.SERVER_PORT ?? 3000);
  const clientPort = Number(env.CLIENT_PORT ?? 5173);
  const serverUrl = env.SERVER_URL ?? `http://localhost:${serverPort}`;
  const isDev = mode === 'development';

  console.log(
    `Vite dev server running on port ${clientPort}, proxying API requests to ${serverUrl}`,
  );

  return {
    plugins: [
      tanstackRouter(),
      react(),
      tailwindcss(),
      serveDir('/cases/', path.resolve(__dirname, '../../cases')),
      serveDir('/reports/', path.resolve(__dirname, '../../reports')),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: clientPort,
      proxy: {
        '/api': {
          target: serverUrl,
          changeOrigin: true,
        },
      },
    },
    // In dev, leave VITE_API_URL unset so the client uses relative `/api/*`
    // paths and goes through the proxy above (same-origin, no CORS preflight).
    define: isDev
      ? {}
      : {
          'import.meta.env.VITE_API_URL': JSON.stringify(serverUrl),
        },
  };
});
