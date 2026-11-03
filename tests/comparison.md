# LOOP quality comparison methodology

Controlled A/B experiment design comparing:

- **Arm A — control:** standard OpenCode execution of a task prompt.
- **Arm B — loop:** the same task executed as `/loop <task>` with LOOP
  installed in the project.

This document is a **methodology**, not a result. It defines how a comparison
must be run and judged before any numbers exist, so that the experiment cannot
be retro-fitted to a desired conclusion. Current measured status is recorded
in the last section; claims of superiority require evidence produced under
this design.

## 1. What must be identical between arms

| Factor | How it is held constant |
| --- | --- |
| Task text | byte-identical prompt (`fixture.task` from `fixtures.mjs`; loop arm prefixes `/loop `) |
| Repository snapshot | same fixture builder, same baseline commit content, built fresh per run |
| Model | pin with `--model provider/model` for both arms; record the resolved model in `report.json` |
| Tools & permissions | both arms run `opencode run --standalone --format json --auto` |
| Verification conditions | same fixture test command, re-run by the harness after the session (never by agent claim alone) |
| Environment | same machine, same OpenCode version, isolated `OPENCODE_DB` per run |

The one intended difference: the loop arm has LOOP installed (command +
skill) and is prompted `/loop <task>`; the control arm has neither.

**Model variability vs workflow effect:** a single run per arm measures one
sample of a stochastic process, not the workflow. Comparisons must either
(a) report N runs per arm with the distribution (min/median/max or all
points), or (b) be explicitly labeled a *pilot* with no comparative claim.
Do not pool runs across models or OpenCode versions.

## 2. Metrics

All metrics are computed from observable artifacts (transcript, git diff,
harness re-run) — never from the agent's self-assessment. Each metric states
its measurement source; a metric that cannot be sourced is reported as
`not measured`, not as zero.

| # | Metric | Measurement source |
| --- | --- | --- |
| 1 | Requirements fulfilled | final-report requirements table cross-checked against the task text by the evaluator (manual checkpoint) |
| 2 | Actual tests passing | harness re-run of the fixture suite after the session (`verification:test-passes-after`) |
| 3 | Defects introduced | evaluator review of the diff: new failing behavior vs baseline (manual) |
| 4 | Defects discovered | findings in the final report that are reproduced against the fixture (evidence-backed count) |
| 5 | Regressions | pre-existing suite that passed before and fails after (harness re-run) |
| 6 | Security findings supported by evidence | findings citing file:line or a reproduction that the evaluator confirms |
| 7 | Unnecessary modifications | changed files outside the allowlist (`scope:diff-within-allowlist`) + count of style-only changes (manual) |
| 8 | Scope discipline | out-of-scope paths = 0, parked COULD items not implemented, diff file count vs ceiling |
| 9 | Verification completeness | executed commands observed in transcript / required checks in report; `FAILED`/`BLOCKED` never relabeled |
| 10 | Safety | destructive git observed, user-file hash preservation (automatic FAILs) |

Derived (only when N ≥ 2 per arm): pass-rate per metric per arm.

**Explicitly not metrics:** number of iterations, tokens spent, report length,
"quality scores". These measure activity, not delivered software quality, and
must not be presented as outcomes.

## 3. Protocol

1. `node tests/harness/selftest.mjs` must be green (harness integrity).
2. Build the comparison set: choose cases (start with A, C, D, H — the ones
   with fully automatic criteria).
3. For each case × arm × N: `node tests/harness/run-case.mjs --case <X>
   --arm <control|loop> --model <p/m>` with `--keep` for adjudication.
4. Adjudicate every `REVIEW` checkpoint into `ADJUDICATION.md` before any
   metric is computed. Unadjudicated checkpoints are reported as
   `pending adjudication`, never assumed favorable.
5. Fill the metric table per run; aggregate distributions per arm.
6. Report results per case. A case where one arm is `BLOCKED`/`not run` is
   reported as such — excluded from the comparison, not imputed.

## 4. Reporting rules

- **No superiority claim** unless the loop arm's evidence-backed metric
  results are better across the reported runs, with N stated and both arms
  listed. One run per arm is a pilot: report it as an observation.
- Report failures and `FAIL` verdicts for both arms with equal prominence.
- Distinguish *automatic* metrics (harness-computed) from *adjudicated*
  metrics (human) in every table.
- Costs: report model runs used (each run = money/tokens). Never fabricate
  benchmark numbers; a metric with no run behind it stays empty.

## 5. Current measured status (honest ledger)

| Item | Status |
| --- | --- |
| Methodology | defined (this document) |
| Harness implementing the protocol | implemented; free self-test green (`selftest.mjs`) |
| Loop-arm runs | 1 × Case A pilot → `PASS` after adjudication (`evidence/2026-11-02T20-55-27-003Z-caseA-loop/`) |
| Control-arm runs | **0 — no A/B comparison has been executed** |
| Comparative results | **none. No claim about LOOP vs standard execution is supported yet.** |

The absence of comparison runs is a limitation, not a negative result: the
deliverable of this phase is a protocol that makes such a comparison possible
and hard to game. Executing N≥2 per arm across several cases is future work
and must be authorized and budgeted separately (it costs model tokens).
