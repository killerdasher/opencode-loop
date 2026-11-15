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

  Destination safety: before writing (or uninstalling) anything, every path
  component between the operator-provided root and the destination is checked
  for symlink/junction/reparse-point redirection. A redirected destination is
  refused with its resolved real target unless -AllowRedirectedDestination is
  given.

  Ownership-aware uninstall: -Uninstall removes ONLY files and directories
  that are byte-identical to LOOP's current sources. Paths that differ
  (user-created or user-modified) are preserved and reported; nothing is
  removed in that run, and -ForceCustomized opts in to removing them
  (they are backed up first).

.PARAMETER Scope
  "global" (default) or "project".

.PARAMETER ProjectDir
  Target project directory for -Scope project. Defaults to the current directory.

.PARAMETER Overwrite
  Replace differing existing files after creating timestamped backups.

.PARAMETER Uninstall
  Remove the installed LOOP files (backing them up first).

.PARAMETER AllowRedirectedDestination
  Proceed even when a destination path component is a symlink, junction, or
  other reparse point (the destination would resolve outside the intended
  tree). The resolved real target is printed in every case.

.PARAMETER ForceCustomized
  With -Uninstall: also remove paths that differ from LOOP's sources
  (user-owned or customized); they are backed up first.

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

    [switch]$AllowRedirectedDestination,

    [switch]$ForceCustomized,

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
    $operatorRoot = $ProjectDir
}
else {
    if ($env:XDG_CONFIG_HOME) {
        $destRoot = Join-Path $env:XDG_CONFIG_HOME 'opencode'
        $operatorRoot = $env:XDG_CONFIG_HOME
    }
    elseif ($HOME) {
        $destRoot = Join-Path $HOME '.config\opencode'
        $operatorRoot = $HOME
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

# --- Destination containment preflight (P9) ----------------------------------
# Every path component between the operator-supplied root and each destination
# (including the destinations themselves) must be a real directory, not a
# symlink, junction, or reparse point - otherwise installs, backups, and
# uninstall removals silently follow the link outside the intended tree
# (reproduced 2026-11-09: both a junctioned destRoot and a junctioned skills
# subdirectory received installer writes while the installer reported success
# at the canonical path). The preflight runs before ANY mutation, for both
# install and uninstall. -AllowRedirectedDestination opts in explicitly; the
# resolved real target is printed in every case.
$TestedContainmentPerLink = @{}
function Test-DestinationContainment([string]$Anchor, [string]$Target) {
    if ($Target -eq $Anchor) { return }
    if (-not ($Target.StartsWith($Anchor + '\') -or $Target.StartsWith($Anchor + '/'))) {
        # Not anchored (unexpected); fail safe.
        Write-Fail "Refusing: destination is not under the operator-provided root: $Target"
        Write-Note "Root: $Anchor"
        exit 1
    }
    $relative = $Target.Substring($Anchor.Length).TrimStart('\', '/')
    $acc = $Anchor
    foreach ($comp in ($relative -split '[\\/]+' | Where-Object { $_ })) {
        $acc = Join-Path $acc $comp
        if (-not (Test-Path -LiteralPath $acc)) { continue } # created later by this run
        try {
            $item = Get-Item -LiteralPath $acc -Force
        } catch {
            Write-Fail "Refusing: destination component cannot be inspected: $acc"
            exit 1
        }
        $isLink = $item.LinkType -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
        if ($isLink) {
            $resolved = if ($item.Target) { ($item.Target | Select-Object -First 1) } else { '(target not reported)' }
            if ($AllowRedirectedDestination) {
                if (-not $TestedContainmentPerLink.ContainsKey($acc)) {
                    $TestedContainmentPerLink[$acc] = $true
                    Write-Note "Redirected destination accepted (-AllowRedirectedDestination): $acc -> $resolved"
                }
            }
            else {
                Write-Fail "Refusing: destination component is a symlink, junction, or reparse point: $acc"
                Write-Note "It resolves to: $resolved"
                Write-Note 'Writing or removing files here would follow the link outside the intended destination.'
                Write-Note 'Remove the link and re-run, or re-run with -AllowRedirectedDestination to accept the redirection explicitly.'
                exit 1
            }
        }
    }
}
foreach ($t in @($destRoot, $destCommand, $destSkillDir, $destHelper, $BackupRoot)) {
    Test-DestinationContainment $operatorRoot $t
}

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

# --- Uninstall (ownership-aware, P9) -----------------------------------------
if ($Uninstall) {
    # LOOP removes ONLY paths verified as unchanged LOOP-installed artifacts
    # (byte-identical to the current sources). A path that differs may be
    # user-created or user-modified; refusing it keeps a customized /loop on
    # the user's machine. The refusal is atomic: all targets are classified
    # BEFORE any removal, and a conflict blocks the whole uninstall.
    $allTargets = @(
        @{ Target = $destCommand;   Source = $srcCommand;   Kind = 'file' },
        @{ Target = $destSkillDir;  Source = $srcSkillDir;  Kind = 'directory' },
        @{ Target = $destHelper;    Source = $srcHelper;    Kind = 'file' }
    )
    # Classification pass - BEFORE any mutation: the refusal is atomic, so a
    # customized/user-owned path blocks the whole uninstall, not only itself.
    $conflicts = @()
    foreach ($entry in $allTargets) {
        $target = $entry.Target
        if (-not (Test-Path -LiteralPath $target)) {
            Write-Note "Not installed (skipped): $target"
            continue
        }
        $pristine = $false
        try {
            if ($entry.Kind -eq 'file') {
                $srcPresent = Test-Path -LiteralPath $entry.Source -PathType Leaf
                $pristine = $srcPresent -and ((Get-FileSignature $entry.Source) -eq (Get-FileSignature $target))
            }
            else {
                $srcPresent = Test-Path -LiteralPath $entry.Source -PathType Container
                $pristine = $srcPresent -and (Test-DirIdentical $entry.Source $target)
            }
        } catch {
            $pristine = $false # inspect failure: treat as differing (fail-closed)
        }
        if (-not $pristine) {
            $conflicts += $target
        }
    }
    if ($conflicts.Count -gt 0 -and -not $ForceCustomized) {
        Write-Fail "Uninstall refused: $($conflicts.Count) customized/user-owned path(s) differ from LOOP's sources; nothing was removed."
        foreach ($c in $conflicts) {
            Write-Note "Preserving differing path: $c"
            Write-Note "  It is not byte-identical to LOOP's current sources, so it may be"
            Write-Note "  user-created or user-modified. LOOP does not remove it by default."
        }
        Write-Note 'Remove them manually if they are truly user content, or re-run with'
        Write-Note '-ForceCustomized to back them up and remove them too (backups are'
        Write-Note "kept in $BackupRoot)."
        exit 1
    }
    # Removal pass - every remaining path is verified-owned (or -ForceCustomized).
    $removed = 0
    foreach ($entry in $allTargets) {
        if (-not (Test-Path -LiteralPath $entry.Target)) { continue }
        Backup-Then-Remove $entry.Target | Out-Null
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
