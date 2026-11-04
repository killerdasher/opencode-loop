# Contributing to LOOP

Thanks for helping improve LOOP. This project is deliberately dependency-light and documentation-heavy; contributions should keep it that way.

## Getting started

```sh
git clone https://github.com/killerdasher/opencode-loop.git
cd opencode-loop
node scripts/validate.mjs --all
```

Requirements: Node.js 16.7+ for validation. To exercise both installers you also need bash and/or PowerShell — the validator reports `SKIP` for any runtime it cannot find rather than failing.

## Before you submit a pull request

Run the full gate and make sure it passes:

```sh
node scripts/validate.mjs --all
```

This runs:

1. **Structural validation** — repository layout, command/skill frontmatter rules, `$ARGUMENTS` and skill-invocation requirements, STAGE 0–8 headings, reference resolution, case-exact link checking, installer behavior markers, documentation completeness, evaluation-framework alignment, the reporting contract (banner, `SETTINGS:`, status vocabulary), and a secret scan.
2. **Self-test** — proves the validator still catches every mutation class on the fixed mutation list in `scripts/validate.mjs` (add a mutation whenever you add a check; the list is version-agnostic so this line cannot drift).
3. **Installer tests** — both installers against temporary directories (never the real OpenCode config): fresh install, idempotency, overwrite refusal, overwrite-with-backup, dry-run, project scope, uninstall.

Then run the behavioral harness self-test (free — no model calls, no network):

```sh
node tests/harness/selftest.mjs
```

It proves the fixtures build, the seeded states are real, the criteria can
both pass and fail, and the evidence parsers hold against the defects found in
the pilot runs. Behavioral *runs* (`run-case.mjs`) cost model tokens and are
never part of CI.

CI runs the validator commands plus the harness self-test on Linux and Windows for every push and pull request.

## Making changes

### To the skill or command

- Keep `.opencode/commands/loop.md` thin: argument handling and explicit skill invocation only. Methodology belongs in the skill.
- Keep `SKILL.md` modular. Detailed checklists and report formats belong in `references/`, referenced by relative path.
- If you change stage behavior, update `references/evaluation-cases.md` and `tests/evaluation.md` so in-session guidance and the evaluation rubric stay aligned.
- Preserve the status vocabulary (`VERIFIED`, `IMPLEMENTED BUT NOT VERIFIED`, `BLOCKED`, `NOT APPLICABLE`, `FAILED`) exactly. New labels fragment reporting.
- Never add claims of runtime enforcement, persistent learning, or guaranteed quality — accuracy is a feature of this project.

### To the installers

- Both scripts must implement identical semantics: idempotent skip, refuse-and-explain on differing files, backup before overwrite, `--dry-run`, `--uninstall`.
- Do not add dependencies beyond shell/PowerShell built-ins.
- Every behavior change needs a matching scenario in `--install-test`.

### To `validate.mjs`

- Zero dependencies. Node built-ins only.
- Every new check needs a self-test mutation that proves it can fail.
- Checks that need an external runtime must degrade to `SKIP`, never to a false `PASS` or a spurious failure.

### To the behavioral harness (`tests/harness/`)

- Zero dependencies; Node built-ins + git + the `opencode` CLI only.
- Behavioral runs cost model tokens: they are manual, one case at a time, and never run in CI. CI runs `selftest.mjs` only.
- Every criterion in `checks.mjs` needs a free sensitivity check in `selftest.mjs` (one PASS case and one FAIL case).
- If you change a fixture's declared state, update `tests/evaluation.md` in the same commit — the rubric and the fixture are one contract.
- Evidence (`tests/harness/evidence/`) is gitignored local output; never commit it, never validate it as repository content.
- A `REVIEW` verdict is a manual checkpoint: adjudicate it in an `ADJUDICATION.md` next to the evidence. The harness must never auto-promote `REVIEW` to `PASS`.

## Style

- Documentation: plain, precise, no marketing language, no claims without evidence.
- Markdown: standard CommonMark; frontmatter must remain valid per the OpenCode V2 rules (skill `name` lowercase-hyphenated, matching the directory name; `description` 1–1024 characters).
- Scripts: defensive quoting, explicit exit codes, user-facing messages prefixed `[LOOP]`.

## Reporting bugs

Use the issue tracker for bugs and feature requests. **Security issues must not be filed publicly** — see [SECURITY.md](SECURITY.md).

## Licensing

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
