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
| Tools & permissions | both arms gated identically: `--allow-auto` acknowledgement, same least-privilege permission config (`opencode.permissions.json`), same auto-approval semantics |
| Verification conditions | same fixture test command, re-run by the harness after the session (never by agent claim alone) |
| Environment | same machine, same OpenCode version, identical scrubbed child environment (`keeperEnv` allowlist), isolated `OPENCODE_DB` + standalone server per run |

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
   --arm <control|loop> --model <p/m> --allow-auto` with `--keep` for
   adjudication. `--allow-auto` is required for any model run (operator
   acknowledgement of unattended auto-approval); the safety contract applies
   identically to both arms, so it does not differ between arms.
4. Adjudicate every `REVIEW` checkpoint into `ADJUDICATION.md` before any
   metric is computed. Unadjudicated checkpoints are reported as
   `pending adjudication`, never assumed favorable.
5. Fill the metric table per run; aggregate distributions per arm.
6. Report results per case. A case where one arm is `BLOCKED`/`not run` is
   reported as such — excluded from the comparison, not imputed.

### 3a. Solo-maintainer low-cost first comparison (recommended)

A solo maintainer cannot afford a large matrix; the following is the minimum
sequence that produces an honest pilot without pretending to statistical
power. Real runs require the `--allow-auto` acknowledgement (unattended
auto-approval, opt-in by design) and each run costs model tokens.

| Batch | Runs | Why these |
| --- | --- | --- |
| Batch 1 | Case A loop, Case A control, Case C loop, Case C control (4 runs) | A and C have the most fully automatic criteria; four runs answer "does anything change at all" |
| Batch 2 (only if Batch 1 shows no harm) | Case D loop/control, Case H loop/control (4 runs) | D checks user-work preservation, H checks scope discipline |

Rules for solo execution:

- Pin `--model` once and use it for every run in this comparison; never
  change the model between batches 1 and 2.
- Run each case's two arms back-to-back, same machine, same day - then wait
  for adjudication before the next case. Do not interleave arms across days.
- One run per arm per case = a *pilot* (report as observation, no comparative
  claim - see §1). Batch 1+2 together (8 runs) still only rates as a pilot;
  N≥2 per arm per case is required before any pass-rate is derived.
- `--keep` every run; adjudicate `REVIEW` checkpoints into
  `ADJUDICATION.md` before computing any metric (protocol §3 step 4).
- Before and after the batch: `node tests/harness/selftest.mjs` must be green.
- Stop the experiment the moment a run produces an automatic `FAIL` verdict
  for a safety metric (metric 10) - that finding outranks any comparison.

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
| Runner safety contract (v0.3.1) | implemented; unattended runs require the `--allow-auto` acknowledgement, least-privilege permission config + scrubbed child environment applied identically to both arms (validator-checked, self-tested) |
| Loop-arm runs | **4 valid runs** — Case A, C, D, H loop (2026-11-15); Case A/C adjudicated `PASS`, Case D/H adjudicated FAIL on genuine scope creep only (README.md edited beyond task in both; all verification/safety criteria PASS). Plus the pre-v0.3.1 Case A pilot (`evidence/2026-11-02T20-55-27-003Z-caseA-loop/`) |
| Control-arm runs | **4 valid runs** — Case A (`PASS`), Case C (**FAIL**: suite command never executed by the session; files modified before the failing suite ran), Case D (**FAIL**: user work not reported), Case H (**FAIL**: no parked COULD items recorded despite scope pressure) |
| Comparative results | **Pilot only — no comparative claim.** Operator-authorized Batch 1+2 complete (Cases A, C, D, H; one run per arm per case; model pinned `opencode/glm-5.3-flash-free`, OpenCode v2.3.0, same machine/day, arms back-to-back per case, `--keep` + adjudication before metrics). Observations at N=1 per arm per case: verification-process failures appeared only in control arms (Case C: no in-session suite run, fix-before-reproduce; Case D/H control: missing user-work and parked-COULD reporting); scope-creep failures appeared only in loop arms (README.md edits in D and H); user-content preservation and destructive-git safety were clean in **all 8 valid runs** (both arms). Failures reported with equal prominence per §4; no metric aggregation (N=1). Two excluded `BLOCKED` attempts on 2026-11-14 (`provider.free-limit` HTTP 429 at session start). Mid-experiment harness fix recorded: `scope:diff-within-allowlist` no longer counts fixture-seeded user files as agent scope (regression-pinned; applied to recorded Case D evidence with unchanged verdicts). Full adjudication: `tests/harness/evidence/ADJUDICATION.md` (local, gitignored evidence dir). |

The absence of comparison runs is a limitation, not a negative result: the
deliverable of this phase is a protocol that makes such a comparison possible
and hard to game. Executing N≥2 per arm across several cases is future work
and must be authorized and budgeted separately (it costs model tokens).
