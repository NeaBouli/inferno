import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // All files share the reset SQLite fixture, while module state remains isolated.
    fileParallelism: false,
    isolate: true,
    // Retain open-handle diagnostics and require natural runner shutdown.
    reporters: [...configDefaults.reporters, 'hanging-process'],
    clearMocks: false,
    mockReset: false,
    restoreMocks: false,
    testTimeout: 5_000,
    hookTimeout: 5_000,
  },
});
