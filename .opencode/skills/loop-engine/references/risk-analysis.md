# Adversarial review — risk analysis

Reference for the LOOP engine's Stage 6. Take the position of a senior reviewer who did not author the code: assume nothing works, including your own earlier work, unless you have just verified it.

## Review discipline

- Review the actual diff, not the plan. Read the changed files; compare documented behavior with actual behavior.
- Trace at least one main flow end to end through the changed code.
- Reproduce plausible findings locally before reporting them.

## Defect categories

| Severity | Definition |
| --- | --- |
| `CRITICAL` | Data loss, security breach, or the core requirement is broken |
| `HIGH` | Major functionality fails; verification absent where it must exist; deep design flaw |
| `MEDIUM` | Real defect or risk with bounded impact |
| `LOW` | Minor defect or polish with no immediate user impact |
| `INFORMATIONAL` | Worth recording; no action required |

Severity claims require stated practical impact. No impact, no severity.

## Dimension checklists

Use the dimensions relevant to what was actually built. Report an issue only with concrete evidence.

### Correctness

Invalid assumptions; missing conditions; incorrect calculations; off-by-one errors; unhandled branches; swallowed errors; wrong operator precedence; unsafe type coercions; boundary values; unexpected inputs; empty and null states; Unicode and encoding surprises; locale and timezone handling; resource cleanup on early exit.

### Architecture

Tight or hidden coupling; circular dependencies; weak or inconsistent interfaces; unclear component responsibilities; duplicated functionality; unnecessary abstractions; scalability limits; missing single source of truth for key state.

### Security and privacy

- Injection: SQL, shell (command construction), path traversal, unsafe deserialization, template and header injection.
- Authentication and authorization: missing checks, default-allow paths, confused-deputy flows.
- File operations: paths built from user input, unsafe temporary files, accidental overwrite, symlink or junction surprises.
- Secret exposure: credentials or tokens in logs, error messages, reports, or new files; hardcoded secrets.
- Insecure defaults; outdated or unpinned dependencies; dependencies that execute unknown code.
- Network behavior: SSRF, unvalidated redirects, missing TLS verification, credentials leaked in URLs or logs.

### Performance and reliability

Resource leaks (handles, listeners, connections); unbounded caches or buffers; N+1 work; blocking calls on hot paths; missing timeouts or retry bounds; race conditions and idempotency gaps; large-input handling; partial-failure recovery.

### Product and usability

Missing loading, empty, and error states; inconsistent interaction patterns; misleading or dead-end messages; incomplete user flows; accessibility gaps; visual hierarchy that hides the important. Real but out-of-scope items may be recorded as `LOW` or `INFORMATIONAL`.

### Maintainability and delivery

Missing or stale documentation; undocumented configuration; magic numbers; dead code; fragile coupling to internals; packaging or install errors; platform or permission assumptions; missing migration or compatibility notes.

## Do not fabricate

- Never invent vulnerabilities or imaginary edge cases.
- If an issue is suspected but unconfirmed, mark it `SUSPECTED` and describe how to confirm it.
- Do not inflate severity to look rigorous; do not pad the findings list to appear thorough. An honest "no CRITICAL or HIGH findings in this area" beats manufactured ones.

## Disposition after review (feeds Stage 7)

| Class | Handling |
| --- | --- |
| CRITICAL, HIGH | Fix now; where genuinely infeasible, report as a blocker rather than hiding it |
| MEDIUM | Fix when real and in scope |
| LOW, INFORMATIONAL | Record; fix only when cheap and clearly valuable |

Re-review policy: after substantial fixes, rerun the relevant Stage 5 verification and spot-recheck the changed areas. Never trust a fix you did not re-examine.
