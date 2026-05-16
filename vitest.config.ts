import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        // Redirect wasm pkg to a stub so unit tests don't need a built wasm binary.
        // Matches both bare specifier and relative path variants.
        find: /.*mixi-core\/pkg\/mixi_core$/,
        replacement: path.resolve(__dirname, 'tests/__mocks__/mixi_core.ts'),
      },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.claude/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
