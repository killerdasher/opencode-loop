# Quality gates and reporting

Reference for the LOOP engine. Use this file when constructing the Stage 8 convergence check and the final report. Paths referenced elsewhere resolve relative to this file's directory.

## Purpose

Quality is judged by evidence, not by scores or optimism. Gates exist to force an explicit, false-signal-free decision: what is done, how you know, what is not. Do not present an arbitrary 100/100 or "98% quality" number as proof of anything.

## Status vocabulary (mandatory)

| Label | Meaning | Guardrails |
| --- | --- | --- |
| `VERIFIED` | Executed in this session with a recorded command and result | Only with real evidence; state what the check covered |
| `IMPLEMENTED BUT NOT VERIFIED` | The change exists; no applicable check ran | Must appear with the reason no check ran |
| `BLOCKED` | The check was attempted and could not run | Record the precise blocker (missing capability, credential, environment) |
| `NOT APPLICABLE` | The check is irrelevant to this project | Justify in one clause |
| `FAILED` | The check ran and did not pass | Must be fixed, or explicitly accepted by the user |

Never upgrade a label without new evidence. Never downgrade a problem by reclassifying it.

## Quality-gate dimensions

Use the dimensions relevant to the project; record status plus an evidence pointer for each.

| Dimension | Typical evidence |
| --- | --- |
| Functional correctness | Passing tests tied to named requirements; reproduction scripts |
| Architecture | Consistent structure; dependency direction notes; interface review |
| Security | Input-validation checks; secret scan of new files; dependency audit; authorization tests |
| Reliability | Error-path tests; timeout coverage; recovery from partial failure |
| Performance | Measured profile or benchmark with environment stated — only when performance is a real requirement |
| Maintainability | Documentation consistency; naming; test coverage of changed areas |
| User experience / accessibility | Flow review; missing-state coverage; accessibility checks where relevant |
| Compatibility | Matrix run limited to platforms/versions actually tested |
| Documentation | Docs updated against changed behavior; examples executed where cheap |
| Test coverage | Coverage statistic on changed code when tooling exists; otherwise a stated structural review |
| Deployment readiness | Build, packaging, and configuration verified — only when shipping is part of the objective |

## Convergence checklist (Stage 8 evidence)

A loop may end only when this checklist is satisfied or the stopping condition honestly prevents it:

1. Requirement table shows every MUST satisfied (`VERIFIED` evidence) or explicitly `BLOCKED` with a user-visible reason.
2. Verification table lists actual commands with PASS / FAIL / BLOCKED / NOT APPLICABLE statuses.
3. No open CRITICAL or HIGH findings.
4. No unexplained regressions introduced since the baseline.
5. Documentation updated for behavior/interface changes.
6. Remaining risks and known limitations disclosed.
7. The stopping condition that applies is named.

## Reporting formats

Iteration banner — emit at each iteration boundary and whenever progress is material:

```
LOOP | ITERATION n/N — <one-line objective>
changed: ...
verified: ...
key findings: ...
next: ...
```

Requirements table:

| ID | Requirement | Class (MUST/SHOULD/COULD) | Status | Evidence |
| --- | --- | --- | --- | --- |

Verification table:

| Check | Command | Status | Notes |
| --- | --- | --- | --- |

## Final completion report template

1. **Overall outcome** — complete / partially complete / blocked, in one paragraph.
2. **Requirements table** — MUST/SHOULD/COULD with status and evidence.
3. **What was built** — major changes, key decisions, accepted trade-offs.
4. **Verification table** — actual commands, statuses, short notes.
5. **Adversarial findings** — each with severity and disposition: fixed / accepted / parked / blocked.
6. **Remaining risks and known limitations.**
7. **Reason for stopping** — which of the five conditions applies (see SKILL.md Stage 8).
8. **Recommended follow-ups** — only genuinely valuable ones, stated as optional.

Keep the report factual: every claim must trace to an evidence entry. Concise reasoning summaries are welcome; never expose private chain-of-thought.
