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
Write-Host "  Building..."
npm run build --quiet 2>$null

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

$claudeSettings = "$claudeDir\settings.json"
if (!(Test-Path $claudeSettings)) {
  '{}' | Set-Content $claudeSettings -Encoding UTF8
}

$hookConfigured = $false
$statuslineConfigured = $false
$statuslineCommand = "node $STATUSLINE_PATH_UNIX"
try {
  $config = Get-Content $claudeSettings -Raw | ConvertFrom-Json
} catch {
  $config = @{}
}
if (!$config.hooks) {
  $config | Add-Member -NotePropertyName "hooks" -NotePropertyValue @{} -Force
}
$hooks = $config.hooks
if (!$hooks.PostToolUse) {
  $hooks | Add-Member -NotePropertyName "PostToolUse" -NotePropertyValue @() -Force
}
$hasBuddyHook = $false
foreach ($entry in @($hooks.PostToolUse)) {
  if ($entry.matcher -eq 'Bash' -and $entry.hooks) {
    foreach ($hk in $entry.hooks) {
      if ($hk.command -and $hk.command -like "*post-tool-handler*") {
        $hasBuddyHook = $true
      }
    }
  }
}
if (-not $hasBuddyHook) {
  $hookEntry = @{
    matcher = "Bash"
    hooks = @(@{
      type = "command"
      command = "node $HOOK_PATH_UNIX"
      async = $true
      timeout = 3
    })
  }
  $hooks.PostToolUse = @($hooks.PostToolUse) + @($hookEntry)
  $hookConfigured = $true
}
if ((-not $config.statusLine) -or $config.statusLine.command -ne $statuslineCommand -or $config.statusLine.type -ne 'command' -or $config.statusLine.refreshInterval -ne 2) {
  $config | Add-Member -NotePropertyName "statusLine" -NotePropertyValue ([ordered]@{
    type = "command"
    command = $statuslineCommand
    padding = 1
    refreshInterval = 2
  }) -Force
  $statuslineConfigured = $true
}
if ($hookConfigured -or $statuslineConfigured) {
  $config | ConvertTo-Json -Depth 8 | Set-Content $claudeSettings -Encoding UTF8
}
if ($hookConfigured) {
  Write-Host "  ✓ PostToolUse hook configured" -ForegroundColor Green
} else {
  Write-Host "  ✓ PostToolUse hook already configured" -ForegroundColor Green
}
if ($statuslineConfigured) {
  Write-Host "  ✓ Claude Code statusline configured ($statuslineCommand)" -ForegroundColor Green
} else {
  Write-Host "  ✓ Claude Code statusline already configured" -ForegroundColor Green
}

# Cursor
if (Test-Path "$env:USERPROFILE\.cursor") {
  $CURSOR_CONFIGURED = Add-BuddyToConfig "$env:USERPROFILE\.cursor\mcp.json" "Cursor"
}

$cursorHooks = "$env:USERPROFILE\.cursor\hooks.json"
if (Test-Path "$env:USERPROFILE\.cursor") {
  $cursorConfig = @{}
  if (Test-Path $cursorHooks) {
    try { $cursorConfig = Get-Content $cursorHooks -Raw | ConvertFrom-Json }
    catch { $cursorConfig = @{} }
  }
  if (!$cursorConfig.version) {
    $cursorConfig | Add-Member -NotePropertyName "version" -NotePropertyValue 1 -Force
  }
  if (!$cursorConfig.hooks) {
    $cursorConfig | Add-Member -NotePropertyName "hooks" -NotePropertyValue @{} -Force
  }
  if (!$cursorConfig.hooks.afterShellExecution) {
    $cursorConfig.hooks | Add-Member -NotePropertyName "afterShellExecution" -NotePropertyValue @() -Force
  }
  $hasCursorHook = $false
  foreach ($entry in @($cursorConfig.hooks.afterShellExecution)) {
    if ($entry.command -eq "node $HOOK_PATH_UNIX") {
      $hasCursorHook = $true
    }
  }
  if (-not $hasCursorHook) {
    $cursorConfig.hooks.afterShellExecution = @($cursorConfig.hooks.afterShellExecution) + @(@{ command = "node $HOOK_PATH_UNIX" })
    $cursorConfig | ConvertTo-Json -Depth 8 | Set-Content $cursorHooks -Encoding UTF8
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
    $copilotConfig = @{}
    if (Test-Path $copilotSettings) {
      try { $copilotConfig = Get-Content $copilotSettings -Raw | ConvertFrom-Json }
      catch { $copilotConfig = @{} }
    }
    if (!$copilotConfig.hooks) {
      $copilotConfig | Add-Member -NotePropertyName "hooks" -NotePropertyValue @{} -Force
    }
    if (!$copilotConfig.hooks.postToolUse) {
      $copilotConfig.hooks | Add-Member -NotePropertyName "postToolUse" -NotePropertyValue @() -Force
    }
    $hasCopilotHook = $false
    foreach ($entry in @($copilotConfig.hooks.postToolUse)) {
      if ($entry.bash -eq "node $HOOK_PATH_UNIX" -or $entry.powershell -eq "node $HOOK_PATH_UNIX") {
        $hasCopilotHook = $true
      }
    }
    if (-not $hasCopilotHook) {
      $copilotConfig.hooks.postToolUse = @($copilotConfig.hooks.postToolUse) + @(@{
        type = "command"
        bash = "node $HOOK_PATH_UNIX"
        powershell = "node $HOOK_PATH_UNIX"
        timeoutSec = 3
      })
      $copilotConfig | ConvertTo-Json -Depth 8 | Set-Content $copilotSettings -Encoding UTF8
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
    $codexConfig = @{}
    if (Test-Path $codexHooks) {
      try { $codexConfig = Get-Content $codexHooks -Raw | ConvertFrom-Json }
      catch { $codexConfig = @{} }
    }
    if (!$codexConfig.hooks) {
      $codexConfig | Add-Member -NotePropertyName "hooks" -NotePropertyValue @{} -Force
    }
    if (!$codexConfig.hooks.PostToolUse) {
      $codexConfig.hooks | Add-Member -NotePropertyName "PostToolUse" -NotePropertyValue @() -Force
    }
    $postToolUseGroups = @($codexConfig.hooks.PostToolUse)
    $codexGroup = $null
    foreach ($entry in $postToolUseGroups) {
      if ($entry.matcher -eq 'Bash' -and $entry.hooks) {
        $codexGroup = $entry
        break
      }
    }
    if (-not $codexGroup) {
      $codexGroup = [ordered]@{
        matcher = "Bash"
        hooks = @()
      }
      $codexConfig.hooks.PostToolUse = @($postToolUseGroups) + @($codexGroup)
    }
    $hasCodexHook = $false
    foreach ($entry in @($codexGroup.hooks)) {
      if ($entry.command -eq "node $HOOK_PATH_UNIX") {
        $hasCodexHook = $true
      }
    }
    if (-not $hasCodexHook) {
      $codexGroup.hooks = @($codexGroup.hooks) + @(@{
        type = "command"
        command = "node $HOOK_PATH_UNIX"
        statusMessage = "Reviewing Bash output"
      })
      $codexConfig | ConvertTo-Json -Depth 10 | Set-Content $codexHooks -Encoding UTF8
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

**When insight mode is on**, also pass ``claims``, ``edges``, and ``cwd`` on every ``buddy_observe`` call:
- ``claims``: 1-4 substantive assertions from the turn that just ended. Each claim needs ``text`` (≤240 chars), ``basis`` (research/empirical/deduction/analogy/definition/llm_output/assumption/vibes), ``speaker`` (user/assistant), ``confidence`` (low/medium/high), and ``external_id`` (e.g. c1).
- ``edges``: relationships between claims — ``{ from, to, type }`` where type is supports/depends_on/contradicts/questions.
- ``cwd``: absolute path of the current project root for workspace isolation.
Skip claims/edges if the turn had no substantive structure. Check ``buddy_status`` or ``buddy_reasoning_status`` to see if insight mode is on.

At the start of each conversation, call ``buddy_status`` to check on your buddy.

If the user addresses the buddy by name, respond briefly in character before your normal response.

After calling buddy_observe, relay the buddy's reaction to the user. The first text content is an ASCII speech bubble — include it verbatim.
<!-- /buddy-companion v3 -->
"@

function Inject-BuddyPrompt($filePath, $cliName) {
  $dir = Split-Path $filePath -Parent
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

  if ((Test-Path $filePath) -and (Select-String -Path $filePath -Pattern "buddy-companion v3" -Quiet)) {
    Write-Host "  ✓ $cliName prompt already has buddy instructions (v3)" -ForegroundColor Green
    return
  }

  # Upgrade from older version: strip the old block before appending new one
  if ((Test-Path $filePath) -and (Select-String -Path $filePath -Pattern "buddy-companion" -Quiet)) {
    $content = Get-Content $filePath -Raw
    $content = $content -replace '(?s)<!-- buddy-companion.*?<!-- /buddy-companion[^>]*-->', ''
    $content = $content.Trim()
    Set-Content -Path $filePath -Value $content -Encoding UTF8
    Write-Host "  ↑ $cliName prompt upgrading buddy instructions to v3" -ForegroundColor Green
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
