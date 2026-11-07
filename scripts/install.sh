#!/usr/bin/env bash
#
# Installs the LOOP /loop command and loop-engine skill for OpenCode.
#
# Copies .opencode/commands/loop.md and .opencode/skills/loop-engine/ from this
# repository into an OpenCode configuration directory.
#
# Default destination is the global OpenCode config directory:
#   ${XDG_CONFIG_HOME:-$HOME/.config}/opencode
# Use --project to install into <dir>/.opencode instead.
#
# Existing files are NEVER silently overwritten:
#   - identical files are skipped (idempotent install)
#   - differing files cause an error unless --overwrite is given
#   - with --overwrite, a timestamped backup is created first
#
# Usage:
#   ./scripts/install.sh                      # global install
#   ./scripts/install.sh --project [dir]      # project-local install (dir defaults to $PWD)
#   ./scripts/install.sh --overwrite          # replace differing files (with backup)
#   ./scripts/install.sh --uninstall          # remove installed files (with backup)
#   ./scripts/install.sh --dry-run            # print actions, change nothing
#   ./scripts/install.sh --help

set -euo pipefail

SCOPE="global"
PROJECT_DIR=""
OVERWRITE=0
UNINSTALL=0
DRYRUN=0
TIMESTAMP="$(date +%Y%m%d%H%M%S)"

usage() {
  cat <<'EOF'
Usage: install.sh [options]

Options:
  --global            Install into the global OpenCode config directory (default).
  --project [dir]     Install into <dir>/.opencode (dir defaults to the current directory).
  --overwrite         Replace differing existing files after creating backups.
  --uninstall         Remove installed LOOP files (backing them up first).
  --dry-run           Print what would happen without changing anything.
  -h, --help          Show this help.

Exit codes: 0 = success (including "already up to date"), 1 = error or refused overwrite.
EOF
}

note() { printf '[LOOP] %s\n' "$1"; }
fail() { printf '[LOOP] ERROR: %s\n' "$1" >&2; }

# --- Parse arguments ---------------------------------------------------------
while [ "$#" -gt 0 ]; do
  case "$1" in
    --global)
      SCOPE="global"
      shift
      ;;
    --project)
      SCOPE="project"
      if [ "$#" -gt 1 ] && [ "${2#--}" = "$2" ]; then
        PROJECT_DIR="$2"
        shift 2
      else
        shift
      fi
      ;;
    --overwrite)
      OVERWRITE=1
      shift
      ;;
    --uninstall)
      UNINSTALL=1
      shift
      ;;
    --dry-run)
      DRYRUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      usage >&2
      exit 1
      ;;
  esac
done

# --- Locate repository source files -----------------------------------------
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
SRC_COMMAND="$REPO_ROOT/.opencode/commands/loop.md"
SRC_SKILL_DIR="$REPO_ROOT/.opencode/skills/loop-engine"
# Continuity helper (ADR 0002): deterministic state validation/persistence.
# Installed outside the skill directory (see backup-root rationale below:
# OpenCode discovers extensions under <config>/commands and <config>/skills).
SRC_HELPER="$REPO_ROOT/scripts/continuity.mjs"

if [ ! -f "$SRC_COMMAND" ] || [ ! -f "$SRC_SKILL_DIR/SKILL.md" ] || [ ! -f "$SRC_HELPER" ]; then
  fail "Repository is incomplete; missing source files under $REPO_ROOT/.opencode"
  note "Run this script from a complete opencode-loop checkout."
  exit 1
fi

# --- Resolve destination root ------------------------------------------------
if [ "$SCOPE" = "project" ]; then
  if [ -z "$PROJECT_DIR" ]; then
    PROJECT_DIR="$(pwd)"
  fi
  if [ ! -d "$PROJECT_DIR" ]; then
    fail "Project directory does not exist: $PROJECT_DIR"
    exit 1
  fi
  DEST_ROOT="$PROJECT_DIR/.opencode"
else
  if [ -n "${XDG_CONFIG_HOME:-}" ]; then
    DEST_ROOT="$XDG_CONFIG_HOME/opencode"
  elif [ -n "${HOME:-}" ]; then
    DEST_ROOT="$HOME/.config/opencode"
  else
    fail "Cannot determine the global config directory (HOME and XDG_CONFIG_HOME are both unset)."
    exit 1
  fi
fi

# Backup root: sibling of DEST_ROOT, never inside it (see unique_backup_path
# for why backups must stay out of OpenCode's extension discovery directories).
BACKUP_ROOT="$(dirname "$DEST_ROOT")/$(basename "$DEST_ROOT")-loop-backups"

DEST_COMMAND="$DEST_ROOT/commands/loop.md"
DEST_SKILL_DIR="$DEST_ROOT/skills/loop-engine"
DEST_HELPER="$DEST_ROOT/scripts/continuity.mjs"

note "Scope: $SCOPE"
note "Destination: $DEST_ROOT"
if [ "$DRYRUN" -eq 1 ]; then
  note "DRY RUN - no files will be changed."
fi

# --- Helpers -----------------------------------------------------------------
files_identical() { cmp -s "$1" "$2"; }

dirs_identical() { diff -rq "$1" "$2" >/dev/null 2>&1; }

unique_backup_path() {
  # $1 = path being backed up; never returns an existing path (same-second runs
  # must not clobber an earlier backup). Backups live in BACKUP_ROOT - a
  # sibling of DEST_ROOT, never inside it: OpenCode scans <config>/commands and
  # <config>/skills for extension files, so an in-place "loop-engine.backup-*"
  # directory (which contains a live SKILL.md) is discovered as a phantom
  # skill - observed 2026-11-04. Tree structure is preserved inside the root:
  # <BACKUP_ROOT>/<TIMESTAMP>/<path relative to DEST_ROOT>.
  local rel="${1#"$DEST_ROOT/"}"
  local base="$BACKUP_ROOT/$TIMESTAMP/$rel"
  local candidate="$base"
  local i=2
  while [ -e "$candidate" ]; do
    candidate="$base-$i"
    i=$((i + 1))
  done
  mkdir -p "$(dirname "$candidate")"
  printf '%s' "$candidate"
}

backup_and_remove() {
  # $1 = path to back up and remove
  if [ "$DRYRUN" -eq 1 ]; then
    note "DRY RUN: would back up $1 -> $BACKUP_ROOT/$TIMESTAMP/${1#"$DEST_ROOT/"} and remove it."
    return 0
  fi
  local backup
  backup="$(unique_backup_path "$1")"
  mv "$1" "$backup"
  note "Backed up: $1 -> $backup"
}

# --- Uninstall ---------------------------------------------------------------
if [ "$UNINSTALL" -eq 1 ]; then
  removed=0
  for target in "$DEST_COMMAND" "$DEST_SKILL_DIR" "$DEST_HELPER"; do
    if [ ! -e "$target" ]; then
      note "Not installed (skipped): $target"
      continue
    fi
    backup_and_remove "$target"
    removed=$((removed + 1))
  done
  if [ "$DRYRUN" -eq 1 ]; then
    note "DRY RUN complete; nothing was changed."
  elif [ "$removed" -eq 0 ]; then
    note "Nothing to uninstall; no LOOP files were present."
  else
    note "Uninstall complete ($removed item(s) removed, backups kept in $BACKUP_ROOT)."
    note "Backups can be deleted manually when no longer needed."
  fi
  exit 0
fi

# --- Install -----------------------------------------------------------------
install_file() {
  # $1 = source, $2 = destination
  if [ -f "$2" ]; then
    if files_identical "$1" "$2"; then
      note "Up to date: $2"
      return 0
    fi
    if [ "$OVERWRITE" -ne 1 ]; then
      fail "Refusing to overwrite a differing file: $2"
      note "It may be user-created or from another LOOP version."
      note "Re-run with --overwrite to replace it (a timestamped backup is created first),"
      note "or install manually by copying the source file yourself."
      exit 1
    fi
    if [ "$DRYRUN" -eq 1 ]; then
      note "DRY RUN: would back up and replace $2"
      return 0
    fi
    local backup
    backup="$(unique_backup_path "$2")"
    mv "$2" "$backup"
    note "Backed up: $2 -> $backup"
  elif [ -d "$2" ]; then
    fail "Destination path is a directory but a file is expected: $2"
    exit 1
  fi
  if [ "$DRYRUN" -eq 1 ]; then
    note "DRY RUN: would install $2"
    return 0
  fi
  mkdir -p "$(dirname "$2")"
  cp "$1" "$2"
  note "Installed: $2"
}

install_skill_dir() {
  # $1 = source, $2 = destination
  if [ -f "$2" ]; then
    fail "Destination path is a file but a directory is expected: $2"
    exit 1
  fi
  if [ -d "$2" ]; then
    if dirs_identical "$1" "$2"; then
      note "Up to date: $2"
      return 0
    fi
    if [ "$OVERWRITE" -ne 1 ]; then
      fail "Refusing to overwrite a differing skill directory: $2"
      note "It may be user-created or from another LOOP version."
      note "Re-run with --overwrite to replace it (a timestamped backup is created first)."
      exit 1
    fi
    if [ "$DRYRUN" -eq 1 ]; then
      note "DRY RUN: would back up and replace $2"
      return 0
    fi
    backup_and_remove "$2"
  fi
  if [ "$DRYRUN" -eq 1 ]; then
    note "DRY RUN: would install $2"
    return 0
  fi
  mkdir -p "$(dirname "$2")"
  cp -R "$1" "$2"
  note "Installed: $2"
}

install_file "$SRC_COMMAND" "$DEST_COMMAND"
install_skill_dir "$SRC_SKILL_DIR" "$DEST_SKILL_DIR"
install_file "$SRC_HELPER" "$DEST_HELPER"

if [ "$DRYRUN" -eq 1 ]; then
  note "DRY RUN complete; nothing was changed."
else
  note "Install complete."
  note "Usage: open OpenCode in the target project and run: /loop <your task>"
fi
exit 0
