import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Separate pool for the ONE real-runtime integration test: it runs inside
// workerd (via @cloudflare/vitest-pool-workers) so it can exercise a genuine
// WebSocketPair, the Durable Object Hibernation API, and eviction/rehydration.
// The rest of the suite (node pool, better-sqlite3) stays in vitest.config.ts;
// *.workers.test.ts files are excluded there and included ONLY here.
//
// vitest-pool-workers 0.20 (vitest 4) moved config from `defineWorkersConfig`'s
// `test.poolOptions.workers` to the `cloudflareTest()` Vite plugin.
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/world/worker.ts',
      singleWorker: true,
      miniflare: {
        compatibilityDate: '2026-06-01',
        compatibilityFlags: ['nodejs_compat'],
        durableObjects: {
          // SQLite-backed DO storage, matching wrangler.toml's
          // new_sqlite_classes = ["WorldRoom"].
          ROOM: { className: 'WorldRoom', useSQLite: true },
        },
        d1Databases: ['DB'],
      },
    }),
  ],
  test: {
    include: ['src/__tests__/world/**/*.workers.test.ts'],
  },
});
