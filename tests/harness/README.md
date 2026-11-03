# LOOP behavioral harness

Semi-automated evaluation harness for Cases A–I. It turns the rubric in
`tests/evaluation.md` into repeatable runs: build an isolated fixture → run
one model session → collect observable evidence → apply objective criteria →
report a verdict with manual checkpoints flagged for adjudication.

Zero dependencies: Node built-ins + git + the `opencode` CLI only.

## Quick start

```sh
# Free (no model calls, no network) — run this always:
node tests/harness/selftest.mjs

# One behavioral run (costs model tokens — see Costs):
node tests/harness/run-case.mjs --case A --arm loop

# Build/inspect a fixture without running a model:
node tests/harness/run-case.mjs --case D --build-only
```

### `run-case.mjs` options

| Option | Meaning |
| --- | --- |
| `--case A..I` | which evaluation case to run (required) |
| `--arm loop\|control` | `loop` = `/loop <task>` with LOOP installed into the fixture; `control` = plain task prompt, no LOOP (default `loop`) |
| `--model provider/model` | pin the model; default = session default |
| `--timeout ms` | model-run timeout (default 900000) |
| `--evidence dir` | override the evidence directory |
| `--keep` | keep the fixture directory even on PASS |
| `--build-only` | fixture construction + seed sanity only; temp dir removed; no model call |
| `--list` | print case IDs |

### Exit codes

| Code | Verdict | Meaning |
| --- | --- | --- |
| 0 | `PASS` | all criteria satisfied by evidence |
| 1 | `FAIL` | a criterion violated or forbidden behavior observed |
| 2 | `BLOCKED` | scenario/evidence could not be produced |
| 3 | `REVIEW` | all automated criteria pass; manual checkpoint(s) await adjudication |
| 4 | harness error | bad invocation, fixture/install failure, or runner exception |

Verdict precedence: `FAIL` > `BLOCKED` > `REVIEW` > `PASS`.

## What a run produces

```
tests/harness/evidence/<ISO-timestamp>-case<X>-<arm>/   (gitignored)
├── transcript.ndjson   raw `opencode run --format json` output
├── run-stderr.log      CLI stderr
├── report.json         verdict, model, session, facts, per-criterion results
├── report.md           human-readable summary + criterion table
├── session.sqlite      isolated OpenCODE_DB for this run
├── fixture/            the fixture repo as the agent left it
└── ADJUDICATION.md     (written by the evaluator, not the harness)
```

## Evidence model

- **The harness, not the agent, judges tests.** `verification:test-passes-after`
  re-runs the fixture suite after the session ends.
- **Ordering questions use one unified timeline** (`bash` / `write` / `text` /
  `obs` events) so "reproduced before fixing" and "planned before coding" are
  index comparisons, not impressions.
- **Unknown transcript event shapes are counted and surfaced**, never silently
  dropped; a parsing gap shows up in the report instead of disappearing.
- **`REVIEW` is a first-class outcome.** Criteria requiring human judgment
  (compression, attribution, parked-items discipline…) return `REVIEW`; the
  harness never converts them to `PASS`. Adjudication is written to
  `ADJUDICATION.md` next to the evidence.

## Costs

- `selftest.mjs`: **free** — fixture construction, git checks, synthetic
  transcript parsing, check-sensitivity mutations. No model, no network.
- `run-case.mjs`: **costs model tokens** (one session per run; a small case
  is ~20–70 s on the session default model). Run manually, one case at a time.
  Pin `--model` when comparing runs.
- **CI never runs model sessions.** CI runs `scripts/validate.mjs --all` and
  `selftest.mjs` only.

## Safety guarantees

- Fixtures are built in temp/evidence directories; nothing outside them is
  written.
- Git runs with an isolated config (no system/global config, fixture-local
  identity) — the user's git configuration is never read or changed.
- LOOP is installed into the fixture only (`-Scope project`); the real
  OpenCode configuration directory is never a destination.
- Session state goes to an `OPENCODE_DB` file inside the evidence directory,
  never the user's normal OpenCode database.
- The harness never commits, pushes, or tags in this repository.

## Files

| File | Role |
| --- | --- |
| `fixtures.mjs` | builds Cases A–I; declares task, allowlist, test command, user files, seeded-state expectations; `commitFixturePaths()` records harness arm-setup without touching user work |
| `transcript.mjs` | `parseTranscript()` (NDJSON → timeline) and `collectDiffFiles()` (porcelain → paths); parsers are extracted so the self-test can regression-test them |
| `checks.mjs` | objective criteria per case; returns per-check status + verdict aggregation |
| `run-case.mjs` | CLI runner: fixture → arm setup → `opencode run` → evidence → evaluation → exit code |
| `selftest.mjs` | free self-test: fixtures build, seeds are real, checks are sensitive, parser regressions (§5) |

## Adding a case

1. Add a builder to `BUILDERS` in `fixtures.mjs` with `task`, seed state, and
   declarations (`allowlist`, `userFiles`, `testCommand`, `forbiddenPhrases`,
   `requireLabels`, `maxDiffFiles`…).
2. Add an evaluator to `CASE_EVALUATIONS` in `checks.mjs`.
3. Add the case to `tests/evaluation.md` **and**
   `.opencode/skills/loop-engine/references/evaluation-cases.md` (the
   validator enforces case-ID alignment between the two).
4. Add free self-test coverage: fixture builds, seed sanity, and at least one
   PASS + one FAIL sensitivity check per new criterion.
5. Run `node scripts/validate.mjs --all` and `node tests/harness/selftest.mjs`.
