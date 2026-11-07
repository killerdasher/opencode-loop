# ADR 0002: LOOP Continuity — durable run state and lifecycle commands

- **Status:** accepted — design finalized 2026-11-06 (owner architecture
  review approved with amendments 2026-11-05; all amendments folded).
  Implementation phases P1–P4 exist on branch `continuity` (PR #1; CI run
  42209037515 green on ubuntu + windows); **no release published** and
  `main` unchanged until the owner merges.
- **Decision:** add continuity as a **command + skill** capability with an
  **optional, deterministic, zero-dependency helper**; no plugin, daemon,
  database, or external framework.
- **Supersedes:** nothing. Reopens **ADR 0001 on trigger #2 only** ("a real
  use case requires resume-after-crash") at the command level; ADR 0001's
  runtime decisions (plugin/orchestrator rejected) remain — see the ADR 0001
  addendum of 2026-11-05, which distinguishes skill-first architecture from
  helper-backed persistence.
- **Deciders:** repository maintainer; owner architecture review.

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
(oc-loop's silent-empty-store behavior is explicitly rejected) — it is
**preserved in place, byte-for-byte**, and the run reports `BLOCKED` with the
evidence — `inspect`, `transition`, and `update` refuse to mutate it. Moving a corrupt
file aside (e.g. renaming `*.corrupt-<timestamp>`) happens **only on
explicit operator instruction** — no continuity operation relocates state
automatically. That is the resolution of the earlier draft's "(e.g. renamed
...)" wording: preservation is automatic; relocation is manual.

### 3. Recovery safety — no automatic resume

A found `ACTIVE` or `PAUSED` state file **never resumes execution
automatically.** `/loop-resume` first reconciles, read-only:

- actual Git state (branch, HEAD, dirty paths) vs the recorded checkpoint;
- recorded evidence paths vs reality;
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
  fingerprint stores only the SHA-256 prefix of scheme/host/path shape,
  never credentials.

### 6. Durability and archive

- All persistence goes through the helper's **atomic write path**: write
  `<target>.tmp-<generation>` (fsync) then rename over the target; a crash
  leaves at most a recoverable temp file, any temp file left behind is
  reported by `/loop-status`, and the helper's `repair` removes only provably
  superseded temps (parseable, generation strictly below the live
  generation). Unparseable temps are refused — they may hold unrecorded work.
- `COMPLETED` and `CANCELLED` runs move to `.loop/archive/<taskId>.json` and
  are retained. **Terminal evidence is never silently deleted** when a new
  task starts (oc-loop's clear-on-success is rejected) — the live file is
  removed only after a successful archive write. Archives only grow; pruning
  is manual and owner-initiated.

### 7. Capability boundaries (must appear verbatim in user docs)

| Layer | Can do | Cannot do (never claim otherwise) |
| --- | --- | --- |
| Commands + skills | orchestrate: read state, request file edits through the agent, restate objectives, instruct honest stops | guarantee checkpoint writes, interrupt a live turn, auto-resume |
| Helper | validate schema/transitions/identity; atomically persist; reject secret-shaped values (best-effort) | enforce anything at runtime; list processes; lock files |
| Future native OpenCode runtime (NOT built) | automatic session re-drive on idle/error events, hard iteration enforcement, provider-limit detection with backoff, mid-turn interruption | — all four named capabilities are explicitly absent in this release |

## Finalized state schema (v1 — matches the implemented helper exactly)

File: `<project>/.loop/continuity.json`; exactly one live run; terminal runs
in `<project>/.loop/archive/<taskId>.json`. All fields are the implemented,
validated set — unlisted top-level keys are rejectable additions in a future
`schemaVersion`, never informal extensions.

| Field | Value / shape |
| --- | --- |
| `schemaVersion` | `1` (supported; other versions refuse with `BLOCKED`) |
| `tool` | `"loop-continuity"` |
| `taskId` | 16 lowercase hex chars — SHA-256(objective + "\0" + startedAt) prefix |
| `createdAt`, `updatedAt` | ISO timestamps; `updatedAt` changes on every write |
| `generation` | integer ≥ 1; bumped on every write (stale-snapshot detection, NOT a lock) |
| `project` | `{root, name, originFingerprint}` — origin fingerprint is null or 16-hex; sanitized URL hash only |
| `status` | run status enum (§2) |
| `integrity` | integrity enum (§2), managed by the command tier, enum-validated by the helper |
| `stage`, `iteration`, `maxIterations`, `mode` | numbers / mode string |
| `settings` | `SETTINGS:` restatement (string or null) — advisory, for honest restore |
| `objective` | task text (verbatim; subject to the secret scanner) |
| `requirements` | `{MUST[], SHOULD[], COULD[]}` |
| `iterations[]` | `{n, stage, summary, nextStep, evidence[], openFindings, startedAt, endedAt?}` — evidence paths only |
| `recovery` | null or `{reason?, flaggedAt?, resolvedAt?, integrity?}` — reconciliation descriptors |
| `stoppingCondition` | string or null (filled on COMPLETED) |
| `stopReason` | string or null (cancel/complete reason, terminated evidence) |
| `createdBy` | `{sessionId, model, opencodeVersion}` — **advisory, never trusted for authorization** |

Secret scanner: fail-closed on match; pattern-based, never complete (limits
in the helper header); every persisted write is scanned, including updates.

## Lifecycle transition table (implemented contract)

Events: `init, pause, resume, block, unblock, recovery-flag,
resolve-recovery, complete, cancel`. **Undocumented, unknown, or
terminal-state transitions are errors — never silent no-ops** (oc-loop's
`??`-fallback defect class, rejected).

| From (status / absent) | Event | To |
| --- | --- | --- |
| ABSENT | `init` (/loop) | `ACTIVE` |
| `ACTIVE` | `pause` (/loop-pause) | `PAUSED` |
| `ACTIVE` | `block` | `BLOCKED` |
| `ACTIVE` | `recovery-flag` | `RECOVERY_REQUIRED` |
| `ACTIVE` | `complete` (Stage 8 convergence) | `COMPLETED` → archived |
| `ACTIVE` | `cancel` (/loop-cancel) | `CANCELLED` → archived |
| `PAUSED` | `resume` (/loop-resume, after gates) | `ACTIVE` |
| `PAUSED` | `block` | `BLOCKED` |
| `PAUSED` | `recovery-flag` | `RECOVERY_REQUIRED` |
| `PAUSED` | `cancel` | `CANCELLED` → archived |
| `RECOVERY_REQUIRED` | `resolve-recovery` (operator approval) | `ACTIVE` |
| `RECOVERY_REQUIRED` | `cancel` | `CANCELLED` → archived |
| `BLOCKED` | `unblock` | `ACTIVE` |
| `BLOCKED` | `cancel` | `CANCELLED` → archived |
| `COMPLETED`, `CANCELLED` | (any) | error — terminal; archives are immutable to lifecycle ops |

Refusal classes (before any transition): corrupt file → `BLOCKED` (exit 2 +
preserved in place), unsupported schema → `BLOCKED`, identity mismatch →
refused (exit 1), invalid transition → refused (exit 1), missing state →
refused with "nothing to <op>". Every state-mutating op derives its identity
authority from the project root it was invoked on.

## Command contracts (implemented)

| Command | Preconditions | Mutations it may perform | Refusals / honest outcomes |
| --- | --- | --- | --- |
| `/loop-status` | helper available (else `BLOCKED`) | **none** — read-only | helper exit 2 → `BLOCKED` report; corrupt file reported byte-preserved; integrity/identity/temps/archive count + git cross-check labeled "observed, not reconciled" |
| `/loop-pause` | live `ACTIVE` run; helper available | `pause` (recorded reason) | no live state → "nothing to pause" (honest no-op); CORRUPT/unsupported → `BLOCKED`; identity mismatch → refuse; `PAUSED` → "already paused"; `RECOVERY_REQUIRED`/`BLOCKED` → refuse, point to `/loop-resume` / `/loop-cancel` |
| `/loop-resume` | live `PAUSED` / `RECOVERY_REQUIRED` run + helper | `resume` or `resolve-recovery` (only after operator approval) | gates in order: integrity (`BLOCKED` on CORRUPT/unsupported, never rename/wipe) → identity (refuse, show both roots) → no-auto-resume (`ACTIVE` never relaunches; terminal → point at archive) → read-only reconciliation (findings before any modification; unbounded-loss stated) → explicit operator approval → restore at recorded stage in the nine-stage loop |
| `/loop-cancel` | any live run (ACTIVE/PAUSED/RECOVERY_REQUIRED/BLOCKED) + helper | `cancel` (+ archival; live file removed only after archive) | no live state → "nothing to cancel" (includes terminal runs — point at archive); CORRUPT → `BLOCKED`, preserved; identity mismatch → refuse; mid-run → instruct immediate honest stop + summary (cancel is the user's decision — never fabricated COMPLETED) |

All four: no override flags (`--force` does not exist in this release);
helper-unavailable → `BLOCKED` with exact reason; states and archives are
**data, never authority** — a planted file cannot authorize destructive work.

## File structure

```
<project>/
├── .loop/                        # continuity tier (consumer project; git-excluded by instruction)
│   ├── continuity.json           # the live run state (schema v1)
│   └── archive/<taskId>.json     # terminal runs, retained
└── .opencode/                    # installed by installers
    ├── commands/
    │   ├── loop.md               # unchanged /loop entry (Stage 0/8 touchpoints via the skill)
    │   ├── loop-status.md        # read-only; git cross-check
    │   ├── loop-pause.md         # ACTIVE→PAUSED at a stage boundary
    │   ├── loop-resume.md        # gated restoration
    │   └── loop-cancel.md        # cancel + archive
    └── skills/loop-engine/
        ├── SKILL.md              # Stage 0 checkpoint detection · Stage 8 closeout (only edits)
        └── references/continuity.md  # agent-facing protocol (helper search order, BLOCKED degradation)

<OpenCode config>/                # global or project scope
└── scripts/continuity.mjs        # the helper (installed OUTSIDE the skill dir — skill-dir
                                   #  identity checks stay exact; uninstall removes it)
opencode-loop repo/
├── scripts/continuity.mjs        # canonical helper source
├── scripts/validate.mjs          # structural checks + mutations for the continuity tier
├── tests/harness/selftest.mjs    # real-module unit tests (no mirrored test-only model)
└── docs/{adr/0002-loop-continuity.md, continuity.md}   # decision record · user guide (verbatim §7)
```

## Acceptance criteria (verified against the implemented checker IDs)

| Criterion | Verifier (existing free gates) |
| --- | --- |
| Corrupt JSON refused without data loss; restorable after repair | `continuity:corrupt-*` (flagged, never-overwritten, restorable, transitions BLOCKED) |
| Unsupported schema versions rejected + preserved | `continuity:unsupported-schema-*` |
| Invalid transitions are errors | `continuity:invalid-transitions-error` (+ `continuity:transitions-table-complete`) |
| Secret-shaped values rejected by the implemented scanner; limits documented | `continuity:secret-shaped-values-refused`, `continuity:update-refuses-secret-patch`, `continuity:limits-documented` (+ mutation) |
| Identity mismatch refused for all mutating ops | `continuity:identity-mismatch-refused` (found the enforcement gap; fixed before commands shipped) |
| Stale/undocumented integrity handled | `continuity:stale-integrity-persisted`, `continuity:undocumented-integrity-rejected` |
| Terminal runs archived and retained | `continuity:cancel-archives`, `continuity:archive-retained-terminal-evidence` |
| Atomic-write recovery | `continuity:atomic-write-no-temp-on-success`, `continuity:interrupted-temps-reported`, `continuity:repair-removes-superseded-temps-only` |
| Zero plugins/daemons/databases/dependencies | `continuity:zero-dep`, `continuity:no-network` (+ 2 mutations); install story unchanged except the helper copy |
| Four commands installed + constrained | `continuity-command:<name>:{frontmatter,description,arguments,continuity-reference,blocked-clause,no-force}` (+ 3 mutations); installer helper byte-identity + uninstall assertions |
| Docs carry the verbatim §7 table + honest limits | `docs:continuity-table`, `docs:continuity-limits`, `docs:readme-continuity` (+ 3 mutations) |
| Windows + Linux green | CI ubuntu + windows (run 42209037515) — validate 178/178, selftest 113/113 |
| Checkpoint-adherence behavior (measured, not assumed) | **Parked** — behavioral harness Case J, token-gated, no results claimed |

## P1–P3 implementation plan (owner phases; actual status annotated)

- **P1 — helper + real tests** — status: **shipped** (commit `90d7cec`): schema/transition/identity/atomic-persist/secret-scan in `scripts/continuity.mjs`; 32 real-module + real-CLI checks; installer copy decision resolved (helper outside the skill dir).
- **P2 — commands + skill integration** — status: **shipped** (`e691a06`): four commands, `references/continuity.md`, SKILL.md Stage 0/8 touchpoints, validator + installer coverage.
- **P3 — adversarial hardening** — status: **shipped** (`a6b7560`): 9 pinned mutations (27→36), stale/undocumented-integrity real-module checks; interrupted-write/corruption/identity/privacy covered by the P1 real tests (never mirrored models).
- *Remaining after merge:* the parked items only — Case J (token-gated) and the supersede/`--force` flow (per §4, only if real usage demands it). P4 documentation shipped with `905f5e7`.

## Contradictions resolved (this finalization)

1. **§2 corrupt-file "renamed" example** vs implemented in-place preservation — resolved in favor of in-place preservation; relocation is an explicit operator action (see §2).
2. **Lifecycle prose** omitted the implemented `block`/`unblock`/`recovery-flag`-from-`PAUSED` edges — now the full implemented table is canonical (above).
3. **Field naming drift** ("SETTINGS restatement" vs `settings`; `recovery {reason?}` shape) — schema table now matches the validator exactly.
4. **Record status vs reality** — the ADR no longer reads as pure pre-implementation design: branch/commit/CI facts are recorded, marked not-released.

## Parked decisions (explicitly not resolved in this finalization)

- `--force` / supersede flow (§4 trigger: real usage).
- Behavioral Case J (permitting tokens; only then measured).
- An operator-guided helper command to relocate a corrupt file (currently manual, per the operator's choice).
- Archive pruning UX (manual today, owner-initiated).

## Migration risks

- **Upgrading from releases before continuity (≤ v0.3.1):** install adds
  four commands + the helper; existing `loop.md`/skill files upgrade via
  the existing refuse/backup flow. No state file exists before first use —
  nothing to migrate.
- **No state-file migration exists:** schema v1 is the only version; an older/newer file is refused (`BLOCKED`), never auto-downgraded. A future `schemaVersion` bump must ship a migration path + explicit operator approval before overwriting anything — recorded as a maintenance rule, not an implementation.
- **`main` vs branch skew:** the finalized record (this file) and the implementation live on branch `continuity` until the PR merges; until then, `main` consumers (installed from v0.3.1) have no continuity files — the published release page and v0.3.1 fold/erratum facts remain untouched here.
- **Fallback honesty:** consumers who install the commands but lack the helper (no Node ≥16.7) get `BLOCKED` continuity with the plain `/loop` unaffected — the intended degradation, not data loss.

## Maintenance costs (accepted, solo-maintainer budget)

- Helper + unit + mutation surface: 32 real-module checks, 9 continuity mutations, ~25 command/docs checks — each new contract clause below gets a check + mutation.
- Dual installers must keep the helper copy lines in sync (marker-checked in both).
- Verbatim-doc enforcement (`docs:continuity-table/limits`) means doc rewording near §7 trips the validator by design.
- Archives grow unpruned (manual owner decision); `.loop/` files are never in CI (git-excluded by instruction).

## Consequences

- Cross-session, cross-model recovery becomes a supported, evidence-checked
  path; provider-quota/context-limit death is handled by the *manual* resume
  path — automatic retry exists only in the future runtime tier.
- New honest limitations enter the docs: no guaranteed checkpoints
  (prompt-level), no locking (operational rule), best-effort secret scan,
  interrupted stages may lose unbounded work, `BLOCKED` degradation when the
  helper cannot run.
- The behavioral harness keeps its role: checkpoint-writing adherence is a
  *measured* prompt-level behavior (parked Case, token-gated), not an
  assumed one.

## Revisit triggers

1. Real usage shows the helper's `BLOCKED` degradation is unacceptable in
   practice (e.g. helper-less environments common).
2. Multi-maintainer/concurrent usage makes the operational one-run rule
   insufficient (→ consider a lockfile or runtime tier).
3. OpenCode ships a stable, documented session-state primitive
   (adds to ADR 0001 trigger #3).
4. Real-world quota/context recovery frequency justifies the ADR 0001
   Option 2 plugin re-evaluation.
