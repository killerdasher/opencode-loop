# Fresh-Context Review — optional independent verification (deep mode)

A fresh-context review is a **separate OpenCode session** — any model — that
re-examines a finished implementation from the evidence on disk instead of the
implementer's narrative. It exists because the strongest known weakness of
in-session adversarial review (Stage 6) is **anchoring**: the same context that
built the plan also reviews it, and the reviewer has already agreed with the
reasoning once.

## What it is and is not

| It is | It is not |
| --- | --- |
| An optional capability for deep or high-risk runs | Mandatory for ordinary tasks (never auto-run, never a hard gate) |
| Context-freshness: the reviewer has not seen the implementer's reasoning | Guaranteed independence: the same model can still repeat the same blind spots |
| A producer of reconcilable findings (each one CONFIRMED / REFUTED / UNCONFIRMED against evidence) | A replacement for Stage 6 or for the deterministic evaluator |
| Read-only for the reviewed work | License to fix things — the reviewer reports, the operator decides |

**Honest model-diversity caveat:** a different model does not automatically
make a review independent or correct. Diversity helps when it is available;
the design must not depend on it. The capability works with any model, and the
reviewer prompt below is model-agnostic on purpose.

## When to offer it (implementer's duty)

Offer a fresh-context review at Stage 8 — and record the offer in the report —
when any of these holds:

- run mode is `deep` and the change touches more than one component;
- Stage 6 produced any MEDIUM-or-higher finding that was accepted rather than fixed;
- the task is security-relevant, destructive-capable, or modifies the installers,
  the evaluator, or the continuity helper (the trust chain itself);
- the user asked for independent verification.

The operator opts in explicitly. Without opt-in, the run converges normally —
the offer is recorded, not executed.

## The review package (what the reviewer receives)

The implementer assembles a package and passes it verbatim. Nothing in it may
be summarized by the implementer's judgment — quote or point at the artifact.
The same secret discipline applies as everywhere else in LOOP: never paste
credential-shaped values into the package; when a diff touches a file that
could contain one, point at the file and name what to check instead of
quoting it:

1. **Original objective** — the user's task text, verbatim and complete.
2. **Requirements and acceptance criteria** — the Stage 0 MUST/SHOULD/COULD
   table, plus evaluator criteria and their origins when recorded
   (`.loop/verification.json`).
3. **Actual git diff** — `git diff <baseline>..HEAD` output (or the file list
   plus the diff for changed files); never a description of the diff.
4. **Test evidence** — every verification command with its real exit status,
   and where each result is reproducible.
5. **Known limitations and disclosed risks** — accepted findings, TOCTOU-class
   windows, platform gaps — verbatim from the implementer's report, clearly
   labeled as claims.
6. **The implementer's report, last and labeled** — provided as a *claim to
   check*, not as context to adopt. The reviewer must form its own view from
   items 1–5 first.

## Reviewer rules (read-only, evidence-first)

- Work read-only: run checks, read files, run tests — but change nothing. Any
  proposed fix is a finding, not an edit.
- Re-derive, don't adopt: re-run the recorded verification commands when they
  are runnable; a claim that cannot be re-run is reported as UNCONFIRMED, not
  accepted.
- Trace requirements: check every MUST criterion against the original
  objective text — an implemented-but-never-requested item and a
  requested-but-unimplemented item are both findings.
- Report what could not be verified with the same prominence as what passed.

## Findings format (reconcilable by construction)

```md
### F<n> — <title> — <CRITICAL|HIGH|MEDIUM|LOW|INFORMATIONAL>
- claim: <what the implementer asserted or what the reviewer suspects>
- evidence: <file:line, command, or reproduction — actually executed>
- reconciliation: CONFIRMED | REFUTED | UNCONFIRMED (and why, against evidence)
```

Each finding must carry one of the three reconciliation states. A finding that
is a suspicion without a reproduction stays `UNCONFIRMED` — the reviewer names
the check that would confirm it.

## Reconciliation and the evidence chain

The implementer (not the reviewer) reconciles every finding against actual
evidence in the original session: each `CONFIRMED` finding enters the
evaluator manifest as a finding entry (gating PASS by the normal severity
rules); each `REFUTED`/`UNCONFIRMED` finding is answered with evidence in the
final report — never silently dropped. The review document itself is stored at
`.loop/reviews/<taskId>-fresh-review.md` (uncommitted run state, like the rest
of `.loop/`), and the final report links its reconciliation table.

## Capability boundary (do not oversell)

- No runtime enforces the read-only rule, the package contents, or the
  reconciliation — these are agent-followed procedures, like every LOOP
  protocol. The deterministic evaluator remains the only component whose
  verdicts are derived, not narrated.
- A fresh-context review strengthens **judgment**; it does not produce
  statistical evidence. One review is one more sample, recorded honestly.
- It consumes model tokens whenever the reviewer is a separate paid session.
  On the same machine with no budget for another session, the offer is
  declined and the run reports that independent review was offered and not
  performed — that is a legitimate, honest outcome.
