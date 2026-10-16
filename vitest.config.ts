import { defineConfig, configDefaults } from 'vitest/config';
import { join } from 'path';
import { tmpdir } from 'os';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    // The workerd integration test runs in a separate pool (vitest.workers.config.ts).
    // It can't load better-sqlite3, so keep it out of this node run.
    exclude: [...configDefaults.exclude, '**/*.workers.test.ts'],
    env: {
      // Tests use an isolated DB so they never touch ~/.buddy/buddy.db
      BUDDY_DB_PATH: join(tmpdir(), 'buddy-test.db'),
      // ...and an isolated Claude config dir, so BUDDY_STATUS_PATH (which
      // honors CLAUDE_CONFIG_DIR) never resolves to the developer's real
      // ~/.claude/buddy-status.json. mute-persistence.test.ts deletes it.
      CLAUDE_CONFIG_DIR: join(tmpdir(), 'buddy-test-claude'),
      // ...and an isolated hook-event queue. Any test that runs the PostToolUse
      // handler on a successful commit/test run appends to the default queue;
      // it must never be the real ~/.buddy/pending-events.jsonl, which the
      // developer's own buddy_observe would then pay out.
      BUDDY_PENDING_EVENTS_PATH: join(tmpdir(), 'buddy-test-pending-events.jsonl'),
    },
    // Several test files share the single BUDDY_DB_PATH file (doctor,
    // respawn-cleanup, mode-orthogonality, companion, self-healing). Vitest's
    // default is file-level parallelism, which would race them against each
    // other's DELETE/INSERT cycles. Serialize file execution to eliminate
    // the race. Individual tests within a file still run in order.
    fileParallelism: false,
  },
});
