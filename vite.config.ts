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
  build: {
    rollupOptions: {
      output: {
        // Pin React + zustand into one synchronous vendor chunk.
        //
        // vite-plugin-wasm emits a top-level `await` for Wasm init, and
        // vite-plugin-top-level-await then rewrites every chunk that
        // (transitively) contains that await into an async-initialised chunk:
        // its exports are declared as bare `let`s and only *assigned* inside a
        // deferred `.then(async () => { … })`, with the init promise re-exported
        // as `__tla`. A consumer chunk is supposed to `await` that `__tla`
        // before touching those bindings — but the plugin only does so for the
        // chunks it also wraps, and fails to propagate to some lazily-loaded
        // chunks (e.g. DesktopRoot). When zustand's `create`/`persist` land in
        // such a Wasm/TLA chunk, a *non*-TLA consumer that builds a store at
        // module-eval time (sessionStore: create()(persist())) calls `create`
        // before it is assigned → "Vs is not a function" on open.
        //
        // None of react / react-dom / scheduler / zustand use top-level await,
        // so this chunk is plain-synchronous: its exports are assigned eagerly,
        // before any consumer's module body runs. zustand is grouped *with*
        // React (it depends on react's useSyncExternalStore) so React stays a
        // single instance — isolating zustand alone duplicates React core into
        // two chunks and breaks hooks. Fixes crash at DesktopRoot:1830.
        manualChunks(id) {
          if (
            id.includes('node_modules/zustand') ||
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'react-vendor';
          }
        },
      },
    },
  },
  // COOP/COEP — required for SharedArrayBuffer. `vite preview` serves the
  // production build (used by the CI e2e run, see playwright.config.ts) and
  // needs the same cross-origin isolation as the dev server, otherwise the
  // Wasm audio engine has no SharedArrayBuffer.
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
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
