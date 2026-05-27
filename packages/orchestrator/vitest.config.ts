import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    pool: 'forks', // better-sqlite3 is native; forks keep workers isolated
    reporters: ['default'],
    setupFiles: ['./src/__test__/setup.ts'],
    testTimeout: 10_000,
  },
});
