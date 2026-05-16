import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import pkg from './package.json' with { type: 'json' };
import { existsSync } from 'fs';
import { resolve } from 'path';

// If the Wasm pkg hasn't been built (worktree / fresh clone), fall back to
// the same stub used by Vitest so the dev server and E2E tests can still run.
const wasmPkgExists = existsSync(resolve(__dirname, 'mixi-core/pkg/mixi_core.js'));
const wasmAlias = wasmPkgExists
  ? []
  : [
      {
        find: /.*mixi-core\/pkg\/mixi_core$/,
        replacement: resolve(__dirname, 'tests/__mocks__/mixi_core.ts'),
      },
    ];

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __MIXI_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: wasmAlias,
  },
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    // COOP/COEP — required for SharedArrayBuffer (Step 2)
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    // Proxy API calls to the Python backend during dev
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
