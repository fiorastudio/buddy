import { initDb, db } from '../db/schema.js';
import { loadCompanion } from '../lib/companion.js';
import { captureSnapshot } from '../lib/snapshot.js';
import { join } from 'path';
import { parseArgs } from 'util';

function usage(): never {
  console.log(`Usage: buddy-snapshot [options]

Options:
  -o, --output <path>     Output PNG path (default: ./buddy_snapshot.png)
  -m, --message <text>    Speech bubble message
  --stat <name>           Delta stat name (e.g. WISDOM)
  --points <n>            Delta points (default: 0)
  -h, --help              Show this help`);
  process.exit(0);
}

async function main() {
  const { values } = parseArgs({
    options: {
      output:  { type: 'string', short: 'o' },
      message: { type: 'string', short: 'm' },
      stat:    { type: 'string' },
      points:  { type: 'string' },
      help:    { type: 'boolean', short: 'h' },
    },
    strict: true,
  });

  if (values.help) usage();

  initDb();
  const row = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
  if (!row) {
    console.error("No buddy found. Hatch one first!");
    process.exit(1);
  }

  const companion = loadCompanion(row)!;
  const outPath = values.output || join(process.cwd(), 'buddy_snapshot.png');
  const delta = values.stat ? { stat: values.stat, points: parseInt(values.points || '0') } : undefined;

  console.log(`Generating snapshot for ${companion.name}...`);
  await captureSnapshot(companion, outPath, values.message, delta);
  console.log(`Snapshot saved to: ${outPath}`);
}

main().catch(err => {
  console.error("Failed to generate snapshot:", err);
  process.exit(1);
});
