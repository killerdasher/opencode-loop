# Task Profile: AUDIT

<!-- Universal safeguards apply unchanged -->

## Required inputs

- The audit charter: what is being assessed (code, project, process,
  architecture, security) and the boundary of the assessment (which
  repositories, modules, or materials are in and out of scope).
- Read-only authorization level: an AUDIT run does not modify by default;
  fixes are proposed, never silently applied.
- Any standards/checklists the operator wants applied, else the engine's
  default risk-analysis dimensions.

## Relevant analysis stages

- Stage 0: record the charter and the read-only authorization level.
- Stage 1: inventory the assessment boundary (files, entry points,
  dependencies, configuration, data flows).
- Stage 2: plan the vectors - correctness, architecture, security/
  privacy, performance/reliability, usability, maintainability
  (per risk-analysis dimensions); prioritized by attack surface first.
- Stage 3: predetermined findings format (severity CRITICAL/HIGH/MEDIUM/
  LOW/INFORMATIONAL; reproducible evidence per finding).
- Stage 4: examination only - an audit run writes nothing but its own
  audit deliverables; applying fixes is a separate, explicitly authorized
  task (re-scoping by the operator), never a silent side effect.
- Stage 5: verification of findings (each finding reproduce-able or
  explicitly labeled SUSPECTED with a confirmation method).
- Stage 6: adversarial review of the audit itself - overreach, missing
  areas, unverified severity claims.
- Stage 8: deliver a findings report; convergence is the report, not a
  fix.

## Verification methods

- Findings verified by reproducing each defect (where one is claimed) -
  unconfirmed findings may not be presented as confirmed.
- Dependency/version checks against known-bad sources where feasible.
- Secret-pattern scanning; process/permission surface inspection.
- The harness's adversarial cases where behaviors can be executed.
- Every finding: severity + named evidence (file/line, reproduction, or
  data flow), never speculation presented as fact.

## Risk priorities

1. Unconfirmed severity inflation - claiming CRITICAL without proof.
2. Assessment scope holes never surfaced - claiming complete assessment
   when the boundary was not fully assessed; the audit must state exactly
   what was and was not examined.
3. Report tied to the wrong root cause (attribution without evidence).
4. False confidence: an audit that never says what it could not inspect.

## Completion criteria

- The charter's boundary fully examined OR honest holes listed.
- Every finding has a reproducible step, location, or data-flow evidence;
  anything unconfirmed carries the SUSPECTED label with a confirmation
  method.
- No fixes applied unless the charter authorized them (and then each fix
  needs separate verification).
- The final deliverable is the findings report with severity counts and
  explicit scope holes; no "all clear" without scope coverage.

## Forbidden shortcuts

- Never silently fix during an audit (mixing verdict and therapy).
- Never present an unverified claim as confirmed (SUSPECTED or said so).
- Never report "secure" or "clean" without specifying the boundary.
- Never sample-and-extrapolate without saying so.
- Never treat prompt-level claims as findings without evidence.

## Expected evidence

- Findings list with severity, location, reproduction, and (if
  applicable) suggested fix - clearly separated from the audit scope.
- Examined/not-examined coverage statement with specific paths.
- No code changes (or, if authorized: diff + verification trail).
- The scope holes stated explicitly; unconfirmed items labeled SUSPECTED.
