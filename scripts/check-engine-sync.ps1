# check-engine-sync.ps1 — PowerShell mirror of check-engine-sync.sh
#
# Windows-native equivalent of the bash script. Same contract: exit 0
# when the app's src/lib/screen-engine/ matches the sandbox's src/engine/
# byte-for-byte, exit 1 on drift, exit 2 on env/layout problems.
#
# Usage (from the app repo root):
#   pwsh ./scripts/check-engine-sync.ps1
#   # or
#   ./scripts/check-engine-sync.ps1
#
# Override the sandbox path:
#   $env:SANDBOX_REPO = "D:\some\other\path"; ./scripts/check-engine-sync.ps1
#
# This is the Windows-native answer to Codex audit LOW #1. Bash works in
# WSL/Git-Bash but fails for ops who run pure PowerShell.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appRepo = Resolve-Path (Join-Path $scriptDir "..")

# Default to sibling layout under D:\00_Work\01_CaseLoad_Select\
$defaultSandbox = Join-Path $appRepo "..\..\CaseLoadScreen_2.0_2026-05-03"
$sandboxRepo = if ($env:SANDBOX_REPO) { $env:SANDBOX_REPO } else { $defaultSandbox }

$appEngine = Join-Path $appRepo "src\lib\screen-engine"
$sandboxEngine = Join-Path $sandboxRepo "src\engine"

if (-not (Test-Path $sandboxEngine -PathType Container)) {
    Write-Host "ERROR: sandbox engine not found at: $sandboxEngine"
    Write-Host "Override the path with: `$env:SANDBOX_REPO = '/path/to/sandbox'; ./scripts/check-engine-sync.ps1"
    exit 2
}

if (-not (Test-Path $appEngine -PathType Container)) {
    Write-Host "ERROR: app engine port not found at: $appEngine"
    exit 2
}

Write-Host "Comparing:"
Write-Host "  app:     $appEngine"
Write-Host "  sandbox: $sandboxEngine"
Write-Host ""

# Collect every file under each tree, hash each, build a relative-path => hash map.
function Get-FileHashMap {
    param([string]$root)
    $map = @{}
    Get-ChildItem -Path $root -Recurse -File | ForEach-Object {
        $relative = $_.FullName.Substring($root.Length).TrimStart("\", "/").Replace("\", "/")
        $hash = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash
        $map[$relative] = $hash
    }
    $map
}

$sandboxMap = Get-FileHashMap -root $sandboxEngine
$appMap = Get-FileHashMap -root $appEngine

$drifted = New-Object System.Collections.ArrayList
$onlyInSandbox = New-Object System.Collections.ArrayList
$onlyInApp = New-Object System.Collections.ArrayList

foreach ($key in $sandboxMap.Keys) {
    if (-not $appMap.ContainsKey($key)) {
        [void]$onlyInSandbox.Add($key)
    } elseif ($appMap[$key] -ne $sandboxMap[$key]) {
        [void]$drifted.Add($key)
    }
}

foreach ($key in $appMap.Keys) {
    if (-not $sandboxMap.ContainsKey($key)) {
        [void]$onlyInApp.Add($key)
    }
}

if ($drifted.Count -eq 0 -and $onlyInSandbox.Count -eq 0 -and $onlyInApp.Count -eq 0) {
    Write-Host "OK: app/src/lib/screen-engine/ matches sandbox/src/engine/ byte-for-byte."
    exit 0
}

Write-Host "FAIL: engine port has drifted from the sandbox source of truth."
Write-Host ""

if ($drifted.Count -gt 0) {
    Write-Host "Files with different contents:"
    foreach ($f in $drifted) { Write-Host "  != $f" }
    Write-Host ""
}
if ($onlyInSandbox.Count -gt 0) {
    Write-Host "Files in sandbox but missing from app:"
    foreach ($f in $onlyInSandbox) { Write-Host "  -- $f" }
    Write-Host ""
}
if ($onlyInApp.Count -gt 0) {
    Write-Host "Files in app but missing from sandbox (orphans):"
    foreach ($f in $onlyInApp) { Write-Host "  ++ $f" }
    Write-Host ""
}

Write-Host "Discipline: engine changes must land in BOTH repos in the same commit."
Write-Host "  sandbox: $sandboxEngine"
Write-Host "  app:     $appEngine"
Write-Host ""
Write-Host "Fix: re-port the sandbox engine into the app, then re-run this script:"
Write-Host "  Copy-Item -Recurse -Force `"$sandboxEngine\*`" `"$appEngine\`""
Write-Host ""
exit 1
