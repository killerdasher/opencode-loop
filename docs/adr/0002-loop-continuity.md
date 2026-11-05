# ADR 0002: LOOP Continuity — durable run state and lifecycle commands

- **Status:** accepted (design approved; implementation phased) — 2026-11-05
- **Decision:** add continuity as a **command + skill** capability with an
  **optional, deterministic, zero-dependency helper**; no plugin, daemon,
  database, or external framework
- **Supersedes:** nothing. Reopens **ADR 0001 on trigger #2 only** ("a real
  use case requires resume-after-crash") at the command level; ADR 0001's
  runtime decisions (plugin/orchestrator rejected) remain — see the ADR 0001
  addendum of the same date.
- **Deciders:** repository maintainer; owner architecture review approved
  with amendments on 2026-11-05 (all amendments folded into this record).

## Context

LOOP's nine-stage workflow keeps iteration state (counter, stage, findings,
convergence decision) in the model's context and report prose. When a session
or a model dies mid-run — crash, context-limit exhaustion, provider quota —
that context is lost; recovery today is manual reconstruction.

The owner-approved design goal: make loop state a **durable, model-agnostic,
evidence-grade file** that the workflow writes at defined transitions and that
thin commands consume, so any new session — any model — can verifiably pick a
run up where the previous one left off, without LOOP gaining a runtime.

Design inputs (studied, not copied): `GoDiao/oc-loop` (public TypeScript
plugin; source read 2026-11-05). Adopted concepts: a versioned state store on
disk; an explicit status/transition table; run-targeted lifecycle commands;
pause-vs-abort distinction; completion verified by evidence, not self-report.
Rejected from it (as incompatible with LOOP's constraints or defects in its
own behavior): plugin-based re-drive; silent empty-store fallback on corrupt
JSON; non-atomic writes; unlocked read-modify-write; deletion of terminal
state; Bun/POSIX-locked test runner; unfiltered content in state files.

## Decision (as amended by the 2026-11-05 owner review)

### 1. Deterministic state validation — optional helper

A minimal, zero-external-dependency Node ≥16.7 helper (`scripts/continuity.mjs`) provides:

- state-file schema validation (versioned schema, allowlisted fields);
- transition validation against the lifecycle table;
- project identity verification;
- atomic persistence (temporaries + rename, recoverable).

The **normal LOOP workflow must remain usable without the helper.** Continuity
operations that require validation or persistence **report `BLOCKED`** and
exact instructions when the helper cannot run (missing, wrong Node, spawn
failure). The helper is offline, file-scoped, session-hook-free code — the
same class as this repository's own validator. It is **not** a resident
runtime, plugin, daemon, or database; see the ADR 0001 addendum. Adherence of
prompt-level writing remains *measured* by the harness, never assumed.

### 2. Consistent state model

Two orthogonal dimensions, kept separate:

- **Run status:** `ACTIVE | PAUSED | RECOVERY_REQUIRED | BLOCKED | COMPLETED | CANCELLED`
- **File integrity:** `VALID | SUSPECTED_STALE | CORRUPT`

`BLOCKED` is a run status (an operation could not proceed safely at
validation/persistence level), not a data state. Corrupt or unsupported
schema-version state is **never silently overwritten, emptied, or deleted**
(oc-loop's silent-empty-store behavior is explicitly rejected); it is
preserved byte-for-byte (e.g. renamed `*.corrupt-<timestamp>`) and the run
reports `BLOCKED` with the evidence.

### 3. Recovery safety — no automatic resume

A found `ACTIVE` or `PAUSED` state file **never resumes execution
automatically.** `/loop-resume` first reconciles, read-only:

- actual Git state (branch, HEAD, dirty paths) vs the recorded checkpoint;
- recorded file hashes / evidence paths vs reality;
- interrupted changes found on disk (present but unrecorded).

A **potentially interrupted stage** — claims that cannot be reconciled, or
uncommitted work the checkpoint does not explain — sets the run to
`RECOVERY_REQUIRED`: the resume reports the discrepancy, the run stays halted,
and modifications proceed only after the operator inspects the findings and
explicitly instructs continuation. Recovery with a dirty reconciliation
report is an accepted, expected outcome — not a failure of the protocol.

**No promise of bounded data loss.** The earlier draft's
"at-most-one-stage loss" claim is *withdrawn*: the checkpoint records intent,
not guarantees; a killed stage may lose arbitrary in-flight work. What is
guaranteed is that everything the checkpoint claimed is reconciled before
anything is modified.

### 4. Concurrency honesty

- **One live run per project is an operational rule, not a technical
  guarantee.** A second `/loop` sees an existing live (ACTIVE/PAUSED/
  RECOVERY_REQUIRED) checkpoint and refuses with a pointer to
  `/loop-status` / `/loop-cancel`.
- `generation` (bumped on every write) exists to **detect stale snapshots of
  concurrent edits in `/loop-status` output**; it is not a lock and not an
  atomic compare-and-swap. Two agents must not be trusted to mutate the file
  simultaneously.
- **No `--force` in the first release** (a supersede flow may be added in a
  later release after real usage shows it needed; the refusal path is the
  v1 story).

### 5. Privacy and local persistence

- `.loop/` stays in the consumer project and is **excluded from Git by
  default — by documentation and explicit instruction, never by silently
  editing the project's shared `.gitignore`** (the skill instructs the agent
  to announce the missing ignore entry and ask / show the line).
- The state file stores: objective text, requirements labels, stage/iteration
  metadata, statuses, evidence *paths*, and reconciliation descriptors. It
  stores **no tokens, environment values, raw transcripts, or unnecessary
  command output**.
- Secret scanning of state content is **best-effort, by pattern, fail-closed
  on match within its detection limits — never described as complete
  protection** (pattern-based scanning has inherent gaps; documented).
- **Remote URLs are sanitized before fingerprinting** — userinfo
  (`user:token@`) and tokens embedded in URLs are stripped; the identity
  fingerprint stores only scheme/host/path shape, never credentials.

### 6. Durability and archive

- All persistence goes through the helper's **atomic write path**: write
  `<target>.tmp-<generation>`, rename over the target; a crash leaves at most
  a recoverable temp file, and any temp file left behind is reported and
  reconciled at the next continuity operation.
- `COMPLETED` and `CANCELLED` runs move to `.loop/archive/` and are retained.
  **Terminal evidence is never silently deleted** when a new task starts
  (oc-loop's clear-on-success is rejected). Archives only grow; pruning is
  manual and owner-initiated.

### 7. Capability boundaries (must appear verbatim in user docs)

| Layer | Can do | Cannot do (never claim otherwise) |
| --- | --- | --- |
| Commands + skills | orchestrate: read state, request file edits through the agent, restate objectives, instruct honest stops | guarantee checkpoint writes, interrupt a live turn, auto-resume |
| Helper | validate schema/transitions/identity; atomically persist; reject secret-shaped values (best-effort) | enforce anything at runtime; list processes; lock files |
| Future native OpenCode runtime (NOT built) | automatic session re-drive on idle/error events, hard iteration enforcement, provider-limit detection with backoff, mid-turn interruption | — all four named capabilities are explicitly absent in this release |

## Architecture (adopted)

- **State file:** `<project>/.loop/continuity.json`; exactly one live run;
  terminal runs in `<project>/.loop/archive/<taskId>.json`.
- **Fields:** `schemaVersion (1)`, `taskId`, `generation`, `createdAt`,
  `updatedAt`, `project {root, name, originFingerprint}`, `status`,
  `integrity`, `stage`, `iteration`, `maxIterations`, `mode`, `SETTINGS`
  restatement, `objective`, `requirements {MUST, SHOULD, COULD}`,
  `iterations[] {n, stage, summary, nextStep, evidence[], openFindings,
  startedAt, endedAt?}`, `recovery {RECOVERY_REQUIRED reason?; reconciliation[]}`,
  `stoppingCondition?`, `createdBy {sessionId, model, opencodeVersion}` (advisory).
- **Lifecycle:** `(none) --/loop--> ACTIVE`; `ACTIVE --/loop-pause--> PAUSED`;
  `PAUSED --/loop-resume--> ACTIVE` (after gates below); unexplained
  claims/dirty work → `RECOVERY_REQUIRED`; `ACTIVE|PAUSED --/loop-cancel-->
  CANCELLED`; `ACTIVE --stage-8 convergence--> COMPLETED`; invalid state,
  corrupt file, unsupported version, identity mismatch → refuse + report,
  never overwrite. BLOCKED (helper unavailable) is reported, with the reason,
  by every continuity operation that needs it.
- **Resume gates (in order):** load+integrity (schema gate) → identity gate →
  freshness/staleness gate → read-only reconciliation → RECOVERY_REQUIRED
  resolution (if any) → explicit operator approval to continue → restore into
  the nine-stage loop at the recorded stage, restating objective and
  `SETTINGS:` and continuing the honest iteration counter.
- **The nine-stage methodology is unchanged.** Continuity adds input
  (Stage 0 may consume a checkpoint) and output (Stage 8 archives the run);
  it adds no tenth stage and reorders nothing.

## Consequences

- Cross-session, cross-model recovery becomes a supported, evidence-checked
  path; provider-quota/context-limit death is handled by the *manual* resume
  path — automatic retry exists only in the future runtime tier.
- New honest limitations enter the docs: no guaranteed checkpoints
  (prompt-level), no locking (operational rule), best-effort secret scan,
  interrupted stages may lose unbounded work, BLOCKED degradation when the
  helper cannot run.
- Test surface grows for the informed: real-module unit tests, corruption /
  interrupted-write / stale-identity / privacy scenarios on the actual
  helper (never a mirrored test-only model of the schema code).
- The behavioral harness keeps its role: checkpoint-writing adherence is a
  *measured* prompt-level behavior (future Case, token-gated), not an
  assumed one.

## Revisit triggers

1. Real usage shows the helper's BLOCKED degradation is unacceptable in
   practice (e.g. helper-less environments common).
2. Multi-maintainer/concurrent usage makes the operational one-run rule
   insufficient (→ consider a lockfile or runtime tier).
3. OpenCode ships a stable, documented session-state primitive
   (adds to ADR 0001 trigger #3).
4. Real-world quota/context recovery frequency justifies the ADR 0001
   Option 2 plugin re-evaluation.
