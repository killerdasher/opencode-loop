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

# One behavioral run (costs model tokens — see Costs; requires the
# --allow-auto operator acknowledgement described under Isolation model):
node tests/harness/run-case.mjs --case A --arm loop --allow-auto

# Build/inspect a fixture without running a model:
node tests/harness/run-case.mjs --case D --build-only
```

### `run-case.mjs` options

| Option | Meaning |
| --- | --- |
| `--case A..I` | which evaluation case to run (required) |
| `--arm loop\|control` | `loop` = `/loop <task>` with LOOP installed into the fixture; `control` = plain task prompt, no LOOP (default `loop`) |
| `--model provider/model` | pin the model; default = session default |
| `--allow-auto` | **required** for any model run: operator acknowledgement that the session runs unattended with auto-approval. Without it the runner refuses (exit 4) |
| `--env-pass NAME,...` | additional environment variables to forward to the evaluated session (values never printed); default is an allowlist that drops credential-shaped variables |
| `--timeout ms` | model-run timeout (default 900000) |
| `--evidence dir` | override the evidence directory |
| `--keep` | keep the fixture directory even on PASS |
| `--build-only` | fixture construction + seed sanity only; temp dir removed; no model call; no acknowledgement needed |
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
├── report.json         verdict, model, session, facts, safety record, per-criterion results
├── report.md           human-readable summary + safety record + criterion table
├── opencode.permissions.json  the least-privilege permission config handed to this run
├── session.sqlite      isolated OPENCODE_DB for this run (+ -wal/-shm)
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
  transcript parsing, check-sensitivity mutations, and the unattended-run
  safety contract (env scrubber, permission rules, acknowledgement gate).
  No model, no network, no acknowledgement required.
- `run-case.mjs`: **costs model tokens** (one session per run; a small case
  is ~20–70 s on the session default model) and requires `--allow-auto`.
  Run manually, one case at a time. Pin `--model` when comparing runs.
- **Evidence size.** Each run stores an isolated `session.sqlite` in its
  evidence dir (observed: ~11.5 MB plus `-wal`/`-shm` for a short Case A
  run, plus the transcript and limits). Evidence is local and gitignored;
  delete old `tests/harness/evidence/<run>/` directories when they are no
  longer needed for adjudication.
- **CI never runs model sessions.** CI runs `scripts/validate.mjs --all` and
  `selftest.mjs` only.

## Isolation model — what is isolated, what is not

An agent under evaluation is an ordinary child process running as the user.
Keep the following five notions apart, because the harness isolates some of
them and explicitly does not isolate others:

| Notion | Status in a model run |
| --- | --- |
| **Fixture directory** | Isolated as a *destination of the harness's own actions*: built in a temp dir, seed-verified, and — on PASS — removed. The harness never writes outside it and a gitignore'd evidence dir. |
| **Session & database** | Isolated per run: `opencode run --standalone` boots a private server and `OPENCODE_DB` points it at `session.sqlite` inside the evidence dir (verified against real run artifacts; a non-standalone run would instead talk to the user's shared background server, so `--standalone` is required, not decorative). |
| **Configuration** | **Not isolated.** OpenCode merges the user's global config into every run (providers, plugins, instructions). The harness layers a least-privilege permission config on top via the documented `OPENCODE_CONFIG` tier (written to `opencode.permissions.json`), which overrides the global config on conflicting keys; it does not remove the global config. |
| **Permission restrictions** | Explicit opt-in with least privilege: a model run is refused without `--allow-auto`; with it, the permission config hard-denies `external_directory` (tools touching paths outside the fixture), `webfetch`, `websearch`, `*.env` reads, and `curl`/`wget` bash commands. Under `--auto` these denies are still enforced (documented OpenCode behavior); everything OpenCode would prompt for is approved. |
| **Operating-system sandbox** | **No operating-system sandbox** exists. `bash`, `edit`, and `read` default to allow; a child process has the user's effective abilities. The permission config contains a few named risky actions; it cannot contain `bash` generally. Anything requiring true isolation (e.g. adversarial models, untrusted tasks) must run in a disposable environment (container/VM/user account) — that is the operator's job, not LOOP's. |

Additional safety controls on every model run (both A/B arms identically):

- **Harness-side git is identity-isolated.** All git calls from the harness run
  with `GIT_CONFIG_NOSYSTEM=1` and a fixture-local `GIT_CONFIG_GLOBAL` — the
  user's git configuration is never read or changed by the harness (the
  evaluated agent's own git calls run against the user's real config,
  confined in effect by the fixture being a repository without a remote).
- **The harness never commits, pushes, or tags in this repository.**

Per-run controls (both A/B arms identically):

- **Acknowledgement gate.** Without `--allow-auto` the runner exits 4 before
  any side effect. Running evaluations unattended is a decision the operator
  must make explicitly; the acknowledgement is not a substitute for the
  isolation described above.
- **Env allowlist.** The child environment is built with `keeperEnv`
  (`safety.mjs`): only runtime basics (PATH, HOME/TEMP/system paths, locale,
  proxy vars for egress, Windows system vars incl. `SystemRoot`,
  `ComSpec`, `PSModulePath`) plus the harness's own
  `OPENCODE_DB`/`OPENCODE_CONFIG` are inherited. Matching is case-insensitive
  on Windows (its real spellings are `Path`, `ComSpec`) and case-sensitive on
  POSIX (where `path` is a different variable). Credential-shaped variables
  (`*_TOKEN`, `*_API_KEY`, SSH agents…) never reach the session; the report
  records the COUNT of dropped variables, never their names.
  `--env-pass NAME,...` forwards named extras (e.g. the provider key an
  env-auth setup needs), visible in the report.
- **Evidence hygiene.** Evidence is local and gitignored; reports record the
  COUNT of scrubbed-out variables, never their names — the set of variables
  that exist on a machine is not report content — and no values are ever
  printed. Only variables the operator explicitly named with `--env-pass`
  appear by name (the operator knows them already). The full transcript and
  session DB stay in the evidence dir.

## Files

| File | Role |
| --- | --- |
| `fixtures.mjs` | builds Cases A–I; declares task, allowlist, test command, user files, seeded-state expectations; `commitFixturePaths()` records harness arm-setup without touching user work |
| `transcript.mjs` | `parseTranscript()` (NDJSON → timeline), `collectDiffFiles()` (porcelain → paths), and `writeReports()` (report.json/report.md); parsers and the writer are extracted so the self-test can regression-test them |
| `checks.mjs` | objective criteria per case; returns per-check status + verdict aggregation |
| `run-case.mjs` | CLI runner: fixture → arm setup → safety controls → `opencode run` → evidence → evaluation → exit code |
| `safety.mjs` | unattended-run safety contract: `keeperEnv()` env allowlist, least-privilege `permissionRules()`/`writePermissionConfig()` |
| `selftest.mjs` | free self-test: fixtures build, seeds are real, checks are sensitive, parser regressions, unattended-run safety contract |

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
