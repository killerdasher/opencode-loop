# Task Profile: REFACTOR

<!-- Universal safeguards apply unchanged -->

## Required inputs

- The structural problem to fix (duplication, dead code, tangled
  responsibilities, unclear interfaces) and the intended target shape.
- The behavior-preservation baseline: which observable behaviors and
  exported contracts must remain identical (identical interface = a MUST).
- Existing test coverage of the targeted area - if coverage is thin,
  the refactor must first add characterization tests (report that as part
  of the work, not silently skip it).

## Relevant analysis stages

- Stage 1: map current behavior from tests + call sites BEFORE touching
  structure; establish the baseline suite result (counts recorded).
- Stage 2: compare restructuring options; prefer the one with the
  smallest observable-surface change and clearest contract.
- Stage 3: sequence the refactor in behavior-preserving steps; each step
  compiles and passes the baseline.
- Stage 4/5: alternate implement + run the baseline every step.
- Stage 6: review for accidental contract drift (renamed exports,
  changed defaults, moved files that break consumers).
- Stage 8: converge when structure is improved and the baseline is green
  with identical observable behavior (or documented, authorized deltas).

## Verification methods

- Baseline test suite run before, during (per step), and after - counts
  must match before/after (no silent weakening).
- Characterization tests added where coverage was thin, before the
  structural change they protect.
- Static analysis / type-check to catch broken imports and contracts.
- Public-contract diff check: no undocumented export/default changes.

## Risk priorities

1. Behavior drift disguised as cleanup (the entire contract of the profile).
2. Big-bang rewrites that cannot be bisected when something breaks.
3. Test changes that mask drift instead of exposing it.
4. Half-migrated states (dead duplicates left behind, callers split
   between two implementations).

## Completion criteria

- Structure target from Stage 0 achieved and evidenced in the diff.
- Baseline suite identical before/after (counts equal, all green).
- No leftover dead code from the old shape; callers fully migrated.
- The improvement is honestly quantifiable (names inconsistent things
  removed, coupling reduced) - not just churn.

## Forbidden shortcuts

- Changing behavior "while refactoring" (name it, park it as a separate
  task, get operator approval).
- Rewriting large files wholesale instead of preserving history.
- Deleting tests that "seem redundant" without proving redundancy.
- Declaring done while callers still reference the old shape.

## Expected evidence

- Before/after baseline suites (identical passed/failed counts).
- A structural diff review: what moved, what merged, what was deleted.
- Characterization tests added where coverage was thin.
- Explicit statement of any surface change (with authorization).
