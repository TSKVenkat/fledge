import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'docs/.vitepress/cache/**', 'docs/.vitepress/dist/**', '**/test/fixture/**', 'apps/web/public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Node runs the TypeScript directly by stripping types, and it cannot
      // strip a parameter property. Do not disable this.
      '@typescript-eslint/parameter-properties': ['error', { prefer: 'class-property' }],
    },
  },
  {
    files: ['apps/web/**/*.tsx', 'apps/web/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // Test drivers run in Node but hold browser code in strings passed to
    // page.evaluate(), so they legitimately name globals from both.
    files: ['e2e/**/*.mjs', 'packages/*/test/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['**/*.config.{js,ts,mjs}', '**/scripts/**/*.mjs', 'packages/*/build.mjs', 'packages/*/test/build.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
);
