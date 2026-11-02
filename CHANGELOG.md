# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-02

Verified rebuild of LOOP. Same public interface as 0.1.0 (`/loop` command, `loop-engine` skill, file layout, flags), re-engineered and proven against OpenCode v2.2.5 with an end-to-end live-session run.

### Added

- End-to-end verification in a live OpenCode v2.2.5 session: skill load, `$ARGUMENTS` flag parsing (`SETTINGS: mode=... iterations=...`), Stage 0-8 execution, `LOOP | ITERATION n/N` banner, and byte-level artifact confirmation of the produced file.
- `stage:` line in the iteration reporting banner (the 0.1.0 banner carried changed/verified/key findings/next only).
- `--dry-run` / `-DryRun` mode in both installers, with a test scenario proving it changes nothing.
- Backup-clobber regression scenario: a 60-second marker window proves an overwrite never destroys an earlier backup, for both installers.
- Secret-pattern scan in the validator (private-key blocks and GitHub/AWS/Slack/OpenAI-style token shapes).
- Flags-only invocation fallback: `/loop --mode deep` with no task text now uses the conversation objective.
- `.gitattributes` enforcing LF endings for `*.sh`, so a Windows clone cannot break `install.sh`.

### Changed

- Installer test matrix: 16 scenarios (fresh install, idempotent rerun, overwrite refusal, overwrite-with-backup, clobber window, dry-run, project scope, uninstall), executed against temporary directories only for both installers.
- `/loop` command invokes the skill tool in a parameter-agnostic way (0.1.0 hard-coded `id`).
- Validator split into `--self-test` and `--install-test` modes with 11 defect-injection mutations that must each be detected; relative-link verification upgraded from plain existence checks (which hide case mismatches on Windows) to case-exact resolution.
- Documentation rewritten; fixed the broken `<owner-placeholder>` release link from 0.1.0.

## [0.1.0] - 2026-10-30

Initial release. LOOP is an iterative engineering workflow for OpenCode, not a finished workflow engine; treat this release as a carefully tested starting point.

### Added

- `/loop` command (`.opencode/commands/loop.md`) with `$ARGUMENTS` handling, `--max-iterations` (1-10, default 5) and `--mode focused|balanced|deep` flags, graceful invalid-argument handling, and conversation-context support when no task argument is given.
- `loop-engine` skill (`.opencode/skills/loop-engine/SKILL.md`) implementing the eight-stage iterative lifecycle (objective acquisition, reconnaissance, solution-space exploration, planning, implementation, verification, adversarial review, improvement, convergence) with hard safety rules, iteration management, and an evidence-based reporting contract.
- Skill references: quality gates and reporting format, adversarial review methodology, and runtime guidance for nine canonical evaluation cases.
- Windows installer (`scripts/install.ps1`) and POSIX installer (`scripts/install.sh`): global install by default, project-local option, explicit destination override, backup-before-replace, content-verified uninstall.
- Repository validator (`scripts/validate.mjs`) with `--selftest` mode: structural and frontmatter checks, reference and documentation integrity, ASCII-portability enforcement, sandboxed installer tests, and defect injection proving the checks detect breakage.
- Evaluation suite (`tests/evaluation.md`) with nine cases and disqualifiers.
- Documentation: `docs/architecture.md`, `docs/design-principles.md`, README, CONTRIBUTING, SECURITY policy, and this changelog.
- GitHub Actions workflow running the full validator on Ubuntu and Windows.

[0.2.0]: https://github.com/killerdasher/opencode-loop/releases/tag/v0.2.0
[0.1.0]: https://github.com/killerdasher/opencode-loop/releases/tag/v0.1.0
