# Task Profile: BUILD

<!-- Universal safeguards apply unchanged -->

## Required inputs

- The task objective as stated by the operator (verbatim scope; new
  functionality always builds exactly what is asked, nothing speculative).
- Target users / intended usage of the new functionality.
- Existing project conventions the functionality must respect (style,
  structure, API patterns, test conventions).
- Explicit acceptance boundaries: what is in scope, what is explicitly
  excluded (a BUILD profile claim of "done" extends no further).

## Relevant analysis stages

- Stage 0: restate the task + settings; classify requirements MUST/SHOULD/
  COULD as usual.
- Stage 1: recon of the placeholder/pattern context - where the new work
  integrates, what it must not break (existing call sites, exports, tests).
- Stage 2-3: choose the smallest coherent design that satisfies the MUST
  list; state interfaces and error handling before writing code.
- Stage 4: implement in coherent increments, tests alongside.
- Stage 5-6: standard; BUILD-specific emphasis is below.
- Stage 7: driven by adversarial review findings.
- Stage 8: convergence on the acceptance criteria as classified.

## Verification methods

- New unit tests covering the specified behavior, including error paths.
- Integration checks where the feature meets existing code surfaces.
- Regression runs proving existing behavior unchanged (existing suites).
- Static/structural checks of the project type (build, type-check, lint).
- Honest labeling per iteration: VERIFIED / IMPLEMENTED BUT NOT VERIFIED /
  BLOCKED / NOT APPLICABLE / FAILED.

## Risk priorities

1. Speculative scope creep past the stated objective.
2. Breaking existing integrations or exported contracts.
3. Missing error paths in new code (happy-path-only implementations).
4. Fake data or decorative functionality presented as features.

## Completion criteria

- Deliverables explicitly named in Stage 0 exist and are VERIFIED.
- Every MUST criterion exercised with a passing, named check; every
  SHOULD either implemented or explicitly recorded as not done.
- Existing suites still pass (no unexplained regressions).
- Documentation updated for the new behavior where users touch it.

## Forbidden shortcuts

- No placeholder text standing in for real behavior ("to be filled").
- No tests mocked into green by mirroring the implementation's mistakes.
- No dependency added without a stated, justified need.
- No "temporarily disabled" or silently skipped requirements.
- No convergence by relabeling: IMPLEMENTED BUT NOT VERIFIED never becomes
  VERIFIED without running a check.

## Expected evidence

- Updated/new test files with named, passing checks (check IDs).
- A full diff limited in scope to the named deliverables.
- Regression results (summary lines with counts for affected suites).
- Stage 5 check list with the exact commands executed and their outcomes.
