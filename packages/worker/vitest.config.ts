import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Prevent Vite from walking up the tree and picking up an unrelated PostCSS
  // config from a parent project. This package has no stylesheets.
  css: { postcss: {} },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
