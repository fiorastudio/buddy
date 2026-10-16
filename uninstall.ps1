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
  if (Test-Path "$DataDir\world.json") {
    Write-Host "  Your buddy will be recalled from Buddy World and its server data deleted."
  }
}

if (-not $Force) {
  $reply = Read-Host "Proceed with uninstall? [y/N]"
  if ($reply -notin @('y', 'Y', 'yes', 'YES')) {
    Write-Host "  Aborted."
    exit 0
  }
}

function Remove-BuddyHooks($configPath, $cliName) {
  if (!(Test-Path $configPath)) { return }

  try {
    $content = Get-Content $configPath -Raw | ConvertFrom-Json
    if (!$content.hooks -or !$content.hooks.PostToolUse) { return }
    $before = $content.hooks.PostToolUse.Count
    $filtered = @($content.hooks.PostToolUse | Where-Object {
      $dominated = $false
      if ($_.hooks) {
        foreach ($hk in $_.hooks) {
          if ($hk.command -and $hk.command -like '*post-tool-handler*') {
            $dominated = $true
          }
        }
      }
      -not $dominated
    })
    if ($filtered.Count -eq $before) { return }
    if ($filtered.Count -eq 0) {
      $content.hooks.PSObject.Properties.Remove('PostToolUse')
    } else {
      $content.hooks.PostToolUse = $filtered
    }
    if ($content.hooks.PSObject.Properties.Count -eq 0) {
      $content.PSObject.Properties.Remove('hooks')
    }
    $content | ConvertTo-Json -Depth 8 | Set-Content $configPath -Encoding UTF8
    Write-Host "  ✓ Removed Buddy hooks from $cliName ($configPath)" -ForegroundColor Green
  } catch {
    Write-Host "  ! Could not update $cliName hooks ($configPath)" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "  Removing MCP client configuration..."
Remove-BuddyFromJsonConfig "$env:USERPROFILE\.claude\settings.json" "Claude Code"
Remove-BuddyHooks "$env:USERPROFILE\.claude\settings.json" "Claude Code"
Remove-BuddyFromJsonConfig "$env:USERPROFILE\.cursor\mcp.json" "Cursor"
Remove-BuddyFromJsonConfig "$env:USERPROFILE\.copilot\mcp-config.json" "GitHub Copilot CLI"

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
Remove-BuddyPromptBlock "$env:USERPROFILE\.cursor\rules\buddy.md" "Cursor"
Remove-BuddyPromptBlock "$env:USERPROFILE\.codex\instructions.md" "Codex CLI"
Remove-BuddyPromptBlock "$env:USERPROFILE\.codex\AGENTS.md" "Codex CLI"
Remove-BuddyPromptBlock "$env:USERPROFILE\.gemini\GEMINI.md" "Gemini CLI"
Remove-BuddyPromptBlock "$env:USERPROFILE\.gemini\AGENTS.md" "Gemini CLI"
Remove-BuddyPromptBlock "$env:USERPROFILE\.copilot\copilot-instructions.md" "GitHub Copilot CLI"
Remove-BuddyPromptBlock "$env:USERPROFILE\.copilot\AGENTS.md" "GitHub Copilot CLI"

if (Test-Path $StatusFile) {
  Remove-Item $StatusFile -Force
  Write-Host "  ✓ Removed Buddy status file ($StatusFile)" -ForegroundColor Green
}

# world.json holds the only token that can delete this buddy's Buddy World
# data. Purge while the CLI is still installed; if that fails (offline), keep
# the token so the user can still purge later.
$WorldCfg = "$DataDir\world.json"
$WorldKept = $false
if (-not $KeepData -and (Test-Path $WorldCfg)) {
  Write-Host ""
  Write-Host "  Recalling your buddy from Buddy World..."
  $WorldCli = "$InstallDir\dist\cli\world-cli.js"
  $NodeBin = if ($env:BUDDY_NODE_BIN) { $env:BUDDY_NODE_BIN } else { (Get-Command node -ErrorAction SilentlyContinue).Source }
  if ($NodeBin -and (Test-Path $WorldCli)) {
    try { & $NodeBin $WorldCli recall --purge *> $null } catch { }
  }
  # world-cli deletes world.json only after the server confirms the purge.
  if (Test-Path $WorldCfg) {
    $WorldKept = $true
    Write-Host "  ! Could not reach Buddy World. Kept your world token ($WorldCfg)" -ForegroundColor Yellow
  } else {
    Write-Host "  ✓ Recalled your buddy and deleted its Buddy World data" -ForegroundColor Green
  }
}

Write-Host ""
Write-Host "  Removing local files..."
if (Test-Path $InstallDir) {
  Remove-Item $InstallDir -Recurse -Force
  Write-Host "  ✓ Removed install directory ($InstallDir)" -ForegroundColor Green
}

if (-not $KeepData -and $WorldKept) {
  Get-ChildItem $DataDir -Force | Where-Object { $_.Name -ne 'world.json' } | Remove-Item -Recurse -Force
  Write-Host "  ✓ Removed data directory except world.json ($DataDir)" -ForegroundColor Green
  Write-Host "    To delete your Buddy World data later, reinstall Buddy and run:" -ForegroundColor Yellow
  Write-Host "      buddy-world recall --purge" -ForegroundColor Yellow
  Write-Host "    Or delete $WorldCfg to leave that data behind." -ForegroundColor DarkGray
} elseif (-not $KeepData -and (Test-Path $DataDir)) {
  Remove-Item $DataDir -Recurse -Force
  Write-Host "  ✓ Removed data directory ($DataDir)" -ForegroundColor Green
} elseif ($KeepData) {
  Write-Host "  Preserved data directory ($DataDir)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  ✅ Buddy uninstalled." -ForegroundColor Green
Write-Host ""
