import { fileURLToPath } from 'node:url';

// eslint-disable-next-line import/no-extraneous-dependencies -- test runner configuration
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.spec.ts'],
  },
});
