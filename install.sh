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
  echo -e "  ${YELLOW}Node.js is required but not found.${NC}"
  # Default to "n" (safe for CI/non-interactive). Try /dev/tty for interactive shells.
  REPLY="n"
  if printf "  Install it automatically? [Y/n]: " >/dev/tty 2>/dev/null && read -r REPLY </dev/tty 2>/dev/null; then
    :
  fi
  if [[ "$REPLY" =~ ^[Nn] ]]; then
    echo -e "  Install Node.js from https://nodejs.org then re-run."
    exit 1
  fi
  echo -e "  Installing Node.js..."
  set +e  # allow install attempts to fail without aborting the script
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
    nvm install --lts --silent
  elif command -v brew &>/dev/null; then
    brew install node --quiet
  elif command -v apt-get &>/dev/null; then
    sudo apt-get install -y nodejs npm >/dev/null 2>&1
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y nodejs >/dev/null 2>&1
  else
    echo -e "  Installing nvm..."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    # shellcheck source=/dev/null
    [ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh"
    command -v nvm &>/dev/null && nvm install --lts --silent
  fi
  set -e
  if ! command -v node &>/dev/null; then
    echo -e "${YELLOW}  Could not install Node.js. Please install from https://nodejs.org${NC}"
    exit 1
  fi
  echo -e "${GREEN}  ✓ Node.js installed${NC}"
fi

NODE_BIN="$(command -v node)"

# Prefer system node over app-bundled node (e.g. /Applications/Codex.app/Contents/Resources/node).
# App-bundled node has macOS code signing restrictions that reject .node native addons
# compiled/downloaded outside the app bundle (different Team IDs).
if [[ "$NODE_BIN" == /Applications/*.app/* ]]; then
  FOUND_SYSTEM_NODE=0
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$candidate" ]; then
      echo -e "  ${DIM}Preferring system node ($candidate) over app-bundled ($NODE_BIN)${NC}"
      NODE_BIN="$candidate"
      FOUND_SYSTEM_NODE=1
      break
    fi
  done
  if [ "$FOUND_SYSTEM_NODE" -eq 0 ]; then
    echo -e "  ${YELLOW}Warning: only app-bundled node found ($NODE_BIN). Native addons may fail due to code signing restrictions.${NC}"
    echo -e "  ${YELLOW}Install Node.js via Homebrew (brew install node) or from https://nodejs.org for best results.${NC}"
  fi
fi

NODE_VERSION=$("$NODE_BIN" -v | cut -d'v' -f2 | cut -d'.' -f1)
# Always pin the absolute Node path in generated configs so GUI-launched clients
# (e.g. Claude desktop on macOS) find the correct binary regardless of shell init.
# nvm/asdf/fnm users: re-run the installer after upgrading Node.
CONFIG_NODE_BIN="$NODE_BIN"
# Prepend pinned node's directory to PATH so bare `npm` and npm's internal
# node shebang both resolve to the same runtime as $NODE_BIN.
export PATH="$(dirname "$NODE_BIN"):$PATH"
if [ "$NODE_VERSION" -lt 20 ]; then
  echo -e "${YELLOW}Node.js 20+ required (better-sqlite3 dropped Node 18/19 support). You have $("$NODE_BIN" -v). Please upgrade.${NC}"
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

# Verify native module ABI matches current node. A stale binary from a prior
# install with a different node version will crash at runtime. Rebuild if
# needed, then re-verify — a silent half-broken install is worse than failing.
if ! "$NODE_BIN" -e "require('better-sqlite3')" 2>/dev/null; then
  echo "  Rebuilding native module for $("$NODE_BIN" -v)..."
  npm rebuild better-sqlite3
  if ! "$NODE_BIN" -e "require('better-sqlite3')" 2>/dev/null; then
    echo ""
    echo -e "${YELLOW}  ✗ better-sqlite3 does not load under node $("$NODE_BIN" -v) ($NODE_BIN) and the rebuild failed.${NC}"
    echo -e "${YELLOW}    If you use nvm, switch to the node version Buddy should run under (nvm use <version>),${NC}"
    echo -e "${YELLOW}    then re-run this installer. See the rebuild output above for details.${NC}"
    exit 1
  fi
fi

echo "  Building..."
npm run build --quiet 2>/dev/null

# ── Symlink CLI binaries onto PATH ──
for bin_entry in buddy:buddy.js buddy-doctor:doctor-cli.js buddy-world:world-cli.js; do
  bin_name="${bin_entry%%:*}"
  bin_file="$INSTALL_DIR/dist/cli/${bin_entry##*:}"
  if [ -f "$bin_file" ]; then
    chmod +x "$bin_file"
    ln -sf "$bin_file" "/usr/local/bin/$bin_name" 2>/dev/null \
      || sudo ln -sf "$bin_file" "/usr/local/bin/$bin_name" 2>/dev/null \
      || echo -e "  ${YELLOW}Could not symlink $bin_name to /usr/local/bin — add $INSTALL_DIR/dist/cli to your PATH${NC}"
  fi
done

SERVER_PATH="$INSTALL_DIR/dist/server/index.js"
CODEX_CONFIGURED=0
HOOK_PATH="$INSTALL_DIR/dist/hooks/post-tool-handler.js"
HOOK_COMMAND=$(printf '%q %q' "$CONFIG_NODE_BIN" "$HOOK_PATH")
PROMPT_HOOK_PATH="$INSTALL_DIR/dist/hooks/prompt-handler.js"
PROMPT_HOOK_COMMAND=$(printf '%q %q' "$CONFIG_NODE_BIN" "$PROMPT_HOOK_PATH")
CLAUDE_CONFIGURED=0
CURSOR_CONFIGURED=0
COPILOT_CONFIGURED=0

# ── Auto-configure MCP for detected CLIs ──

configure_claude_code() {
  local config_dir="$HOME/.claude"
  local settings_file="$config_dir/settings.json"
  local user_file="$HOME/.claude.json"
  local stop_hook_path="$INSTALL_DIR/dist/hooks/stop-handler.js"
  local stop_hook_command
  local prompt_hook_command="$PROMPT_HOOK_COMMAND"
  local statusline_command
  local commands_dir="$config_dir/commands"
  local buddy_graph_command="$commands_dir/buddy-graph.md"
  stop_hook_command=$(printf '%q %q' "$CONFIG_NODE_BIN" "$stop_hook_path")
  statusline_command=$(printf '%q %q' "$CONFIG_NODE_BIN" "$INSTALL_DIR/dist/statusline-wrapper.js")

  mkdir -p "$config_dir" "$commands_dir"

  cat > "$buddy_graph_command" <<EOF
---
description: Generate and open an interactive visualization of Buddy guard-mode reasoning data using the Buddy CLI.
---

Run the Buddy graph CLI to visualize the reasoning graph.

If \`$ARGUMENTS\` is present, treat it as optional CLI arguments such as a session ID or \`--out\` path.

\`\`\`bash
set -euo pipefail

args=()
if [ -n "${ARGUMENTS:-}" ]; then
  read -r -a args <<< "$ARGUMENTS"
fi

if command -v buddy >/dev/null 2>&1; then
  buddy graph "${args[@]}" --open
else
  "$CONFIG_NODE_BIN" "$INSTALL_DIR/dist/cli/buddy.js" graph "${args[@]}" --open
fi
\`\`\`

Execute the bash block above, then report the saved graph path and basic graph counts back to the user.
EOF
  echo -e "  ${GREEN}✓${NC} Claude Code global /buddy-graph command installed ${DIM}($buddy_graph_command)${NC}"

  local buddy_world_command="$commands_dir/buddy-world.md"
  cat > "$buddy_world_command" <<EOF
---
description: Teleport your buddy into Buddy World — a shared plaza where buddies wander and celebrate your commits, deploys, and level-ups.
---

Run the Buddy World CLI.

If \`\$ARGUMENTS\` is present pass it through. Subcommands: \`teleport [--avatar chibi-1..8]\`, \`status\`, \`anon on|off\`, \`recall [--purge]\`. With no arguments: run \`status\` first; if the buddy is not in the world yet, run \`teleport\`.

\`\`\`bash
set -euo pipefail

args=()
if [ -n "\${ARGUMENTS:-}" ]; then
  read -r -a args <<< "\$ARGUMENTS"
fi

if command -v buddy-world >/dev/null 2>&1; then
  buddy-world "\${args[@]}"
else
  "$CONFIG_NODE_BIN" "$INSTALL_DIR/dist/cli/world-cli.js" "\${args[@]}"
fi
\`\`\`

Execute the bash block above. After a successful teleport, open the printed world URL in the browser and relay it to the user with a short celebratory note.
EOF
  echo -e "  ${GREEN}✓${NC} Claude Code global /buddy-world command installed ${DIM}($buddy_world_command)${NC}"

  local registered=0
  if command -v claude &> /dev/null; then
    if claude mcp get buddy >/dev/null 2>&1; then
      echo -e "  ${GREEN}✓${NC} Claude Code MCP already registered"
      registered=1
    else
      if claude mcp add buddy -s user -- "$CONFIG_NODE_BIN" "$SERVER_PATH" >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Claude Code MCP registered via claude CLI"
        registered=1
      else
        echo -e "  ${YELLOW}!${NC} claude CLI detected, but MCP registration failed — falling back to manual config"
      fi
    fi
  fi

  if [ "$registered" -ne 1 ]; then
    if CLAUDE_USER_FILE="$user_file" SERVER_PATH="$SERVER_PATH" NODE_BIN="$CONFIG_NODE_BIN" "$NODE_BIN" <<'EOJS' 2>/dev/null; then
const fs = require('fs');
const path = process.env.CLAUDE_USER_FILE;
const serverPath = process.env.SERVER_PATH;
const nodeBin = process.env.NODE_BIN;
let data = {};
try { data = JSON.parse(fs.readFileSync(path, 'utf-8')); } catch {}
if (!data.mcpServers) data.mcpServers = {};
data.mcpServers.buddy = {
  type: 'stdio',
  command: nodeBin,
  args: [serverPath]
};
fs.writeFileSync(path, JSON.stringify(data, null, 2));
EOJS
      echo -e "  ${GREEN}✓${NC} Claude Code MCP config written ${DIM}($user_file)${NC}"
    else
      echo -e "  ${YELLOW}!${NC} Could not write MCP config to $user_file"
    fi
  fi

  # Configure hook + statusline in a single settings.json write
  local settings_result
  settings_result=$(CLAUDE_SETTINGS="$settings_file" HOOK_COMMAND="$HOOK_COMMAND" STOP_HOOK_COMMAND="$stop_hook_command" PROMPT_HOOK_COMMAND="$prompt_hook_command" STATUSLINE_COMMAND="$statusline_command" SERVER_PATH="$SERVER_PATH" NODE_BIN="$CONFIG_NODE_BIN" "$NODE_BIN" <<'EOJS'
const fs = require('fs');
const settingsPath = process.env.CLAUDE_SETTINGS;
const hookCommand = process.env.HOOK_COMMAND;
const stopHookCommand = process.env.STOP_HOOK_COMMAND;
const promptHookCommand = process.env.PROMPT_HOOK_COMMAND;
const statuslineCommand = process.env.STATUSLINE_COMMAND;
const serverPath = process.env.SERVER_PATH;
const nodeBin = process.env.NODE_BIN;
let config = {};
try { config = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
let changed = false;
const result = [];

// MCP server registration
if (!config.mcpServers) config.mcpServers = {};
const existing = config.mcpServers.buddy;
if (!existing || existing.command !== nodeBin || !Array.isArray(existing.args) || existing.args[0] !== serverPath) {
  config.mcpServers.buddy = { type: 'stdio', command: nodeBin, args: [serverPath] };
  changed = true;
  result.push('mcp:updated');
} else {
  result.push('mcp:noop');
}

if (!config.hooks) config.hooks = {};

// PostToolUse — error detection (Bash only)
// Match on script path suffix to also recognise legacy "node <path>" entries from older installs.
const hookScript = hookCommand.split(/\s+/).slice(-1)[0];
const stopHookScript = stopHookCommand.split(/\s+/).slice(-1)[0];
const promptHookScript = promptHookCommand.split(/\s+/).slice(-1)[0];
const statuslineScript = statuslineCommand.split(/\s+/).slice(-1)[0];
const matchesHook = (cmd, current, script) => cmd === current || (cmd && cmd.endsWith(script));
if (!Array.isArray(config.hooks.PostToolUse)) config.hooks.PostToolUse = [];
const hasPostHook = config.hooks.PostToolUse.some(entry =>
  entry.matcher === 'Bash' &&
  Array.isArray(entry.hooks) &&
  entry.hooks.some(h => matchesHook(h.command, hookCommand, hookScript))
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
  entry.hooks.some(h => matchesHook(h.command, stopHookCommand, stopHookScript))
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
// The prompt hook injects guard-mode context via stdout, which Claude Code
// only captures from SYNCHRONOUS hooks (async hooks are fire-and-forget) — so
// it must NOT be async. Upgrade any pre-existing async registration in place.
const PROMPT_SYNC_TIMEOUT = 10;
let promptHookFixed = false;
const hasPromptHook = config.hooks.UserPromptSubmit.some(entry =>
  Array.isArray(entry.hooks) &&
  entry.hooks.some(h => matchesHook(h.command, promptHookCommand, promptHookScript))
);
for (const entry of config.hooks.UserPromptSubmit) {
  if (!Array.isArray(entry.hooks)) continue;
  for (const h of entry.hooks) {
    if (!matchesHook(h.command, promptHookCommand, promptHookScript)) continue;
    if (h.async) { delete h.async; promptHookFixed = true; }
    if ((h.timeout || 0) < PROMPT_SYNC_TIMEOUT) { h.timeout = PROMPT_SYNC_TIMEOUT; promptHookFixed = true; }
  }
}
if (!hasPromptHook) {
  config.hooks.UserPromptSubmit.push({
    hooks: [{ type: 'command', command: promptHookCommand, timeout: PROMPT_SYNC_TIMEOUT }]
  });
  changed = true;
  result.push('prompt:updated');
} else if (promptHookFixed) {
  changed = true;
  result.push('prompt:updated');
} else {
  result.push('prompt:noop');
}

// Statusline
const needsStatusline = !config.statusLine ||
  config.statusLine.type !== 'command' ||
  !matchesHook(config.statusLine.command, statuslineCommand, statuslineScript) ||
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
    *mcp:updated*) echo -e "  ${GREEN}✓${NC} MCP server registered in settings.json" ;;
    *)             echo -e "  ${GREEN}✓${NC} MCP server already in settings.json" ;;
  esac
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

  CLAUDE_CONFIGURED=1
}

configure_cursor_hooks() {
  local config_file="$HOME/.cursor/hooks.json"

  if [ ! -d "$HOME/.cursor" ]; then
    return 0
  fi

  local result
  result=$(CURSOR_HOOKS_FILE="$config_file" HOOK_COMMAND="$HOOK_COMMAND" "$NODE_BIN" <<'EOJS'
const fs = require('fs');
const path = process.env.CURSOR_HOOKS_FILE;
const hookCommand = process.env.HOOK_COMMAND;
let config = {};
try { config = JSON.parse(fs.readFileSync(path, 'utf-8')); } catch {}
if (!config.version) config.version = 1;
if (!config.hooks || typeof config.hooks !== 'object') config.hooks = {};
if (!Array.isArray(config.hooks.afterShellExecution)) config.hooks.afterShellExecution = [];
const hooks = config.hooks.afterShellExecution;
const hookScript = hookCommand.split(/\s+/).slice(-1)[0];
const matchesHook = (cmd) => cmd === hookCommand || (typeof cmd === 'string' && cmd.endsWith(hookScript));
const hasHook = hooks.some(h => typeof h?.command === 'string' && matchesHook(h.command));
if (!hasHook) {
  hooks.push({ command: hookCommand });
  fs.mkdirSync(require('path').dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(config, null, 2));
  process.stdout.write('updated');
} else {
  process.stdout.write('noop');
}
EOJS
)

  case "$result" in
    updated) echo -e "  ${GREEN}✓${NC} Cursor CLI afterShellExecution hook configured ${DIM}($config_file)${NC}" ;;
    *)       echo -e "  ${GREEN}✓${NC} Cursor CLI afterShellExecution hook already configured" ;;
  esac
}

configure_copilot_hooks() {
  local settings_file="$HOME/.copilot/settings.json"

  if [ ! -d "$HOME/.copilot" ]; then
    return 0
  fi

  local result
  result=$(COPILOT_SETTINGS="$settings_file" BASH_COMMAND="$HOOK_COMMAND" POWERSHELL_COMMAND="$HOOK_COMMAND" "$NODE_BIN" <<'EOJS'
const fs = require('fs');
const path = require('path');
const settingsPath = process.env.COPILOT_SETTINGS;
const bashCommand = process.env.BASH_COMMAND;
const powershellCommand = process.env.POWERSHELL_COMMAND;
let config = {};
try { config = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
if (!config.hooks || typeof config.hooks !== 'object') config.hooks = {};
if (!Array.isArray(config.hooks.postToolUse)) config.hooks.postToolUse = [];
const hooks = config.hooks.postToolUse;
const hookScript = bashCommand.split(/\s+/).slice(-1)[0];
const matchesHook = (cmd) => cmd === bashCommand || (typeof cmd === 'string' && cmd.endsWith(hookScript));
const hasHook = hooks.some(h => matchesHook(h?.bash) || matchesHook(h?.powershell));
if (!hasHook) {
  hooks.push({
    type: 'command',
    bash: bashCommand,
    powershell: powershellCommand,
    timeoutSec: 3,
  });
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(config, null, 2));
  process.stdout.write('updated');
} else {
  process.stdout.write('noop');
}
EOJS
)

  case "$result" in
    updated) echo -e "  ${GREEN}✓${NC} GitHub Copilot CLI postToolUse hook configured ${DIM}($settings_file)${NC}" ;;
    *)       echo -e "  ${GREEN}✓${NC} GitHub Copilot CLI postToolUse hook already configured" ;;
  esac
}


configure_cursor() {
  local config_file="$HOME/.cursor/mcp.json"

  if [ -d "$HOME/.cursor" ]; then
    if [ ! -f "$config_file" ]; then
      cat > "$config_file" << EOJSON
{
  "mcpServers": {
    "buddy": {
      "command": "$CONFIG_NODE_BIN",
      "args": ["$SERVER_PATH"]
    }
  }
}
EOJSON
    else
      if ! CURSOR_MCP_CONFIG="$config_file" NODE_BIN="$CONFIG_NODE_BIN" SERVER_PATH="$SERVER_PATH" "$NODE_BIN" <<'EOJS' 2>/dev/null
const fs = require('fs');
const configPath = process.env.CURSOR_MCP_CONFIG;
const nodeBin = process.env.NODE_BIN;
const serverPath = process.env.SERVER_PATH;
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
if (!config.mcpServers) config.mcpServers = {};
config.mcpServers.buddy = { command: nodeBin, args: [serverPath] };
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
EOJS
      then
        echo -e "  ${YELLOW}!${NC} Cursor: could not update existing MCP config ${DIM}($config_file)${NC}"
        return 1
      fi
    fi
    echo -e "  ${GREEN}✓${NC} Cursor configured ${DIM}($config_file)${NC}"
    CURSOR_CONFIGURED=1
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
      "command": "$CONFIG_NODE_BIN",
      "args": ["$SERVER_PATH"]
    }
  }
}
EOJSON
    else
      if ! COPILOT_MCP_CONFIG="$config_file" NODE_BIN="$CONFIG_NODE_BIN" SERVER_PATH="$SERVER_PATH" "$NODE_BIN" <<'EOJS' 2>/dev/null
const fs = require('fs');
const configPath = process.env.COPILOT_MCP_CONFIG;
const nodeBin = process.env.NODE_BIN;
const serverPath = process.env.SERVER_PATH;
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
if (!config.mcpServers) config.mcpServers = {};
config.mcpServers.buddy = { command: nodeBin, args: [serverPath] };
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
EOJS
      then
        echo -e "  ${YELLOW}!${NC} GitHub Copilot CLI: could not update existing MCP config ${DIM}($config_file)${NC}"
        return 1
      fi
    fi
    echo -e "  ${GREEN}✓${NC} GitHub Copilot CLI configured ${DIM}($config_file)${NC}"
    COPILOT_CONFIGURED=1
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

  if codex mcp add buddy -- "$CONFIG_NODE_BIN" "$SERVER_PATH" >/dev/null 2>&1; then
    CODEX_CONFIGURED=1
    echo -e "  ${GREEN}✓${NC} Codex CLI configured"
    return 0
  fi

  echo -e "  ${YELLOW}!${NC} Codex CLI detected, but MCP registration failed"
  return 1
}

configure_codex_hooks() {
  local config_file="$HOME/.codex/hooks.json"

  if [ "$CODEX_CONFIGURED" -ne 1 ]; then
    return 0
  fi

  local result
  result=$(CODEX_HOOKS_FILE="$config_file" HOOK_COMMAND="$HOOK_COMMAND" PROMPT_HOOK_COMMAND="$PROMPT_HOOK_COMMAND" "$NODE_BIN" <<'EOJS'
const fs = require('fs');
const path = require('path');
const hooksPath = process.env.CODEX_HOOKS_FILE;
const hookCommand = process.env.HOOK_COMMAND;
const promptHookCommand = process.env.PROMPT_HOOK_COMMAND;
let config = {};
try { config = JSON.parse(fs.readFileSync(hooksPath, 'utf-8')); } catch {}
if (!config.hooks || typeof config.hooks !== 'object') config.hooks = {};
let changed = false;

// PostToolUse:Bash — review Bash output (existing behaviour).
if (!Array.isArray(config.hooks.PostToolUse)) config.hooks.PostToolUse = [];
const postGroups = config.hooks.PostToolUse;
let bashGroup = postGroups.find(entry => entry?.matcher === 'Bash' && Array.isArray(entry?.hooks));
if (!bashGroup) {
  bashGroup = { matcher: 'Bash', hooks: [] };
  postGroups.push(bashGroup);
}
const postScript = hookCommand.split(/\s+/).slice(-1)[0];
const postMatches = (cmd) => cmd === hookCommand || (typeof cmd === 'string' && cmd.endsWith(postScript));
if (!bashGroup.hooks.some(h => typeof h?.command === 'string' && postMatches(h.command))) {
  bashGroup.hooks.push({ type: 'command', command: hookCommand, statusMessage: 'Reviewing Bash output' });
  changed = true;
}

// UserPromptSubmit — re-inject the extraction instruction when the graph lapses.
// Codex routes this hook's stdout into model context just like Claude Code, so
// the same compiled prompt-handler keeps guard mode alive across both hosts.
// No matcher (Codex does not match UserPromptSubmit); synchronous so stdout is read.
if (!Array.isArray(config.hooks.UserPromptSubmit)) config.hooks.UserPromptSubmit = [];
const promptGroups = config.hooks.UserPromptSubmit;
let promptGroup = promptGroups.find(entry => Array.isArray(entry?.hooks) && entry?.matcher === undefined);
if (!promptGroup) {
  promptGroup = { hooks: [] };
  promptGroups.push(promptGroup);
}
const promptScript = promptHookCommand.split(/\s+/).slice(-1)[0];
const promptMatches = (cmd) => cmd === promptHookCommand || (typeof cmd === 'string' && cmd.endsWith(promptScript));
if (!promptGroup.hooks.some(h => typeof h?.command === 'string' && promptMatches(h.command))) {
  promptGroup.hooks.push({ type: 'command', command: promptHookCommand, timeout: 10 });
  changed = true;
}

if (changed) {
  fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
  fs.writeFileSync(hooksPath, JSON.stringify(config, null, 2));
  process.stdout.write('updated');
} else {
  process.stdout.write('noop');
}
EOJS
)

  case "$result" in
    updated) echo -e "  ${GREEN}✓${NC} Codex CLI hooks configured ${DIM}($config_file)${NC}" ;;
    *)       echo -e "  ${GREEN}✓${NC} Codex CLI hooks already configured" ;;
  esac
}

echo ""
echo "  Configuring MCP clients..."
configure_claude_code
configure_cursor
configure_copilot
configure_codex
configure_cursor_hooks
configure_copilot_hooks
configure_codex_hooks

# ── Inject buddy instructions into CLI prompt files ──

BUDDY_INSTRUCTIONS='<!-- buddy-companion v3 -->
## Buddy Companion

You have a coding companion available via the buddy MCP server.

**After completing any coding task** (writing code, fixing bugs, refactoring, deploying, running tests), **automatically call `buddy_observe`** with a 1-sentence summary of what you did. This gives your companion XP and triggers a personality-flavored reaction. Do this every time — the user expects it.

At the start of each conversation, call `buddy_status` to check on your buddy.

If the user addresses the buddy by name, respond briefly in character before your normal response.

After calling buddy_observe, relay the buddy'\''s reaction to the user. The first text content is an ASCII speech bubble — include it verbatim.

When guard mode is on, also pass `claims` (key assertions from the turn, ≤240 chars each, with `basis`, `confidence`, `speaker`, `external_id`), `edges` (relationships between claims), and `cwd` (absolute path to the project root) to `buddy_observe`.
<!-- /buddy-companion v3 -->'

inject_prompt() {
  local file="$1"
  local cli_name="$2"
  local dir
  dir="$(dirname "$file")"

  mkdir -p "$dir"

  if [ -f "$file" ] && grep -q "buddy-companion v3" "$file" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} $cli_name prompt already has buddy instructions"
    return 0
  fi

  # Remove older buddy-companion block (v1/v2) before appending current version
  if [ -f "$file" ] && grep -q "buddy-companion" "$file" 2>/dev/null; then
    local tmp="${file}.tmp.$$"
    sed '/<!-- buddy-companion/,/<!-- \/buddy-companion/d' "$file" > "$tmp" && mv "$tmp" "$file"
    echo -e "  ${GREEN}✓${NC} $cli_name prompt upgraded to v3"
  fi

  # Append to existing file or create new one
  echo "" >> "$file"
  echo "$BUDDY_INSTRUCTIONS" >> "$file"
  echo -e "  ${GREEN}✓${NC} $cli_name prompt updated ${DIM}($file)${NC}"
}

echo ""
echo "  Injecting buddy instructions..."

if [ "$CLAUDE_CONFIGURED" -eq 1 ]; then
  inject_prompt "$HOME/.claude/CLAUDE.md" "Claude Code"
fi

if [ "$CURSOR_CONFIGURED" -eq 1 ]; then
  mkdir -p "$HOME/.cursor/rules" 2>/dev/null
  inject_prompt "$HOME/.cursor/rules/buddy.md" "Cursor CLI"
fi

# Codex CLI (only inject prompts after Buddy MCP is configured; prefer AGENTS.md)
if [ "$CODEX_CONFIGURED" -eq 1 ]; then
  if [ -f "$HOME/.codex/AGENTS.md" ]; then
    inject_prompt "$HOME/.codex/AGENTS.md" "Codex CLI"
  else
    inject_prompt "$HOME/.codex/instructions.md" "Codex CLI"
  fi
else
  echo -e "  ${YELLOW}!${NC} Skipping Codex CLI prompt injection because Buddy MCP is not configured"
fi

# Gemini CLI (only touch existing Gemini prompt locations; Buddy does not auto-configure Gemini MCP)
if [ -d "$HOME/.gemini" ]; then
  if [ -f "$HOME/.gemini/GEMINI.md" ]; then
    inject_prompt "$HOME/.gemini/GEMINI.md" "Gemini CLI"
  elif [ -f "$HOME/.gemini/AGENTS.md" ]; then
    inject_prompt "$HOME/.gemini/AGENTS.md" "Gemini CLI"
  else
    echo -e "  ${YELLOW}!${NC} Skipping Gemini CLI prompt injection because no existing Gemini prompt file was found"
  fi
fi

# GitHub Copilot CLI (supports AGENTS.md and copilot-instructions.md — prefer AGENTS.md)
if [ "$COPILOT_CONFIGURED" -eq 1 ]; then
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
  "$NODE_BIN" "$ONBOARD_SCRIPT" || true
elif [ "$NO_ONBOARD" -eq 1 ]; then
  echo -e "  ${DIM}Onboarding skipped (--no-onboard). Run buddy-onboard later to set up.${NC}"
fi

echo ""
if [ "$CLAUDE_CONFIGURED" -eq 1 ] || [ "$CURSOR_CONFIGURED" -eq 1 ] || [ "$COPILOT_CONFIGURED" -eq 1 ] || [ "$CODEX_CONFIGURED" -eq 1 ]; then
  echo -e "${GREEN}  ✅ Buddy installed!${NC}"
  echo -e "  ${DIM}Next: in your client, open the AI chat and ask the assistant to hatch your first buddy. That is a message to the model, not a command in this terminal.${NC}"
elif command -v codex &> /dev/null; then
  echo -e "${YELLOW}  ⚠ Buddy installed, but no supported host was fully configured.${NC}"
  echo -e "  ${YELLOW}!${NC} Codex CLI is installed, but MCP registration still needs attention."
else
  echo -e "${YELLOW}  ⚠ Buddy installed, but no supported host was fully configured.${NC}"
  echo -e "  ${YELLOW}!${NC} Open a supported CLI and rerun the installer to wire Buddy in automatically."
fi
if [ "$CODEX_CONFIGURED" -ne 1 ] && command -v codex &> /dev/null; then
  echo ""
  echo -e "  ${YELLOW}!${NC} Codex CLI prompt injection was skipped because Buddy MCP is not configured there yet."
fi
echo ""
echo -e "${BLUE}  💬 Join the Buddy Community!${NC}"
echo -e "  Connect with other buddy rescuers, share your companion's evolution, and get help on Slack:"
echo -e "  ${DIM}👉 https://join.slack.com/t/buddy-mcp/shared_invite/zt-3xn6v1qza-R~fgkVCov9sCLZDXh9wErQ${NC}"
echo ""
echo -e "  💛 If you like it, star the repo:"
echo "  github.com/fiorastudio/buddy"
echo ""
