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

$NODE_BIN = (Get-Command node).Source

# Resolve symlinks/junctions to the real versioned node binary. nvm-windows
# exposes node at C:\Program Files\nodejs (a junction it repoints on every
# `nvm use`), so pinning that path silently swaps the runtime later and
# crashes better-sqlite3 with an ABI mismatch. Pin the resolved target instead.
# Only follow reparse points that actually redirect (SymbolicLink/Junction).
# HardLink Targets are alternate names for the same file and must not be
# followed — Target[0] could pin an arbitrary alias. Loop to unwind chained
# links (nvm shim -> junction -> version dir), bounded to avoid cycles.
# 'SymLink' included defensively: LinkType string varies across PS builds.
$REDIRECT_LINK_TYPES = @('SymbolicLink', 'SymLink', 'Junction')
try {
  $resolvedAny = $false
  for ($hop = 0; $hop -lt 4; $hop++) {
    $changed = $false

    $nodeItem = Get-Item $NODE_BIN -ErrorAction Stop
    if ($REDIRECT_LINK_TYPES -contains $nodeItem.LinkType -and $nodeItem.Target) {
      $resolvedFile = @($nodeItem.Target)[0]
      if (Test-Path $resolvedFile) { $NODE_BIN = $resolvedFile; $changed = $true }
    }

    $nodeDirItem = Get-Item (Split-Path $NODE_BIN) -ErrorAction Stop
    if ($REDIRECT_LINK_TYPES -contains $nodeDirItem.LinkType -and $nodeDirItem.Target) {
      $resolvedDir = @($nodeDirItem.Target)[0]
      $resolvedNode = Join-Path $resolvedDir (Split-Path $NODE_BIN -Leaf)
      if (Test-Path $resolvedNode) { $NODE_BIN = $resolvedNode; $changed = $true }
    }

    if ($changed) { $resolvedAny = $true } else { break }
  }
  if ($resolvedAny) {
    Write-Host "  Pinning node to resolved path: $NODE_BIN" -ForegroundColor DarkGray
    # Verify the hop limit actually finished the job — check both the
    # file and its parent directory (a remaining dir junction is also unresolved).
    $finalItem = Get-Item $NODE_BIN -ErrorAction Stop
    $finalDirItem = Get-Item (Split-Path $NODE_BIN) -ErrorAction Stop
    if (($REDIRECT_LINK_TYPES -contains $finalItem.LinkType) -or ($REDIRECT_LINK_TYPES -contains $finalDirItem.LinkType)) {
      Write-Host "  ! node path is still a link after 4 hops; pinning it as-is." -ForegroundColor Yellow
      Write-Host "    Re-run this installer if node version switches cause crashes." -ForegroundColor Yellow
    }
  }
} catch {
  Write-Host "  ! Could not resolve node's link target; pinning $NODE_BIN as-is." -ForegroundColor Yellow
  Write-Host "    If you use nvm-windows, re-run this installer after 'nvm use' changes." -ForegroundColor Yellow
}

$nodeVersion = (& $NODE_BIN -v) -replace 'v(\d+)\..*', '$1'
if ([int]$nodeVersion -lt 20) {
  Write-Host "  Node.js 20+ required (better-sqlite3 dropped Node 18/19 support). You have $(& $NODE_BIN -v)." -ForegroundColor Yellow
  exit 1
}

# Prepend pinned node's directory to PATH so bare npm resolves to the same runtime
$env:Path = (Split-Path $NODE_BIN) + ";" + $env:Path

try { $null = Get-Command git -ErrorAction Stop }
catch {
  Write-Host "  Git is required." -ForegroundColor Yellow
  exit 1
}

# Clone or update. A prior install may have left a NON-git directory here
# (e.g. an npm-package install): 'git pull' fails there and we would silently
# build stale code. Detect that (and a failed pull) and re-clone. Safe to wipe:
# the companion DB (~/.buddy/buddy.db) and world.json live in the PARENT dir,
# not inside ~/.buddy/server.
$needClone = $true
if (Test-Path "$INSTALL_DIR\.git") {
  Write-Host "  Updating existing installation..."
  Push-Location "$INSTALL_DIR"
  try { git pull origin master --quiet; $pullOk = ($LASTEXITCODE -eq 0) }
  catch { $pullOk = $false }
  Pop-Location
  if ($pullOk) { $needClone = $false }
  else { Write-Host "  Update failed; re-cloning fresh..." -ForegroundColor Yellow }
} elseif (Test-Path "$INSTALL_DIR") {
  Write-Host "  Replacing a non-git install with a fresh clone..." -ForegroundColor Yellow
}
if ($needClone) {
  if (Test-Path "$INSTALL_DIR") { Remove-Item -Recurse -Force "$INSTALL_DIR" }
  Write-Host "  Cloning Buddy MCP Server..."
  git clone --depth 1 $REPO "$INSTALL_DIR" --quiet
}

Push-Location "$INSTALL_DIR"

Write-Host "  Installing dependencies..."
npm install --quiet 2>$null

# Verify native module ABI matches current node. A stale binary from a prior
# install with a different node version will crash at runtime.
# Probe via a stdout marker instead of $LASTEXITCODE: with EAP=Stop, PS 5.1
# throws NativeCommandError on redirected native stderr and can leave
# $LASTEXITCODE stale, which made the old check silently skip the rebuild.
# The JS-side catch keeps stderr clean and the exit code 0 in both outcomes.
$abiProbeJs = "try{require('better-sqlite3');console.log('ABI_OK')}catch(e){console.log('ABI_FAIL')}"
$abiProbe = & $NODE_BIN -e $abiProbeJs
if ("$abiProbe" -notmatch 'ABI_OK') {
  Write-Host "  Rebuilding native module for node $(& $NODE_BIN -v)..."
  npm rebuild better-sqlite3
  $abiProbe = & $NODE_BIN -e $abiProbeJs
  if ("$abiProbe" -notmatch 'ABI_OK') {
    Write-Host ""
    Write-Host "  X better-sqlite3 does not load under node $(& $NODE_BIN -v) ($NODE_BIN) and the rebuild failed." -ForegroundColor Red
    Write-Host "    If you use nvm, switch to the node version Buddy should run under (nvm use <version>)," -ForegroundColor Yellow
    Write-Host "    then re-run this installer. See the rebuild output above for details." -ForegroundColor Yellow
    Pop-Location
    exit 1
  }
}

Write-Host "  Building..."
npm run build --quiet
# tsc can exit 0 without emitting (e.g. run where it finds no tsconfig), so
# verify the build artifact exists rather than trusting the exit code — same
# "verify, don't trust silent success" lesson as the ABI probe above.
if (-not (Test-Path "$INSTALL_DIR\dist\server\index.js")) {
  Write-Host ""
  Write-Host "  X Build produced no output (tsc emitted nothing)." -ForegroundColor Red
  Write-Host "    Run 'npm run build' in $INSTALL_DIR to see the compiler error." -ForegroundColor Yellow
  Pop-Location
  exit 1
}

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
    command = $NODE_BIN
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
    claude mcp add buddy -s user -- "$NODE_BIN" "$SERVER_PATH_UNIX" 1>$null 2>$null
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
    command = $NODE_BIN
    args = @($SERVER_PATH_UNIX)
  } -Force
  $userConfig | ConvertTo-Json -Depth 8 | Set-Content $claudeUserFile -Encoding UTF8
  Write-Host "  ✓ Claude Code MCP config written ($claudeUserFile)" -ForegroundColor Green
}
$CLAUDE_CONFIGURED = $true

# Configure hooks + statusline in settings.json via node (avoids PowerShell
# ConvertFrom-Json flattening single-element arrays into bare objects).
$claudeSettings = "$claudeDir\settings.json"
$commandsDir = Join-Path $claudeDir 'commands'
$buddyGraphCommand = Join-Path $commandsDir 'buddy-graph.md'
New-Item -ItemType Directory -Force -Path $commandsDir | Out-Null
if (!(Test-Path $claudeSettings)) {
  '{}' | Set-Content $claudeSettings -Encoding UTF8
}

$statuslineCommand = "`"$NODE_BIN`" `"$STATUSLINE_PATH_UNIX`""
$env:CLAUDE_SETTINGS = $claudeSettings
$env:HOOK_COMMAND = "`"$NODE_BIN`" `"$HOOK_PATH_UNIX`""
$env:STOP_HOOK_COMMAND = "`"$NODE_BIN`" `"$STOP_HOOK_PATH_UNIX`""
$env:PROMPT_HOOK_COMMAND = "`"$NODE_BIN`" `"$PROMPT_HOOK_PATH_UNIX`""
$env:STATUSLINE_COMMAND = $statuslineCommand
$env:SERVER_PATH = $SERVER_PATH_UNIX
$env:NODE_BIN = $NODE_BIN
$settingsResult = & $NODE_BIN -e @'
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
const hookScript = hookCommand.match(/"([^"]+)"\s*$/)?.[1] || hookCommand.split(/\s+/).slice(-1)[0];
const stopHookScript = stopHookCommand.match(/"([^"]+)"\s*$/)?.[1] || stopHookCommand.split(/\s+/).slice(-1)[0];
const promptHookScript = promptHookCommand.match(/"([^"]+)"\s*$/)?.[1] || promptHookCommand.split(/\s+/).slice(-1)[0];
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

@'
---
description: Generate and open an interactive visualization of Buddy guard-mode reasoning data using the Buddy CLI.
---

Run the Buddy graph CLI to visualize the reasoning graph.

If `$ARGUMENTS` is present, treat it as optional CLI arguments such as a session ID or `--out` path.

```bash
set -euo pipefail

args=()
if [ -n "${ARGUMENTS:-}" ]; then
  read -r -a args <<< "$ARGUMENTS"
fi

if command -v buddy >/dev/null 2>&1; then
  buddy graph "${args[@]}" --open
else
  node "$HOME/.buddy/server/dist/cli/buddy.js" graph "${args[@]}" --open
fi
```

Execute the bash block above, then report the saved graph path and basic graph counts back to the user.
'@ | Set-Content -Path $buddyGraphCommand -Encoding UTF8
Write-Host "  ✓ Claude Code global /buddy-graph command installed ($buddyGraphCommand)" -ForegroundColor Green

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
  $env:HOOK_COMMAND = "`"$NODE_BIN`" `"$HOOK_PATH_UNIX`""
  $cursorResult = & $NODE_BIN -e @'
const fs = require('fs');
const path = process.env.CURSOR_HOOKS_FILE;
const hookCommand = process.env.HOOK_COMMAND;
let config = {};
try { config = JSON.parse(fs.readFileSync(path, 'utf-8')); } catch {}
if (!config.version) config.version = 1;
if (!config.hooks || typeof config.hooks !== 'object') config.hooks = {};
if (!Array.isArray(config.hooks.afterShellExecution)) config.hooks.afterShellExecution = [];
const hooks = config.hooks.afterShellExecution;
const hookScript = hookCommand.match(/"([^"]+)"\s*$/)?.[1] || hookCommand.split(/\s+/).slice(-1)[0];
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
    $env:BASH_COMMAND = "`"$NODE_BIN`" `"$HOOK_PATH_UNIX`""
    $env:POWERSHELL_COMMAND = "`"$NODE_BIN`" `"$HOOK_PATH_UNIX`""
    $copilotResult = & $NODE_BIN -e @'
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
const hookScript = bashCommand.match(/"([^"]+)"\s*$/)?.[1] || bashCommand.split(/\s+/).slice(-1)[0];
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
    codex mcp add buddy -- "$NODE_BIN" "$SERVER_PATH_UNIX" 1>$null 2>$null
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
    $env:HOOK_COMMAND = "`"$NODE_BIN`" `"$HOOK_PATH_UNIX`""
    $env:PROMPT_HOOK_COMMAND = "`"$NODE_BIN`" `"$PROMPT_HOOK_PATH_UNIX`""
    $codexResult = & $NODE_BIN -e @'
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
const postScript = hookCommand.match(/"([^"]+)"\s*$/)?.[1] || hookCommand.split(/\s+/).slice(-1)[0];
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
const promptScript = promptHookCommand.match(/"([^"]+)"\s*$/)?.[1] || promptHookCommand.split(/\s+/).slice(-1)[0];
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
'@ 2>$null

    if ($codexResult -eq 'updated') {
      Write-Host "  ✓ Codex CLI hooks configured ($codexHooks)" -ForegroundColor Green
    } else {
      Write-Host "  ✓ Codex CLI hooks already configured" -ForegroundColor Green
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
if (Test-Path "$ONBOARD_SCRIPT") {
  try {
    & $NODE_BIN "$ONBOARD_SCRIPT"
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
Write-Host "  💬 Join the Buddy Community!" -ForegroundColor Blue
Write-Host "  Connect with other buddy rescuers, share your companion's evolution, and get help on Slack:"
Write-Host "  👉 https://join.slack.com/t/buddy-mcp/shared_invite/zt-3xn6v1qza-R~fgkVCov9sCLZDXh9wErQ" -ForegroundColor Gray
Write-Host ""
Write-Host "  💛 If you like it, star the repo:"
Write-Host "  github.com/fiorastudio/buddy"
Write-Host ""
