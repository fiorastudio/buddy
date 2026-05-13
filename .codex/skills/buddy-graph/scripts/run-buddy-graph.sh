#!/usr/bin/env bash
set -euo pipefail

if command -v buddy >/dev/null 2>&1; then
  buddy graph "$@"
else
  node dist/cli/buddy.js graph "$@"
fi
