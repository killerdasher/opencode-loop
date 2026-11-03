# ADR 0001: Runtime orchestration architecture

- **Status:** accepted — 2026-11-03
- **Decision:** retain the skill-only architecture; no plugin or external
  orchestrator in this release
- **Supersedes:** nothing
- **Deciders:** repository maintainer, informed by audit findings (LOOP 0.3.0)

## Context

LOOP currently runs entirely as prompt-level assets: `.opencode/commands/loop.md`
(entry) + `.opencode/skills/loop-engine/SKILL.md` (workflow) + references.
The engine's iteration state (iteration counter, stage, findings, convergence
decision) lives in the model's context and in the report text.

The 0.3.0 audit asked whether a future dedicated runtime layer could provide
capabilities that prompt-level instructions cannot *guarantee*:

1. explicit iteration state (machine-readable, not prose)
2. enforced iteration caps (a hard stop, not a requested stop)
3. reliable continuation across model turns
4. persistent task checkpoints
5. controlled interruption
6. recovery after session interruption
7. clear start and stop conditions

Constraints: preserve the existing safety model, avoid premature
implementation, keep the project dependency-light and portable, and do not
break v0.2.0 functionality.

## Research: what official OpenCode APIs actually offer (v2.2.5, verified)

Sources: official docs (`opencode.ai/v2/docs/` — build/plugins,
build/plugins/server, api, cli) fetched 2026-11-02, plus local CLI inspection.

- **CLI:** `opencode run` is the documented automation path ("designed for
  scripts, CI jobs") with `--session/--continue/--fork/--model/--agent/
  --format json`. Verified working locally (NDJSON transcript with
  `sessionID`, text parts, `step_finish` + token/cost data).
- **Plugins:** `@opencode/plugin` (an npm package) with server-side
  `setup(ctx)` hooks; plugin context exposes session/prompt control,
  `ctx.storage` (durable key-value), hooks for prompt/context interception,
  tool/command/agent registration, and reload/cleanup lifecycle.
- **HTTP API:** session lifecycle endpoints (create, prompt, command, wait,
  interrupt, fork) plus an event stream — enough for an external process to
  drive and observe sessions.

Conclusion: **all three candidate architectures are technically feasible** on
documented APIs. The decision is therefore about trade-offs, not possibility.

## Options

### Option 1 — Skill-only (status quo, chosen)

Prompt-level workflow: the command loads the skill; the skill instructs
stage discipline, iteration counting, caps, convergence, and reporting.

- **Reliability:** iteration state and caps are *instructed*, not enforced.
  A model can under-count iterations or ignore the cap. Observed risk is
  bounded because every run produces an evidence report that a human (or the
  harness) checks — and behavioral evaluation (this repository's harness)
  measures adherence instead of assuming it.
- **Complexity:** zero runtime code. No dependency, no build step, no
  version coupling.
- **Portability:** works in any OpenCode session (TUI, GUI, CLI `run`) on
  any OS, with no config beyond installing the files.
- **Maintainability:** plain Markdown; changes are reviewable diffs; the
  validator guards structure.
- **Compatibility:** immune to OpenCode API churn — it consumes no API.

### Option 2 — Skill + native plugin

A server plugin holds the loop state: `ctx.storage` persists
iteration/stage/checkpoint; hooks or a registered command enforce caps
(refuse to continue past N), mark start/stop explicitly, and can interrupt a
run that exceeds budget; storage enables resume after interruption.

- **Reliability:** the key win — caps and state become *enforced* rather
  than requested; interruption and continuation gain a durable record.
- **Complexity:** adds `@opencode/plugin` (first npm dependency), a
  build/TS-or-JS artifact, plugin load/config surface, and a second thing to
  version against OpenCode releases.
- **Portability:** degrades — plugins load from project/global config; CLI
  and GUI must both load it; environments that only copy skill files (the
  current install story: two Markdown files) lose enforcement silently,
  creating a degraded-mode matrix the validator would have to model.
- **Maintainability:** hooks couple to undocumented-stability surfaces; an
  OpenCode upgrade can break enforcement without any LOOP-side diff.
- **Compatibility:** must track plugin API changes; the skill would need a
  graceful path when the plugin is absent (dual-mode logic).

### Option 3 — Dedicated external orchestrator

A separate process drives sessions via the HTTP API: owns iteration state,
caps, checkpoints on disk, interruption, restart/recovery, and start/stop
conditions; runs the model loop outside OpenCode's session context.

- **Reliability:** strongest enforcement and crash recovery *of the driver*,
  but every failure mode moves into a new codebase (process supervision,
  API session semantics, partial-output handling).
- **Complexity:** highest — a service with its own lifecycle, config,
  scheduling, and error handling; effectively a second product.
- **Portability:** worst — requires a running server, a port, and an
  always-on process; unusable from a plain interactive session.
- **Maintainability:** largest surface to test; the behavioral harness would
  need to test the orchestrator *and* the prompt workflow.
- **Compatibility:** binds to the experimental HTTP API surface
  (`/api/...` routes are marked experimental in the API reference).

## Comparison

| Dimension | Skill-only (1) | Skill + plugin (2) | External orchestrator (3) |
| --- | --- | --- | --- |
| Enforced iteration caps | no (instructed) | yes | yes |
| Durable iteration/checkpoint state | no (report text) | yes (`ctx.storage`) | yes (disk) |
| Continuation after interruption | manual (re-run, report carries state) | partial (state persists; session resume semantics still OpenCode's) | yes (driver owns restart) |
| Controlled interruption | no | yes (hook can interrupt) | yes (API interrupt) |
| Explicit start/stop conditions | in prompt/report | prompt + plugin markers | driver-owned |
| Runtime dependencies | none | `@opencode/plugin` | process + server + client lib |
| Portability (TUI/GUI/CLI, any OS) | full | degraded without plugin | server required |
| API-churn exposure | none | hooks + storage | experimental HTTP API |
| Implementation/ maintenance cost | already built | medium | high |
| Fits current install story (copy 2 files) | yes | no | no |

## Decision

**Retain skill-only (Option 1).**

Rationale against the task's own bar ("retain the existing skill-only
implementation if a runtime controller would introduce disproportionate
complexity"):

- The capabilities in (1)–(7) are *guarantees* the prompt layer cannot make —
  but the audit showed the actual gap is **unmeasured behavioral adherence**,
  not missing runtime code. The 0.3.0 harness turns adherence into evidence;
  re-architecting before measuring would be premature optimization.
- Option 2 buys enforcement at the cost of the project's defining
  properties: zero dependencies, two-file portability, and immunity to API
  churn — plus a dual-mode degraded matrix. Disproportionate for a workflow
  whose core artifact is Markdown.
- Option 3 is a second product with an experimental-API dependency; clearly
  disproportionate.
- Nothing in the current safety model requires runtime enforcement: caps are
  already reported per run (`ITERATION n/N`), and the harness can objectively
  detect cap violations from the transcript (`report:budget-not-burned`).

## Consequences

- Iteration caps and state remain *instructed*; a model may still
  under-count. This residual risk is accepted and **measured** by the
  behavioral harness rather than hidden.
- The evaluation suite must keep at least one criterion that would catch cap
  misuse (Case I, `report:budget-not-burned`) so the decision stays honest.
- Revisit triggers (any one may reopen this ADR):
  1. harness data shows systematic cap/state violations across runs;
  2. a real use case requires resume-after-crash within a session;
  3. OpenCode ships a stable, documented loop/session-state primitive that
     removes the dependency argument against Option 2.
- If reopened, prefer Option 2 over Option 3 (smaller surface, first-party
  API) with a mandatory skill-only fallback path.
