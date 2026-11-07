# Task Profile: MIGRATE

<!-- Universal safeguards apply unchanged -->

## Required inputs

- Source and target named precisely (platforms, versions, formats, or
  data stores) with the target as a pinned, stated version.
- Data/compatibility inventory: what moves, what must stay backward
  compatible, what is explicitly deprecated.
- Rollback story: how the migration backs out if verification fails
  (at minimum: what on disk changed, and how the pre-migration state is
  reconstructable) BEFORE the first irreversible step.
- Downtime/in-flight-work reality: operator knows when live behavior
  changes.

## Relevant analysis stages

- Stage 1: inventory both sides - schema/format/API differences mapped
  field-by-field (or item-by-item); classified: straightforward, needs
  adaptation, not representable.
- Stage 2: pick between the viable paths (in-place migration vs
  bridge/adapter vs new deployment) with real trade-off analysis.
- Stage 3: staged plan - every stage independently verifiable and
  reversible to the previous stage; record the irreversible moments.
- Stage 4: migrate under the plan, one stage/commit at a time;
  data-losing steps gated behind explicit operator approval.
- Stage 5: verification both directions: target works, source
  equivalence holds where promised.
- Stage 6: review for partial-migration states, stale callers, leftover
  pieces of the old world (the classic defect class).
- Stage 8: converge only when the migration is complete AND the previous
  path is either cleanly removed or explicitly retained (with reason).

## Verification methods

- Pre/post parity checks on migrated data: count + spot-check integrity,
  round-trip where formats allow.
- The target's tests running against the migrated reality (the target
  proves its own compatibility).
- Rollback rehearsal: execute the rollback path (where cheap) before
  relying on it.
- Both-stack grace period tests while coexistence exists.

## Risk priorities

1. Data loss / corruption in the one-way conversion step.
2. Partial migration: some callers on the new path, some on the old
   (undetected divergence).
3. Silent format-version drift (target reads old data "fine" in tests
   but fails on operator data).
4. Rollback story that was never executed (a plan is not a rehearsal).

## Completion criteria

- Inventory coverage: every inventoried item migrated or explicitly
  dispositioned (moved / kept dual-write / deprecated).
- Parity checks passed over the full data set (not a sample).
- Old contracts either removed completely or explicitly retained with
  reason + expiry; no orphaned code paths.
- Rollback path verified (or explicitly stated as not verifiable).

## Forbidden shortcuts

- No irreversible conversion without a rehearsed rollback.
- No data-losing step without explicit operator approval.
- No "sampled and looks good" claims: parity is validated over the set
  that matters (full set) or scoped-and-labeled honestly.
- No decomposition of cleanup into a follow-up that never happens:
  deprecation complete in this task or explicitly handed off in writing.

## Expected evidence

- Migration inventory with per-item disposition.
- Parity checks (counts + verification of integrity cases).
- Pre/post invocations of the migrated target (its own test suite on
  the migrated state).
- Rollback rehearsal evidence (or explicit non-verifiability note); the
  commit trail mapping stages to the plan.
