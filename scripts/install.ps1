#Requires -Version 5.1
<#
.SYNOPSIS
  Install the LOOP command and the loop-engine skill into an OpenCode configuration.

.DESCRIPTION
  Copies the /loop command and the loop-engine skill from this repository into an
  OpenCode configuration root. By default installs into the user's global OpenCode
  configuration. Existing files are backed up before being replaced; identical
  files are left untouched; files that LOOP does not own are never removed by
  -Uninstall unless their content differs and a backup is created first.

  Path handling is platform-neutral: the same script runs under Windows
  PowerShell and PowerShell (pwsh) on Linux/macOS, which is what the CI
  validator relies on.

.PARAMETER Destination
  Explicit OpenCode configuration root (a directory that contains or will contain
  'commands' and 'skills'). Intended for testing and advanced setups.

.PARAMETER Local
  Install into the current project's ./.opencode directory (project-local config).

.PARAMETER Uninstall
  Remove LOOP-managed files instead of installing.

.PARAMETER Force
  With -Uninstall: also remove existing files whose content differs from the
  current LOOP content and does not carry the LOOP marker. A backup of each
  removed file is always created first.

.EXAMPLE
  powershell -File scripts/install.ps1
  powershell -File scripts/install.ps1 -Local
  powershell -File scripts/install.ps1 -Destination "C:\temp\sandbox\opencode"
  powershell -File scripts/install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [string]$Destination,
    [switch]$Local,
    [switch]$Uninstall,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$MarkerText = 'Iterative Engineering Engine'

function Write-Loop {
    param([string]$Message, [string]$Color = 'White')
    Write-Host "[loop] $Message" -ForegroundColor $Color
}

# Platform-neutral path builder: the manifest uses forward slashes on every OS.
function Convert-RelativePath {
    param([string]$Root, [string]$Rel)
    $target = $Root
    foreach ($part in ($Rel -split '/')) {
        if ($part -ne '') { $target = Join-Path $target $part }
    }
    return $target
}

# --- Manifest derived from the source tree -----------------------------------
# Walking .opencode/ means newly added reference or template files install
# automatically; the validator keeps its own explicit expected-file contract.

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $repoRoot '.opencode'

if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
    Write-Loop "Source directory missing: $sourceRoot" 'Red'
    exit 1
}

$sourceNames = @(Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($sourceRoot.Length + 1)
    $relative.Replace('\', '/')
})

if ($sourceNames.Count -eq 0) {
    Write-Loop "No source files found under $sourceRoot" 'Red'
    exit 1
}

# --- Destination resolution ----------------------------------------------------

if ($Local -and -not [string]::IsNullOrWhiteSpace($Destination)) {
    Write-Loop 'Use either -Local or -Destination, not both.' 'Red'
    exit 1
}

if ($Local) {
    $destRoot = Join-Path (Get-Location).Path '.opencode'
}
elseif (-not [string]::IsNullOrWhiteSpace($Destination)) {
    $trimmed = $Destination.Trim()
    # Keep drive roots literal: "C:\" must not collapse to the drive-relative "C:".
    if ($trimmed -match '^[A-Za-z]:[\\/]$') { $destRoot = $trimmed.Substring(0, 3) }
    elseif ($trimmed -match '^[A-Za-z]:$') { $destRoot = $trimmed + '\' }
    elseif ($trimmed -eq '/') { $destRoot = '/' }
    else { $destRoot = $trimmed.TrimEnd('\', '/') }
}
else {
    $xdg = $env:XDG_CONFIG_HOME
    if ([string]::IsNullOrWhiteSpace($xdg)) { $xdg = Join-Path $HOME '.config' }
    $destRoot = Join-Path $xdg 'opencode'
}

# --- Helpers ---------------------------------------------------------------------

function Get-FileSha256 {
    param([string]$Path)
    $hash = Get-FileHash -LiteralPath $Path -Algorithm SHA256
    return $hash.Hash.ToLowerInvariant()
}

function Test-LoopOwned {
    param([string]$Path)
    try {
        $content = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
        return $content -like "*$MarkerText*"
    }
    catch {
        return $false
    }
}

# Backup with a collision-safe name (same-second replacements never overwrite
# an earlier backup).
function Backup-Existing {
    param([string]$Path)
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = "$Path.bak.$stamp"
    $n = 0
    while (Test-Path -LiteralPath $backup -PathType Leaf) {
        $n++
        $backup = "$Path.bak.$stamp-$n"
    }
    Copy-Item -LiteralPath $Path -Destination $backup
    return $backup
}

$summary = [System.Collections.Generic.List[string]]::new()
$hadError = $false
$keptCount = 0

# --- Main -------------------------------------------------------------------------

try {
    if ($Uninstall) {
        Write-Loop "Uninstalling from: $destRoot"
        foreach ($name in $sourceNames) {
            $targetPath = Convert-RelativePath $destRoot $name
            try {
                if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
                    $summary.Add("ABSENT    $name")
                    continue
                }

                $srcPath = Convert-RelativePath $sourceRoot $name
                $identical = $false
                if (Test-Path -LiteralPath $srcPath -PathType Leaf) {
                    foreach ($file in @($srcPath, $targetPath)) {
                        if ($file -notmatch '.+') { throw "invalid path for hashing: $file" }
                    }
                    $identical = (Get-FileSha256 $targetPath) -eq (Get-FileSha256 $srcPath)
                }

                if ($identical) {
                    Remove-Item -LiteralPath $targetPath -Force
                    $summary.Add("REMOVED   $name (identical to current LOOP version)")
                }
                elseif ((Test-LoopOwned $targetPath) -or $Force) {
                    # Differing content must always be recoverable: back it up first.
                    $reason = if ($Force -and -not (Test-LoopOwned $targetPath)) { 'forced removal' } else { 'differing LOOP content' }
                    $backup = Backup-Existing $targetPath
                    Remove-Item -LiteralPath $targetPath -Force
                    $summary.Add("REMOVED   $name ($reason; backup: $(Split-Path -Leaf $backup))")
                }
                else {
                    $keptCount++
                    $summary.Add("KEPT      $name (not LOOP-managed; content differs and -Force was not supplied)")
                }
            }
            catch {
                $hadError = $true
                $summary.Add("FAILED    $name ($($_.Exception.Message))")
            }
        }

        foreach ($dir in @(
            (Convert-RelativePath $destRoot 'skills/loop-engine/references'),
            (Convert-RelativePath $destRoot 'skills/loop-engine'),
            (Convert-RelativePath $destRoot 'skills'))
        ) {
            try {
                if ((Test-Path -LiteralPath $dir -PathType Container) -and (@(Get-ChildItem -LiteralPath $dir -Force).Count -eq 0)) {
                    Remove-Item -LiteralPath $dir -Force
                    $summary.Add("RMDIR     $dir")
                }
            }
            catch {
                $hadError = $true
                $summary.Add("FAILED    rmdir $dir ($($_.Exception.Message))")
            }
        }
    }
    else {
        Write-Loop "Installing into: $destRoot"
        foreach ($name in $sourceNames) {
            $srcPath = Convert-RelativePath $sourceRoot $name
            $targetPath = Convert-RelativePath $destRoot $name
            $targetDir = Split-Path -Parent $targetPath
            try {
                if (-not (Test-Path -LiteralPath $targetDir -PathType Container)) {
                    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
                }

                if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
                    Copy-Item -LiteralPath $srcPath -Destination $targetPath
                    $summary.Add("INSTALLED $name")
                }
                elseif ((Get-FileSha256 $targetPath) -eq (Get-FileSha256 $srcPath)) {
                    $summary.Add("UP-TO-DATE $name")
                }
                else {
                    $backup = Backup-Existing $targetPath
                    Copy-Item -LiteralPath $srcPath -Destination $targetPath
                    $summary.Add("REPLACED  $name (previous file backed up: $(Split-Path -Leaf $backup))")
                }
            }
            catch {
                $hadError = $true
                $summary.Add("FAILED    $name ($($_.Exception.Message))")
            }
        }
    }
}
catch {
    $hadError = $true
    $summary.Add("FAILED    fatal: $($_.Exception.Message)")
}
finally {
    $summary | ForEach-Object { Write-Loop $_ }
    $tailColor = if ($hadError) { 'Red' } elseif ($keptCount -gt 0) { 'Yellow' } else { 'Green' }
    if ($Uninstall) {
        Write-Loop ("Uninstall finished: kept=$keptCount" + $(if (-not $hadError) { ' - done.' })) $tailColor
    }
    else {
        Write-Loop ("Install finished." + $(if (-not $hadError) { ' Open a project in OpenCode and run /loop with your task.' })) $tailColor
    }
}

if ($hadError) { exit 1 } else { exit 0 }
