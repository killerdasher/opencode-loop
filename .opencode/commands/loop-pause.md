---
description: Pause the current LOOP run at an honest stage boundary, recording next steps and the given reason - only from ACTIVE state
---

# /loop-pause - request a durable pause of the live LOOP run

## Step 1 - arguments

$ARGUMENTS

The remainder (optional) is the pause reason, stored in the state file. Keep
it free of secrets - the helper's best-effort scanner refuses secret-shaped
content and would block the write entirely.

## Step 2 - locate the helper

As in `references/continuity.md`. No running helper → report **BLOCKED** with
the precise reason and do not create or edit any state file yourself.

## Step 3 - inspect first, never blind-mutate

Run the helper's `inspect` on the current project root:

- No live state file → report plainly: nothing to pause; offer `/loop` to
  start a run. Exit with an honest no-op summary.
- Integrity CORRUPT or unsupported → report BLOCKED: the file is preserved
  byte-for-byte and nothing may pause over it; explain the manual options.
- Identity mismatch → refuse: show the recorded project root vs this one.
- Status gate: only `ACTIVE` may pause. If the live
  status is `PAUSED`, reporting "already paused" is the honest outcome. If it
  is `RECOVERY_REQUIRED` or `BLOCKED`, refuse and point to
  `/loop-resume` (recovery discipline) or `/loop-cancel`.

## Step 4 - pause at an honest boundary

Behavior when a LOOP workflow is live in this conversation: instruct it to
finish its current stage, record findings honestly, and stop; do not abandon
mid-tool-call silently. Then run the helper `transition --event pause
--reason <text>`.

Report the resulting state: status PAUSED, new generation, the recorded
`nextStep`/summary that a future `/loop-resume` will restore, plus the
iteration counter it will continue from. State the honest limitation once:
pause takes effect at prompt/stage boundaries; a live turn is never
interrupted by this command.
