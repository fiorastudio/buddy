# Buddy MCP Server — Windows PowerShell Installer
# Installs AND auto-configures MCP for your CLI
#
# Usage:
#   irm https://raw.githubusercontent.com/fiorastudio/buddy/master/install.ps1 | iex

$ErrorActionPreference = "Stop"
$REPO = "https://github.com/fiorastudio/buddy.git"
$INSTALL_DIR = "$env:USERPROFILE\.buddy\server"

Write-Host ""
Write-Host "  Buddy MCP Server Installer" -ForegroundColor Cyan
Write-Host "  ─────────────────────────────" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
try { $null = Get-Command node -ErrorAction Stop }
catch {
  Write-Host "  Node.js is required. Install from https://nodejs.org" -ForegroundColor Yellow
  exit 1
}

$nodeVersion = (node -v) -replace 'v(\d+)\..*', '$1'
if ([int]$nodeVersion -lt 18) {
  Write-Host "  Node.js 18+ required. You have $(node -v)." -ForegroundColor Yellow
  exit 1
}

try { $null = Get-Command git -ErrorAction Stop }
catch {
  Write-Host "  Git is required." -ForegroundColor Yellow
  exit 1
}

# Clone or update
if (Test-Path $INSTALL_DIR) {
  Write-Host "  Updating existing installation..."
  Push-Location $INSTALL_DIR
  git pull origin master --quiet
  Pop-Location
} else {
  Write-Host "  Cloning Buddy MCP Server..."
  git clone --depth 1 $REPO $INSTALL_DIR --quiet
}

Push-Location $INSTALL_DIR

Write-Host "  Installing dependencies..."
npm install --quiet 2>$null
npm rebuild --quiet 2>$null
Write-Host "  Building..."
npm run build --quiet 2>$null

# ── Add CLI binaries to PATH ──
$BIN_DIR = "$INSTALL_DIR\dist\cli"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$BIN_DIR*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$BIN_DIR", "User")
  $env:Path = "$env:Path;$BIN_DIR"
  Write-Host "  Added $BIN_DIR to user PATH"
}

$SERVER_PATH = "$INSTALL_DIR\dist\server\index.js"
$SERVER_PATH_UNIX = $SERVER_PATH -replace '\\', '/'
$STATUSLINE_PATH = "$INSTALL_DIR\dist\statusline-wrapper.js"
$STATUSLINE_PATH_UNIX = $STATUSLINE_PATH -replace '\\', '/'
$CLAUDE_CONFIGURED = $false
$CURSOR_CONFIGURED = $false
$COPILOT_CONFIGURED = $false
$CODEX_CONFIGURED = $false

Pop-Location

# ── Auto-configure MCP for detected CLIs ──

function Add-BuddyToConfig($configPath, $cliName) {
  $configDir = Split-Path $configPath -Parent
  if (!(Test-Path $configDir)) { return $false }

  $buddyConfig = @{
    type = "stdio"
    command = "node"
    args = @($SERVER_PATH_UNIX)
  }

  if (!(Test-Path $configPath)) {
    $config = @{ mcpServers = @{ buddy = $buddyConfig } }
    $config | ConvertTo-Json -Depth 5 | Set-Content $configPath -Encoding UTF8
    Write-Host "  ✓ $cliName configured ($configPath)" -ForegroundColor Green
    return $true
  }

  $content = Get-Content $configPath -Raw | ConvertFrom-Json
  if ($content.mcpServers.buddy) {
    Write-Host "  ✓ $cliName already configured" -ForegroundColor Green
    return $true
  }

  if (!$content.mcpServers) {
    $content | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue @{} -Force
  }
  $content.mcpServers | Add-Member -NotePropertyName "buddy" -NotePropertyValue $buddyConfig -Force
  $content | ConvertTo-Json -Depth 5 | Set-Content $configPath -Encoding UTF8
  Write-Host "  ✓ $cliName configured ($configPath)" -ForegroundColor Green
  return $true
}

$HOOK_PATH = "$INSTALL_DIR\dist\hooks\post-tool-handler.js"
$HOOK_PATH_UNIX = $HOOK_PATH -replace '\\', '/'
$STOP_HOOK_PATH = "$INSTALL_DIR\dist\hooks\stop-handler.js"
$STOP_HOOK_PATH_UNIX = $STOP_HOOK_PATH -replace '\\', '/'
$PROMPT_HOOK_PATH = "$INSTALL_DIR\dist\hooks\prompt-handler.js"
$PROMPT_HOOK_PATH_UNIX = $PROMPT_HOOK_PATH -replace '\\', '/'

Write-Host ""
Write-Host "  Configuring MCP clients..."

# Claude Code
$claudeDir = "$env:USERPROFILE\.claude"
if (!(Test-Path $claudeDir)) { New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null }

$claudeRegistered = $false
if (Get-Command claude -ErrorAction SilentlyContinue) {
  claude mcp get buddy 1>$null 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Claude Code MCP already registered" -ForegroundColor Green
    $claudeRegistered = $true
  } else {
    claude mcp add buddy -s user -- node "$SERVER_PATH_UNIX" 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "  ✓ Claude Code MCP registered via claude CLI" -ForegroundColor Green
      $claudeRegistered = $true
    } else {
      Write-Host "  ! claude CLI detected, but MCP registration failed — falling back to manual config" -ForegroundColor Yellow
    }
  }
}

if (-not $claudeRegistered) {
  $claudeUserFile = "$env:USERPROFILE\.claude.json"
  $userConfig = @{}
  if (Test-Path $claudeUserFile) {
    try { $userConfig = Get-Content $claudeUserFile -Raw | ConvertFrom-Json }
    catch { $userConfig = @{} }
  }
  if (!$userConfig.mcpServers) {
    $userConfig | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue @{} -Force
  }
  $userConfig.mcpServers | Add-Member -NotePropertyName "buddy" -NotePropertyValue @{
    type = "stdio"
    command = "node"
    args = @($SERVER_PATH_UNIX)
  } -Force
  $userConfig | ConvertTo-Json -Depth 8 | Set-Content $claudeUserFile -Encoding UTF8
  Write-Host "  ✓ Claude Code MCP config written ($claudeUserFile)" -ForegroundColor Green
}
$CLAUDE_CONFIGURED = $true

# Configure hooks + statusline in settings.json via node (avoids PowerShell
# ConvertFrom-Json flattening single-element arrays into bare objects).
$claudeSettings = "$claudeDir\settings.json"
if (!(Test-Path $claudeSettings)) {
  '{}' | Set-Content $claudeSettings -Encoding UTF8
}

$statuslineCommand = "node $STATUSLINE_PATH_UNIX"
$env:CLAUDE_SETTINGS = $claudeSettings
$env:HOOK_COMMAND = "node $HOOK_PATH_UNIX"
$env:STOP_HOOK_COMMAND = "node $STOP_HOOK_PATH_UNIX"
$env:PROMPT_HOOK_COMMAND = "node $PROMPT_HOOK_PATH_UNIX"
$env:STATUSLINE_COMMAND = $statuslineCommand
$env:SERVER_PATH = $SERVER_PATH_UNIX
$env:NODE_BIN = "node"
$settingsResult = node -e @'
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

// Match on script path suffix to recognise legacy "node <path>" entries from older installs.
const hookScript = hookCommand.split(/\s+/).slice(-1)[0];
const stopHookScript = stopHookCommand.split(/\s+/).slice(-1)[0];
const promptHookScript = promptHookCommand.split(/\s+/).slice(-1)[0];
const matchesHook = (cmd, current, script) => cmd === current || (cmd && cmd.endsWith(script));

// PostToolUse — error detection (Bash only)
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
const hasPromptHook = config.hooks.UserPromptSubmit.some(entry =>
  Array.isArray(entry.hooks) &&
  entry.hooks.some(h => matchesHook(h.command, promptHookCommand, promptHookScript))
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
'@ 2>$null

if ($settingsResult -match 'mcp:updated') {
  Write-Host "  ✓ MCP server registered in settings.json" -ForegroundColor Green
} else {
  Write-Host "  ✓ MCP server already in settings.json" -ForegroundColor Green
}
if ($settingsResult -match 'hook:updated') {
  Write-Host "  ✓ PostToolUse hook configured" -ForegroundColor Green
} else {
  Write-Host "  ✓ PostToolUse hook already configured" -ForegroundColor Green
}
if ($settingsResult -match 'stop:updated') {
  Write-Host "  ✓ Stop hook configured" -ForegroundColor Green
} else {
  Write-Host "  ✓ Stop hook already configured" -ForegroundColor Green
}
if ($settingsResult -match 'prompt:updated') {
  Write-Host "  ✓ UserPromptSubmit hook configured" -ForegroundColor Green
} else {
  Write-Host "  ✓ UserPromptSubmit hook already configured" -ForegroundColor Green
}
if ($settingsResult -match 'statusline:updated') {
  Write-Host "  ✓ Claude Code statusline configured" -ForegroundColor Green
} else {
  Write-Host "  ✓ Claude Code statusline already configured" -ForegroundColor Green
}

# Cursor
if (Test-Path "$env:USERPROFILE\.cursor") {
  $CURSOR_CONFIGURED = Add-BuddyToConfig "$env:USERPROFILE\.cursor\mcp.json" "Cursor"
}

$cursorHooks = "$env:USERPROFILE\.cursor\hooks.json"
if (Test-Path "$env:USERPROFILE\.cursor") {
  $env:CURSOR_HOOKS_FILE = $cursorHooks
  $env:HOOK_COMMAND = "node $HOOK_PATH_UNIX"
  $cursorResult = node -e @'
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
'@ 2>$null

  if ($cursorResult -eq 'updated') {
    Write-Host "  ✓ Cursor CLI afterShellExecution hook configured ($cursorHooks)" -ForegroundColor Green
  } else {
    Write-Host "  ✓ Cursor CLI afterShellExecution hook already configured" -ForegroundColor Green
  }
}

# GitHub Copilot CLI (only if ~/.copilot exists — don't create dir for users without Copilot)
if (Test-Path "$env:USERPROFILE\.copilot") {
  $COPILOT_CONFIGURED = Add-BuddyToConfig "$env:USERPROFILE\.copilot\mcp-config.json" "GitHub Copilot CLI"

  if ($COPILOT_CONFIGURED) {
    $copilotSettings = "$env:USERPROFILE\.copilot\settings.json"
    $env:COPILOT_SETTINGS = $copilotSettings
    $env:BASH_COMMAND = "node $HOOK_PATH_UNIX"
    $env:POWERSHELL_COMMAND = "node $HOOK_PATH_UNIX"
    $copilotResult = node -e @'
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
'@ 2>$null

    if ($copilotResult -eq 'updated') {
      Write-Host "  ✓ GitHub Copilot CLI postToolUse hook configured ($copilotSettings)" -ForegroundColor Green
    } else {
      Write-Host "  ✓ GitHub Copilot CLI postToolUse hook already configured" -ForegroundColor Green
    }
  }
}

if (Get-Command codex -ErrorAction SilentlyContinue) {
  codex mcp get buddy 1>$null 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Codex CLI already configured" -ForegroundColor Green
    $CODEX_CONFIGURED = $true
  } else {
    codex mcp add buddy -- node "$SERVER_PATH_UNIX" 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "  ✓ Codex CLI configured" -ForegroundColor Green
      $CODEX_CONFIGURED = $true
    } else {
      Write-Host "  ! Codex CLI detected, but MCP registration failed" -ForegroundColor Yellow
    }
  }

  if ($CODEX_CONFIGURED) {
    $codexHooks = "$env:USERPROFILE\.codex\hooks.json"
    $env:CODEX_HOOKS_FILE = $codexHooks
    $env:HOOK_COMMAND = "node $HOOK_PATH_UNIX"
    $codexResult = node -e @'
const fs = require('fs');
const path = require('path');
const hooksPath = process.env.CODEX_HOOKS_FILE;
const hookCommand = process.env.HOOK_COMMAND;
let config = {};
try { config = JSON.parse(fs.readFileSync(hooksPath, 'utf-8')); } catch {}
if (!config.hooks || typeof config.hooks !== 'object') config.hooks = {};
if (!Array.isArray(config.hooks.PostToolUse)) config.hooks.PostToolUse = [];
const groups = config.hooks.PostToolUse;
let group = groups.find(entry => entry?.matcher === 'Bash' && Array.isArray(entry?.hooks));
if (!group) {
  group = { matcher: 'Bash', hooks: [] };
  groups.push(group);
}
const hookScript = hookCommand.split(/\s+/).slice(-1)[0];
const matchesHook = (cmd) => cmd === hookCommand || (typeof cmd === 'string' && cmd.endsWith(hookScript));
const hasHook = group.hooks.some(h => typeof h?.command === 'string' && matchesHook(h.command));
if (!hasHook) {
  group.hooks.push({
    type: 'command',
    command: hookCommand,
    statusMessage: 'Reviewing Bash output',
  });
  fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
  fs.writeFileSync(hooksPath, JSON.stringify(config, null, 2));
  process.stdout.write('updated');
} else {
  process.stdout.write('noop');
}
'@ 2>$null

    if ($codexResult -eq 'updated') {
      Write-Host "  ✓ Codex CLI PostToolUse hook configured ($codexHooks)" -ForegroundColor Green
    } else {
      Write-Host "  ✓ Codex CLI PostToolUse hook already configured" -ForegroundColor Green
    }
  }
}

# ── Inject buddy instructions into CLI prompt files ──

$BUDDY_INSTRUCTIONS = @"
<!-- buddy-companion v3 -->
## Buddy Companion

You have a coding companion available via the buddy MCP server.

**After completing any coding task** (writing code, fixing bugs, refactoring, deploying, running tests), **automatically call ``buddy_observe``** with a 1-sentence summary of what you did. This gives your companion XP and triggers a personality-flavored reaction. Do this every time — the user expects it.

At the start of each conversation, call ``buddy_status`` to check on your buddy.

If the user addresses the buddy by name, respond briefly in character before your normal response.

After calling buddy_observe, relay the buddy's reaction to the user. The first text content is an ASCII speech bubble — include it verbatim.

When guard mode is on, also pass ``claims`` (key assertions from the turn, ≤240 chars each, with ``basis``, ``confidence``, ``speaker``, ``external_id``), ``edges`` (relationships between claims), and ``cwd`` (absolute path to the project root) to ``buddy_observe``.
<!-- /buddy-companion v3 -->
"@

function Inject-BuddyPrompt($filePath, $cliName) {
  $dir = Split-Path $filePath -Parent
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

  if ((Test-Path $filePath) -and (Select-String -Path $filePath -Pattern "buddy-companion v3" -Quiet)) {
    Write-Host "  ✓ $cliName prompt already has buddy instructions" -ForegroundColor Green
    return
  }

  # Remove older buddy-companion block (v1/v2) before appending current version
  if ((Test-Path $filePath) -and (Select-String -Path $filePath -Pattern "buddy-companion" -Quiet)) {
    $content = Get-Content $filePath -Raw
    $content = [regex]::Replace($content, '(?s)\s*<!-- buddy-companion[^>]*-->.*?<!-- /buddy-companion[^>]*-->\s*', '')
    Set-Content $filePath -Value $content.Trim() -Encoding UTF8
    Write-Host "  ✓ $cliName prompt upgraded to v3" -ForegroundColor Green
  }

  Add-Content -Path $filePath -Value "`n$BUDDY_INSTRUCTIONS" -Encoding UTF8
  Write-Host "  ✓ $cliName prompt updated ($filePath)" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Injecting buddy instructions..."

if ($CLAUDE_CONFIGURED) {
  Inject-BuddyPrompt "$env:USERPROFILE\.claude\CLAUDE.md" "Claude Code"
}
$cursorRulesDir = "$env:USERPROFILE\.cursor\rules"
if ($CURSOR_CONFIGURED) {
  if (!(Test-Path $cursorRulesDir)) { New-Item -ItemType Directory -Path $cursorRulesDir -Force | Out-Null }
  Inject-BuddyPrompt "$cursorRulesDir\buddy.md" "Cursor CLI"
}

# Codex CLI (only inject prompts after Buddy MCP is configured; prefer AGENTS.md)
if ($CODEX_CONFIGURED) {
  if (Test-Path "$env:USERPROFILE\.codex\AGENTS.md") {
    Inject-BuddyPrompt "$env:USERPROFILE\.codex\AGENTS.md" "Codex CLI"
  } else {
    Inject-BuddyPrompt "$env:USERPROFILE\.codex\instructions.md" "Codex CLI"
  }
}
# Gemini CLI (only touch existing Gemini prompt locations; Buddy does not auto-configure Gemini MCP)
if (Test-Path "$env:USERPROFILE\.gemini") {
  if (Test-Path "$env:USERPROFILE\.gemini\GEMINI.md") {
    Inject-BuddyPrompt "$env:USERPROFILE\.gemini\GEMINI.md" "Gemini CLI"
  } elseif (Test-Path "$env:USERPROFILE\.gemini\AGENTS.md") {
    Inject-BuddyPrompt "$env:USERPROFILE\.gemini\AGENTS.md" "Gemini CLI"
  } else {
    Write-Host "  ! Skipping Gemini CLI prompt injection because no existing Gemini prompt file was found" -ForegroundColor Yellow
  }
}
# GitHub Copilot CLI (supports AGENTS.md and copilot-instructions.md — prefer AGENTS.md)
if ($COPILOT_CONFIGURED) {
  if (Test-Path "$env:USERPROFILE\.copilot\AGENTS.md") {
    Inject-BuddyPrompt "$env:USERPROFILE\.copilot\AGENTS.md" "GitHub Copilot CLI"
  } else {
    Inject-BuddyPrompt "$env:USERPROFILE\.copilot\copilot-instructions.md" "GitHub Copilot CLI"
  }
}

# ── Run onboarding wizard ──

$ONBOARD_SCRIPT = "$INSTALL_DIR\dist\cli\onboard.js"
if (Test-Path $ONBOARD_SCRIPT) {
  try {
    node $ONBOARD_SCRIPT
  } catch {
    # Non-fatal — wizard is optional
  }
}

Write-Host ""
if ($CLAUDE_CONFIGURED -or $CURSOR_CONFIGURED -or $COPILOT_CONFIGURED -or $CODEX_CONFIGURED) {
  Write-Host "  ✅ Buddy installed!" -ForegroundColor Green
  Write-Host "  Next: in your client, open the AI chat and ask the assistant to hatch your first buddy. That is a message to the model, not a command in this terminal." -ForegroundColor DarkGray
} elseif (Get-Command codex -ErrorAction SilentlyContinue) {
  Write-Host "  ⚠ Buddy installed, but no supported host was fully configured." -ForegroundColor Yellow
  Write-Host "  ! Codex CLI is installed, but MCP registration still needs attention." -ForegroundColor Yellow
} else {
  Write-Host "  ⚠ Buddy installed, but no supported host was fully configured." -ForegroundColor Yellow
  Write-Host "  ! Open a supported CLI and rerun the installer to wire Buddy in automatically." -ForegroundColor Yellow
}
if ((-not $CODEX_CONFIGURED) -and (Get-Command codex -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "  ! Codex CLI prompt injection was skipped because Buddy MCP is not configured there yet." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  💛 If you like it, star the repo:"
Write-Host "  github.com/fiorastudio/buddy"
Write-Host ""
