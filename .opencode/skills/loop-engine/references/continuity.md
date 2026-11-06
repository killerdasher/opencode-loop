# Continuity reference (ADR 0002) - durable run state for the nine-stage loop

LOOP's nine-stage methodology is unchanged by continuity. This reference adds
two things: an input (Stage 0 may consume an existing checkpoint) and an output
(each run is durably tracked and archived at its terminal state). Read this
together with `docs/adr/0002-loop-continuity.md`; that decision record is the
authority.

## Mechanism honesty - state this in reports when continuity is discussed

| Layer | Can do | Cannot do (never claim otherwise) |
| --- | --- | --- |
| Commands + skills | orchestrate: read state, request file edits through the agent, restate objectives, instruct honest stops | guarantee checkpoint writes, interrupt a live turn, auto-resume |
| Helper | validate schema/transitions/identity; atomically persist; reject secret-shaped values (best-effort) | enforce anything at runtime; list processes; lock files |
| Future native OpenCode runtime (NOT built) | automatic session re-drive on idle/error events, hard iteration enforcement, provider-limit detection with backoff, mid-turn interruption | - all four named capabilities are explicitly absent in this release |

## The helper (deterministic validation/persistence tier)

The helper is a Node (>=16.7) script named
`continuity.mjs` supporting `inspect`, `init`, `transition`, `update`, and
`repair` subcommands, exiting 0 = ok, 1 = refused/error, 2 = BLOCKED,
3 = usage. Search order for the helper file:

1. `<project>/.opencode/scripts/continuity.mjs` (project-scope install)
2. `<OpenCode config>/scripts/continuity.mjs` - `$XDG_CONFIG_HOME/opencode` if
   set, else `~/.config/opencode` (global install)
3. `scripts/continuity.mjs` relative to the repository root (LOOP development)

**BLOCKED path (keep it honest):** if no helper file runs (missing, unknown
command shape, Node unavailable, spawn failure), continuity operations report
`BLOCKED` with the exact reason and the install instruction
(`scripts/install.ps1|sh`, or manual copy of the helper file). Never fabricate
state-file content in the meantime. The plain `/loop` workflow never requires
the helper.

## State file

`<project>/.loop/continuity.json` - schema v1; run status
`ACTIVE | PAUSED | RECOVERY_REQUIRED | BLOCKED | COMPLETED | CANCELLED`; file
integrity tracked separately as `VALID | SUSPECTED_STALE | CORRUPT`. Terminal
runs move to `<project>/.loop/archive/<taskId>.json` and are retained.

## Write protocol (prompt-level discipline - measured, not guaranteed)

Update the checkpoint at defined transitions; if the helper is unavailable,
write nothing rather than writing unvalidated content (report BLOCKED). If
persuaded that a stage cannot checkpoint honestly, say so in the report - do
not invent a fake checkpoint.

- **Stage entry** (`init` once; `update` thereafter): record `stage`,
  `iteration`, and the planned work summary for the entering stage. Write
  BEFORE the stage's first modification (write-before-act); a killed session
  then leaves a truthful resume point, with no promise that in-flight work
  inside the interrupted stage is bounded.
- **Stage exit/iteration boundary** (`update`): record the completed stage
  number, a one-line `summary`, a truthful `nextStep`, and evidence paths
  already known to exist (no invented paths).
- Every helper write bumps `generation` and updates `updatedAt`.

Field hygiene (enforced by the helper's best-effort scanner; see its header
for limits): no tokens, no environment values, no raw transcripts, no bulky
command output; evidence is stored as paths, not content; remote URLs are
sanitized by the helper before fingerprinting.

## Recovery gates (in `/loop-resume`; never skip a gate)

1. Inspect (read-only). CORRUPT/unsupported → BLOCKED, preserved bytes
   stated, no repair without explicit operator instruction.
2. Identity. Mismatch → refuse, show both project roots.
3. Status semantics (no automatic resume): ACTIVE never resumes by itself;
   PAUSED requires operator confirmation of objective and scope;
   RECOVERY_REQUIRED requires read-only reconciliation FIRST (git state,
   evidence paths, interrupted changes), then findings, then explicit
   operator approval before any further modification.
4. Restore: restate the objective, `SETTINGS:`, remaining MUST/SHOULD
   items, and the iteration counter; re-enter the nine-stage loop at the
   recorded stage. Stage 0 of a resumed run consumes the checkpoint instead
   of a fresh prompt.

`BLOCKED` run status means an operation could not proceed safely; report it
with the operation's exact refusal reason. `--force` does not exist in this
release; never invent override flags.
