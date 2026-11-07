# LOOP Model Capability Evaluation (P6)

Evidence-backed evaluation of LOOP-compatible AI models. The framework
measures eight named capability dimensions from **controlled, identical
task runs** and derives capability profiles from **completed evaluation
records** — never from marketing descriptions, benchmark claims, or any
model's self-report.

Status: shipped infrastructure validated offline on fixture records.
Producing a profile of a real model requires operator-initiated runs
with operator-supplied credentials; this repository ships zero real
model profiles (see [Honest scope](#honest-scope)).

## The eight dimensions

One task each in the pinned task set (`tests/model-eval/taskset.v1.json`;
multiple tasks per dimension may be recorded):

| Dimension | What it measures |
| --- | --- |
| `instruction-adherence` | resolving flags/settings exactly; no silent drift to defaults |
| `tool-calling` | valid tool invocations; no fabricated tools/paths; recovery on failure |
| `coding-correctness` | fixes that pass hidden tests without touching public API |
| `context-management` | no skipped stages; no stale findings re-reported as fresh |
| `verification-accuracy` | verdicts derived from transcripts only; unevidenced success never corroborated |
| `security-reasoning` | refuses secret persistence; continues the safe remainder of work |
| `recovery-behavior` | reconcile read-only before any modification; continue only with approval |
| `completion-evaluator-adherence` | reports the evaluator's derived outcome verbatim; no re-labeling |

## Rules the framework enforces by construction

- **Identical tasks only.** Every evaluated model receives the same task
  prompts verbatim, pinned by version `v1.0.0` and a SHA-256-derived
  16-hex `taskSetHash` written into every record. Comparisons between
  records with different task-set hashes are **refused** (blocked, exit
  2) — differing tasks are never silently compared.
- **Environment recorded, compared honestly.** `environment` (os,
  nodeVersion, optional harnessNote) is stored per record; comparisons
  between differing environments carry a `directional, never controlled`
  warning.
- **No rankings, ever.** `compare` emits per-dimension counts labeled
  "observed difference". No overall score, no winner, no aggregate and
  no rank field exists anywhere in the output, so a single-number model
  ranking is not derivable. Profiles likewise state counts + a
  sample-size classification only.
- **Sample-size honesty.** A dimension needs ≥ `MIN_TASKS_PER_DIMENSION`
  (3) recorded tasks to classify as `EVIDENCED`; below that it is
  `INSUFFICIENT_SAMPLE` — classified, **never scored**. Completing a
  record requires an explicit `limitations` statement (refused without
  one); it is carried into every derived profile and comparison.
- **No credentials, no provider switching.** The tool never calls a
  provider, never selects or switches providers, and never touches the
  network. `provider` / `modelId` are operator-typed names only — records
  must contain no secrets (the repository security scanner runs on every
  write; secret-shaped content is refused, fail-closed). Evaluation runs
  are operator-initiated with operator-supplied credentials; the tool
  itself is never given them.
- **No paid API for core tests.** The core project tests (validator +
  self-test) exercise the framework offline on fixture records in temp
  dirs. Zero network, zero cost.
- **Deterministic, no overwrites.** `runId` =
  first 16 hex of `sha256(provider ␀ modelId ␀ taskSetHash ␀ testedAt)`.
  Re-initializing with identical inputs is refused (bump `testedAt` or
  inspect the existing record). All writes are atomic (tmp + fsync +
  rename).
- **Marketing is not evidence.** Records are allowlist-strict: unknown
  fields (e.g. promotional prose) are refused. Unrecorded behavior is
  unmeasured behavior.

## CLI (`scripts/model-eval.mjs`)

Zero dependencies, Node ≥ 16.7. Exit codes: 0 ok, 2 blocked, 4
usage/refusal, 5 internal.

```
node scripts/model-eval.mjs taskset                 # print pinned task set + hash
node scripts/model-eval.mjs init <dir> --provider Acme --model acme-9 --tested-at 2026-01-01T00:00:00Z [--os X --node Y] [--taskset PATH]
node scripts/model-eval.mjs result <dir> --run-id R --from-stdin
                                                    # {"id","dimension","result":"PASS|FAIL|PARTIAL","evidence?","notes?"}
node scripts/model-eval.mjs complete <dir> --run-id R --from-stdin
                                                    # {"limitations":"..."} REQUIRED
node scripts/model-eval.mjs profile <dir> --run-id R
node scripts/model-eval.mjs compare <dir> --run-ids A,B
```

Record files are `<dir>/model-eval-<runId>.json`; schema (v1):

```json
{
  "schemaVersion": 1, "tool": "loop-model-eval", "runId": "…16 hex",
  "provider": "…", "modelId": "…", "testedAt": "ISO",
  "environment": { "os": "…", "nodeVersion": "…", "harnessNote": "…" },
  "taskSetVersion": "v1.0.0", "taskSetHash": "…16 hex",
  "tasks": [ { "id": "…", "dimension": "…", "result": "PASS",
               "evidence": "relative/path", "notes": "…" } ],
  "limitations": "…", "completed": true
}
```

`evidence` is a project/record-relative path the operator can re-inspect
(the framework stores it as data; it does not assert its existence — the
same boundary as continuity evidence paths).

## Honest scope

- **Shipped:** record-keeping + derivation framework, pinned task set,
  comparison with mismatch refusal, secret scanning, atomic writes;
  validated on fixture records by `tests/harness/selftest.mjs` and
  `scripts/validate.mjs` — fully offline, free.
- **Not shipped (token-gated):** real model capability profiles. No model
  credentials exist in this project; evaluation runs are an
  operator-supplied-credentials exercise. Zero real profiles exist here,
  and none are inferred from any vendor's marketing material.

Documented limits: the framework verifies record integrity, sample-size
thresholds, and comparison preconditions deterministically; it cannot
verify that a recorded `PASS` reflects reality — that is the operator's
evidence discipline (re-inspectable artifact per task). Small sample
sizes are disclosed, never smoothed over: `INSUFFICIENT_SAMPLE` and the
`limitations` field exist so nothing passes as more evidenced than it is.
