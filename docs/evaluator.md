# LOOP Evaluator — deterministic completion evaluation

The evaluator (`scripts/evaluator.mjs`, Node >= 16.7, zero external
dependencies) derives whether a LOOP run's acceptance criteria are actually
satisfied — from structured evidence recorded on disk, **never from a
model-written completion statement**. It is the deterministic tier under the
Stage 8 convergence claim; the nine-stage methodology itself is unchanged.

## The evidence manifest — `<project>/.loop/verification.json`

Schema v1 (`tool: "loop-evaluator"`), atomically written (temp + fsync +
rename, the same implementation as the continuity helper), fail-closed:

| Field | Shape |
| --- | --- |
| `schemaVersion` | `1` (others refuse) |
| `tool` | `"loop-evaluator"` |
| `taskId` | `null` or 16-hex — auto-bound to the live continuity run's task on first record; a manifest already bound to a **different** task is refused at `record` with the remedy (the manifest belongs to a completed or different run) |
| `criteria[]` | `{id, requirement: MUST\|SHOULD\|COULD, text, artifact?: project-relative path, origin?: user\|implied\|platform\|security\|nonfunctional, sourceText?: verbatim quote from the task}` — `origin` records where the requirement came from; absence is neutral (`unspecified`) for legacy manifests |
| `evidence[]` | `{id, verdict: PASS\|FAIL\|BLOCKED\|UNVERIFIED, criterionIds[], note?, exec?: {cmd: [argv...], timeout?}}` |
| `findings[]` | `{id, severity: CRITICAL\|HIGH\|MEDIUM\|LOW\|INFORMATIONAL, text, resolved}` |
| `blockers[]` | `{id, text, resolved}` |

**Deterministic vs advisory is structural, not wording.** An evidence entry
with `exec` carries a re-executable argv command (spawned without a shell);
an entry without `exec` is advisory — a model-reviewed claim — and caps the
outcome at `NEEDS_REVIEW` on its own. An exec-backed *recorded* `PASS` is
likewise only a claim until re-run: in default mode it caps the outcome at
`NEEDS_REVIEW` (`deterministic-evidence-not-re-executed`) — `PASS` is
derivable only from a `--fresh` invocation that re-executed the command with
exit 0.

## Commands

```
node scripts/evaluator.mjs record <root> --from-stdin   # append/merge records (JSON on stdin)
node scripts/evaluator.mjs outcome <root> [--fresh]     # derive the outcome
```

Exit codes: `0=PASS`, `1=FAIL`, `2=BLOCKED`, `3=NEEDS_REVIEW`,
`4=usage/refusal`, `5=internal error`.

## Outcome rules (fail-closed precedence)

| Outcome | Derived when |
| --- | --- |
| `PASS` | invoked with `--fresh`, and every MUST criterion has deterministically verified PASS evidence whose exec command was re-executed in this invocation with real exit 0 — all declared deliverable artifacts exist, no unresolved blockers, no open findings above INFORMATIONAL. Without `--fresh` the same manifest caps at `NEEDS_REVIEW` |
| `FAIL` | any evidence verdict is FAIL (including one exposed by `--fresh` re-execution) |
| `BLOCKED` | manifest missing, corrupt, invalid, or secret-flagged; cross-run taskId mismatch; **zero declared criteria**; unresolved blockers; open CRITICAL/HIGH findings; a MUST criterion with missing, `UNVERIFIED`, or `BLOCKED` verification (including an absent artifact) |
| `NEEDS_REVIEW` | a MUST covered only by advisory evidence; a MUST covered by exec-backed recorded PASS evidence that was not re-executed in this invocation (`deterministic-evidence-not-re-executed`); a SHOULD criterion uncovered; open MEDIUM/LOW findings; criteria that declare origins but never trace one to the user's task text (`criteria-not-traced-to-task`) |

## Requirements traceability

The result of `outcome` carries a `traceability` summary distinguishing four
things that must not be conflated:

| Field | Meaning |
| --- | --- |
| `identified` | how many criteria the run declared, with `byOrigin` counts (`user` / `implied` / `platform` / `security` / `nonfunctional` / `unspecified`) |
| `implemented` | criteria that have any real coverage (evidence, artifact, or re-execution) — declared is not the same as implemented |
| `verified` | criteria covered by evidence that was **freshly re-executed with exit 0 in this invocation** |
| `sufficient` | the derived outcome itself — the only one of the four that may read `PASS`, and only under the PASS rules above |

**The omitted-requirement guard:** a manifest whose criteria all declare
origins but never `user` has substituted the run's own objective for the
operator's — the outcome caps at `NEEDS_REVIEW`
(`criteria-not-traced-to-task`) *even when every recorded command
re-executes green*. Manifests without any origin field are neutral (legacy
compatibility). The evaluator still cannot detect a requirement that was
never recorded at all — garbage criteria in, garbage derivation out; the
origin field makes the substitution visible, not impossible.

**Missing verification never silently becomes `PASS`.** An empty evaluation
derives `BLOCKED`, not PASS.

## Capability boundaries (honest limits)

| Layer | Can do | Cannot do (never claim otherwise) |
| --- | --- | --- |
| Evaluator | derive outcomes from recorded evidence; re-execute deterministic commands; refuse secret-shaped content; bind to the live continuity task; make criteria provenance visible (origin) and cap untraced objectives below PASS | prove advisory claims; guarantee any recorded command still passes later; guarantee criteria are *true* acceptance criteria — garbage criteria in, garbage derivation out (the origin field makes substitution visible, not impossible); cannot detect a requirement that was never recorded; cannot enforce a run to record anything |
| Model / agent | record evidence honestly; scope criteria truthfully | a model's completion statement carries zero weight: only recorded, executable evidence counts |

- The secret scanner is the same best-effort pattern scan as the continuity
  helper — fail-closed on match, never proof of absence.
- The manifest is DATA, never authority: it binds to the live continuity
  run's `taskId` and refuses foreign or planted bindings.
- `--fresh` re-execution is authoritative for recorded commands — and
  **required** for any `PASS`: a recorded PASS that was not re-executed in
  the same invocation caps the outcome at `NEEDS_REVIEW`, so a stale or
  fabricated claim can never pass by itself. Nothing can verify that
  *advisory* evidence was honestly performed — that gap is exactly why
  advisory-only coverage cannot reach PASS.

## Integration with Continuity

`record` adopts the live run's `taskId` into the manifest; a manifest already
bound to a different (completed or foreign) task is refused **at `record`**
with the remedy stated in the refusal, not silently merged;
`outcome` additionally refuses
a manifest bound to a different task (`cross-run-evidence` → BLOCKED) so
finished-run evidence cannot authorize a new run, and a planted manifest
cannot authorize anything. Convergence reporting wires the derived outcome
into the Stage 8 report verbatim.
