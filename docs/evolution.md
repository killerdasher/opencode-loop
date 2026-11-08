# LOOP Controlled Self-Evolution (P7)

A controlled improvement system for LOOP itself: it turns recorded
evaluation outcomes into classified weaknesses and testable improvement
proposals, drives candidates through the full regression suite in
isolated worktrees, and — only on a measurable, regression-free
improvement **and** an explicit human approval — records an adoption
decision. **The framework never modifies the active skill, never
publishes, and never applies a candidate automatically.**

Honest statement of scope (read this first): LOOP does **not** learn
model weights and holds no permanent autonomous intelligence. "Evolution"
here means improving instruction, reference, validation, and recovery
*artifacts* through human-approved, regression-gated changes. Model-
generated claims are never proof: verdicts rest on deterministic suite
counts only.

## The ten-step workflow (`scripts/evolution.mjs`, zero dependencies)

| Step | Command | What it does |
| --- | --- | --- |
| 1 | `collect <dir> --archives PATH` | Sanitizes recorded evaluation outcomes (validated continuity archives; `verification.json` manifest when present) into an append-only ledger. Already-recorded entries are skipped, never rewritten; unparseable or integrity-suspect sources are refused. |
| 2–3 | `patterns <dir>` | Classifies each recorded outcome into failure classes (with keyword counts) and reports **recurring** patterns (≥ `RECURRING_THRESHOLD` = 2). Derived per run; nothing asserted from memory. |
| 4 | `propose <dir> --from-stdin` | Registers a proposal `{ weaknessClass, mappedEntryIds[], changeTitle, changeSummary, acceptanceMetric [, claim] }`. Weakness classes: `instructions \\| references \\| validation \\| recovery`. |
| 5 | (inside `propose`) | Mapping is validated against the ledger: a proposal not backed by recorded failed cases is refused. |
| 6 | `verify <dir> --proposal P [--base SHA] [--candidate SHA]` | Creates two **detached git worktrees in the OS temp dir** (stable commit, candidate commit) — the active repository and skill are untouched. |
| 7 | (inside `verify`) | Runs the full regression suite on both sides with `spawnSync` (no shell) — by default `node scripts/validate.mjs --all` (3 summary tiers) and `node tests/harness/selftest.mjs` (1 tier); a hermetic suite spec may be supplied instead. |
| 8 | (inside `verify`) | Compares every `Summary: N passed, M failed` tier. Verdict: `IMPROVED` (strictly more passing, no regressions), `NEUTRAL` (equal, all green), `REJECTED` (any regression — see the gate below). |
| 9 | (inside `verify`) | Regressions reject: a `REJECTED` verdict **cannot ever be approved**, and the proposal's recorded status becomes `rejected` (its comparison record is preserved as evidence; nothing is deleted). |
| 10 | `report <dir> --proposal P` | Human-reviewable report: proposal, mapped cases, verdict, per-tier table, approval, and a limitations block (proxy metric, one-commit scope, claims-not-evidence, no-learning statement). |

Adoption: `approve <dir> --proposal P --approved-by NAME`.

- Approval is **refused** without an explicit approver name, without a
  recorded comparison, or when the latest verdict is not `IMPROVED`.
- Approval is a **decision record only** (`approval.appliedByTool` is
  always `false`): applying the candidate to the repository — including
  the instruction/reference/validation/recovery artifacts it targets — is
  a manual, human-reviewable step. The tool never commits, pushes, or
  publishes, and never writes anything under the active skill directory
  (`.opencode` paths are refused outright, fail-closed).

## The improvement gate (why this cannot self-congratulate)

`verify` accepts a proposal only if the candidate worktree's suites **all
exit 0** and some tier parses **strictly more** passing checks than the
stable side, with **zero regressions**. A tier counted lower, more
failures, a missing summary tier, or a nonzero exit is a regression →
`REJECTED`.

Disclosed limitation: tier passed-counts are a *structural* metric.
Renaming or splitting a check can read as a regression; the bias is
deliberately conservative (reject rather than accept ambiguity). A
proposal's optional `claim` field is echoed back **labeled as a claim,
not evidence** — it does not participate in the verdict.

## Records and reproducibility

Records live in an operator-chosen data dir (default `.loop/evolution/`,
never inside the skill dir): one JSON file per ledger entry / proposal /
comparison, schema-pinned v1, content-hash ids, deterministic id refusal
on proposals, secret-shape scanning on every write, atomic
temp+fsync+rename writes. The full report (Step 10) is regenerable at
any time from the records — history is never rewritten.

## Limits, stated plainly

- One candidate per comparison, one commit pair, the operator's suite
  spec — not a statistical model of LOOP quality.
- Improvement is measured against recorded evaluation outcomes; the
  ledger is only as good as the archives it sanitizes.
- Suite commands run as argv with no shell; tokens are split on
  whitespace — quoted paths are not supported (a deliberate no-shell
  trade, stated here rather than hidden).
- The framework proves a candidate passes more checks; whether the
  changed checks are the *right* checks is the human reviewer's call —
  that is the point of the mandatory approval step.
