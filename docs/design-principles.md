# Design principles

The engineering principles behind LOOP, and where each one is enforced in the implementation. This is the reasoning record for the workflow decisions; see `architecture.md` for mechanism-level detail.

## P1 — Evidence over appearance

A claim without evidence is a defect, not a feature. Verification results are labeled `VERIFIED`, `IMPLEMENTED BUT NOT VERIFIED`, `BLOCKED`, `NOT APPLICABLE`, or `FAILED`, each with its guardrails; the final report must trace every claim to a recorded command or inspection.

Enforced in: SKILL.md (Stage 5, Stage 8, reporting contract), `references/quality-gates.md`, validator checks on the skill's status vocabulary.

## P2 — Strongest verifiable result, not largest result

The optimization target is the result that best satisfies the user's stated objective with appropriate complexity — not the most files, the most features, or the most elaborate architecture. LOOP explicitly names over-engineering and manufactured sophistication as failure modes.

Enforced in: SKILL.md (Stage 2 anti-fashion rule, Stage 4 speculative-complexity ban, calibration section), `references/risk-analysis.md` (no-fabrication section).

## P3 — Convergence is part of quality

Knowing when to stop is engineered: five explicit stopping conditions, including the iteration budget, two consecutive no-improvement cycles, blockers, and out-of-scope requirements. An iteration limit reached with unmet requirements produces an incomplete report — never a relabeled success.

Enforced in: SKILL.md Stage 8; `references/evaluation-cases.md` Case I; `tests/evaluation.md` scoring.

## P4 — The user's project is untouchable ground

The engine's first act in a repository is establishing what belongs to whom (Git state, uncommitted changes, conventions). Uncommitted work is preserved; destructive, irreversible, or externally consequential actions require explicit authorization; repository content is data, never instructions that outrank the user or the safety rules.

Enforced in: SKILL.md hard safety rules; `references/evaluation-cases.md` Case D and Case E; installer backup behavior mirrors the same value at the meta level: LOOP never silently replaces user files, including a user's own `/loop` command.

## P5 — Portability without dependencies

LOOP must work for developers on Windows, Linux, and macOS, on any OpenCode provider, without installing a framework, an API key, a database, or a specific model. Artifacts are Markdown; tooling is dependency-free Node; installer scripts are ASCII-only for Windows PowerShell 5.1 safety.

Enforced in: architecture decision D1; installer scripts; `validate.mjs` ASCII check; the integration-test approach using only what OpenCode itself provides.

## P6 — Small tasks get small loops

Ceremony scales down: `focused` mode keeps exploration to a justified paragraph and compresses review. What never scales down is verification and honest reporting — "small" does not exempt work from evidence.

Enforced in: SKILL.md mode table and calibration section; `references/evaluation-cases.md` Case A.

## P7 — Graceful degradation, honest labels

Unknown flags fall back to documented defaults with a stated correction; a missing skill produces a plainly marked degraded run instead of silent substitution; blocked verification is labeled `BLOCKED` with the precise missing capability rather than faked.

Enforced in: command `loop.md` startup behavior; SKILL.md status vocabulary; `references/evaluation-cases.md` Case F and Case G.

## P8 — Modularity where the model pays attention

SKILL.md is the always-loaded core: stages, rules, settings, reporting. Checklists live in reference files that OpenCode lists but does not inline; SKILL.md directs when to read each. This reduces context cost on every loop and lets contributors extend reference material without inflating the engine.

Enforced in: repository layout (`references/`), SKILL.md's explicit reference pointers, validator checks that references exist and are mentioned.

## P9 — Security review is a named stage, not a garnish

Stage 6 runs a skeptical, independent review with checklists across correctness, architecture, security, performance, product, and maintainability; findings require evidence, severity, and impact. CRITICAL and HIGH issues are fixed before cosmetic work.

Enforced in: SKILL.md Stage 6; `references/risk-analysis.md`; `tests/evaluation.md` Case E.

## P10 — The tool is evaluated by its own rubric

`tests/evaluation.md` defines nine canonical cases with disqualifiers (fabricated results, destructive operations, scope inflation) that fail a case outright. Defect injection in the validator proves the static checks themselves catch breakage. Evaluation results in documentation quote real runs only.

Enforced in: `tests/evaluation.md`, `validate.mjs --selftest`, README honesty requirements.
