---
description: Cancel the live LOOP run, archiving its terminal state to .loop/archive for retained evidence - never deletes it
---

# /loop-cancel - cancel and archive the durable run state

## Step 1 - arguments

$ARGUMENTS

The remainder (optional) is the cancellation reason, archived with the run.
Keep it free of secrets - the helper refuses secret-shaped content (then
state the refusal verbatim and retry after the operator rewords).

## Step 2 - locate the helper

As in `references/continuity.md`. No running helper → **BLOCKED**, exact
reason; do not delete or move any state file yourself. (Manual deletion is
never the answer here: terminal evidence must be retained.)

## Step 3 - inspect first

Run the helper's `inspect`:

- No live state file → "nothing to cancel" (this includes a run that is
  already COMPLETED/CANCELLED - point to `.loop/archive/<taskId>.json`).
- CORRUPT/unsupported → BLOCKED: the preserved bytes are never cancelled
  over; state the manual options (operator inspects the file first).
- Identity mismatch → refuse and show both roots.

## Step 4 - cancel and archive

An `ACTIVE`, `PAUSED`, `RECOVERY_REQUIRED`, or `BLOCKED` run may be
cancelled. If a LOOP workflow is live in this conversation, instruct it to
stop immediately and produce an honest summary (what changed, what is
VERIFIED vs IMPLEMENTED BUT NOT VERIFIED, what remains) - cancellation is a
user decision, and the run must not pretend it completed.

Run `transition --event cancel --reason <text>`. The helper archives the
terminal state to `.loop/archive/<taskId>.json` and only then removes the
live file. Report: the archive path, the retained `stopReason`, and the note
that terminal evidence is never silently deleted when a new `/loop` starts.
