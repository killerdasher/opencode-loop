# LOOP — Iterative Engineering Engine for OpenCode

[![validate](https://github.com/killerdasher/opencode-loop/actions/workflows/validate.yml/badge.svg)](https://github.com/killerdasher/opencode-loop/actions/workflows/validate.yml) [![release](https://img.shields.io/github/v/release/killerdasher/opencode-loop)](https://github.com/killerdasher/opencode-loop/releases)

**LOOP** is a goal-driven iterative workflow for [OpenCode](https://opencode.ai). It gives your agent a disciplined engineering loop — analyze, inspect, plan, implement, **verify**, adversarially review, improve — and keeps it going until the result is genuinely done, with evidence instead of optimism.

```
/loop Build a full-stack application with authentication and testing.
```

LOOP is a command (`.opencode/commands/loop.md`) plus a skill (`.opencode/skills/loop-engine/SKILL.md`). It runs entirely inside your existing OpenCode session: no framework, no API key, no special model, no external service.

## Why LOOP exists

Left to itself, an agent tends to do one of two things: implement the first acceptable solution and stop, or keep churning without a stopping rule. LOOP replaces both failure modes with a repeatable process:

1. **Understand the objective** before touching anything — including what "done" means.
2. **Inspect the actual project** — structure, conventions, git state, uncommitted user work.
3. **Consider the approach** when the task has real technical choices.
4. **Implement in coherent increments**, not one giant diff.
5. **Verify actual behavior** — run the tests, the build, the linter — and record the real results.
6. **Review the work adversarially**, as a skeptical engineer who didn't write it.
7. **Fix what matters**, in severity order, then verify again.
8. **Converge or stop honestly** — against explicit stopping conditions, never by declaring victory early.

## Core principles

- **Evidence over claims.** Every "done" must trace to a command that ran, a test that passed, or an artifact that exists. Fabricated success is the one thing LOOP treats as a hard failure.
- **Honest labels.** `VERIFIED`, `IMPLEMENTED BUT NOT VERIFIED`, `BLOCKED`, `NOT APPLICABLE`, `FAILED` — used precisely, never upgraded without new evidence.
- **Scope is sacred.** The user's objective is the boundary. Speculative features get parked, not implemented.
- **User work is untouchable.** Git status is checked first; uncommitted changes are preserved; destructive actions require explicit authorization.
- **Appropriate complexity.** The best result is the one that best satisfies the objective with the least defensible complexity — not the biggest implementation.
- **Convergence, not churn.** Two consecutive cycles without meaningful improvement is a signal to stop, not to keep editing.

## How the workflow operates

The `loop-engine` skill drives nine stages:

| Stage | Purpose |
| --- | --- |
| 0 — Objective acquisition | Extract the goal; classify requirements MUST / SHOULD / COULD; define testable success criteria |
| 1 — Project reconnaissance | Inspect structure, dependencies, tests, build system, git state, existing conventions |
| 2 — Solution-space exploration | Compare viable approaches when the task has meaningful technical choices |
| 3 — Architecture and planning | Components, interfaces, error handling, testing strategy, implementation sequence |
| 4 — Engineering | Implement in coherent increments, following project conventions |
| 5 — Verification | Run relevant checks; record every command as PASS / FAIL / BLOCKED / NOT APPLICABLE |
| 6 — Adversarial review | Skeptical review of the actual diff across correctness, architecture, security, performance, usability, maintainability |
| 7 — Improvement | Fix by severity (CRITICAL/HIGH first); each iteration has one specific objective |
| 8 — Convergence | Decide against explicit stopping conditions; report honestly, including incompleteness |

Iteration 1 runs stages 0–6. Later iterations start at stage 7 with a specific improvement objective, then re-verify and re-review. Stage 8 runs after every iteration.

An iteration boundary looks like this:

```
LOOP | ITERATION 2/5 — close the HIGH-severity path traversal finding
stage: Stage 7 — Improvement
changed: fixed resolveDownloadPath(), added traversal regression test
verified: npm test (47 pass), npm run lint (clean)
key findings: none new at CRITICAL/HIGH
next: full adversarial re-review of the changed module
```

## Commands and modes

```
/loop <task>                              # default (balanced) run
/loop --mode deep <task>                  # broader exploration + heavier adversarial review
/loop --max-iterations 3 <task>           # tighter iteration budget
/loop --max-iterations 7 --mode deep <task>
/loop                                     # no task: uses the current conversation as the objective
```

| Setting | Values | Default | Notes |
| --- | --- | --- | --- |
| `--max-iterations` | 1–10 | 5 | Out-of-range values are clamped; the correction is stated in the Stage 0 summary |
| `--mode` | `focused`, `balanced`, `deep` | `balanced` | Controls depth of alternative exploration and adversarial review |

Invalid flags never abort the run: LOOP names the correction and continues with defaults.

Mode behavior:

| Mode | Exploration | Adversarial review |
| --- | --- | --- |
| `focused` | One-paragraph justification when the approach is clear | Core dimensions, concise |
| `balanced` | Genuine comparison for meaningful decisions | Full dimensions |
| `deep` | Broad comparison, including rejected alternatives | Full dimensions + re-review of areas touched repeatedly |

> **Honesty note:** iteration limits and modes are *prompt-level execution guidance*, not a runtime controller. No code counts your iterations — the workflow's integrity depends on the agent tracking and reporting them truthfully. LOOP says the same thing to the agent inside the skill.

## Installation

### Windows (PowerShell)

```powershell
git clone https://github.com/killerdasher/opencode-loop.git
cd opencode-loop
.\scripts\install.ps1
```

Installs to your global OpenCode config (`~\.config\opencode`) by default.

> **If PowerShell blocks script execution** (the default policy on many Windows machines is `Restricted`), run the installer in one shot instead:
>
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
> ```

### Linux and macOS (Bash)

```sh
git clone https://github.com/killerdasher/opencode-loop.git
cd opencode-loop
./scripts/install.sh
```

Installs to `${XDG_CONFIG_HOME:-$HOME/.config}/opencode` by default.

### What installation does

- Copies `loop.md` into `commands/` and the `loop-engine` skill into `skills/`.
- **Never silently overwrites.** If a target file already exists and is identical, it is skipped (idempotent). If it differs, installation refuses and tells you why - unless you pass `-Overwrite` / `--overwrite`, which creates a timestamped backup first. Backups go to a sibling of the install root (`<root>-loop-backups\<timestamp>\...`), never inside `<root>/commands` or `<root>/skills`, so an OpenCode extension discovery scan cannot resurrect a replaced revision (a SKILL.md backup inside `skills/` is discovered as a live skill).
- Supports a dry run (`-DryRun` / `--dry-run`) that prints actions without changing anything.
- Supports uninstall (`-Uninstall` / `--uninstall`), which backs up before removing.

### Project-local installation

Install into a single repository instead of globally:

```powershell
.\scripts\install.ps1 -Scope project -ProjectDir C:\src\my-app     # Windows
```

```sh
./scripts/install.sh --project /src/my-app                          # Linux/macOS
```

### Manual installation

No script required — copy these two paths by hand (the installers live at `scripts/install.ps1` for Windows and `scripts/install.sh` for Bash):

1. `.opencode/commands/loop.md` → `~/.config/opencode/commands/loop.md`
2. `.opencode/skills/loop-engine/` → `~/.config/opencode/skills/loop-engine/`

(On Windows, `~/.config/opencode` is `%USERPROFILE%\.config\opencode`. Project-local equivalents live under `<project>/.opencode/`.)

### Upgrade and uninstall

```powershell
.\scripts\install.ps1 -Overwrite      # upgrade, backing up existing files first
.\scripts\install.ps1 -Uninstall      # remove, backing up first
```

```sh
./scripts/install.sh --overwrite      # upgrade
./scripts/install.sh --uninstall      # remove
```

## Example usage

```
/loop Build a full-stack application with authentication and testing.
```

```
/loop --mode deep Review the architecture and improve its reliability.
```

```
/loop --max-iterations 3 Refactor this module without changing its public API.
```

## Configuration

LOOP needs no configuration. The two execution settings (`--max-iterations`, `--mode`) are passed per invocation, and natural language works too — e.g. `/loop spend a couple of iterations hardening this parser` is interpreted against the same mode table.

## Validating this repository

```sh
node scripts/validate.mjs              # structure, frontmatter, references, docs, secret scan
node scripts/validate.mjs --self-test  # proves the validator catches deliberately broken copies
node scripts/validate.mjs --install-test  # runs both installers against temp dirs
node scripts/validate.mjs --all        # everything

node tests/harness/selftest.mjs        # behavioral harness: free checks (no model calls)
```

Zero dependencies — Node.js only. The same checks run in CI on Linux and Windows (see [docs/architecture.md](docs/architecture.md) for the full design).

### Behavioral evaluation

Structural validation proves the files are correct; it does not prove agent
behavior. The behavioral harness in `tests/harness/` runs the Cases A–I from
[tests/evaluation.md](tests/evaluation.md) against a live model session in an
isolated fixture repository, and judges the result from observable evidence
(transcript, git diff, an independent re-run of the fixture's tests):

```sh
node tests/harness/run-case.mjs --case A --arm loop   # one run (costs model tokens)
```

CI runs only the free harness self-test, never model sessions. The A/B
comparison methodology (standard OpenCode vs LOOP) is specified in
[tests/comparison.md](tests/comparison.md); no comparative results are
claimed yet.

## Known limitations

- **Prompt-level iteration limits.** Nothing enforces `--max-iterations` at runtime; a misbehaving model could ignore the budget. LOOP mitigates this with explicit iteration banners and honest reporting rules, not hard enforcement.
- **Quality depends on the active model and tools.** LOOP structures the work; it cannot add capabilities your model or session lacks. Verification is limited to what the session can actually run (e.g., no cross-platform claims for platforms you didn't test).
- **No persistent learning.** Each run starts fresh; LOOP does not retain memory between sessions.
- **No guarantee of perfection.** LOOP aims for evidence-based quality, not the discovery of every possible defect.
- **Skill loading requires OpenCode's skill tool.** If the `loop-engine` skill cannot load, the `/loop` command degrades to a built-in outline and marks the run `DEGRADED — SKILL UNAVAILABLE` rather than failing silently.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `.\scripts\install.ps1` is blocked ("running scripts is disabled") | Default PowerShell execution policy is `Restricted` | Run `powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1` |
| `/loop` is not listed when typing `/` | Command file not in an OpenCode commands directory | Re-run the installer, or copy `loop.md` to `~/.config/opencode/commands/` (or `<project>/.opencode/commands/`) |
| Skill not loaded / `DEGRADED — SKILL UNAVAILABLE` | `loop-engine` missing from a skills directory, or invalid frontmatter | Verify `~/.config/opencode/skills/loop-engine/SKILL.md` exists and its frontmatter `name: loop-engine` matches the directory name |
| `Refusing to overwrite a differing file` | An existing file differs from this repository's version | Inspect the file; then re-run with `-Overwrite` / `--overwrite` (a backup is created first) |
| LOOP stops early with requirements unmet | A stopping condition was hit (budget, no-improvement, blocker) | The report names the condition; re-run with a higher `--max-iterations` or resolve the stated blocker |
| OpenCode does not pick up new files | Config/skill discovery caches | Run `/reload` in the TUI (config changes otherwise apply without a restart) |

## Repository structure

```
opencode-loop/
├── .opencode/
│   ├── commands/loop.md                 # /loop entry point
│   └── skills/loop-engine/
│       ├── SKILL.md                     # the workflow engine
│       └── references/
│           ├── quality-gates.md         # status vocabulary, gates, report formats
│           ├── risk-analysis.md         # adversarial review checklists
│           └── evaluation-cases.md      # in-session behavioral guidance
├── scripts/
│   ├── install.ps1                      # Windows installer
│   ├── install.sh                       # Linux/macOS installer
│   └── validate.mjs                     # repository validator (3 modes)
├── tests/
│   ├── evaluation.md                    # behavioral evaluation rubric (Cases A–I)
│   ├── comparison.md                    # A/B comparison methodology (no results claimed)
│   └── harness/                         # semi-automated evaluation harness
│       ├── README.md                    # usage, exit codes, costs, safety
│       ├── fixtures.mjs                 # isolated fixture repos for Cases A–I
│       ├── transcript.mjs               # transcript + git-diff evidence parsers
│       ├── checks.mjs                   # objective PASS/FAIL/BLOCKED/REVIEW criteria
│       ├── run-case.mjs                 # runner (`opencode run --format json`)
│       └── selftest.mjs                 # free self-test (no model calls)
├── docs/
│   ├── architecture.md · design-principles.md
│   └── adr/0001-runtime-orchestration.md  # skill-only vs plugin vs orchestrator
├── .github/workflows/validate.yml       # CI on Linux + Windows
├── README.md · CONTRIBUTING.md · SECURITY.md · CHANGELOG.md · LICENSE
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: run `node scripts/validate.mjs --all` before submitting, keep the skill modular, and don't add dependencies without a stated need.

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities. Please do not open public issues for security reports.

## License

[MIT](LICENSE)
