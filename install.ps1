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

Pop-Location

# ── Auto-configure MCP for detected CLIs ──

function Add-BuddyToConfig($configPath, $cliName) {
  $configDir = Split-Path $configPath -Parent
  if (!(Test-Path $configDir)) { return }

  $buddyConfig = @{
    command = "node"
    args = @($SERVER_PATH_UNIX)
  }

  if (!(Test-Path $configPath)) {
    $config = @{ mcpServers = @{ buddy = $buddyConfig } }
    $config | ConvertTo-Json -Depth 5 | Set-Content $configPath -Encoding UTF8
    Write-Host "  ✓ $cliName configured ($configPath)" -ForegroundColor Green
    return
  }

  $content = Get-Content $configPath -Raw | ConvertFrom-Json
  if ($content.mcpServers.buddy) {
    Write-Host "  ✓ $cliName already configured" -ForegroundColor Green
    return
  }

  if (!$content.mcpServers) {
    $content | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue @{} -Force
  }
  $content.mcpServers | Add-Member -NotePropertyName "buddy" -NotePropertyValue $buddyConfig -Force
  $content | ConvertTo-Json -Depth 5 | Set-Content $configPath -Encoding UTF8
  Write-Host "  ✓ $cliName configured ($configPath)" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Configuring MCP clients..."

# Claude Code
$claudeDir = "$env:USERPROFILE\.claude"
if (!(Test-Path $claudeDir)) { New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null }
Add-BuddyToConfig "$claudeDir\settings.json" "Claude Code"

# Cursor
if (Test-Path "$env:USERPROFILE\.cursor") {
  Add-BuddyToConfig "$env:USERPROFILE\.cursor\mcp.json" "Cursor"
}

# GitHub Copilot CLI
$copilotDir = "$env:USERPROFILE\.copilot"
if (!(Test-Path $copilotDir)) { New-Item -ItemType Directory -Path $copilotDir -Force | Out-Null }
Add-BuddyToConfig "$copilotDir\mcp-config.json" "GitHub Copilot CLI"

# ── Inject buddy instructions into CLI prompt files ──

$BUDDY_INSTRUCTIONS = @"
<!-- buddy-companion -->
## Buddy Companion

You have a coding companion available via the buddy MCP server.

**After completing any coding task** (writing code, fixing bugs, refactoring, deploying, running tests), **automatically call ``buddy_observe``** with a 1-sentence summary of what you did. This gives your companion XP and triggers a personality-flavored reaction. Do this every time — the user expects it.

At the start of each conversation, call ``buddy_status`` to check on your buddy.

If the user addresses the buddy by name, respond briefly in character before your normal response.
<!-- /buddy-companion -->
"@

function Inject-BuddyPrompt($filePath, $cliName) {
  $dir = Split-Path $filePath -Parent
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

  if ((Test-Path $filePath) -and (Select-String -Path $filePath -Pattern "buddy-companion" -Quiet)) {
    Write-Host "  ✓ $cliName prompt already has buddy instructions" -ForegroundColor Green
    return
  }

  Add-Content -Path $filePath -Value "`n$BUDDY_INSTRUCTIONS" -Encoding UTF8
  Write-Host "  ✓ $cliName prompt updated ($filePath)" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Injecting buddy instructions..."

Inject-BuddyPrompt "$env:USERPROFILE\.claude\CLAUDE.md" "Claude Code"
$cursorRulesDir = "$env:USERPROFILE\.cursor\rules"
if (!(Test-Path $cursorRulesDir)) { New-Item -ItemType Directory -Path $cursorRulesDir -Force | Out-Null }
Inject-BuddyPrompt "$cursorRulesDir\buddy.md" "Cursor CLI"

Inject-BuddyPrompt "$env:USERPROFILE\.codex\instructions.md" "Codex CLI"
Inject-BuddyPrompt "$env:USERPROFILE\.gemini\GEMINI.md" "Gemini CLI"
Inject-BuddyPrompt "$env:USERPROFILE\.copilot\copilot-instructions.md" "GitHub Copilot CLI"

Write-Host ""
Write-Host "  ✅ Buddy installed! Say `"hatch a buddy`" to start." -ForegroundColor Green
Write-Host ""
Write-Host "  💛 If you like it, star the repo:"
Write-Host "  github.com/fiorastudio/buddy"
Write-Host ""
