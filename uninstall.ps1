# Buddy MCP Server — Windows PowerShell Uninstaller
#
# Usage:
#   irm https://raw.githubusercontent.com/fiorastudio/buddy/master/uninstall.ps1 | iex

param(
  [switch]$Force,
  [switch]$KeepData
)

$ErrorActionPreference = "Stop"
$InstallDir = "$env:USERPROFILE\.buddy\server"
$DataDir = "$env:USERPROFILE\.buddy"
$StatusFile = "$env:USERPROFILE\.claude\buddy-status.json"

Write-Host ""
Write-Host "  Buddy MCP Server Uninstaller" -ForegroundColor Cyan
Write-Host "  ────────────────────────────" -ForegroundColor Cyan
Write-Host ""

function Remove-BuddyFromJsonConfig($configPath, $cliName) {
  if (!(Test-Path $configPath)) { return }

  try {
    $content = Get-Content $configPath -Raw | ConvertFrom-Json
    if (!$content.mcpServers -or !$content.mcpServers.buddy) { return }
    $content.mcpServers.PSObject.Properties.Remove('buddy')
    if ($content.mcpServers.PSObject.Properties.Count -eq 0) {
      $content.PSObject.Properties.Remove('mcpServers')
    }
    $content | ConvertTo-Json -Depth 8 | Set-Content $configPath -Encoding UTF8
    Write-Host "  ✓ Removed Buddy MCP entry from $cliName ($configPath)" -ForegroundColor Green
  } catch {
    Write-Host "  ! Could not update $cliName config ($configPath)" -ForegroundColor Yellow
  }
}

function Remove-BuddyPromptBlock($filePath, $cliName) {
  if (!(Test-Path $filePath)) { return }

  $content = Get-Content $filePath -Raw
  $pattern = '(?s)\s*<!-- buddy-companion -->.*?<!-- /buddy-companion -->\s*'
  if ($content -notmatch 'buddy-companion') { return }

  try {
    $updated = ([regex]::Replace($content, $pattern, '')).Trim()
    if ($updated.Length -gt 0) {
      Set-Content -Path $filePath -Value ($updated + "`n") -Encoding UTF8
    } else {
      Set-Content -Path $filePath -Value '' -Encoding UTF8
    }
    Write-Host "  ✓ Removed Buddy instructions from $cliName ($filePath)" -ForegroundColor Green
  } catch {
    Write-Host "  ! Could not update $cliName prompt file ($filePath)" -ForegroundColor Yellow
  }
}

Write-Host "  This will remove Buddy MCP config and prompt instructions."
if ($KeepData) {
  Write-Host "  Local Buddy data will be preserved."
} else {
  Write-Host "  Local Buddy data in $DataDir will also be removed."
}

if (-not $Force) {
  $reply = Read-Host "Proceed with uninstall? [y/N]"
  if ($reply -notin @('y', 'Y', 'yes', 'YES')) {
    Write-Host "  Aborted."
    exit 0
  }
}

Write-Host ""
Write-Host "  Removing MCP client configuration..."
Remove-BuddyFromJsonConfig "$env:USERPROFILE\.claude\settings.json" "Claude Code"
Remove-BuddyFromJsonConfig "$env:USERPROFILE\.cursor\mcp.json" "Cursor"
Remove-BuddyFromJsonConfig "$env:USERPROFILE\.codeium\windsurf\mcp_config.json" "Windsurf"

try {
  $null = Get-Command codex -ErrorAction Stop
  codex mcp get buddy *> $null
  if ($LASTEXITCODE -eq 0) {
    codex mcp remove buddy *> $null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "  ✓ Removed Buddy MCP entry from Codex CLI" -ForegroundColor Green
    } else {
      Write-Host "  ! Could not remove Buddy MCP entry from Codex CLI" -ForegroundColor Yellow
    }
  }
} catch {
  # Codex not installed; nothing to remove
}

Write-Host ""
Write-Host "  Removing injected prompt instructions..."
Remove-BuddyPromptBlock "$env:USERPROFILE\.claude\CLAUDE.md" "Claude Code"
Remove-BuddyPromptBlock "$env:USERPROFILE\.cursorrules" "Cursor"
Remove-BuddyPromptBlock "$env:USERPROFILE\.codeium\windsurf\rules\buddy.md" "Windsurf"
Remove-BuddyPromptBlock "$env:USERPROFILE\.codex\instructions.md" "Codex CLI"
Remove-BuddyPromptBlock "$env:USERPROFILE\.gemini\GEMINI.md" "Gemini CLI"

if (Test-Path $StatusFile) {
  Remove-Item $StatusFile -Force
  Write-Host "  ✓ Removed Buddy status file ($StatusFile)" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Removing local files..."
if (Test-Path $InstallDir) {
  Remove-Item $InstallDir -Recurse -Force
  Write-Host "  ✓ Removed install directory ($InstallDir)" -ForegroundColor Green
}

if (-not $KeepData -and (Test-Path $DataDir)) {
  Remove-Item $DataDir -Recurse -Force
  Write-Host "  ✓ Removed data directory ($DataDir)" -ForegroundColor Green
} elseif ($KeepData) {
  Write-Host "  Preserved data directory ($DataDir)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  ✅ Buddy uninstalled." -ForegroundColor Green
Write-Host ""
