# Contributing

Thank you for improving LOOP. This project is small and deliberately disciplined: the quality of the artifacts matters far more than their quantity. Please keep contributions focused, verifiable, and honest.

## Development setup

Requirements: Git, Node.js >= 18, OpenCode V2 when you want to test agent behavior manually, bash (via Git for Windows on Windows) only when touching the POSIX installer.

```bash
git clone <your-fork>/opencode-loop.git
cd opencode-loop
node scripts/validate.mjs --selftest
```

The validator must pass before any PR. It is dependency-free and safe to run repeatedly; `--selftest` executes the installers only against throwaway sandbox directories and never touches a real OpenCode configuration.

## Repository structure contract

```text
.opencode/commands/loop.md                                 # /loop entry point
.opencode/skills/loop-engine/SKILL.md                      # engine: stages 0-8
.opencode/skills/loop-engine/references/*.md               # quality-gates, risk-analysis, evaluation-cases
scripts/install.ps1 | scripts/install.sh | scripts/validate.mjs
tests/evaluation.md                                        # cases A-I rubric
docs/architecture.md | docs/design-principles.md
.github/workflows/validate.yml
README.md | CONTRIBUTING.md | SECURITY.md | CHANGELOG.md | LICENSE | .gitignore
```

## Content conventions

- **Frontmatter is single-line `key: value` only.** The validator enforces this because it lets validation stay deterministic without shipping a YAML parser. Multi-line YAML will fail `validate.mjs` — restructure the text instead.
- **The skill id is the directory name** (`loop-engine`), lowercase kebab-case, case-sensitive for OpenCode. Never rename the directory without a breaking-change changelog entry.
- **SKILL.md stays lean.** It is loaded into context on every loop. Detail belongs in `references/` files; SKILL.md must explicitly mention and direct reading of each.
- **No shell interpolation blocks** (`!` backtick form) in commands — OpenCode docs warn they execute outside the permission flow.
- **Installer scripts are ASCII-only** (Windows PowerShell 5.1 parses BOM-less scripts using the system code page; non-ASCII text becomes mojibake). The validator enforces this.
- **Installer behavior must stay in parity** between `install.ps1` and `install.sh`: backup-before-replace, `UP-TO-DATE` reporting, idempotency, differing-content uninstall that always creates a backup, `KEPT` protection for unowned files, and the `-Force`/`--force-uninstall` escape hatch. Changes to one must be landed in the other in the same PR; `--selftest` covers both.
- **The installer manifest is derived from the source tree.** New files under `.opencode/` ship automatically, **but** the validator keeps an explicit expected-file contract in `requiredFiles` (`scripts/validate.mjs`) — adding a repository file also means adding it to that contract so `missing required files` stays a real signal.
- **The `install.sh` executable bit is part of the contract.** When committing from Windows, preserve it with `git update-index --chmod=+x scripts/install.sh` (the validator enforces the bit on POSIX runs).
- **Behavioral guidance and its rubric stay paired.** Runtime case guidance lives in `references/evaluation-cases.md`; the evaluator rubric lives in `tests/evaluation.md`. If a case changes, update both in the same PR.

## Testing expectations

- Static: `node scripts/validate.mjs`.
- Full: `node scripts/validate.mjs --selftest` (installer sandboxes + defect injection; requires Node; skips cleanly with a reported `SKIP` line where an interpreter is unavailable).
- Agent behavior: for changes to the skill or command, run at least one relevant case from `tests/evaluation.md` in a sandbox project with the installed OpenCode version, and quote the honest outcome (verdict, model, version) in the PR. Do not record claims that were not run. Changed behavior that degrades a case must be discussed, not hidden.

## Commit and PR guidance

- One logical change per PR; prefer several small PRs over a large one.
- Commits in the imperative mood with a subject under 72 characters.
- Update `CHANGELOG.md` under an "Unreleased" section for user-visible changes.
- PR checklist:
  - [ ] `node scripts/validate.mjs --selftest` passes (or explicitly records `SKIP` lines).
  - [ ] No secrets, personal data, or unrelated files in the diff.
  - [ ] Documentation updated for behavior changes.
  - [ ] Claims in docs and PR text reflect executed tests only.

## Licensing

By contributing, you agree that your contributions are licensed under the project's MIT License (see `LICENSE`), and you confirm that you have the right to submit your contribution under those terms.
