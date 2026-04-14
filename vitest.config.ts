import { defineConfig } from 'vitest/config';
import { join } from 'path';
import { tmpdir } from 'os';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    env: {
      // Tests use an isolated DB so they never touch ~/.buddy/buddy.db
      BUDDY_DB_PATH: join(tmpdir(), 'buddy-test.db'),
    },
  },
});
