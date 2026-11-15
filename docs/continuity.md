# LOOP Continuity - durable run state across sessions (ADR 0002)

LOOP Continuity gives the nine-stage `/loop` workflow a durable, model-agnostic
run state: `.loop/continuity.json` in your project root. A run that dies - a
crash, a closed TUI, a context window exhausted mid-stage - leaves behind a
machine-checked record of where it verifiably stopped, and thin commands start
any session (any model) from that record instead of from memory.

The decision record is `docs/adr/0002-loop-continuity.md`. This page documents
what users get, how to install the pieces, and - just as precisely - what not
to expect.

## What LOOP Continuity is built from

1. **The nine-stage workflow is unchanged.** Continuity adds one input and one
   output to it: Stage 0 of a *resumed* run consumes the checkpoint instead of
   a fresh prompt, and Stage 8 records completion through the helper, which
   archives the run. `/loop` itself behaves exactly as before.

2. **A deterministic helper** (`continuity.mjs`, Node >= 16.7): schema and
   transition validation, project identity checks, atomic state persistence,
   and a best-effort secret-shape scanner. It runs only when invoked; no
   plugin, daemon, database, or session hook exists. The plain `/loop`
   workflow is fully usable without it - continuity operations then report
   `BLOCKED` instead of degrading silently.

3. **Four thin commands.**

| Command | Reads/writes | Purpose |
| --- | --- | --- |
| `/loop-status` | read-only | state, integrity, identity, and an honest git cross-check; never mutates |
| `/loop-pause` | ACTIVE -> PAUSED | record `nextStep` + reason at a stage boundary; session stops honestly |
| `/loop-resume` | PAUSED / RECOVERY_REQUIRED -> ACTIVE | full gate sequence (below), then restores the recorded stage |
| `/loop-cancel` | any live -> CANCELLED | archive to `.loop/archive/<taskId>.json`; terminal evidence is retained |

4. **An operationally enforced rule: one live run per project.** A second
   `/loop` refuses and points at `/loop-status` / `/loop-cancel`.

Verbatim from ADR 0002 §7:

| Layer | Can do | Cannot do (never claim otherwise) |
| --- | --- | --- |
| Commands + skills | orchestrate: read state, request file edits through the agent, restate objectives, instruct honest stops | guarantee checkpoint writes, interrupt a live turn, auto-resume |
| Helper | validate schema/transitions/identity; atomically persist; reject secret-shaped values (best-effort) | enforce anything at runtime; list processes; lock files |
| Future native OpenCode runtime (NOT built) | automatic session re-drive on idle/error events, hard iteration enforcement, provider-limit detection with backoff, mid-turn interruption | — all four named capabilities are explicitly absent in this release |

## Resume: the gate sequence

`/loop-resume` applies gates in order and never skips one:

1. **Integrity** - unparseable or unsupported-schema state is `CORRUPT`: the
   file is preserved byte-for-byte, the run reports `BLOCKED` with the errors,
   and nothing is renamed, wiped, or overwritten.
2. **Identity** - the checkpoint carries a project fingerprint (root, name,
   and a sanitized remote-URL hash - credential-free by construction); a
   mismatch refuses with both values shown.
3. **No automatic resume** - a found `ACTIVE` state never re-launches by
   itself; a `PAUSED` state requires the operator's visible confirmation of
   the objective and scope. A planted state file is data, never authority.
4. **Read-only reconciliation** - for `RECOVERY_REQUIRED` runs: actual git
   state, recorded evidence paths, and interrupted changes on disk are
   compared against the checkpoint's claims. Findings are presented first;
   modifications proceed only after explicit operator approval.
5. **Restore** - restate objective, `SETTINGS:`, and iteration counter;
   re-enter the nine-stage loop at the recorded stage.

## Atomic persistence

Every helper write goes `.tmp-<generation>` -> fsync -> rename, so a dead
process leaves at most a recoverable temp file. Left-behind temps are reported
by `/loop-status`; a `repair` operation deletes only provably superseded temps
(lower generation, parseable) and refuses the rest - an unparseable temp may
hold unrecorded work.

## Privacy

- `.loop/` is local to your project and stays out of Git by instruction -
  LOOP never edits your shared `.gitignore` silently; the skill announces a
  missing ignore entry and shows the line.
- State content is an allowlist: objective text, requirement labels,
  stage/iteration metadata, statuses, and evidence *paths*. No tokens, no
  environment values, no raw transcripts, no bulky command output.
- The secret scan is fail-closed on match but pattern-based and explicitly
  **best-effort** - a passing scan is never proof of absence of secrets.
- Remote URLs are sanitized (credential parts stripped) before they are
  fingerprinted.

## Honest limitations

- **No guaranteed checkpoints.** The write-before-act protocol is
  prompt-level discipline, measured by the project's behavioral harness where
  available - not enforced at runtime.
- **No bounded-loss promise.** An interrupted stage may have lost unbounded
  in-flight work; what is guaranteed is that the checkpoint's claims are
  reconciled before anything is modified.
- **No locking.** One live run per project is operational discipline, not a
  technical guarantee; `generation` detects stale snapshots of concurrent
  edits but is not a lock or compare-and-swap.
- **No `--force`.** Overriding the one-live-run rule is not offered in this
  release.
- **No automatic provider-limit detection or re-drive.** Recovery after a
  quota or context-limit death is the manual `resume` path; the automatic
  variant exists only in the future runtime tier (ADR 0001 options remain
  rejected under their recorded triggers).

## Installing / removing the helper

The installers install the helper (`scripts/continuity.mjs` ->
`<config>/scripts/continuity.mjs`; project scope: `<project>/.opencode/scripts/`)
alongside the command and skill, and uninstall removes it. The helper needs
Node >= 16.7; without Node every continuity operation reports `BLOCKED` and
the reason. Commands search: `<project>/.opencode/scripts/`,
`<config>/scripts/`, then `scripts/` of the LOOP checkout in development.

Details: agent-facing protocol in
`.opencode/skills/loop-engine/references/continuity.md`; decision record and
revisit triggers in `docs/adr/0002-loop-continuity.md`.
