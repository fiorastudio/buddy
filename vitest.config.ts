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
    // Several test files share the single BUDDY_DB_PATH file (doctor,
    // respawn-cleanup, mode-orthogonality, companion, self-healing). Vitest's
    // default is file-level parallelism, which would race them against each
    // other's DELETE/INSERT cycles. Serialize file execution to eliminate
    // the race. Individual tests within a file still run in order.
    fileParallelism: false,
  },
});
