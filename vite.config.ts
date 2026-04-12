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
function importMapPlugin(): Plugin {
  return {
    name: 'mixi-import-map',
    enforce: 'post',
    closeBundle() {
      // Post-build: inject import map into dist/index.html
      const distDir = path.resolve(__dirname, 'dist');
      const htmlPath = path.join(distDir, 'index.html');
      if (!fs.existsSync(htmlPath)) return;

      const assetsDir = path.join(distDir, 'assets');
      const reactChunk = fs.readdirSync(assetsDir).find((f: string) => f.startsWith('react-vendor') && f.endsWith('.js'));
      if (!reactChunk) return;

      const importMap = {
        imports: {
          'react': `./assets/${reactChunk}`,
          'react-dom': `./assets/${reactChunk}`,
          'react/jsx-runtime': `./assets/${reactChunk}`,
        },
      };

      let html = fs.readFileSync(htmlPath, 'utf8');
      html = html.replace(
        '<script type="module"',
        `<script type="importmap">${JSON.stringify(importMap)}</script>\n    <script type="module"`,
      );
      fs.writeFileSync(htmlPath, html);
      console.log(`[mixi-import-map] Injected import map → assets/${reactChunk}`);
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
