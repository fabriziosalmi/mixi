import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from './package.json' with { type: 'json' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Injects a native <script type="importmap"> into the HTML so that
 * external ESM modules (mixi-decks plugins loaded via dynamic import())
 * can resolve bare "react" specifiers to the host app's bundled React.
 * This prevents React #306 (dual instance) in production.
 */
/**
 * Post-build: generate ESM shims for React that re-export named hooks
 * from the Vite vendor chunk, then inject an import map into index.html.
 *
 * The vendor chunk is CJS-to-ESM — it only has a default export.
 * External deck plugins do `import { useState } from 'react'` which
 * needs named exports. The shim bridges the gap.
 */
function importMapPlugin(): Plugin {
  return {
    name: 'mixi-import-map',
    enforce: 'post',
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      const htmlPath = path.join(distDir, 'index.html');
      if (!fs.existsSync(htmlPath)) return;

      const assetsDir = path.join(distDir, 'assets');
      const reactChunk = fs.readdirSync(assetsDir).find((f: string) => f.startsWith('react-vendor') && f.endsWith('.js'));
      if (!reactChunk) return;

      // Generate react-shim.js — re-exports named hooks from the default export
      const reactShim = `import R from './${reactChunk}';
export default R;
export const {useState,useEffect,useRef,useCallback,useMemo,useContext,useReducer,useLayoutEffect,useId,useSyncExternalStore,useTransition,useDeferredValue,useInsertionEffect,useDebugValue,useImperativeHandle,createContext,createElement,createRef,forwardRef,memo,lazy,Fragment,Suspense,StrictMode,Children,cloneElement,isValidElement,startTransition,Component,PureComponent} = R;
`;
      fs.writeFileSync(path.join(assetsDir, 'react-shim.js'), reactShim);

      // Generate jsx-runtime-shim.js
      const jsxShim = `import R from './${reactChunk}';
export const jsx = R.createElement;
export const jsxs = R.createElement;
export const jsxDEV = R.createElement;
export const Fragment = R.Fragment;
`;
      fs.writeFileSync(path.join(assetsDir, 'jsx-runtime-shim.js'), jsxShim);

      // Inject import map pointing to the shims (not the raw vendor chunk)
      const importMap = {
        imports: {
          'react': `./assets/react-shim.js`,
          'react-dom': `./assets/react-shim.js`,
          'react/jsx-runtime': `./assets/jsx-runtime-shim.js`,
        },
      };

      let html = fs.readFileSync(htmlPath, 'utf8');
      html = html.replace(
        '<script type="module"',
        `<script type="importmap">${JSON.stringify(importMap)}</script>\n    <script type="module"`,
      );
      fs.writeFileSync(htmlPath, html);
      console.log(`[mixi-import-map] Shims + import map → assets/react-shim.js (vendor: ${reactChunk})`);
    },
  };
}

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait(), importMapPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __MIXI_VERSION__: JSON.stringify(pkg.version),
  },
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react/jsx-runtime'],
        },
      },
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
