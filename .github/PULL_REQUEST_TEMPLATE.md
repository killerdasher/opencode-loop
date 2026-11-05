<!--
Priority: PRs that pass the gates and make an honest, scoped change are reviewed quickly.
-->

## What does this PR change, and why?

<!-- One to three sentences. State the objective; where it is in scope, say so. -->

## Gates (see CONTRIBUTING.md)

- [ ] `node scripts/validate.mjs --all` passes (structure + mutation self-test + installer scenarios)
- [ ] `node tests/harness/selftest.mjs` passes — free, no model calls
- [ ] Every new validator check has a matching mutation in `scripts/validate.mjs`
- [ ] Every new behavior has a matching free self-test check (harness criteria need one PASS and one FAIL case)
- [ ] `tests/evaluation.md` updated in the same commit when a fixture's declared state changed
- [ ] Documentation updated where behavior or interfaces changed

## Honest-change statement

- [ ] The change does not claim runtime enforcement, persistent learning, or guaranteed quality
- [ ] No generated evidence (`tests/harness/evidence/`) is committed
- [ ] Labels in documentation use the status vocabulary exactly (`VERIFIED`, `IMPLEMENTED BUT NOT VERIFIED`, `BLOCKED`, `NOT APPLICABLE`, `FAILED`)
