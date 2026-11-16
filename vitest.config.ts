import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['node_modules', 'build', 'test/live*.test.ts'],
    coverage: {
      include: ['src/**/*.ts', 'scripts/scrub-patterns.mjs'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
    },
  },
});
