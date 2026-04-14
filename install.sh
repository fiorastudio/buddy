#!/usr/bin/env bash
# Buddy MCP Server — Cross-platform installer
# Installs AND auto-configures MCP for your CLI
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/fiorastudio/buddy/master/install.sh | bash

set -e

REPO="https://github.com/fiorastudio/buddy.git"
INSTALL_DIR="$HOME/.buddy/server"
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
DIM='\033[2m'
NC='\033[0m'

echo -e "${BLUE}"
echo '  🥚 Buddy MCP Server Installer'
echo '  ─────────────────────────────'
echo -e "${NC}"

# Check prerequisites
if ! command -v node &> /dev/null; then
  echo -e "${YELLOW}Node.js is required but not found. Install it from https://nodejs.org${NC}"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${YELLOW}Node.js 18+ required. You have $(node -v). Please upgrade.${NC}"
  exit 1
fi

if ! command -v git &> /dev/null; then
  echo -e "${YELLOW}Git is required but not found.${NC}"
  exit 1
fi

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
  echo "  Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull origin master --quiet
else
  echo "  Cloning Buddy MCP Server..."
  git clone --depth 1 "$REPO" "$INSTALL_DIR" --quiet
fi

cd "$INSTALL_DIR"

echo "  Installing dependencies..."
npm install --quiet 2>/dev/null
echo "  Building..."
npm run build --quiet 2>/dev/null

SERVER_PATH="$INSTALL_DIR/dist/server/index.js"
CODEX_CONFIGURED=0

# ── Auto-configure MCP for detected CLIs ──

configure_claude_code() {
  local config_file="$HOME/.claude/settings.json"
  local config_dir="$HOME/.claude"

  mkdir -p "$config_dir"

  if [ ! -f "$config_file" ]; then
    # Create new settings with buddy
    cat > "$config_file" << EOJSON
{
  "mcpServers": {
    "buddy": {
      "command": "node",
      "args": ["$SERVER_PATH"]
    }
  }
}
EOJSON
    echo -e "  ${GREEN}✓${NC} Claude Code configured ${DIM}($config_file)${NC}"
    return 0
  fi

  # Check if buddy already configured
  if grep -q '"buddy"' "$config_file" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} Claude Code already configured"
    return 0
  fi

  # Inject buddy into existing mcpServers (or add mcpServers section)
  if command -v node &> /dev/null; then
    node -e "
      const fs = require('fs');
      const config = JSON.parse(fs.readFileSync('$config_file', 'utf-8'));
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers.buddy = { command: 'node', args: ['$SERVER_PATH'] };
      fs.writeFileSync('$config_file', JSON.stringify(config, null, 2));
    " 2>/dev/null
    echo -e "  ${GREEN}✓${NC} Claude Code configured ${DIM}($config_file)${NC}"
  fi
}

configure_cursor() {
  local config_file="$HOME/.cursor/mcp.json"

  if [ -d "$HOME/.cursor" ]; then
    if [ ! -f "$config_file" ]; then
      cat > "$config_file" << EOJSON
{
  "mcpServers": {
    "buddy": {
      "command": "node",
      "args": ["$SERVER_PATH"]
    }
  }
}
EOJSON
    elif ! grep -q '"buddy"' "$config_file" 2>/dev/null; then
      node -e "
        const fs = require('fs');
        const config = JSON.parse(fs.readFileSync('$config_file', 'utf-8'));
        if (!config.mcpServers) config.mcpServers = {};
        config.mcpServers.buddy = { command: 'node', args: ['$SERVER_PATH'] };
        fs.writeFileSync('$config_file', JSON.stringify(config, null, 2));
      " 2>/dev/null
    fi
    echo -e "  ${GREEN}✓${NC} Cursor configured ${DIM}($config_file)${NC}"
  fi
}

configure_copilot() {
  local config_file="$HOME/.copilot/mcp-config.json"

  if [ -d "$HOME/.copilot" ]; then
    if [ ! -f "$config_file" ]; then
      cat > "$config_file" << EOJSON
{
  "mcpServers": {
    "buddy": {
      "command": "node",
      "args": ["$SERVER_PATH"]
    }
  }
}
EOJSON
    elif ! grep -q '"buddy"' "$config_file" 2>/dev/null; then
      if command -v node &> /dev/null; then
        node -e "
          const fs = require('fs');
          const config = JSON.parse(fs.readFileSync('$config_file', 'utf-8'));
          if (!config.mcpServers) config.mcpServers = {};
          config.mcpServers.buddy = { command: 'node', args: ['$SERVER_PATH'] };
          fs.writeFileSync('$config_file', JSON.stringify(config, null, 2));
        " 2>/dev/null
      else
        echo -e "  ${YELLOW}!${NC} GitHub Copilot CLI: node not found, could not merge into existing config"
        return 1
      fi
    fi
    echo -e "  ${GREEN}✓${NC} GitHub Copilot CLI configured ${DIM}($config_file)${NC}"
  fi
}

configure_codex() {
  if ! command -v codex &> /dev/null; then
    return 0
  fi

  if codex mcp get buddy >/dev/null 2>&1; then
    CODEX_CONFIGURED=1
    echo -e "  ${GREEN}✓${NC} Codex CLI already configured"
    return 0
  fi

  if codex mcp add buddy -- node "$SERVER_PATH" >/dev/null 2>&1; then
    CODEX_CONFIGURED=1
    echo -e "  ${GREEN}✓${NC} Codex CLI configured"
    return 0
  fi

  echo -e "  ${YELLOW}!${NC} Codex CLI detected, but MCP registration failed"
  return 1
}

echo ""
echo "  Configuring MCP clients..."
configure_claude_code
configure_cursor
configure_copilot
configure_codex

# ── Inject buddy instructions into CLI prompt files ──

BUDDY_INSTRUCTIONS='<!-- buddy-companion -->
## Buddy Companion

You have a coding companion available via the buddy MCP server.

**After completing any coding task** (writing code, fixing bugs, refactoring, deploying, running tests), **automatically call `buddy_observe`** with a 1-sentence summary of what you did. This gives your companion XP and triggers a personality-flavored reaction. Do this every time — the user expects it.

At the start of each conversation, call `buddy_status` to check on your buddy.

If the user addresses the buddy by name, respond briefly in character before your normal response.
<!-- /buddy-companion -->'

inject_prompt() {
  local file="$1"
  local cli_name="$2"
  local dir
  dir="$(dirname "$file")"

  mkdir -p "$dir"

  if [ -f "$file" ] && grep -q "buddy-companion" "$file" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} $cli_name prompt already has buddy instructions"
    return 0
  fi

  # Append to existing file or create new one
  echo "" >> "$file"
  echo "$BUDDY_INSTRUCTIONS" >> "$file"
  echo -e "  ${GREEN}✓${NC} $cli_name prompt updated ${DIM}($file)${NC}"
}

echo ""
echo "  Injecting buddy instructions..."
inject_prompt "$HOME/.claude/CLAUDE.md" "Claude Code"
mkdir -p "$HOME/.cursor/rules" 2>/dev/null
inject_prompt "$HOME/.cursor/rules/buddy.md" "Cursor CLI"

# Codex CLI (supports AGENTS.md and instructions.md — prefer AGENTS.md)
if [ "$CODEX_CONFIGURED" -eq 1 ]; then
  if [ -f "$HOME/.codex/AGENTS.md" ]; then
    inject_prompt "$HOME/.codex/AGENTS.md" "Codex CLI"
  else
    inject_prompt "$HOME/.codex/instructions.md" "Codex CLI"
  fi
else
  echo -e "  ${YELLOW}!${NC} Skipping Codex CLI prompt injection because Buddy MCP is not configured"
fi

# Gemini CLI (supports GEMINI.md and AGENTS.md — use whichever exists, prefer GEMINI.md)
if [ -f "$HOME/.gemini/AGENTS.md" ] && [ ! -f "$HOME/.gemini/GEMINI.md" ]; then
  inject_prompt "$HOME/.gemini/AGENTS.md" "Gemini CLI"
else
  inject_prompt "$HOME/.gemini/GEMINI.md" "Gemini CLI"
fi

# GitHub Copilot CLI
inject_prompt "$HOME/.copilot/copilot-instructions.md" "GitHub Copilot CLI"

echo ""
if [ "$CODEX_CONFIGURED" -eq 1 ] || ! command -v codex &> /dev/null; then
  echo -e "${GREEN}  ✅ Buddy installed! Say \"hatch a buddy\" to start.${NC}"
  echo ""
  echo -e "  💛 If you like it, star the repo:"
  echo "  github.com/fiorastudio/buddy"
else
  echo -e "${YELLOW}  ⚠ Buddy installed, but Codex CLI still needs MCP configuration.${NC}"
fi
echo ""
