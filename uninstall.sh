#!/usr/bin/env bash
# Buddy MCP Server — Uninstaller
#
# Usage:
#   bash uninstall.sh
#   bash uninstall.sh --yes
#   bash uninstall.sh --keep-data

set -euo pipefail

INSTALL_DIR="$HOME/.buddy/server"
DATA_DIR="$HOME/.buddy"
STATUS_FILE="$HOME/.claude/buddy-status.json"
KEEP_DATA=0
ASSUME_YES=0
NODE_BIN="${BUDDY_NODE_BIN:-$(command -v node || true)}"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
DIM='\033[2m'
NC='\033[0m'

for arg in "$@"; do
  case "$arg" in
    --keep-data)
      KEEP_DATA=1
      ;;
    --yes|-y)
      ASSUME_YES=1
      ;;
    --help|-h)
      cat <<'EOF'
Buddy MCP Server — Uninstaller

Usage:
  bash uninstall.sh [--yes] [--keep-data]

Options:
  --yes        Skip confirmation prompt
  --keep-data  Preserve ~/.buddy/buddy.db and other local Buddy data
EOF
      exit 0
      ;;
    *)
      echo -e "${YELLOW}Unknown argument:${NC} $arg"
      exit 1
      ;;
  esac
done

echo -e "${BLUE}"
echo '  Buddy MCP Server Uninstaller'
echo '  ────────────────────────────'
echo -e "${NC}"

remove_json_buddy() {
  local config_file="$1"
  local cli_name="$2"

  if [ ! -f "$config_file" ]; then
    return 0
  fi

  if [ -z "$NODE_BIN" ]; then
    echo -e "  ${YELLOW}!${NC} Skipping $cli_name config cleanup because Node.js is not available"
    return 0
  fi

  set +e
  "$NODE_BIN" -e "
    const fs = require('fs');
    const path = process.argv[1];
    try {
      const raw = fs.readFileSync(path, 'utf8');
      const config = JSON.parse(raw);
      if (!config || typeof config !== 'object') process.exit(11);
      if (!config.mcpServers || !config.mcpServers.buddy) process.exit(10);
      delete config.mcpServers.buddy;
      if (Object.keys(config.mcpServers).length === 0) {
        delete config.mcpServers;
      }
      fs.writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
    } catch {
      process.exit(11);
    }
  " "$config_file" >/dev/null 2>&1
  local rc=$?
  set -e

  case "$rc" in
    0)
      echo -e "  ${GREEN}✓${NC} Removed Buddy MCP entry from $cli_name ${DIM}($config_file)${NC}"
      ;;
    10)
      ;;
    *)
      echo -e "  ${YELLOW}!${NC} Could not update $cli_name config ${DIM}($config_file)${NC}"
      ;;
  esac
}

remove_prompt_block() {
  local file="$1"
  local cli_name="$2"

  if [ ! -f "$file" ]; then
    return 0
  fi

  if [ -z "$NODE_BIN" ]; then
    echo -e "  ${YELLOW}!${NC} Skipping $cli_name prompt cleanup because Node.js is not available"
    return 0
  fi

  set +e
  "$NODE_BIN" -e "
    const fs = require('fs');
    const path = process.argv[1];
    try {
      const raw = fs.readFileSync(path, 'utf8');
      const pattern = /\n?<!-- buddy-companion -->[\s\S]*?<!-- \/buddy-companion -->\n?/;
      if (!pattern.test(raw)) process.exit(10);
      const updated = raw.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n').trim();
      fs.writeFileSync(path, updated ? updated + '\n' : '');
    } catch {
      process.exit(11);
    }
  " "$file" >/dev/null 2>&1
  local rc=$?
  set -e

  case "$rc" in
    0)
      echo -e "  ${GREEN}✓${NC} Removed Buddy instructions from $cli_name ${DIM}($file)${NC}"
      ;;
    10)
      ;;
    *)
      echo -e "  ${YELLOW}!${NC} Could not update $cli_name prompt file ${DIM}($file)${NC}"
      ;;
  esac
}

echo ""
echo "  This will remove Buddy MCP config and prompt instructions."
if [ "$KEEP_DATA" -eq 1 ]; then
  echo "  Local Buddy data will be preserved."
else
  echo "  Local Buddy data in ~/.buddy will also be removed."
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  printf "\nProceed with uninstall? [y/N] "
  read -r reply
  case "$reply" in
    y|Y|yes|YES)
      ;;
    *)
      echo "  Aborted."
      exit 0
      ;;
  esac
fi

echo ""
echo "  Removing MCP client configuration..."
remove_json_buddy "$HOME/.claude/settings.json" "Claude Code"
remove_json_buddy "$HOME/.cursor/mcp.json" "Cursor"
remove_json_buddy "$HOME/.codeium/windsurf/mcp_config.json" "Windsurf"

if command -v codex >/dev/null 2>&1; then
  if codex mcp get buddy >/dev/null 2>&1; then
    if codex mcp remove buddy >/dev/null 2>&1; then
      echo -e "  ${GREEN}✓${NC} Removed Buddy MCP entry from Codex CLI"
    else
      echo -e "  ${YELLOW}!${NC} Could not remove Buddy MCP entry from Codex CLI"
    fi
  fi
fi

echo ""
echo "  Removing injected prompt instructions..."
remove_prompt_block "$HOME/.claude/CLAUDE.md" "Claude Code"
remove_prompt_block "$HOME/.cursorrules" "Cursor"
remove_prompt_block "$HOME/.codeium/windsurf/rules/buddy.md" "Windsurf"
remove_prompt_block "$HOME/.codex/instructions.md" "Codex CLI"
remove_prompt_block "$HOME/.gemini/GEMINI.md" "Gemini CLI"

if [ -f "$STATUS_FILE" ]; then
  rm -f "$STATUS_FILE"
  echo -e "  ${GREEN}✓${NC} Removed Buddy status file ${DIM}($STATUS_FILE)${NC}"
fi

echo ""
echo "  Removing local files..."
if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  echo -e "  ${GREEN}✓${NC} Removed install directory ${DIM}($INSTALL_DIR)${NC}"
fi

if [ "$KEEP_DATA" -eq 0 ] && [ -d "$DATA_DIR" ]; then
  rm -rf "$DATA_DIR"
  echo -e "  ${GREEN}✓${NC} Removed data directory ${DIM}($DATA_DIR)${NC}"
elif [ "$KEEP_DATA" -eq 1 ]; then
  echo -e "  ${DIM}Preserved data directory ${DATA_DIR}${NC}"
fi

echo ""
echo -e "${GREEN}  ✅ Buddy uninstalled.${NC}"
echo ""
