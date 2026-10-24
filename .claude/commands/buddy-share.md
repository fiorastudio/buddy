---
description: Generate a shareable PNG card of your Buddy's current status.
---

Generate a snapshot PNG of the current Buddy companion card.

If `$ARGUMENTS` is present, treat it as an optional output file path.

```bash
set -euo pipefail

args=()
if [ -n "${ARGUMENTS:-}" ]; then
  read -r -a args <<< "$ARGUMENTS"
fi

if command -v buddy-share >/dev/null 2>&1; then
  buddy-share "${args[@]}"
else
  BUDDY_SERVER="$HOME/.buddy/server/dist/cli/snapshot-cli.js"
  NODE_BIN="$(command -v node)"
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$candidate" ] && [[ "$NODE_BIN" == /Applications/*.app/* ]]; then
      NODE_BIN="$candidate"
      break
    fi
  done
  "$NODE_BIN" "$BUDDY_SERVER" "${args[@]}"
fi
```

Execute the bash block above, then report the saved PNG path back to the user.
