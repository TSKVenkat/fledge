import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{apps,packages}/*/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'e2e/**'],
    environment: 'node',
    // Password hashing dominates the API tests otherwise. Four rounds is
    // meaningless for security and irrelevant here; production reads the same
    // variable and is left at its default.
    env: { BCRYPT_ROUNDS: '4' },
    testTimeout: 30_000,
  },
});
