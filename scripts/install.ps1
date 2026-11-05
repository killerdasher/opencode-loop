<#
.SYNOPSIS
  Installs the LOOP /loop command and loop-engine skill for OpenCode.

.DESCRIPTION
  Copies .opencode/commands/loop.md and .opencode/skills/loop-engine/ from this
  repository into an OpenCode configuration directory.

  Default destination is the global OpenCode config directory:
    $XDG_CONFIG_HOME/opencode  (when XDG_CONFIG_HOME is set)
    otherwise ~/.config/opencode

  Use -Scope project to install into <dir>\.opencode instead.

  Existing files are NEVER silently overwritten:
    - identical files are skipped (idempotent install)
    - differing files cause an error unless -Overwrite is given
    - with -Overwrite, a timestamped backup is created first

.PARAMETER Scope
  "global" (default) or "project".

.PARAMETER ProjectDir
  Target project directory for -Scope project. Defaults to the current directory.

.PARAMETER Overwrite
  Replace differing existing files after creating timestamped backups.

.PARAMETER Uninstall
  Remove the installed LOOP files (backing them up first).

.PARAMETER DryRun
  Print what would happen without changing anything.

.EXAMPLE
  .\scripts\install.ps1
  .\scripts\install.ps1 -Scope project -ProjectDir C:\src\my-app
  .\scripts\install.ps1 -Overwrite
  .\scripts\install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [ValidateSet('global', 'project')]
    [string]$Scope = 'global',

    [string]$ProjectDir = '',

    [switch]$Overwrite,

    [switch]$Uninstall,

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'

function Write-Note([string]$Message) { Write-Host "[LOOP] $Message" }
function Write-Fail([string]$Message) { Write-Host "[LOOP] ERROR: $Message" -ForegroundColor Red }

# --- Locate repository source files -----------------------------------------
$repoRoot = Split-Path -Parent $PSScriptRoot
$srcCommand = Join-Path $repoRoot '.opencode\commands\loop.md'
$srcSkillDir = Join-Path $repoRoot '.opencode\skills\loop-engine'
# Continuity helper (ADR 0002): deterministic state validation/persistence.
# Installed outside the skill directory (see backup-root rationale below:
# OpenCode discovers extensions under <config>/commands and <config>/skills).
$srcHelper = Join-Path $repoRoot 'scripts\continuity.mjs'

$requiredSources = @($srcCommand, (Join-Path $srcSkillDir 'SKILL.md'), $srcHelper)
foreach ($src in $requiredSources) {
    if (-not (Test-Path -LiteralPath $src)) {
        Write-Fail "Repository is incomplete; missing source file: $src"
        Write-Note 'Run this script from a complete opencode-loop checkout.'
        exit 1
    }
}

# --- Resolve destination root ------------------------------------------------
if ($Scope -eq 'project') {
    if (-not $ProjectDir) { $ProjectDir = (Get-Location).Path }
    if (-not (Test-Path -LiteralPath $ProjectDir -PathType Container)) {
        Write-Fail "Project directory does not exist: $ProjectDir"
        exit 1
    }
    $destRoot = Join-Path $ProjectDir '.opencode'
}
else {
    if ($env:XDG_CONFIG_HOME) {
        $destRoot = Join-Path $env:XDG_CONFIG_HOME 'opencode'
    }
    elseif ($HOME) {
        $destRoot = Join-Path $HOME '.config\opencode'
    }
    else {
        Write-Fail 'Cannot determine the global config directory (HOME and XDG_CONFIG_HOME are both unset).'
        exit 1
    }
}

$destCommand = Join-Path $destRoot 'commands\loop.md'
$destSkillDir = Join-Path $destRoot 'skills\loop-engine'
$destHelper = Join-Path $destRoot 'scripts\continuity.mjs'

# Backup root: a sibling of the destination, NEVER inside it. OpenCode scans
# <config>/commands and <config>/skills for extension files, so an in-place
# "loop-engine.backup-<timestamp>" directory - which contains a live SKILL.md -
# is discovered as a phantom skill (observed 2026-11-04). Tree structure is
# preserved inside the root: <root>\<timestamp>\<path relative to destRoot>.
$BackupRoot = Join-Path (Split-Path -Parent $destRoot) ((Split-Path -Leaf $destRoot) + '-loop-backups')

Write-Note "Scope: $Scope"
Write-Note "Destination: $destRoot"
if ($DryRun) { Write-Note 'DRY RUN - no files will be changed.' }

# --- Helpers -----------------------------------------------------------------
function Get-FileSignature([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Test-DirIdentical([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Destination -PathType Container)) { return $false }
    $srcFiles = Get-ChildItem -LiteralPath $Source -Recurse -File
    $dstFiles = Get-ChildItem -LiteralPath $Destination -Recurse -File
    if (@($srcFiles).Count -ne @($dstFiles).Count) { return $false }
    foreach ($f in $srcFiles) {
        $rel = $f.FullName.Substring($Source.Length).TrimStart('\', '/')
        $peer = Join-Path $Destination $rel
        if (-not (Test-Path -LiteralPath $peer -PathType Leaf)) { return $false }
        if ((Get-FileSignature $f.FullName) -ne (Get-FileSignature $peer)) { return $false }
    }
    return $true
}

function Get-BackupBasePath([string]$Path) {
    # Path of the backup this installer run would create, tree structure
    # preserved: <BackupRoot>\<timestamp>\<path relative to destRoot>.
    $rel = $Path.Substring($destRoot.Length).TrimStart('\', '/')
    return (Join-Path $BackupRoot (Join-Path $timestamp $rel))
}

function Get-UniqueBackupPath([string]$Path) {
    # Returns an existing-path-safe backup destination: same-second runs must
    # not clobber an earlier backup of the same file.
    $base = Get-BackupBasePath $Path
    $candidate = $base
    $i = 2
    while (Test-Path -LiteralPath $candidate) {
        $candidate = "$base-$i"
        $i++
    }
    $parent = Split-Path -Parent $candidate
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    return $candidate
}

function Backup-Then-Remove([string]$Path) {
    if ($DryRun) {
        Write-Note "DRY RUN: would back up $Path -> $(Get-BackupBasePath $Path) and remove it."
        return $null
    }
    $backup = Get-UniqueBackupPath $Path
    Move-Item -LiteralPath $Path -Destination $backup
    Write-Note "Backed up: $Path -> $backup"
    return $backup
}

# --- Uninstall ---------------------------------------------------------------
if ($Uninstall) {
    $removed = 0
    foreach ($target in @($destCommand, $destSkillDir, $destHelper)) {
        if (-not (Test-Path -LiteralPath $target)) {
            Write-Note "Not installed (skipped): $target"
            continue
        }
        Backup-Then-Remove $target | Out-Null
        $removed++
    }
    if ($DryRun) {
        Write-Note 'DRY RUN complete; nothing was changed.'
    }
    elseif ($removed -eq 0) {
        Write-Note 'Nothing to uninstall; no LOOP files were present.'
    }
    else {
        Write-Note "Uninstall complete ($removed item(s) removed, backups kept in $BackupRoot)."
        Write-Note 'Backups can be deleted manually when no longer needed.'
    }
    exit 0
}

# --- Install -----------------------------------------------------------------
function Install-File([string]$Source, [string]$Destination) {
    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
        if ((Get-FileSignature $Source) -eq (Get-FileSignature $Destination)) {
            Write-Note "Up to date: $Destination"
            return
        }
        if (-not $Overwrite) {
            Write-Fail "Refusing to overwrite a differing file: $Destination"
            Write-Note 'It may be user-created or from another LOOP version.'
            Write-Note 'Re-run with -Overwrite to replace it (a timestamped backup is created first),'
            Write-Note 'or install manually by copying the source file yourself.'
            exit 1
        }
        if ($DryRun) {
            Write-Note "DRY RUN: would back up and replace $Destination"
            return
        }
        $backup = Get-UniqueBackupPath $Destination
        Move-Item -LiteralPath $Destination -Destination $backup
        Write-Note "Backed up: $Destination -> $backup"
    }
    elseif (Test-Path -LiteralPath $Destination -PathType Container) {
        Write-Fail "Destination path is a directory but a file is expected: $Destination"
        exit 1
    }
    if ($DryRun) {
        Write-Note "DRY RUN: would install $Destination"
        return
    }
    $destParent = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $destParent)) {
        New-Item -ItemType Directory -Path $destParent -Force | Out-Null
    }
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
    Write-Note "Installed: $Destination"
}

function Install-SkillDir([string]$Source, [string]$Destination) {
    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
        Write-Fail "Destination path is a file but a directory is expected: $Destination"
        exit 1
    }
    if (Test-Path -LiteralPath $Destination -PathType Container) {
        if (Test-DirIdentical $Source $Destination) {
            Write-Note "Up to date: $Destination"
            return
        }
        if (-not $Overwrite) {
            Write-Fail "Refusing to overwrite a differing skill directory: $Destination"
            Write-Note 'It may be user-created or from another LOOP version.'
            Write-Note 'Re-run with -Overwrite to replace it (a timestamped backup is created first).'
            exit 1
        }
        if ($DryRun) {
            Write-Note "DRY RUN: would back up and replace $Destination"
            return
        }
        Backup-Then-Remove $Destination | Out-Null
    }
    if ($DryRun) {
        Write-Note "DRY RUN: would install $Destination"
        return
    }
    $destParent = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $destParent)) {
        New-Item -ItemType Directory -Path $destParent -Force | Out-Null
    }
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
    Write-Note "Installed: $Destination"
}

try {
    Install-File -Source $srcCommand -Destination $destCommand
    Install-SkillDir -Source $srcSkillDir -Destination $destSkillDir
    Install-File -Source $srcHelper -Destination $destHelper
}
catch {
    Write-Fail $_.Exception.Message
    exit 1
}

if ($DryRun) {
    Write-Note 'DRY RUN complete; nothing was changed.'
}
else {
    Write-Note 'Install complete.'
    Write-Note 'Usage: open OpenCode in the target project and run: /loop <your task>'
}
exit 0
