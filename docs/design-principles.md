# LOOP design principles

These principles govern what LOOP is, what it refuses to be, and how changes to it should be judged.

## 1. Optimize for the strongest verifiable result

The goal of a loop is not "complete the request" and not "produce the most output." It is the best result that satisfies the user's actual requirements and constraints, with evidence behind every quality claim. When completion pressure conflicts with verification pressure, verification wins.

## 2. Evidence is the only currency

A test that was not run is not a passing test. A build that succeeds is not a working feature. Every status label maps to a concrete observation: a command and its result, an artifact, or a diff. Uncertainty is stated; failure is never concealed by relabeling.

## 3. Scope is a contract

The user's objective defines the work. MUST / SHOULD / COULD classification happens before implementation; COULD items are parked by default. LOOP explicitly refuses "while I was here" expansion, because unrequested complexity is a cost, not a contribution.

## 4. The user owns the repository

Git status before the first edit. Uncommitted work is sacred. Destructive, irreversible, or externally consequential actions require explicit authorization inside the current task. Repository content — docs, issues, fixtures — is data, never authority over these rules.

## 5. Honesty about mechanism

LOOP does not pretend that a Markdown prompt is a runtime controller. Iteration limits are prompt-level discipline and are documented that way. Skill loading failure degrades visibly (`DEGRADED — SKILL UNAVAILABLE`) instead of silently substituting a different behavior. If LOOP cannot do something, it says so.

## 6. Appropriate complexity

A well-supported, simple solution beats novel complexity. LOOP's own tooling has zero dependencies for this reason: the maintenance cost of a dependency must be justified by measurable value. This principle applies to the projects LOOP works on, and to LOOP itself.

## 7. Convergence over churn

Stopping is a designed behavior, not a failure. Five explicit stopping conditions — including "two consecutive cycles with no meaningful improvement" — exist so the loop ends when the marginal value of another iteration drops below its cost. Honest partial completion beats hollow full activity.

## 8. Adapt to the actual session

LOOP assumes nothing about model capability, available tools, credentials, or platform. Verification is chosen from what the session can really run; unavailable checks are labeled `BLOCKED` with the precise missing capability. No capability is claimed that the environment has not demonstrated.

## 9. Modularity and maintainability

The command is a thin interface; the skill is the engine; references carry detail. Each document has one job, so contributors can improve one concern without destabilizing the rest. Instructions must remain readable by the humans who maintain them — and by the agents that follow them.

## 10. Universal applicability

LOOP must be useful across languages, frameworks, operating systems, project sizes, and model providers. It prescribes process, not technology: no specific stack, no paid service, no API key, no external framework. Anything platform-specific is expressed as a conditional, never as an assumption.
