#!/usr/bin/env bash
# Buddy MCP Server — Cross-platform installer
# Installs AND auto-configures MCP for your CLI
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/fiorastudio/buddy/master/install.sh | bash
#   curl ... | bash -s -- --no-onboard    # skip onboarding wizard (CI/scripted installs)

set -e

# Parse flags
NO_ONBOARD=0
for arg in "$@"; do
  case "$arg" in
    --no-onboard) NO_ONBOARD=1 ;;
  esac
done

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

CLAUDE_DETECTED=0
CURSOR_DETECTED=0
COPILOT_DETECTED=0
CODEX_CONFIGURED=0
GEMINI_DETECTED=0

check_claude() {
  if command -v claude &> /dev/null || [ -d "$HOME/.claude" ]; then
    CLAUDE_DETECTED=1
    return 0
  fi
  return 1
}

check_cursor() {
  if command -v cursor &> /dev/null || [ -d "$HOME/.cursor" ]; then
    CURSOR_DETECTED=1
    return 0
  fi
  return 1
}

check_copilot() {
  if command -v copilot &> /dev/null || [ -d "$HOME/.copilot" ]; then
    COPILOT_DETECTED=1
    return 0
  fi
  return 1
}

check_codex() {
  if command -v codex &> /dev/null || [ -d "$HOME/.codex" ]; then
    return 0 # Detection helper only, CODEX_CONFIGURED is managed in configure_codex
  fi
  return 1
}

check_gemini() {
  if command -v gemini &> /dev/null || [ -d "$HOME/.gemini" ]; then
    GEMINI_DETECTED=1
    return 0
  fi
  return 1
}

configure_claude_code() {
  check_claude || return 0
  local config_dir="$HOME/.claude"
  local settings_file="$config_dir/settings.json"
  local user_file="$HOME/.claude.json"
  local hook_path="$INSTALL_DIR/dist/hooks/post-tool-handler.js"
  local stop_hook_path="$INSTALL_DIR/dist/hooks/stop-handler.js"
  local prompt_hook_path="$INSTALL_DIR/dist/hooks/prompt-handler.js"
  local statusline_command="node $INSTALL_DIR/dist/statusline-wrapper.js"

  mkdir -p "$config_dir"

  local registered=0
  if command -v claude &> /dev/null; then
    if claude mcp get buddy >/dev/null 2>&1; then
      echo -e "  ${GREEN}✓${NC} Claude Code MCP already registered"
      registered=1
    else
      if claude mcp add buddy -s user -- node "$SERVER_PATH" >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Claude Code MCP registered via claude CLI"
        registered=1
      else
        echo -e "  ${YELLOW}!${NC} claude CLI detected, but MCP registration failed — falling back to manual config"
      fi
    fi
  fi

  if [ "$registered" -ne 1 ]; then
    if command -v node &> /dev/null; then
      if CLAUDE_USER_FILE="$user_file" SERVER_PATH="$SERVER_PATH" node <<'EOJS' 2>/dev/null; then
const fs = require('fs');
const path = process.env.CLAUDE_USER_FILE;
const serverPath = process.env.SERVER_PATH;
let data = {};
try { data = JSON.parse(fs.readFileSync(path, 'utf-8')); } catch {}
if (!data.mcpServers) data.mcpServers = {};
data.mcpServers.buddy = {
  type: 'stdio',
  command: 'node',
  args: [serverPath]
};
fs.writeFileSync(path, JSON.stringify(data, null, 2));
EOJS
        echo -e "  ${GREEN}✓${NC} Claude Code MCP config written ${DIM}($user_file)${NC}"
      else
        echo -e "  ${YELLOW}!${NC} Could not write MCP config to $user_file"
      fi
    else
      echo -e "  ${YELLOW}!${NC} node not found — cannot configure Claude Code MCP"
    fi
  fi

  # Configure hook + statusline in a single settings.json write
  if command -v node &> /dev/null; then
    local settings_result
    settings_result=$(CLAUDE_SETTINGS="$settings_file" HOOK_COMMAND="node $hook_path" STOP_HOOK_COMMAND="node $stop_hook_path" PROMPT_HOOK_COMMAND="node $prompt_hook_path" STATUSLINE_COMMAND="$statusline_command" node <<'EOJS'
const fs = require('fs');
const settingsPath = process.env.CLAUDE_SETTINGS;
const hookCommand = process.env.HOOK_COMMAND;
const stopHookCommand = process.env.STOP_HOOK_COMMAND;
const promptHookCommand = process.env.PROMPT_HOOK_COMMAND;
const statuslineCommand = process.env.STATUSLINE_COMMAND;
let config = {};
try { config = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
let changed = false;
const result = [];

if (!config.hooks) config.hooks = {};

// PostToolUse — error detection (Bash only)
if (!Array.isArray(config.hooks.PostToolUse)) config.hooks.PostToolUse = [];
const hasPostHook = config.hooks.PostToolUse.some(entry =>
  entry.matcher === 'Bash' &&
  Array.isArray(entry.hooks) &&
  entry.hooks.some(h => h.command === hookCommand)
);
if (!hasPostHook) {
  config.hooks.PostToolUse.push({
    matcher: 'Bash',
    hooks: [{ type: 'command', command: hookCommand, async: true, timeout: 3 }]
  });
  changed = true;
  result.push('hook:updated');
} else {
  result.push('hook:noop');
}

// Stop — task-completion reactions
if (!Array.isArray(config.hooks.Stop)) config.hooks.Stop = [];
const hasStopHook = config.hooks.Stop.some(entry =>
  Array.isArray(entry.hooks) &&
  entry.hooks.some(h => h.command === stopHookCommand)
);
if (!hasStopHook) {
  config.hooks.Stop.push({
    hooks: [{ type: 'command', command: stopHookCommand, async: true, timeout: 5 }]
  });
  changed = true;
  result.push('stop:updated');
} else {
  result.push('stop:noop');
}

// UserPromptSubmit — name + mood reactions
if (!Array.isArray(config.hooks.UserPromptSubmit)) config.hooks.UserPromptSubmit = [];
const hasPromptHook = config.hooks.UserPromptSubmit.some(entry =>
  Array.isArray(entry.hooks) &&
  entry.hooks.some(h => h.command === promptHookCommand)
);
if (!hasPromptHook) {
  config.hooks.UserPromptSubmit.push({
    hooks: [{ type: 'command', command: promptHookCommand, async: true, timeout: 3 }]
  });
  changed = true;
  result.push('prompt:updated');
} else {
  result.push('prompt:noop');
}

// Statusline
const needsStatusline = !config.statusLine ||
  config.statusLine.type !== 'command' ||
  config.statusLine.command !== statuslineCommand ||
  config.statusLine.refreshInterval !== 2;
if (needsStatusline) {
  config.statusLine = { type: 'command', command: statuslineCommand, padding: 1, refreshInterval: 2 };
  changed = true;
  result.push('statusline:updated');
} else {
  result.push('statusline:noop');
}

if (changed) {
  fs.writeFileSync(settingsPath, JSON.stringify(config, null, 2));
}
process.stdout.write(result.join(','));
EOJS
)
    case "$settings_result" in
      *hook:updated*) echo -e "  ${GREEN}✓${NC} PostToolUse hook configured" ;;
      *)              echo -e "  ${GREEN}✓${NC} PostToolUse hook already configured" ;;
    esac
    case "$settings_result" in
      *stop:updated*) echo -e "  ${GREEN}✓${NC} Stop hook configured" ;;
      *)              echo -e "  ${GREEN}✓${NC} Stop hook already configured" ;;
    esac
    case "$settings_result" in
      *prompt:updated*) echo -e "  ${GREEN}✓${NC} UserPromptSubmit hook configured" ;;
      *)                echo -e "  ${GREEN}✓${NC} UserPromptSubmit hook already configured" ;;
    esac
    case "$settings_result" in
      *statusline:updated*) echo -e "  ${GREEN}✓${NC} Claude Code statusline configured" ;;
      *)                    echo -e "  ${GREEN}✓${NC} Claude Code statusline already configured" ;;
    esac
  else
    echo -e "  ${YELLOW}!${NC} node not found — cannot configure hooks or statusline"
  fi
}


configure_cursor() {
  check_cursor || return 0
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
  check_copilot || return 0
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

After calling buddy_observe, relay the buddy'\''s reaction to the user. The first text content is an ASCII speech bubble — include it verbatim.
<!-- /buddy-companion -->'

inject_prompt() {
  local file="$1"
  local cli_name="$2"
  local dir
  dir="$(dirname "$file")"

  if [ -f "$file" ] && grep -q "buddy-companion" "$file" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} $cli_name prompt already has buddy instructions"
    return 0
  fi

  mkdir -p "$dir"

  # Append to existing file or create new one
  echo "" >> "$file"
  echo "$BUDDY_INSTRUCTIONS" >> "$file"
  echo -e "  ${GREEN}✓${NC} $cli_name prompt updated ${DIM}($file)${NC}"
}

echo ""
echo "  Injecting buddy instructions..."

# Claude Code
if [ "$CLAUDE_DETECTED" -eq 1 ]; then
  inject_prompt "$HOME/.claude/CLAUDE.md" "Claude Code"
fi

# Cursor
if [ "$CURSOR_DETECTED" -eq 1 ]; then
  inject_prompt "$HOME/.cursor/rules/buddy.md" "Cursor"
fi

# Codex CLI (supports AGENTS.md and instructions.md — prefer AGENTS.md)
if [ "$CODEX_CONFIGURED" -eq 1 ] || check_codex; then
  if [ -f "$HOME/.codex/AGENTS.md" ]; then
    inject_prompt "$HOME/.codex/AGENTS.md" "Codex CLI"
  else
    inject_prompt "$HOME/.codex/instructions.md" "Codex CLI"
  fi
fi

# Gemini CLI (supports GEMINI.md and AGENTS.md — use whichever exists, prefer GEMINI.md)
if [ "$GEMINI_DETECTED" -eq 1 ] || check_gemini; then
  if [ -f "$HOME/.gemini/AGENTS.md" ] && [ ! -f "$HOME/.gemini/GEMINI.md" ]; then
    inject_prompt "$HOME/.gemini/AGENTS.md" "Gemini CLI"
  else
    inject_prompt "$HOME/.gemini/GEMINI.md" "Gemini CLI"
  fi
fi

# GitHub Copilot CLI (supports AGENTS.md and copilot-instructions.md — prefer AGENTS.md)
if [ "$COPILOT_DETECTED" -eq 1 ]; then
  if [ -f "$HOME/.copilot/AGENTS.md" ]; then
    inject_prompt "$HOME/.copilot/AGENTS.md" "GitHub Copilot CLI"
  else
    inject_prompt "$HOME/.copilot/copilot-instructions.md" "GitHub Copilot CLI"
  fi
fi

# ── Run onboarding wizard ──

ONBOARD_SCRIPT="$INSTALL_DIR/dist/cli/onboard.js"
if [ -f "$ONBOARD_SCRIPT" ] && [ "$NO_ONBOARD" -eq 0 ]; then
  # Let onboard.ts detect TTY itself — don't force /dev/tty
  # (fails in headless SSH, CI, cron where no controlling terminal exists)
  node "$ONBOARD_SCRIPT" || true
elif [ "$NO_ONBOARD" -eq 1 ]; then
  echo -e "  ${DIM}Onboarding skipped (--no-onboard). Run buddy-onboard later to set up.${NC}"
fi

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
