# LOOP architecture

How the pieces of `opencode-loop` fit together, and why they are shaped this way.

## Components

```
User types /loop <task> [--flags]
        │
        ▼
.opencode/commands/loop.md          ← entry point (prompt template)
        │  1. instructs the agent to load the skill
        │  2. injects $ARGUMENTS (flags + task, or conversation fallback)
        │  3. resolves SETTINGS: mode, iterations
        ▼
.opencode/skills/loop-engine/SKILL.md   ← workflow engine (Stages 0–8)
        │
        ├── references/quality-gates.md     status vocabulary, gates, report formats
        ├── references/risk-analysis.md     adversarial review checklists
        └── references/evaluation-cases.md  behavioral guidance for atypical situations
```

The command is a thin entry point; the skill is the engine. This separation exists because OpenCode discovers them independently: commands live in `commands/` and are invoked as `/name`, skills live in `skills/<name>/SKILL.md` and are loaded on demand through the native `skill` tool. The command's only jobs are argument handling and explicitly requesting the skill — all methodology lives in one place (the skill) so it can also be loaded without the command.

### Data flow through an execution

1. **Invocation.** OpenCode expands `$ARGUMENTS` into the command template and sends the result as the prompt to the current agent (no agent/model override — the default agent runs LOOP).
2. **Skill load.** The prompt instructs the agent to call `skill({ name: "loop-engine" })` first. The skill content is injected into the session context.
3. **Settings resolution.** Flags are stripped from the argument text; the resolved `mode` and `iterations` are restated in the Stage 0 summary and used for every `LOOP | ITERATION n/N` banner.
4. **Iteration loop.** Stage 0–6 on iteration 1; stage 7 with a specific improvement objective plus stages 5–6 thereafter; stage 8 after every iteration decides continue vs. stop.
5. **Reporting.** Requirements table, verification table, quality-gate table, adversarial findings, and the named stopping condition — all defined in `references/quality-gates.md`.

## Design decisions

| Decision | Rationale |
| --- | --- |
| Prompt-level workflow, no runtime controller | The methodology is model behavior, not program behavior. A Markdown file cannot control the OpenCode runtime, and pretending otherwise would be a fake feature. Iteration limits are therefore documented honestly as guidance, with self-reporting rules to keep them meaningful. |
| Skill holds the methodology; command holds argument parsing | Skills are reusable (loadable without `/loop`), versionable as one document, and the command stays a stable, thin interface. |
| Reference documents instead of one giant SKILL.md | Keeps the engine readable and maintainable; each reference is loaded only when its stage needs it, and contributors can revise one concern without rewriting the whole skill. |
| Zero-dependency tooling (`validate.mjs`, installers) | Anyone can run validation with Node alone; installers use only shell/PowerShell built-ins. No supply chain to audit, no lockfile to maintain. |
| Refuse-and-backup overwrite policy | The install target is user configuration. Silent overwrite could destroy a user's own `/loop` command; identical-file skipping makes upgrades idempotent without ever being destructive. |
| `XDG_CONFIG_HOME` honored by both installers | Matches OpenCode's own global-config resolution, makes the install destination standard instead of invented, and gives tests an isolation mechanism that never touches the real config. |
| Case-exact path checks in the validator | Windows filesystems hide case mismatches that would break Linux/macOS installs; CI runs on Linux to catch them end-to-end. |
| Behavioral evaluation lives in `tests/evaluation.md` | Structural checks are automated; behavioral judgment (Cases A–I) requires a live model session, so the suite documents repeatable setups and observable pass criteria instead of pretending to be CI. |

## Validation architecture

`scripts/validate.mjs` has three modes, all zero-dependency:

- **Structural** — required files, command/skill frontmatter rules (name format, directory match, description length, `$ARGUMENTS`, skill invocation, no forced agent), STAGE 0–8 headings, reference resolution, case-exact relative-link checking, installer behavior markers, optional `bash -n` / PowerShell parse syntax checks (skipped with a `SKIP` line when no runtime exists), CI wiring, doc completeness, and a secret-pattern scan.
- **`--self-test`** — copies the repository to a temp directory, applies 11 known corruptions (missing `$ARGUMENTS`, invalid skill name, broken links, injected secret, …), and asserts the structural validator fails on exactly the expected check. This guards against a validator that always passes.
- **`--install-test`** — runs both installers end to end in temp directories with `XDG_CONFIG_HOME` redirected: fresh install → idempotent rerun → refusal to overwrite differing files → overwrite-with-backup → dry-run (no changes) → project scope → uninstall-with-backup. The real user configuration is never a test destination.

CI (`.github/workflows/validate.yml`) runs all three modes on `ubuntu-latest` and `windows-latest`, so both installers execute under both platforms' shells (GitHub runners ship bash on Windows and pwsh on Linux).

## Compatibility

- **OpenCode:** designed against the V2 documentation for Agent Skills (`SKILL.md`, `name`/`description` frontmatter, `^[a-z0-9]+(-[a-z0-9]+)*$` name rule) and custom commands (`commands/*.md`, `$ARGUMENTS`). Verified against OpenCode v2.2.5 during development.
- **Installers:** Windows PowerShell 5.1+ (and pwsh), bash 3.2+ (macOS system bash) — no bashisms beyond POSIX plus `local`.
- **Validator:** Node.js 16.7+ (`fs.cpSync`); developed and run on Node 24.
