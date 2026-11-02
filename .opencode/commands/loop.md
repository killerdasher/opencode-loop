---
description: Run the LOOP iterative engineering workflow - analyze, implement, verify, adversarially review, and improve until convergence
---

# /loop - iterative engineering engine

Execute the LOOP workflow for the task below. Do not answer the task directly from this prompt alone.

## Step 1 - load the engine (first action, before anything else)

Call the `skill` tool for `loop-engine`, then follow its complete workflow for this task. Load the skill before inspecting files or producing any other output.

If the `loop-engine` skill cannot be loaded, say so plainly and continue with a best-effort loop using this outline: objective -> reconnaissance -> plan -> implement -> verify -> adversarial review -> improve -> converge. Mark the run as `DEGRADED - SKILL UNAVAILABLE` in the final report. Never silently substitute a non-loop answer for the loop workflow.

## Step 2 - task arguments

$ARGUMENTS

## Step 3 - resolve settings and the task

- If the text above is empty or whitespace only, the task is the objective already being discussed in this conversation. State that objective in one line as your Stage 0 input, then continue.
- Otherwise, strip control flags from the argument text before Stage 0. Supported flags:
  - `--max-iterations <n>` - iteration budget, integer 1 to 10, default 5. Out-of-range values are clamped to the nearest bound (1 or 10).
  - `--mode <focused|balanced|deep>` - execution depth, default `balanced`. Unknown values fall back to `balanced`.
  - Unknown flags are ignored, never fatal: name each one and its correction in your Stage 0 summary. Do not abort and do not fail silently.
- Everything remaining after flag stripping is the task. Preserve the user's entire original objective - do not truncate, summarize away, or drop any part of it. If nothing remains after flag stripping (flags only, no task), treat it as the no-task case above: use the current conversation as the objective.
- Restate the resolved settings exactly as `SETTINGS: mode=<m>, iterations=<n>` in your Stage 0 summary, and use those values in every `LOOP | ITERATION n/N` banner and in the Stage 8 iteration arithmetic. Never let the resolved values drift silently back to defaults.
