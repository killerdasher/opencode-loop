# LOOP — Iterative Engineering Engine for OpenCode

LOOP is an iterative engineering workflow for [OpenCode](https://opencode.ai). A single command, `/loop`, turns a task into a guided loop of analysis, implementation, verification, adversarial review, and honest convergence — so an agent optimizes for the **strongest verifiable result**, not for the fastest acceptable-looking answer.

- Installs as two native OpenCode artifacts: a `/loop` command and a `loop-engine` skill. No plugins, no API keys, no framework, no dependency.
- Works with your default agent and your active model.
- Ships with an installer for Windows, Linux, and macOS, plus a validator with a selftest that proves its checks work.

> **What LOOP is not.** It does not change the model, does not permanently learn between runs, does not guarantee perfect quality, does not discover every possible defect, and does not make your project "production-safe" without actual evidence. LOOP changes how an agent works on the task at hand — that is all, and that is genuinely useful.

---

## Why LOOP exists

Most agentic workflows stop at the first implementation that looks good. The common failure pattern is: skim the request, write something plausible, declare success. The result often fails on edge cases, skips verification, ignores existing user changes, or expands into unrequested features.

LOOP makes the healthy behavior the instructed behavior:

1. Understand the complete objective and convert vague goals into testable success criteria.
2. Inspect the real project (including Git state and uncommitted changes) before changing anything.
3. Compare approaches where the decision is real, and justify the choice.
4. Implement in coherent increments.
5. Verify actual behavior, with real commands and real results — never invented ones.
6. Review the work as a skeptical engineer who did not write it.
7. Fix what matters, by severity; park what does not.
8. Converge on explicit stopping conditions and report what is done, what is not, and why.

## How it works

```text
/loop <task>
   │
   ▼
Stage 0  Objective acquisition    MUST / SHOULD / COULD, testable success criteria
Stage 1  Project reconnaissance   structure, conventions, tests, Git state, user changes
Stage 2  Solution-space           genuine alternatives compared; no fashionable-tech bias
Stage 3  Architecture & planning  components, contracts, error strategy, test strategy
Stage 4  Implementation           coherent increments, conventions, no fake data
Stage 5  Verification             real commands, PASS / FAIL / BLOCKED / NOT APPLICABLE
Stage 6  Adversarial review       evidence-based findings with severity
Stage 7  Improvement              fix CRITICAL/HIGH first; park optional extras
Stage 8  Convergence              five stopping conditions; incomplete results stay incomplete
   │
   └── iterations loop back through Stages 7 → 5 → 6 until convergence
```

During execution the loop reports concise progress (`LOOP | ITERATION 2/5 — objective`) and a final report listing what changed, what was verified with which commands, what findings were fixed or parked, the remaining risks, and the stopping condition that ended the loop.

### Modes and iteration limits

| Setting | Values | Default |
| --- | --- | --- |
| `--mode` | `focused` \| `balanced` \| `deep` | `balanced` |
| `--max-iterations` | integer `1`–`10` | `5` |

`focused` compresses exploration and review for small, obvious tasks. `deep` widens alternative comparison and re-reviews repeatedly touched areas. Out-of-range `--max-iterations` values are clamped to the nearest bound (1 or 10); unknown `--mode` values fall back to `balanced`; unknown flags degrade gracefully to defaults — each case with an explicit correction note in the loop's Stage 0 summary instead of a silent or failed start.

**Important:** these limits are prompt-level execution guidance. OpenCode Markdown commands cannot enforce a runtime budget; the skill's Stage 8 discipline is what actually stops the loop. LOOP documents this honestly rather than advertising false enforcement.

## Installation

Two installation scope options exist on every OS:

- **Global (default):** LOOP is available in every OpenCode project for your user. Files go into `~/.config/opencode/` (on Windows: `%USERPROFILE%\.config\opencode\`; `XDG_CONFIG_HOME` is honored when set).
- **Project-local:** LOOP is available only in the current project. Files go into `./.opencode/`.

### Windows (PowerShell)

```powershell
git clone https://github.com/<your-account>/opencode-loop.git
cd opencode-loop
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1
```

Options:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1 -Local          # project-local
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1 -Uninstall      # remove LOOP files
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1 -Destination "C:\path\to\opencode"  # explicit root
```

### Linux and macOS (bash)

```bash
git clone https://github.com/<your-account>/opencode-loop.git
cd opencode-loop
bash scripts/install.sh
```

Options: `--local` (project-local), `--dest <path>` (explicit root), `--uninstall`, `--force-uninstall`, `--help`.

### Manual installation

If you prefer not to run scripts, copy `.opencode/` into your OpenCode config root yourself — this is also the most future-proof method, because it copies every current and future artifact in one step:

```bash
mkdir -p ~/.config/opencode
cp -R .opencode/. ~/.config/opencode/
```

For a project-local install use `cp -R .opencode/. <project>/.opencode/` instead. The result must be a `commands/` directory containing `loop.md` and a `skills/` directory containing `loop-engine/` (with `SKILL.md` and its `references/`) — those names are OpenCode's documented discovery locations; other file names will not be discovered.

### What happens on existing files

- If the target file is already identical, the installer reports `UP-TO-DATE` and does nothing (idempotent).
- If a different file exists in the target — including a user's own `/loop` command or a user-written `loop-engine` skill — the installer creates a timestamped `.bak.<timestamp>` backup, then replaces it, and clearly reports the action. Nothing is silently overwritten.
- `-Uninstall` / `--uninstall` removes files that are byte-identical to LOOP's current content, plus files carrying LOOP's marker; any removal of differing content always creates a timestamped backup first. Files LOOP does not own are reported as `KEPT` and left untouched unless `-Force` / `--force-uninstall` is supplied (forced removals are backed up as well).

## Usage

```text
/loop Build a full-stack application with authentication and testing.
/loop --mode deep Review the architecture and improve its reliability.
/loop --max-iterations 3 Refactor this module without changing its public API.
```

With no arguments, `/loop` applies the workflow to the objective already being discussed in the conversation.

You can also load the skill without the command by mentioning `@loop-engine` in a prompt, but `/loop` is the supported entry point.

## Requirements and compatibility

- OpenCode V2. Discovery paths, `$ARGUMENTS` expansion, skill advertisement, and explicit skill loading verified against the OpenCode V2 documentation and the installed OpenCode v2.2.4 binary; `opencode run` exists in that binary's help output. Other V2 minor versions are expected to work but have not been verified by this project — file an issue if one misbehaves.
- No API keys, no plugins, no additional tools, no network access required to use the skill.
- V1 syntax (`opencode.ai/docs`) is not targeted; V2 docs are the compatibility reference.

## Repository validation

Before trusting this tool — or after changing it — run:

```bash
node scripts/validate.mjs --selftest
```

This validates repository structure, frontmatter contracts, references, documentation links, ASCII portability, and CI wiring; runs both installer scripts end-to-end against throwaway sandbox directories (fresh install, idempotency, backup-before-replace, selective uninstall with sentinel user files); and injects defects into a throwaway repo copy to prove each check detects breakage. It never touches your real OpenCode configuration.

See `tests/evaluation.md` for the manual A–I behavioral evaluation rubric used to judge how the loop behaves in real sessions.

## Known limitations

- **Prompt-level iteration control.** Mode and iteration limits guide the model's behavior; they are not runtime-enforced. A weaker model may under- or over-iterate. Use `--max-iterations` and watch the loop's iteration banners.
- **Model-dependent quality.** The loop is only as good as the model running it. The methodology is designed to improve what a capable model produces; it cannot make an incapable model capable.
- **Verification depends on the environment.** A loop cannot run tests that do not exist in the sandbox project, or access services you have not provisioned; expect explicit `BLOCKED` labels in those cases (that is the intended, honest behavior — see Case G in the evaluation suite).
- **No persistent memory.** Each `/loop` starts from the current conversation. LOOP does not learn across runs.
- **Not a security scanner.** Stage 6 reviews security risks in the work at hand; it does not replace dependency auditing, penetration testing, or formal review.
- **Manual evaluation suite.** The A–I evaluation is rubric-based and runs by a human with a transcript, not an automated test that certifies model behavior.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `/loop` is unknown to OpenCode | The command file must be at `~/.config/opencode/commands/loop.md` (global) or `<project>/.opencode/commands/loop.md` (project-local). Only `.md` files are discovered; run `opencode reload` or start a fresh TUI session after manual installs. |
| The skill never loads when running `/loop` | Confirm the skill ends up at `.../skills/loop-engine/SKILL.md` (directory name is the id and is case-sensitive). Confirm the agent's `skill` permissions allow loading; a `deny` rule for `skill/loop-engine` will block it. |
| A user `/loop` exists but LOOP's behavior wins (or vice versa) | Later-registered sources replace earlier same-name commands; project `.opencode/commands` takes precedence over global. Move or rename the conflicting file. |
| PowerShell refuses to run `install.ps1` | Use the `powershell -NoProfile -ExecutionPolicy Bypass -File` invocation above, or run the manual installation steps. |
| Installer reports `KEPT` during uninstall | That file's content differs from what LOOP installs (or lacks LOOP's marker) — most likely a user file. Confirm it is yours, then rerun with `-Force` / `--force-uninstall`. |
| The loop uses my paid model when I wanted something cheap | LOOP never overrides the model; check the model you have selected in OpenCode. Add an explicit `model` field to your local `loop.md` copy if you want to pin one (this is your change, not shipped behavior). |
| Iterations blow past the requested budget | Limits are prompt-level guidance; report the instance with your model and version in an issue. |

## Contributing

Built and verified with a dependency-free validator and a documented evaluation rubric. See [CONTRIBUTING.md](CONTRIBUTING.md) for the contributing workflow, and [docs/architecture.md](docs/architecture.md) / [docs/design-principles.md](docs/design-principles.md) for how the pieces are put together and why.

## Security

Security-relevant problems follow the disclosure policy in [SECURITY.md](SECURITY.md) — please do not open a public issue with exploit details.

## License

MIT — see [LICENSE](LICENSE).
