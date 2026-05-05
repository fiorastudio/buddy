import { initDb, db } from '../db/schema.js';
import { loadCompanion } from '../lib/companion.js';
import { captureSnapshot } from '../lib/snapshot.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  try {
    initDb();
  } catch (error) {
    console.error("Failed to initialize database:", error);
    process.exit(1);
  }
  const row = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
  if (!row) {
    console.error("No buddy found. Hatch one first!");
    process.exit(1);
  }

  const companion = loadCompanion(row)!;
  const outPath = process.argv[2] || join(process.cwd(), 'buddy_snapshot.png');
  
  console.log(`Generating snapshot for ${companion.name}...`);
  await captureSnapshot(companion, outPath);
  console.log(`Snapshot saved to: ${outPath}`);
}

main().catch(err => {
  console.error("Failed to generate snapshot:", err);
  process.exit(1);
});
