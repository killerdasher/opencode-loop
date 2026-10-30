#!/usr/bin/env bash
# Install the LOOP command and the loop-engine skill into an OpenCode configuration.
# Usage:
#   bash scripts/install.sh                 # install into the user's global OpenCode config
#   bash scripts/install.sh --local         # install into the current project's ./.opencode
#   bash scripts/install.sh --dest <path>   # install into an explicit config root (testing, advanced)
#   bash scripts/install.sh --uninstall     # remove LOOP-managed files (user files are preserved)
#   bash scripts/install.sh --force-uninstall   # with --uninstall: also removed
#                                   # differing files; every removed file is backed up
# Safety:
#   Files that would be replaced or removed while differing from LOOP's current
#   content are backed up next to themselves with a collision-safe timestamped
#   .bak suffix. Files whose content is already identical are skipped. Files
#   that LOOP does not own are never removed without --force-uninstall.

set -euo pipefail

MARKER_TEXT="Iterative Engineering Engine"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/../.opencode" && pwd)"

say() { printf '[loop] %s\n' "$1" >&1; }
fail() { printf '[loop] ERROR: %s\n' "$1" >&2; exit 1; }

sha() {
    # Cross-platform sha256 helper: sha256sum on Linux/Git-bash, shasum on macOS.
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" 2>/dev/null | cut -d' ' -f1
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1
    else
        printf '%s' ""
    fi
}

loop_owned() {
    grep -q "$MARKER_TEXT" "$1" 2>/dev/null
}

# Backup with a collision-safe name. Prints the created path on success; returns
# nonzero and prints nothing on failure. Callers must invoke it via command
# substitution and check BOTH the exit status and the captured output:
#   if ! backup="$(backup_existing "$target")" || [ -z "$backup" ]; then ...
# (Command substitution runs in a subshell: it cannot propagate a status
# variable, so none is used.)
backup_existing() {
    local stamp n candidate
    stamp="$(date +%Y%m%d-%H%M%S 2>/dev/null)" || return 1
    candidate="$1.bak.$stamp"
    n=0
    while [ -e "$candidate" ]; do
        n=$((n + 1))
        candidate="$1.bak.$stamp-$n"
    done
    cp -p "$1" "$candidate" 2>/dev/null || return 1
    printf '%s' "$candidate"
}

# Manifest derived from the source tree: new files under .opencode/ ship automatically.
SOURCE_NAMES=()
while IFS= read -r -d '' f; do
    rel="${f#"$SOURCE_ROOT"/}"
    SOURCE_NAMES+=("$rel")
done < <(find "$SOURCE_ROOT" -type f -print0 2>/dev/null)

if [ "${#SOURCE_NAMES[@]}" -eq 0 ]; then
    fail "no source files found under $SOURCE_ROOT"
fi

LOCAL=false
UNINSTALL=false
FORCE=false
DEST=""

print_help() {
    # Print the leading comment block of this script (up to the first non-comment line).
    awk 'NR==1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}"
    exit 0
}

while [ $# -gt 0 ]; do
    case "$1" in
        --local) LOCAL=true ;;
        --uninstall) UNINSTALL=true ;;
        --force-uninstall) FORCE=true ;;
        --dest)
            [ $# -ge 2 ] || fail "--dest requires a path argument"
            DEST="$2"
            shift
            ;;
        --dest=*) DEST="${1#--dest=}" ;;
        -h|--help) print_help ;;
        *) fail "unknown argument: $1 (see --help)" ;;
    esac
    shift
done

if [ "$LOCAL" = true ] && [ -n "$DEST" ]; then
    fail "use either --local or --dest, not both"
fi

if [ "$LOCAL" = true ]; then
    DEST_ROOT="$(pwd)/.opencode"
elif [ -n "$DEST" ]; then
    DEST_ROOT="${DEST%/}"
else
    if [ -n "${XDG_CONFIG_HOME:-}" ]; then
        DEST_ROOT="$XDG_CONFIG_HOME/opencode"
    else
        DEST_ROOT="${HOME}/.config/opencode"
    fi
fi

# --- Summary reporting: every run reports what it did, even on early failure ---

SUMMARY=""
KEPT_COUNT=0
FINISHED=0

summarize() {
    # Print the summary; used on normal completion and by the EXIT trap on failure.
    printf '%s' "${SUMMARY}"
    if [ "$FINISHED" != 1 ]; then
        printf 'ERROR       aborted early (exit %s)\n' "$1" >&1
    fi
}

trap 'status=$?; if [ "$FINISHED" != 1 ]; then summarize "$status"; fi; exit "$status"' EXIT

# Uninstall per-file: identical -> removed; marker-owned or forced -> backed up then removed
# (differing content is always recoverable); anything else -> kept intact.
uninstall_one() {
    local name="$1"
    local target="$DEST_ROOT/$name"
    local src="$SOURCE_ROOT/$name"
    if [ ! -f "$target" ]; then
        SUMMARY="${SUMMARY}ABSENT    $name"$'\n'
        return 0
    fi

    local IDENTICAL=false
    if [ -f "$src" ] && [ -n "$(sha "$target")" ] && [ "$(sha "$target")" = "$(sha "$src")" ]; then
        IDENTICAL=true
    fi

    if [ "$IDENTICAL" = true ]; then
        rm -f "$target"
        SUMMARY="${SUMMARY}REMOVED   $name (identical to current LOOP version)"$'\n'
        return 0
    fi

    if loop_owned "$target" || [ "$FORCE" = true ]; then
        local backup
        if ! backup="$(backup_existing "$target")" || [ -z "$backup" ]; then
            SUMMARY="${SUMMARY}FAILED    $name (could not create backup before removal)"$'\n'
            return 1
        fi
        local reason="differing LOOP content"
        if [ "$FORCE" = true ] && ! loop_owned "$target"; then
            reason="forced removal"
        fi
        rm -f "$target"
        SUMMARY="${SUMMARY}REMOVED   $name ($reason; backup: ${backup##*/})"$'\n'
        return 0
    fi

    KEPT_COUNT=$((KEPT_COUNT + 1))
    SUMMARY="${SUMMARY}KEPT      $name (not LOOP-managed; content differs and --force-uninstall was not supplied)"$'\n'
    return 0
}

install_one() {
    local name="$1"
    local target="$DEST_ROOT/$name"
    local src="$SOURCE_ROOT/$name"
    if ! mkdir -p "$(dirname "$target")" 2>/dev/null; then
        SUMMARY="${SUMMARY}FAILED    $name (could not create directory)"$'\n'
        return 1
    fi
    if [ ! -f "$target" ]; then
        if ! cp -p "$src" "$target" 2>/dev/null; then
            SUMMARY="${SUMMARY}FAILED    $name (copy failed)"$'\n'
            return 1
        fi
        SUMMARY="${SUMMARY}INSTALLED $name"$'\n'
        return 0
    fi
    if [ -n "$(sha "$target")" ] && [ "$(sha "$target")" = "$(sha "$src")" ]; then
        SUMMARY="${SUMMARY}UP-TO-DATE $name"$'\n'
        return 0
    fi
    local backup
    if ! backup="$(backup_existing "$target")" || [ -z "$backup" ]; then
        SUMMARY="${SUMMARY}FAILED    $name (could not create backup before replace)"$'\n'
        return 1
    fi
    if ! cp -p "$src" "$target" 2>/dev/null; then
        SUMMARY="${SUMMARY}FAILED    $name (copy failed after backup)"$'\n'
        return 1
    fi
    SUMMARY="${SUMMARY}REPLACED  $name (previous file backed up: ${backup##*/})"$'\n'
    return 0
}

FAILED_COUNT=0
if [ "$UNINSTALL" = true ]; then
    say "Uninstalling from: $DEST_ROOT"
    for name in "${SOURCE_NAMES[@]}"; do
        if ! uninstall_one "$name"; then
            FAILED_COUNT=$((FAILED_COUNT + 1))
        fi
    done

    for dir in "$DEST_ROOT/skills/loop-engine/references" "$DEST_ROOT/skills/loop-engine" "$DEST_ROOT/skills"; do
        if [ -d "$dir" ] && [ -z "$(ls -A "$dir" 2>/dev/null)" ]; then
            if rmdir "$dir" 2>/dev/null; then
                SUMMARY="${SUMMARY}RMDIR     $dir"$'\n'
            else
                SUMMARY="${SUMMARY}FAILED    rmdir $dir"$'\n'
                FAILED_COUNT=$((FAILED_COUNT + 1))
            fi
        fi
    done
else
    say "Installing into: $DEST_ROOT"
    for name in "${SOURCE_NAMES[@]}"; do
        if ! install_one "$name"; then
            FAILED_COUNT=$((FAILED_COUNT + 1))
        fi
    done
fi

if [ "$FAILED_COUNT" -gt 0 ]; then
    FINISHED=1
    summarize "$FAILED_COUNT"
    exit 1
fi

if [ "$UNINSTALL" = true ]; then
    FINISHED=1
    summarize "$FAILED_COUNT"
    if [ "$KEPT_COUNT" -gt 0 ]; then
        say "Uninstall finished: kept=$KEPT_COUNT - done."
    else
        say "Uninstall finished - done."
    fi
else
    FINISHED=1
    summarize "$FAILED_COUNT"
    say "Install finished. Open a project in OpenCode and run /loop with your task."
fi
exit 0
