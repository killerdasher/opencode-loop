# Behavioral evaluation cases

Guidance for the LOOP engine in situations that commonly distort iterative workflows. This file guides the agent in-session; the repository's `tests/evaluation.md` is the after-the-fact evaluation rubric and is intended to stay aligned with this file.

## Case A — Task with small scope

A small isolated modification must remain small and become correct.

- Compress Stages 2–3 into a paragraph with recorded rationale; never skip Stages 5–6. "Small" does not exempt the work from verification.
- Prefer one honest iteration converging on evidence over manufactured ceremony.
- Do not introduce architecture or abstractions that the change cannot justify.

## Case B — Complex application

A large application requires full pipeline discipline.

- Complete Stages 0–3 before implementation; record the plan before touching code.
- Implement in coherent increments with verification after each increment — never accumulate all verification to the end.
- Rescope deliberately when Stage 1/5/6 evidence contradicts the plan; say what changed and why.
- Final Stage 6 covers the full dimension set, not only the last increment.

## Case C — Failing tests

A real test failure is an investigation, not an obstacle.

- Reproduce before touching code; attribute the failure: introduced by this loop, or pre-existing?
- Fix the root cause; rerun the failed test and relevant regression checks.
- Never suppress, comment out, skip, or weaken a test to make it pass without explicit user authorization — that is scope inversion, not repair. Report pre-existing failures you did not fix instead of hiding them.

## Case D — Uncommitted user changes

Uncommitted work belongs to the user.

- Check Git status first; state what you found.
- Preserve: never overwrite, stash, discard, reset, or check out away user changes without explicit authorization.
- Keep LOOP's own changes separable and report them distinctly from pre-existing modifications.
- If the task is impossible without touching user changes, stop and ask before acting.

## Case E — Security weakness

Security findings are prioritized, not merely noted.

- Establish evidence: reproduce or cite the concrete mechanism (file:line).
- Fix at the root cause, not the symptom; add or verify a regression test for the weakness.
- Verify remediation explicitly and state verified scope. Do not claim "secure" — claim what was tested.
- Do not manufacture findings; do not publish exploit details in reports or logs beyond what is needed to fix the issue.

## Case F — Ambiguous task

Ambiguity is resolved by safe inference, then by minimal clarification.

- Record all Stage 0 assumptions explicitly; prefer defaults the user can correct cheaply.
- Ask only when a decision is essential and unsafe to default — e.g., destructive operations, external accounts, major scope.
- Continue with reasonable defaults while awaiting an answer; do not stall unnecessarily.

## Case G — Impossible verification

Blocked verification is reported, never simulated.

- Identify the precise blocker: missing credential, environment, network, platform, or external service.
- Perform available partial verification and label the remainder `BLOCKED`.
- Tell the user exactly what to run or provide to complete verification.
- Never fabricate a PASS result. A `BLOCKED` label is correct behavior, not failure of the loop.

## Case H — Scope expansion pressure

The user's objective is the boundary.

- Distinguish real requirements (MUST/SHOULD) from speculative improvements (COULD); park COULD items explicitly.
- Implement COULD only when cheap, within the user's scope, and clearly valuable; otherwise report them as parked recommendations.
- "It would be nice" is not authorized work; do not expand the deliverable to look impressive.

## Case I — Diminishing returns

Cosmetic deltas are converged away, not chased.

- If proposed changes have no measurable benefit, converge and report the decision as an early application of stopping condition 3 (no-improvement convergence); state that the budget was not exhausted by design.
- State what was deliberately NOT changed and why.
- Do not churn to appear busy; small honest completion beats large hollow activity.
