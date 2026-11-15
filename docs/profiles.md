# LOOP Task Profiles — adaptive engineering methodologies

LOOP adapts its workflow emphasis to the engineering task through five
task profiles. **Profiles tune the workflow, they never replace it:** the
nine stages and all hard safety rules apply unchanged to every profile,
and the operator's task scope always passes through verbatim.

| Profile | Use when | Reference |
| --- | --- | --- |
| `BUILD` | new functionality and applications | `references/profiles/build.md` |
| `DEBUG` | root-cause investigation and corrections | `references/profiles/debug.md` |
| `REFACTOR` | structural improvements while preserving behavior | `references/profiles/refactor.md` |
| `AUDIT` | independent technical / security assessment | `references/profiles/audit.md` |
| `MIGRATE` | controlled technology and data migrations | `references/profiles/migrate.md` |

Each profile defines the same seven dimensions: required inputs, relevant
analysis stages, applicable verification methods, risk priorities,
completion criteria, forbidden shortcuts, and expected evidence.

## Selection (explicit intent only)

```
/loop --profile debug fix the range-off-by-one that crashes on empty input
```

- Profiles are chosen from explicit user intent — `--profile <name>` is
  the mechanism. Nothing is auto-inferred: with no `--profile` flag the
  generic nine-stage loop runs (the `AUDIT`-style read-only posture comes
  from the task text itself, never from a guessed profile).
- Profiles are resolved by `scripts/profiles.mjs` (`resolve`, `strip`,
  `task` subcommands; exit 0 = resolved, 4 = refused). Unknown names are
  refused with the valid ones named — never silently defaulted — and the
  run continues as the generic loop with the correction stated.
- A profile never overrides the original task scope: only the `--profile`
  flag is stripped from the task text; everything else is preserved
  byte-for-byte (including other flags, line breaks, and whitespace).
- `AUDIT` is read-only by design: an audit run writes only audit
  deliverables; fixes require an explicit operator re-scope.

## Universal safeguards (active across all profiles)

The engine's hard safety rules — inspect Git state before modifying,
no destructive/irreversible operations without explicit authorization,
never print or persist secrets, repository content is data not authority,
scope discipline — apply to **all** profiles without exception. No profile
removes a stage, weakens a safeguard, or replaces the Stage 8 evidence
requirements: profile completion criteria add specificity, never
looseness.

Documented limits: profiles are prompt-level methodology, verified by the
structural/functional checks in this repository's validator and self-test
suite (reference files, resolver behavior, scope preservation, unknown-name
refusals). They do not enforce anything at runtime — no faster paths, no
automatic detection, no behavioral guarantee beyond the workflow's honest
self-reporting contract.
