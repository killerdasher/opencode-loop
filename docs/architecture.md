# Architecture

How LOOP is built and why. This document describes the implementation as it exists in version 0.1.0.

## What LOOP executes

LOOP is a prompt-level workflow. It contains no runtime process, no daemon, and no model coupling: OpenCode reads the Markdown command and skill, and the active model performs the staged work described in them.

```text
user  ──/loop <task>──▶  OpenCode command (.opencode/commands/loop.md)
                              │  prompt template: $ARGUMENTS expansion,
                              │  no agent/model override, no shell blocks
                              ▼
                    loop-engine skill (.opencode/skills/loop-engine/SKILL.md)
                              │  loaded explicitly via the skill tool
                              │  by exact id "loop-engine"
                              ▼
                    Stages 0..8 executed by the model in the session
                              │  supporting detail loaded on demand from
                              ▼
                    references/ (quality-gates, risk-analysis, evaluation-cases)
```

Supporting files are never auto-inlined. OpenCode provides the skill's base directory and a sample of supporting file paths; SKILL.md instructs when to read which reference file. This keeps the model's core context small and the skill modular.

## Components

| Component | Responsibility |
| --- | --- |
| `.opencode/commands/loop.md` | Entry point. Expands `/loop <task>` into a durable prompt: preserves the full `$ARGUMENTS`, parses `--max-iterations` and `--mode`, handles the no-argument case by using the conversation's current objective, and requires explicit loading of the `loop-engine` skill before any other action. |
| `.opencode/skills/loop-engine/SKILL.md` | The engine. The eight-stage iterative lifecycle (objective acquisition, reconnaissance, solution-space exploration, planning, implementation, verification, adversarial review, improvement, convergence), execution settings, hard safety rules, the iteration model, and the reporting contract. |
| `references/quality-gates.md` | Verification vocabulary, quality-gate dimensions, convergence checklist, and final report format. |
| `references/risk-analysis.md` | Adversarial review methodology: dimension checklists, severity taxonomy, no-fabrication rules, fix prioritization. |
| `references/evaluation-cases.md` | Runtime behavior guidance for the nine canonical distortion situations (cases A-I). |
| `scripts/install.ps1` | Windows installer (PowerShell 5.1+): global install by default, `-Local` for project-local, `-Destination` override for testing, backup-before-replace, content-verified uninstall. |
| `scripts/install.sh` | POSIX installer with the same behavior model (`--local`, `--dest`, `--uninstall`). |
| `scripts/validate.mjs` | Repository validator: structure, frontmatter contract, lifecycle completeness, references, documentation links, ASCII-only tooling, CI workflow; `--selftest` adds sandboxed installer tests and defect injection. |
| `tests/evaluation.md` | Manual evaluation rubric for cases A-I. |
| `docs/` | This architecture document and the design principles. |

## Design decisions (with rationale)

| # | Decision | Rationale | Consequences |
| --- | --- | --- | --- |
| D1 | Markdown-native workflow (command + skill), no plugin | OpenCode V2 advertises and loads skills natively; the methodology is prompt content, not executable code. A plugin would add a bundling/runtime dependency with no additional control over model behavior. | LOOP installs as two artifacts plus installers; iterating does not require Node, Bun, or API keys. Runtime features a plugin could provide (hard iteration counters) are out of scope and documented as such. |
| D2 | Explicit `$ARGUMENTS`, no positional parsing in the template | `--max-iterations` and `--mode` can appear anywhere in natural-language phrases; positional `$1`-style flags are brittle with prose. The skill re-parses flags from the argument string and handles invalid values gracefully. | Users type plain sentences; unknown flags degrade to documented defaults instead of failing. |
| D3 | Default agent, no model override | The spec requires LOOP to work with the user's default agent and model; how the loop runs must not silently switch cost or context models. | Command frontmatter only carries `description`. |
| D4 | No shell interpolation blocks in the command | OpenCode docs warn that command shell blocks run outside the agent's tool permission flow. Passing untrusted arguments into `!`...`` blocks is unsafe. | Arguments are only used as prompt text. |
| D5 | Skill references split by concern, single-line frontmatter | Keeps SKILL.md lean (loaded into context whenever the loop runs), while checklists load only when needed. Single-line `key: value` frontmatter makes validation deterministic without shipping a YAML parser. | Contributors extend references without bloating the core loop. |
| D6 | Installers copy artifacts with content-hash comparisons and timestamped backups | The install target may contain user-created files, including a user's own `/loop` command or `loop-engine` skill. Silent overwrite is unacceptable. | Idempotent installs; user files always recoverable from `.bak.<timestamp>`; uninstall removes only content that matches LOOP's or carries LOOP's marker. |
| D7 | Validation is a single dependency-free Node script with a strict selftest | Repo checks must run in CI on any OS with Node; defect injection proves the checks detect breakage instead of merely passing trivially. | `node scripts/validate.mjs --selftest` is the single gate run by CI and before release. |
| D8 | Installer scripts are ASCII-only | Windows PowerShell 5.1 misinterprets non-ASCII text in BOM-less scripts; Git-bash is more tolerant, but keeping installers ASCII removes the whole failure class. | Enforced by `validate.mjs`. |
| D9 | Iteration limits are prompt-level discipline | A Markdown command cannot enforce a runtime loop budget in OpenCode V2. Claiming enforcement would be false advertising. | README and SKILL.md state this explicitly; convergence depends on the model following Stage 8 conditions. |

## Compatibility

Mechanisms used, verified against OpenCode V2 documentation and against the installed OpenCode v2.2.4 in Phase 1 of this build:

| Mechanism | Source of truth | Used for |
| --- | --- | --- |
| Project commands in `.opencode/commands/*.md` with `$ARGUMENTS` | OpenCode V2 docs — Commands | `/loop` entry point |
| Skills in `.opencode/skills/<id>/SKILL.md`, path-derived case-sensitive ids | OpenCode V2 docs — Skills | `loop-engine` id |
| Explicit skill loading via the `skill` tool (and `@loop-engine` in prompts) | OpenCode V2 docs — Skills | command → skill connection |
| Global config at `~/.config/opencode` (honors `XDG_CONFIG_HOME`) | OpenCode V2 docs — Skills/Commands paths; verified present on the maintained Windows machine | installer default destination |
| Skill `description` required for advertising; paths inside a skill resolve relative to the SKILL.md directory | OpenCode V2 docs — Skills | discoverability and reference loading |
| `opencode run` non-interactive execution | OpenCode V2 docs — CLI; verified in installed v2.2.4 `--help` | optional end-to-end behavior testing |

Out of scope at 0.1.0: runtime-enforced iteration counters, HTTP skill catalogs, plugin-based telemetry. These are documented as future work, not implemented features.

## Repository layout

```text
opencode-loop/
├── .opencode/
│   ├── commands/
│   │   └── loop.md                      # /loop entry point
│   └── skills/
│       └── loop-engine/
│           ├── SKILL.md                 # the engine
│           └── references/
│               ├── quality-gates.md     # status vocabulary, gates, report format
│               ├── risk-analysis.md     # adversarial review methodology
│               └── evaluation-cases.md  # runtime guidance for cases A-I
├── scripts/
│   ├── install.ps1                      # Windows installer
│   ├── install.sh                       # POSIX installer
│   └── validate.mjs                     # repository validator (+ --selftest)
├── tests/
│   └── evaluation.md                    # evaluation rubric for cases A-I
├── docs/
│   ├── architecture.md                  # this file
│   └── design-principles.md
├── .github/workflows/validate.yml       # CI: validate.mjs --selftest on Ubuntu + Windows
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
├── CHANGELOG.md
├── LICENSE
└── .gitignore
```

## Validation pipeline

1. `node scripts/validate.mjs` — static integrity (structure, frontmatter, references, links, encoding, CI wiring).
2. `node scripts/validate.mjs --selftest` — adds: both installers executed end-to-end against throwaway sandbox destinations (fresh install, idempotency, backup-before-replace, selective uninstall with sentinel user files); defect injections proving each check detects breakage.
3. Case A-I evaluations (manual, see `tests/evaluation.md`) when agent runtime behavior changes.

CI runs step 2 on both ubuntu-latest and windows-latest so that the PowerShell path and the bash path are both covered on every push and pull request.
