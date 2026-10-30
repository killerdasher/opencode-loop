---
description: Run the LOOP iterative engineering workflow (analyze, implement, verify, adversarially review, improve) on a task
---

START THE LOOP WORKFLOW.

Before inspecting any files or answering anything else, load the `loop-engine` skill by calling the skill tool with id `loop-engine`, then execute its complete workflow for the task defined below.

## Task arguments

$ARGUMENTS

## How to read the arguments

- If the arguments above are empty or whitespace only, the task is the objective already being discussed in this conversation. State the objective you extracted from the conversation in one line as part of Stage 0, then continue.
- Otherwise, strip control flags from the argument text before Stage 0. Supported flags:
  - `--max-iterations <n>` — iteration budget, integer 1 to 10, default 5.
  - `--mode <focused|balanced|deep>` — execution depth, default `balanced`.
- Out-of-range `--max-iterations` values are clamped to the nearest bound (1 or 10). Unknown `--mode` values fall back to `balanced`. Unknown flags fall back to defaults. In every case: do not abort, do not fail silently, and state the exact correction explicitly in your Stage 0 summary.
- After flag stripping, state the resolved settings explicitly in your Stage 0 summary as `SETTINGS: mode=<m>, iterations=<n>`, and use exactly those values in every later `LOOP | ITERATION n/N` banner and in the Stage 8 iteration arithmetic. Never let the resolved values drift silently back to defaults.
- Everything remaining after flag stripping is the task.

## Non-negotiable startup behavior

1. Load `loop-engine` first, before any other action.
2. If the `loop-engine` skill cannot be loaded, say so plainly, run a degraded best-effort loop using this outline (objective → reconnaissance → implement → verify → adversarial review → improve → converge), and mark the run as `DEGRADED — SKILL UNAVAILABLE` in the final report.
3. Never silently substitute a non-loop answer for the loop workflow.
