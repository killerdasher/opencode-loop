# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-02

Initial release. LOOP is a prompt-level iterative engineering workflow for OpenCode; this version provides the command, the skill, its reference documents, installers for Windows and Linux/macOS, and automated repository validation.

### Added

- `/loop` command (`.opencode/commands/loop.md`) with `$ARGUMENTS` handling, `--max-iterations` (1–10, default 5) and `--mode focused|balanced|deep` (default `balanced`) flags, conversation fallback when no task is given, and explicit `loop-engine` skill invocation with a documented degraded path if the skill cannot load.
- `loop-engine` skill (`.opencode/skills/loop-engine/SKILL.md`) implementing Stages 0–8: objective acquisition, project reconnaissance, solution-space exploration, architecture and planning, engineering, verification, adversarial review, improvement, and convergence with five explicit stopping conditions.
- Reference documents: `quality-gates.md` (status vocabulary, quality dimensions, report formats), `risk-analysis.md` (adversarial review checklists and severity classes), `evaluation-cases.md` (in-session guidance for Cases A–I).
- Installers: `scripts/install.ps1` (Windows PowerShell) and `scripts/install.sh` (Bash), with global and project-local scopes, idempotent installs, refuse-and-explain overwrite protection, timestamped backups, dry-run, and uninstall modes.
- `scripts/validate.mjs` — zero-dependency validator with structural, `--self-test`, and `--install-test` modes.
- `tests/evaluation.md` — behavioral evaluation suite covering Cases A–I with a repeatable rubric.
- Documentation: README, architecture, design principles, contributing, and security policy.
- CI workflow running all validator modes on Linux and Windows.

[0.1.0]: https://github.com/killerdasher/opencode-loop/releases/tag/v0.1.0
