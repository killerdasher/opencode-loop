# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Behavioral harness on POSIX: `runFixtureTest` executed the fixture's command string with `shell: false` on non-Windows platforms, so `spawnSync` treated the whole string (`node test/x.test.mjs`) as a single filename — every seeded-state check failed with `ERROR` on ubuntu CI while Windows passed (first CI run to execute the harness self-test on Linux). Commands now run through a shell on every platform, with a pre-flight executable probe (`where` / `command -v`) so a missing executable stays an `ERROR` (broken environment) and can never be misread as a `FAIL` (red suite). Two free self-test checks guard both behaviors.
- Installers (`install.ps1`, `install.sh`): timestamped backups were created **in place** — `commands/loop.md.backup-<ts>` and, for the skill, `skills/loop-engine.backup-<ts>` — but OpenCode discovers every directory containing a `SKILL.md` under `skills/`, so the overlaid backup came back as a phantom skill (the just-replaced version, live again). Observed with a real overwrite install on 2026-11-04. Backups now go to a sibling root (`<dest>-loop-backups\<timestamp>\<tree>`) outside all discovery directories, tree structure preserved; legacy in-place backups from older installers are left untouched. Installer tests assert the new location and that no `*backup*` residue remains inside `commands/` or `skills/`.

## [0.3.0] - 2026-11-03

Independent engineering audit and behavioral validation.

### Added

- **Behavioral evaluation harness** (`tests/harness/`): semi-automated execution of evaluation Cases A–I — isolated fixture repositories (git-identity-isolated, temp-dir only), one model session per run through the officially documented `opencode run --format json` path, evidence collection (transcript, git diff, independent harness re-run of the fixture suite), and objective criteria with a four-level verdict (`PASS` / `FAIL` / `BLOCKED` / `REVIEW`, precedence FAIL > BLOCKED > REVIEW > PASS). Manual checkpoints return `REVIEW` and are adjudicated next to the evidence; the harness never auto-promotes them.
- **Free harness self-test** (`tests/harness/selftest.mjs`, run in CI): proves fixtures build, seeded states are real (failing fixtures fail, green fixtures pass, Case G's blocker blocks), criteria can both pass and fail, and the evidence parsers hold against the pilot-run defects. 66 checks, no model calls.
- **Behavioral evaluation rubric rewrite** (`tests/evaluation.md`): per case — controlled initial conditions, test objective, observable expected/forbidden behavior, evidence, and objective PASS/FAIL/BLOCKED/REVIEW criteria mapped to harness check IDs; honest result ledger (Case A pilot executed; B–I not yet run).
- **A/B comparison methodology** (`tests/comparison.md`): controlled protocol comparing standard OpenCode execution vs LOOP on identical tasks/snapshots/model/permissions, with metric definitions, anti-gaming reporting rules, and an explicit ledger stating **no comparative results exist yet**.
- **ADR 0001** (`docs/adr/0001-runtime-orchestration.md`): compares skill-only, skill+plugin, and external-orchestrator architectures against official OpenCode APIs (verified); retains skill-only and records revisit triggers.
- Validator checks: evaluation-framework alignment (rubric vs in-session guidance must cover the same Cases A–I), changelog currency (a version beyond 0.1.0 must be documented, newest-first), reporting contract (iteration banner, `SETTINGS:` restatement, five-label status vocabulary), `.gitignore` must exclude behavioral evidence, CI must run the harness self-test — each with a mutation proving it can fail.

### Fixed

- Harness pilot defects (found by executing Case A, not by inspection): phantom diff paths from trimming `git status --porcelain` output (`src/range.mjs` parsed as `rc/range.mjs`); the harness's own LOOP install polluting the scope check (arm setup is now committed to the fixture baseline without touching user work); `read`/`skill`/`glob` tool events misclassified as file writes (corrupted ordering facts); running/completed tool-event pairs double-counted.

### Changed

- CI runs the free harness self-test in addition to the three validator modes.
- `walkFiles` in the validator excludes `tests/harness/evidence/` (transient local run output is not repository content and must never fail repository checks).

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
