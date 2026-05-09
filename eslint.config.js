import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'docs/.vitepress/cache', 'electron/dist', 'api/build', 'release', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'error',
      // Visible-but-non-blocking. We have ~130 existing `any` at browser-API
      // boundaries (WebMIDI, WebGPU, native addon). New uses should justify
      // themselves; the `npm run lint` ceiling prevents net regression.
      '@typescript-eslint/no-explicit-any': 'warn',
      // ts-ignore is banned outright; ts-expect-error must carry a reason.
      '@typescript-eslint/ban-ts-comment': ['error', {
        'ts-ignore': true,
        'ts-nocheck': true,
        'ts-check': false,
        'ts-expect-error': 'allow-with-description',
        minimumDescriptionLength: 8,
      }],
      'react-hooks/set-state-in-effect': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
    },
  }
);
