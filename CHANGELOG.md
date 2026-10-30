# Changelog

All notable changes to LOOP are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses
[semantic versioning](https://semver.org/) for its release number.

## [0.1.0] - 2026-10-30

Initial release. LOOP is an iterative engineering workflow for OpenCode, not a
finished workflow engine; treat this release as a carefully tested starting
point.

### Added

- `/loop` command (`.opencode/commands/loop.md`) with `$ARGUMENTS` handling,
  `--max-iterations` (1-10, default 5) and `--mode focused|balanced|deep`
  flags, graceful invalid-argument handling, and conversation-context support
  when no task argument is given.
- `loop-engine` skill (`.opencode/skills/loop-engine/SKILL.md`) implementing
  the eight-stage iterative lifecycle (objective acquisition, reconnaissance,
  solution-space exploration, planning, implementation, verification,
  adversarial review, improvement, convergence) with hard safety rules,
  iteration management, and an evidence-based reporting contract.
- Skill references: quality gates and reporting format, adversarial review
  methodology, and runtime guidance for nine canonical evaluation cases.
- Windows installer (`scripts/install.ps1`) and POSIX installer
  (`scripts/install.sh`): global install by default, project-local option,
  explicit destination override, backup-before-replace, content-verified
  uninstall.
- Repository validator (`scripts/validate.mjs`) with `--selftest` mode:
  structural and frontmatter checks, reference and documentation integrity,
  ASCII-portability enforcement, sandboxed installer tests, and defect
  injection proving the checks detect breakage.
- Evaluation suite (`tests/evaluation.md`) with nine cases and disqualifiers.
- Documentation: `docs/architecture.md`, `docs/design-principles.md`, README,
  CONTRIBUTING, SECURITY policy, and this changelog.
- GitHub Actions workflow running the full validator on Ubuntu and Windows.

[0.1.0]: https://github.com/<owner-placeholder>/opencode-loop/releases/tag/v0.1.0
