import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    setupFiles: ['./jest.setup.cjs'],
    fileParallelism: false,
    isolate: true,
    // Preserve Jest's existing mock-history and 5-second test/hook contracts.
    clearMocks: false,
    mockReset: false,
    restoreMocks: false,
    testTimeout: 5_000,
    hookTimeout: 5_000,
  },
});
