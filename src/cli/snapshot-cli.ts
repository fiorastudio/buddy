import { initDb, db } from '../db/schema.js';
import { loadCompanion } from '../lib/companion.js';
import { captureSnapshot } from '../lib/snapshot.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  initDb();
  const row = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
  if (!row) {
    console.error("No buddy found. Hatch one first!");
    process.exit(1);
  }

  const companion = loadCompanion(row)!;
  const outPath = process.argv[2] || join(process.cwd(), 'buddy_snapshot.png');
  const message = process.argv[3];
  
  const deltaStat = process.argv[4];
  const deltaPoints = parseInt(process.argv[5] || '0');
  const delta = deltaStat ? { stat: deltaStat, points: deltaPoints } : undefined;
  
  console.log(`Generating snapshot for ${companion.name}...`);
  await captureSnapshot(companion, outPath, message, delta);
  console.log(`Snapshot saved to: ${outPath}`);
}

main().catch(err => {
  console.error("Failed to generate snapshot:", err);
  process.exit(1);
});
