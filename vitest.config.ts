import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'backend',
    include: ['tests/**/*.test.ts', 'packages/shared/**/*.test.ts', 'apps/worker/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 20000,
  },
  resolve: {
    alias: { '@nova/shared': new URL('./packages/shared/src/index.ts', import.meta.url).pathname },
  },
});
