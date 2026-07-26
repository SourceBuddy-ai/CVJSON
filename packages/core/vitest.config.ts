import { defineConfig } from 'vitest/config';

export default defineConfig({
  // An inline (empty) PostCSS config stops Vite walking up the directory tree
  // and picking up an unrelated config from a parent project. This package has
  // no stylesheets, so there is nothing to process.
  css: { postcss: {} },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
