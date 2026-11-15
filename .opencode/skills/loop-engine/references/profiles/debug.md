# Task Profile: DEBUG

<!-- Universal safeguards apply unchanged -->

## Required inputs

- Observed failure: what happened, where, when, and how it was observed
  (error text, location, conditions), never just "it is broken".
- A means to reproduce the failure, or the reason reproduction is
  unavailable (report it BLOCKED, never implied-fixed).
- The operator's constraint on scope: fix only the defect; adjacent
  improvements must be named and parked unless trivially in-scope.

## Relevant analysis stages

- Stage 0: restate the symptom; the objective is the fix, stated as the
  root cause to be found and corrected.
- Stage 1: read the failing code paths AND their tests before changing
  anything; establish what the code was believed to do vs observed.
- Stage 2/3 compressed: hypotheses ranked by likelihood; the chosen
  hypothesis states what evidence will confirm or kill it.
- Stage 4: reproduce first (a failing check that demonstrates the defect);
  fix at the root cause, not the symptom site.
- Stage 5: the reproduction check now passes; regression suites run.
- Stage 6: review the fix itself (does it change contracts? masked
  failures? missing validation upstream?).
- Stage 8: converge only when the reproduction is fixed AND regressions
  are green.

## Verification methods

- Reproduction-derived test: a check that failed before the fix and
  passes after (recorded in both states).
- Regression runs over affected suites (summary counts).
- Type-check/build as available for the fix surface.
- If reproduction is impossible: the defect is fixed but the run's final
  classification stays honest (IMPLEMENTED BUT NOT VERIFIED for the
  unverifiable aspects; never upgraded to VERIFIED).

## Risk priorities

1. Symptom-patching: hiding the failure without removing its cause.
2. Fixing symptoms in the test instead of the defect in the code
   (test-weakened-fails is a real harness case; never do it).
3. Scope creep "while we are in here".
4. Masked regressions: marking skipped checks as passing.

## Completion criteria

- Root cause identified and stated in one sentence, with evidence.
- Reproduction check recorded as FAIL-before and PASS-after (or an
  accepted BLOCKED with the reason visible in the final report).
- Affected regression suites green with counts reported.
- No adjacent code changed beyond the fix without justification.

## Forbidden shortcuts

- Never delete or weaken a test to make the suite pass.
- Never claim fixed without executing the reproduction check.
- Never fix by deleting functionality that was asked for.
- Never print or persist secret values surfaced during debugging.

## Expected evidence

- The FAIL-before / PASS-after pair (or the accepted BLOCKED record).
- Diff limited to the fix (+ its new test) — the smaller, the stronger.
- Regression summaries for every suite the fix could affect.
- Root-cause statement citing file/line evidence, not speculation.
