// src/lib/is-main.ts
// True when a module is the process entrypoint. Compares real paths, so it
// still holds when a CLI is launched through an npm bin link or an installer
// symlink (argv[1] is then `.../bin/buddy-world`, not `world-cli.js`), and is
// false when tests import the module.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMainModule(moduleUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
