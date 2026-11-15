#!/usr/bin/env node
/**
 * LOOP EVOLUTION (P7) - controlled, evidence-driven self-evolution framework
 * -----------------------------------------------------------------------------
 * Discovers weaknesses in LOOP's methodology from recorded evaluation outcomes
 * and generates testable improvement proposals - driving them through an
 * isolated, deterministic candidate-vs-stable regression comparison with a
 * hard rejection gate. The objective is controlled evolution, not
 * uncontrolled self-modification.
 *
 * WHAT THIS IS
 *   - a zero-dependency harness (Node >= 16.7) implementing ten steps:
 *     collect sanitized outcomes -> identify recurring failure patterns ->
 *     classify weaknesses (instructions | references | validation | recovery)
 *     -> generate proposals -> map each proposal to failed evaluation cases
 *     -> create isolated candidates (git worktrees in the OS temp dir) ->
 *     run the full regression suite in each side -> compare against the
 *     stable version -> reject regressions -> emit a human-reviewable report;
 *   - append-only in its records: historical evaluation results are never
 *     rewritten; re-collecting unchanged sources ADDS nothing and changes
 *     nothing (already-recorded entries are skipped, never updated);
 *   - deterministic: record ids derive from content hashes; comparisons
 *     spawn the operator's suite commands with no shell (spawnSync argv).
 *
 * WHAT THIS IS NOT
 *   - it NEVER modifies the active skill, repository, or any project file:
 *     candidates run in detached git worktrees under the OS temp directory;
 *     writing its own records under the active skill directory is refused;
 *   - it NEVER publishes: no push, no release, no commit to the main tree;
 *   - it NEVER adopts automatically: `approve` records a decision only and
 *     demands an explicit `--approved-by NAME`; applying a candidate is a
 *     manual, human-reviewable flow performed by the operator;
 *   - it NEVER treats model-generated claims as proof: a proposal may carry
 *     an optional `claim` note, but the comparison verdict rests solely on
 *     deterministic suite counts; claims are echoed back labeled as claims;
 *   - it does NOT learn weights and holds no memory between sessions beyond
 *     its ledger files: LOOP never claims learned models or a permanent
 *     autonomous intelligence.
 *
 * COMPARISON CONTRACT (the improvement gate)
 *   `verify` runs the regression suite in a worktree pinned to the stable
 *   commit and in a worktree pinned to the candidate commit, then parses
 *   every `Summary: N passed` tier. Verdict:
 *     IMPROVED  - candidate suite(s) all exit 0 and some tier passed-count is
 *                 strictly higher than stable, with zero regressions;
 *     NEUTRAL   - all suites exit 0 and every tier count is equal;
 *     REJECTED  - any suite exited non-zero, or any tier passed-count is
 *                 lower than stable, or any tier failed-count is higher
 *                 (regressions). REJECTED candidates are preserved as
 *                 evidence and can never be approved.
 *   Known, disclosed proxy limitation: tier passed-counts are a structural
 *   metric - renaming a check or splitting it reads as a regression. The
 *   bias is deliberately conservative on the side of rejection. When the
 *   proposal carries an acceptanceCommand, the verdict additionally demands
 *   that the candidate actually passes it in its own worktree: the mapped
 *   weakness gets tested, not just narrated (P12 Phase 5).
 *
 * RECORD SCHEMA (v1) - one JSON file per record in the data dir
 *   ledger entry : { schemaVersion, tool, kind:'ledger', entryId, collectedAt,
 *                    sourceKind: 'continuity-archive' | 'evaluator-manifest',
 *                    sourceFile, taskId, status, stage?, signals[] }
 *   proposal     : { schemaVersion, tool, kind:'proposal', proposalId,
 *                    createdAt, weaknessClass (instructions | references |
 *                    validation | recovery), mappedEntryIds[] (>=1, must
 *                    exist in the ledger), changeTitle, changeSummary,
 *                    acceptanceMetric, claim?, status: open|rejected|approved }
 *   comparison   : { schemaVersion, tool, kind:'comparison', comparisonId,
 *                    proposalId, createdAt, baseCommit, candidateCommit,
 *                    suites, stable[], candidate[], verdict, regressions[],
 *                    improvements[], acceptance?{command,stableExit,candidateExit},
 *                    worktreesRemoved, worktreesLeft[] },
 *   approval     (published in the proposal record's `approval` field)
 *   Every write fails closed on secret-shaped content (scanner reused from
 *   continuity.mjs) and uses atomic temp+fsync+rename writes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { scanForSecrets, SECRET_LIMITS_NOTE } from './continuity.mjs';

export const EV_TOOL_ID = 'loop-evolution';
export const EV_SCHEMA_VERSION = 1;
export const WEAKNESS_CLASSES = ['instructions', 'references', 'validation', 'recovery'];
export const OTHER_BUCKET = 'other';
export const RECURRING_THRESHOLD = 2;

export const DEFAULT_DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '.loop', 'evolution',
);
export const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..',
);
/** The real gates of this repository - the regression suite default. */
export const DEFAULT_SUITES = [
  { name: 'validate', command: 'node scripts/validate.mjs --all', expectedSummaries: 3 },
  { name: 'selftest', command: 'node tests/harness/selftest.mjs', expectedSummaries: 1 },
];
export const COMPARISON_NOTE = 'model-generated claims are never evidence: verdicts rest on deterministic suite counts only';
export const HONESTY_NOTE = 'LOOP does not learn model weights and holds no permanent autonomous intelligence: evolution here means improving instruction/reference/validation/recovery artifacts through human-approved, regression-gated changes.';

const KINDS = ['ledger', 'proposal', 'comparison'];

function sha16(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
function isStr(v) { return typeof v === 'string' && v.length > 0; }
function isSha(v) { return typeof v === 'string' && /^[0-9a-f]{7,64}$/.test(v); }

function guardDataDir(dataDir) {
  if (typeof dataDir !== 'string' || dataDir.length === 0) return 'data dir is required';
  const segments = dataDir.split(/[/\\]/);
  if (segments.some((s) => s === '.opencode')) {
    return 'refusing: data dir must not live under the active skill directory (it is read-only to this tool)';
  }
  return null;
}

function recordPath(dir, kind, id) { return path.join(dir, `${kind}-${id}.json`); }

function atomicWrite(file, payload) {
  const tmp = `${file}.tmp-${randomBytes(4).toString('hex')}`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, payload, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function failClosed(record) {
  const hits = scanForSecrets(record);
  if (Array.isArray(hits) && hits.length > 0) {
    return { blocked: true, hits: hits.map((h) => h.id), limits: SECRET_LIMITS_NOTE };
  }
  return null;
}

// ---------------------------------------------------------------------------
// STEP 1-2 + 3 support: collect sanitized outcomes; classification on demand
// ---------------------------------------------------------------------------

/** One sanitized ledger entry per recorded evaluation outcome. */
function classifyText(text) {
  const KEYWORDS = {
    instructions: ['instruction', 'settings', 'adherence', 'drift', 'flag', 'mode'],
    references: ['reference', 'doc', 'skill', 'guide', 'readme', 'anchor'],
    validation: ['validate', 'validator', 'check', 'suite', 'test', 'verdict', 'evidence', 'evaluator', 'selftest', 'fixture'],
    recovery: ['recover', 'resume', 'pause', 'checkpoint', 'continuity', 'interrupt', 'stale', 'worktree', 'reconcil'],
  };
  // collector labels ("status=", "stopReason: ", ...) are noise, not content:
  // they must never weigh into classification.
  const lower = ` ${text.replace(/^(status=|stopReason:|stoppingCondition:|objective:)/i, ' ').toLowerCase()} `;
  let best = OTHER_BUCKET;
  let bestHits = 0;
  for (const [cls, words] of Object.entries(KEYWORDS)) {
    let hits = 0;
    for (const w of words) {
      let i = 0;
      while ((i = lower.indexOf(w, i)) >= 0) { hits += 1; i += w.length; }
    }
    if (hits > bestHits) { best = cls; bestHits = hits; }
  }
  return { cls: best, hits: bestHits };
}

function collectPattern(record) {
  const parts = [];
  if (record.status && record.status !== 'COMPLETED') parts.push(`status ${record.status}`);
  if (record.stopReason) parts.push(String(record.stopReason));
  if (record.stoppingCondition) parts.push(String(record.stoppingCondition));
  if (record.objective) parts.push(String(record.objective));
  for (const s of record.signals ?? []) parts.push(String(s));
  return parts.filter((p) => p.length > 0);
}

export function makeLedgerEntry({ sourceKind, sourceFile, taskId, status, stage, signals, collectedAt }) {
  const entry = {
    schemaVersion: EV_SCHEMA_VERSION,
    tool: EV_TOOL_ID,
    kind: 'ledger',
    entryId: sha16(`${sourceKind}\u0000${sourceFile}\u0000${taskId ?? ''}`),
    collectedAt,
    sourceKind,
    sourceFile,
    taskId,
    status,
    stage: stage ?? null,
    signals,
  };
  return entry;
}

/**
 * Collect a sanitized evaluation outcome into the append-only ledger.
 * sources: verified continuity archives (.loop/archive/*.json) and, when
 * present, the evaluator's verification manifest (.loop/verification.json).
 * Already-recorded entries are skipped (never rewritten); unparseable source
 * files are refused, never ignored (fail-closed, history untouched).
 */
export function collectOutcome(dataDir, { sourceKind, sourceFile, absFile, collectedAt }) {
  const dirErr = guardDataDir(dataDir);
  if (dirErr) return { ok: false, reason: dirErr };
  if (!['continuity-archive', 'evaluator-manifest'].includes(sourceKind)) {
    return { ok: false, reason: `unknown source kind: ${JSON.stringify(sourceKind)}` };
  }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(absFile, 'utf8')); }
  catch (e) { return { ok: false, reason: `source unreadable / not JSON: ${String(e && e.message)}` }; }
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'source must be a JSON object' };

  let entry;
  if (sourceKind === 'continuity-archive') {
    if (raw.schemaVersion !== 1 || raw.tool !== 'loop-continuity' || typeof raw.taskId !== 'string' || typeof raw.status !== 'string') {
      return { ok: false, reason: 'not a validated continuity archive (schemaVersion/tool/taskId/status required)' };
    }
    if (raw.integrity && raw.integrity !== 'VALID') {
      return { ok: false, reason: `archive integrity ${raw.integrity} - suspicious records are never collected` };
    }
    const signals = [
      `status=${raw.status}`,
      raw.stage != null ? `stopped at stage ${raw.stage}` : null,
      raw.stopReason ? `stopReason: ${raw.stopReason}` : null,
      raw.stoppingCondition ? `stoppingCondition: ${raw.stoppingCondition}` : null,
      raw.objective ? `objective: ${raw.objective}` : null,
    ].filter((s) => typeof s === 'string' && s.length > 0);
    entry = makeLedgerEntry({ sourceKind, sourceFile: path.basename(sourceFile), taskId: raw.taskId, status: raw.status, stage: raw.stage, signals, collectedAt });
  } else {
    if (raw.tool !== 'loop-evaluator' || !Array.isArray(raw.evidence)) {
      return { ok: false, reason: 'not a validated evaluator manifest (loop-evaluator + evidence required)' };
    }
    const signals = [
      Array.isArray(raw.criteria) ? `criteria declared: ${raw.criteria.length}` : null,
      ...(raw.evidence ?? []).filter((e) => typeof e === 'object' && e?.verdict && e.verdict !== 'PASS')
        .map((e) => `evidence ${e.id}: ${e.verdict}`),
      ...(raw.blockers ?? []).map((b) => `blocker: ${typeof b === 'string' ? b : (b?.text ?? JSON.stringify(b))}`),
    ].filter((s) => typeof s === 'string' && s.length > 0);
    entry = makeLedgerEntry({
      sourceKind, sourceFile: path.basename(sourceFile), taskId: raw.taskId ?? null, status: 'MANIFEST', stage: null, signals, collectedAt,
    });
  }

  const blocked = failClosed(entry);
  if (blocked) return { ok: false, blocked: true, reason: 'secret-shaped value in collected outcome refused', ...blocked };
  const target = recordPath(dataDir, 'ledger', entry.entryId);
  if (fs.existsSync(target)) return { ok: true, alreadyRecorded: true, entryId: entry.entryId, file: path.basename(target) };
  fs.mkdirSync(dataDir, { recursive: true });
  atomicWrite(target, `${JSON.stringify(entry, null, 2)}\n`);
  return { ok: true, file: path.basename(target), entryId: entry.entryId };
}

/** Read every ledger entry present in the data dir (sorted by entryId). */
export function readLedger(dataDir) {
  if (!fs.existsSync(dataDir)) return { ok: true, entries: [] };
  const entries = [];
  for (const f of fs.readdirSync(dataDir)) {
    if (!f.startsWith('ledger-') || !f.endsWith('.json')) continue;
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); }
    catch { return { ok: false, reason: `ledger record unreadable: ${f} - history refused to be overwritten implicitly` }; }
    entries.push(rec);
  }
  entries.sort((a, b) => (a.entryId < b.entryId ? -1 : 1));
  return { ok: true, entries };
}

/**
 * STEP 2 + 3 on demand: classify recorded signals into the weakness classes
 * and surface recurring patterns. Nothing here is stored: classification is
 * derived per run, against the versioned keyword table in classifyText.
 */
export function derivePatterns(dataDir) {
  const led = readLedger(dataDir);
  if (!led.ok) return led;
  const perEntry = [];
  const byClass = Object.fromEntries([...WEAKNESS_CLASSES, OTHER_BUCKET].map((c) => [c, []]));
  for (const e of led.entries) {
    const parts = collectPattern(e);
    const counts = new Map(WEAKNESS_CLASSES.map((c) => [c, 0]));
    let totalHits = 0;
    for (const p of parts) {
      const r = classifyText(p);
      if (r.cls !== OTHER_BUCKET) { counts.set(r.cls, counts.get(r.cls) + r.hits); totalHits += r.hits; }
    }
    let top = OTHER_BUCKET;
    let topHits = 0;
    for (const c of WEAKNESS_CLASSES) {
      if (counts.get(c) > topHits) { top = c; topHits = counts.get(c); }
    }
    const classification = totalHits === 0 ? OTHER_BUCKET : top;
    perEntry.push({ entryId: e.entryId, status: e.status, signals: parts, classifiedAs: classification });
    byClass[classification].push(e.entryId);
  }
  const recurring = WEAKNESS_CLASSES
    .map((c) => ({ weaknessClass: c, hits: byClass[c].length, recurring: byClass[c].length >= RECURRING_THRESHOLD, exampleEntryIds: byClass[c].slice(0, 3) }))
    .filter((r) => r.hits > 0);
  return {
    ok: true,
    entriesAnalyzed: led.entries.length,
    recurring,
    unclassified: byClass[OTHER_BUCKET].length,
    assessedOn: 'recorded evaluation outcomes only - no model opinion enters classification',
  };
}

// ---------------------------------------------------------------------------
// STEP 4 + 5: proposals, mapped to actual failed evaluation cases
// ---------------------------------------------------------------------------

export function createProposal(dataDir, input) {
  const dirErr = guardDataDir(dataDir);
  if (dirErr) return { ok: false, reason: dirErr };
  const {
    weaknessClass, mappedEntryIds, changeTitle, changeSummary, acceptanceMetric, acceptanceCommand, claim, createdAt,
  } = input ?? {};
  if (!WEAKNESS_CLASSES.includes(weaknessClass)) {
    return { ok: false, reason: `weaknessClass must be one of ${WEAKNESS_CLASSES.join('|')}` };
  }
  if (!Array.isArray(mappedEntryIds) || mappedEntryIds.length === 0) {
    return { ok: false, reason: 'a proposal must map to at least one recorded evaluation case (mappedEntryIds)' };
  }
  const led = readLedger(dataDir);
  if (!led.ok) return led;
  const known = new Set(led.entries.map((e) => e.entryId));
  const missing = mappedEntryIds.filter((id) => !known.has(id));
  if (missing.length > 0) {
    return { ok: false, reason: `mapping refused: not recorded in the ledger: ${missing.join(', ')} (proposals must map to actual recorded evaluation outcomes)` };
  }
  if (!isStr(changeTitle) || !isStr(changeSummary) || !isStr(acceptanceMetric)) {
    return { ok: false, reason: 'changeTitle, changeSummary and acceptanceMetric are required (the metric is what the verdict will measure)' };
  }
  // P12 Phase 5: an optional executable acceptance command (same
  // whitespace-split, no-shell convention as suite commands) turns the
  // acceptance metric from prose into a check the candidate must pass.
  if (acceptanceCommand !== undefined && (!isStr(acceptanceCommand) || !acceptanceCommand.trim())) {
    return { ok: false, reason: 'acceptanceCommand must be a non-empty command string when present' };
  }
  const proposal = {
    schemaVersion: EV_SCHEMA_VERSION,
    tool: EV_TOOL_ID,
    kind: 'proposal',
    proposalId: sha16(`${weaknessClass}\u0000${mappedEntryIds.join(',')}\u0000${changeTitle}\u0000${createdAt}\u0000${sha16(changeSummary)}`),
    createdAt,
    weaknessClass,
    mappedEntryIds,
    changeTitle,
    changeSummary,
    acceptanceMetric,
    acceptanceCommand: typeof acceptanceCommand === 'string' && acceptanceCommand.trim() ? acceptanceCommand : undefined,
    claim: typeof claim === 'string' && claim.length > 0 ? { text: claim, evidence: false } : undefined,
    status: 'open',
  };
  const blocked = failClosed(proposal);
  if (blocked) return { ok: false, blocked: true, reason: 'secret-shaped value refused', ...blocked };
  const target = recordPath(dataDir, 'proposal', proposal.proposalId);
  if (fs.existsSync(target)) {
    return { ok: false, reason: `proposal already exists: ${path.basename(target)} (identical inputs collide; adjust the title or inspect the existing proposal)` };
  }
  fs.mkdirSync(dataDir, { recursive: true });
  atomicWrite(target, `${JSON.stringify(proposal, null, 2)}\n`);
  return { ok: true, proposalId: proposal.proposalId, file: path.basename(target) };
}

function readRecord(dir, kind, id) {
  if (!/^[0-9a-f]{16}$/.test(String(id ?? ''))) return { readStatus: 'invalid-id' };
  const file = recordPath(dir, kind, id);
  if (!fs.existsSync(file)) return { readStatus: 'absent' };
  try { return { readStatus: 'ok', raw: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (e) { return { readStatus: 'unreadable', error: String(e && e.message) }; }
}

// ---------------------------------------------------------------------------
// STEP 6 + 7 + 8 + 9: isolated candidates, regression run, compare, reject
// ---------------------------------------------------------------------------

function resolveCommit(repoRoot, ref) {
  const r = spawnSync('git', ['rev-parse', `${ref}^{commit}`], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0 || !isStr(r.stdout.trim())) {
    return { ok: false, reason: `cannot resolve commit ${JSON.stringify(ref)}: ${(r.stderr || '').trim().slice(0, 120)}` };
  }
  return { ok: true, commit: r.stdout.trim() };
}

/** Parse every "Summary: N passed[, M failed[, K skipped]]" tier in output. */
function parseSummaries(stdout) {
  const tiers = [];
  const re = /Summary: (\d+) passed(?:, (\d+) failed)?(?:, (\d+) skipped)?/g;
  let m;
  while ((m = re.exec(stdout)) !== null) {
    tiers.push({ passed: Number(m[1]), failed: Number(m[2] ?? 0), skipped: Number(m[3] ?? 0) });
  }
  return tiers;
}

function runSuite(worktree, suite) {
  const argv = suite.command.split(/\s+/).filter(Boolean);
  const r = spawnSync(argv[0], argv.slice(1), { cwd: worktree, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const summaries = parseSummaries(`${r.stdout ?? ''}`);
  return {
    name: suite.name,
    command: suite.command,
    exit: r.status ?? -1,
    error: r.error ? String(r.error.message) : undefined,
    summaries: summaries.slice(0, suite.expectedSummaries),
    summariesExpected: suite.expectedSummaries,
  };
}

export function verifyCandidate(dataDir, repoRoot, { proposalId, baseRef, candidateRef, suiteSpec, createdAt, keepWorktrees }) {
  const dirErr = guardDataDir(dataDir);
  if (dirErr) return { ok: false, reason: dirErr };
  if (!isSha(proposalId) && !isStr(proposalId)) return { ok: false, reason: 'proposalId is required' };
  const prop = readRecord(dataDir, 'proposal', proposalId);
  if (prop.readStatus !== 'ok') return { ok: false, reason: `proposal ${prop.readStatus}` };
  if (prop.raw?.kind !== 'proposal' || prop.raw?.tool !== EV_TOOL_ID) return { ok: false, reason: 'record is not a validated proposal' };
  if (prop.raw.status === 'approved') return { ok: false, reason: 'proposal already approved - approved proposals are final' };

  // STEP 6: isolated candidate changes - detached worktrees in OS temp.
  const base = resolveCommit(repoRoot, isStr(baseRef) ? baseRef : 'HEAD');
  if (!base.ok) return base;
  const cand = resolveCommit(repoRoot, isStr(candidateRef) ? candidateRef : 'HEAD');
  if (!cand.ok) return cand;

  // allowlist the suite spec: unknown fields are dropped, not carried into records
  const suites = (Array.isArray(suiteSpec) && suiteSpec.length > 0 ? suiteSpec : DEFAULT_SUITES)
    .map((s) => ({ name: s?.name, command: s?.command, expectedSummaries: s?.expectedSummaries }));
  for (const s of suites) {
    if (!isStr(s.name) || !isStr(s.command) || !Number.isInteger(s.expectedSummaries) || s.expectedSummaries < 1) {
      return { ok: false, reason: 'each suite needs name, command and an integer expectedSummaries >= 1' };
    }
  }
  // P12 Phase 5: optional executable acceptance command from the proposal.
  const accCommand = prop.raw.acceptanceCommand;
  if (accCommand !== undefined && (!isStr(accCommand) || !accCommand.trim())) {
    return { ok: false, reason: 'acceptanceCommand must be a non-empty command string when present' };
  }

  const comparisonId = sha16(`${proposalId}\u0000${base.commit}\u0000${cand.commit}\u0000${createdAt}`);
  const wtRoot = path.join(os.tmpdir(), `loop-evolution-wt-${comparisonId}`);
  const stableWt = path.join(wtRoot, 'stable');
  const candidateWt = path.join(wtRoot, 'candidate');
  const worktreesLeft = [];
  fs.mkdirSync(wtRoot, { recursive: true });
  const addWt = (dir, commit) => {
    const r = spawnSync('git', ['worktree', 'add', '--detach', dir, commit], { cwd: repoRoot, encoding: 'utf8' });
    return r.status === 0 ? { ok: true } : { ok: false, reason: `git worktree add failed: ${(r.stderr || '').trim().slice(0, 160)}` };
  };
  let addErr = (addWt(stableWt, base.commit).ok && addWt(candidateWt, cand.commit).ok)
    ? null : 'git worktree add failed (see stderr)';
  const cleanup = () => {
    if (keepWorktrees) {
      // explicit operator keep: nothing is removed; paths left for inspection
      worktreesLeft.push(stableWt, candidateWt);
      return;
    }
    for (const dir of [stableWt, candidateWt]) {
      const r = spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: repoRoot, encoding: 'utf8' });
      if (r.status !== 0) worktreesLeft.push(dir);
    }
    if (worktreesLeft.length === 0) {
      try { fs.rmSync(wtRoot, { recursive: true, force: true }); } catch { worktreesLeft.push(wtRoot); }
      spawnSync('git', ['worktree', 'prune'], { cwd: repoRoot });
    }
  };
  const abort = (reason) => { cleanup(); return { ok: false, blocked: true, reason, worktreesLeft }; };
  if (addErr) return abort(addErr);

  // STEP 7: run the FULL regression suite on both sides (no shell).
  const stable = suites.map((s) => runSuite(stableWt, s));
  const candidate = suites.map((s) => runSuite(candidateWt, s));
  // P12 Phase 5: the acceptance command turns the proposal's
  // acceptanceMetric from prose into a check. It runs in both worktrees
  // (same whitespace-split, no-shell convention as suite commands): the
  // stable side may fail - that is the recorded weakness - but the
  // candidate MUST exit 0, otherwise the mapped weakness was not actually
  // addressed and the candidate is rejected on that alone. Runs before
  // worktree cleanup, same as the suites.
  let acceptance = null;
  let acceptanceFailure = null;
  if (accCommand !== undefined) {
    const accArgv = accCommand.split(/\s+/).filter(Boolean);
    const accRun = (wt) => {
      const r = spawnSync(accArgv[0], accArgv.slice(1), { cwd: wt, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      return r.status ?? -1;
    };
    const stableExit = accRun(stableWt);
    const candidateExit = accRun(candidateWt);
    acceptance = { command: accCommand, stableExit, candidateExit };
    if (candidateExit !== 0) {
      acceptanceFailure = `acceptance command exited ${candidateExit} in the candidate (stable exit ${stableExit}) - the mapped weakness was not addressed`;
    }
  }
  cleanup();

  // STEP 8 + 9: deterministic comparison; regressions reject, by rule.
  const regressions = [];
  const improvements = [];
  if (acceptanceFailure !== null) {
    regressions.push({ tier: 'acceptance-command', regression: acceptanceFailure, acceptance });
  }
  for (let i = 0; i < suites.length; i += 1) {
    const a = stable[i];
    const b = candidate[i];
    if (b.exit !== 0) regressions.push({ suite: b.name, regression: `exit ${b.exit} (stable exited ${a.exit})` });
    if (b.summaries.length !== b.summariesExpected) regressions.push({ suite: b.name, regression: `only ${b.summaries.length}/${b.summariesExpected} summary tiers parsed - a malformed suite run is treated as produced-nothing, never silently passed` });
    const n = Math.max(a.summaries.length, b.summaries.length);
    for (let t = 0; t < n; t += 1) {
      const sa = a.summaries[t];
      const sb = b.summaries[t];
      if (!sa || !sb) continue;
      const tier = `${b.name}#${t}`;
      if (sb.failed > sa.failed) regressions.push({ tier, regression: `failed ${sa.failed} -> ${sb.failed}`, stable: sa, candidate: sb });
      if (sb.passed < sa.passed) regressions.push({ tier, regression: `passed ${sa.passed} -> ${sb.passed}`, stable: sa, candidate: sb });
      if (sb.passed > sa.passed && sb.failed <= sa.failed && b.exit === 0) improvements.push({ tier, improvement: `passed ${sa.passed} -> ${sb.passed}`, stable: sa, candidate: sb });
    }
  }
  const verdict = regressions.length > 0 ? 'REJECTED' : improvements.length > 0 ? 'IMPROVED' : 'NEUTRAL';
  const comparison = {
    schemaVersion: EV_SCHEMA_VERSION,
    tool: EV_TOOL_ID,
    kind: 'comparison',
    comparisonId,
    proposalId,
    createdAt,
    baseCommit: base.commit,
    candidateCommit: cand.commit,
    suites,
    stable,
    candidate,
    verdict,
    regressions,
    improvements,
    ...(acceptance !== null ? { acceptance } : {}),
    worktreesRemoved: worktreesLeft.length === 0,
    worktreesLeft,
    evidenceNote: COMPARISON_NOTE,
  };
  const blocked = failClosed(comparison);
  if (blocked) return { ok: false, blocked: true, reason: 'secret-shaped value refused', ...blocked };
  fs.mkdirSync(dataDir, { recursive: true });
  atomicWrite(recordPath(dataDir, 'comparison', comparisonId), `${JSON.stringify(comparison, null, 2)}\n`);
  // STEP 9: a rejected candidate marks the proposal rejected (record state
  // only - the candidate patch itself is never applied anywhere).
  if (verdict === 'REJECTED' && prop.raw.status === 'open') {
    const updated = { ...prop.raw, status: 'rejected', rejectedBy: comparisonId };
    const b2 = failClosed(updated);
    if (b2) return { ok: false, blocked: true, reason: 'secret-shaped value refused', ...b2 };
    atomicWrite(recordPath(dataDir, 'proposal', proposalId), `${JSON.stringify(updated, null, 2)}\n`);
  }
  return { ok: true, verdict, comparisonId, file: `comparison-${comparisonId}.json`, worktreesLeft };
}

// ---------------------------------------------------------------------------
// Human approval (STEP beyond 9): record-only, never applies, never publishes
// ---------------------------------------------------------------------------

export function approveProposal(dataDir, { proposalId, approvedBy }) {
  const dirErr = guardDataDir(dataDir);
  if (dirErr) return { ok: false, reason: dirErr };
  if (!isStr(approvedBy)) {
    return { ok: false, reason: 'an explicit approver is required: --approved-by NAME (user approval is mandatory before adopting a candidate)' };
  }
  const prop = readRecord(dataDir, 'proposal', proposalId);
  if (prop.readStatus !== 'ok') return { ok: false, reason: `proposal ${prop.readStatus}` };
  if (prop.raw?.kind !== 'proposal') return { ok: false, reason: 'record is not a validated proposal' };
  if (prop.raw.status === 'approved') return { ok: false, reason: 'proposal already approved - approval is final' };
  if (prop.raw.status === 'rejected') return { ok: false, reason: 'proposal is REJECTED (regression gate) - rejected candidates can never be approved' };
  const comparisons = [];
  if (fs.existsSync(dataDir)) {
    for (const f of fs.readdirSync(dataDir)) {
      if (!f.startsWith('comparison-') || !f.endsWith('.json')) continue;
      try {
        const c = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
        if (c.proposalId === proposalId) comparisons.push(c);
      } catch { return { ok: false, reason: `comparison record unreadable: ${f} - approval requires a readable verdict (fail-closed)` }; }
    }
  }
  const latest = comparisons.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).at(-1);
  if (!latest) return { ok: false, reason: 'no comparison recorded for this proposal - approval without a candidate-vs-stable verdict is refused' };
  if (latest.verdict !== 'IMPROVED') {
    return { ok: false, reason: `adoption requires a measurable improvement with no regressions; the latest verdict is ${latest.verdict} (${latest.comparisonId})` };
  }
  const updated = {
    ...prop.raw,
    status: 'approved',
    approval: {
      approvedBy,
      approvedAt: new Date().toISOString(),
      comparisonId: latest.comparisonId,
      verdict: 'IMPROVED',
      appliedByTool: false,
      note: 'approval is a decision record only: applying the candidate to the repository and the active skill is a manual, human-reviewable step; this tool never publishes and never modifies the active skill',
    },
  };
  const blocked = failClosed(updated);
  if (blocked) return { ok: false, blocked: true, reason: 'secret-shaped value refused', ...blocked };
  atomicWrite(recordPath(dataDir, 'proposal', proposalId), `${JSON.stringify(updated, null, 2)}\n`);
  return { ok: true, proposalId, status: 'approved', comparisonId: latest.comparisonId, verdict: 'IMPROVED' };
}

// ---------------------------------------------------------------------------
// STEP 10: the human-reviewable improvement report
// ---------------------------------------------------------------------------

export function buildReport(dataDir, { proposalId }) {
  const prop = readRecord(dataDir, 'proposal', proposalId);
  if (prop.readStatus !== 'ok') return { ok: false, reason: `proposal ${prop.readStatus}` };
  const led = readLedger(dataDir);
  if (!led.ok) return led;
  const mapped = led.entries.filter((e) => prop.raw.mappedEntryIds?.includes(e.entryId));
  if (mapped.length !== (prop.raw.mappedEntryIds?.length ?? 0)) {
    return { ok: false, reason: 'report refused: mapped evaluation cases are missing from the ledger (history must be preserved intact; the report presents live, complete evidence)' };
  }
  const comparisons = [];
  if (fs.existsSync(dataDir)) {
    for (const f of fs.readdirSync(dataDir)) {
      if (!f.startsWith('comparison-') || !f.endsWith('.json')) continue;
      try {
        const c = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
        if (c.proposalId === proposalId) comparisons.push(c);
      } catch { return { ok: false, reason: `comparison record unreadable: ${f}` }; }
    }
  }
  const latest = comparisons.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).at(-1);
  const tiers = [];
  if (latest) {
    latest.suites.forEach((s, i) => {
      const a = latest.stable[i];
      const b = latest.candidate[i];
      for (let t = 0; t < Math.max(a.summaries.length, b.summaries.length); t += 1) {
        tiers.push({
          tier: `${s.name}#${t}`,
          stable: a.summaries[t] ? `${a.summaries[t].passed} passed / ${a.summaries[t].failed} failed` : 'not parsed',
          candidate: b.summaries[t] ? `${b.summaries[t].passed} passed / ${b.summaries[t].failed} failed` : 'not parsed',
        });
      }
    });
  }
  return {
    ok: true,
    report: {
      title: prop.raw.changeTitle,
      proposalId: prop.raw.proposalId,
      weaknessClass: prop.raw.weaknessClass,
      changeSummary: prop.raw.changeSummary,
      acceptanceMetric: prop.raw.acceptanceMetric,
      claimedImprovement: prop.raw.claim ?? null,
      mappedFailedCases: mapped.map((e) => ({ entryId: e.entryId, status: e.status, sourceFile: e.sourceFile })),
      status: prop.raw.status,
      approval: prop.raw.approval ?? null,
      comparison: latest ? {
        comparisonId: latest.comparisonId,
        verdict: latest.verdict,
        baseCommit: latest.baseCommit,
        candidateCommit: latest.candidateCommit,
        regressions: latest.regressions,
        improvements: latest.improvements,
        acceptance: latest.acceptance ?? null,
        tiers,
      } : null,
      limitations: {
        metricProxy: 'tier passed-counts are a structural proxy: renames/splits of checks read as regressions; the bias is deliberately conservative',
        scope: 'one candidate, one commit pair, the operator\'s suite spec - not a statistical model of LOOP quality',
        claimsNotEvidence: COMPARISON_NOTE,
        noLearning: HONESTY_NOTE,
        noAuto: 'the active skill was never modified by this run; nothing was published; adoption (if approved) is a manual operator flow',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// CLI: collect | patterns | propose | verify | approve | report | list | help
// ---------------------------------------------------------------------------

function usage() {
  return [
    'loop-evolution - controlled, evidence-driven self-evolution (P7)',
    '',
    '  collect <dir> --archives PATH            sanitize .loop/archive/*.json (+ verification.json)',
    '  patterns <dir>                           classify weaknesses + recurring failure patterns',
    '  propose <dir> --from-stdin               {"weaknessClass","mappedEntryIds",[...]',
    '                                            "changeTitle","changeSummary","acceptanceMetric"',
    '                                            [, "acceptanceCommand"] [, "claim"]}',
    '                                           acceptanceCommand (optional, same',
    '                                           no-shell convention) runs in both',
    '                                           worktrees: the candidate must exit 0',
    '                                           or the verdict is REJECTED',
    '  verify <dir> --proposal P [--base SHA] [--candidate SHA]',
    '         [--repo PATH] [--keep-worktrees] --from-stdin   {"suiteSpec":[{"name","command","expectedSummaries"}]} optional',
    '                                           isolated worktrees; full regression suite on both sides;',
    '                                           verdict IMPROVED | NEUTRAL | REJECTED',
    '  approve <dir> --proposal P --approved-by NAME   records the human decision only (requires verdict IMPROVED)',
    '  report <dir> --proposal P                human-reviewable improvement report',
    '  list <dir>                               ledger + proposals overview',
    '  help                                     this text',
    '',
    'Exit codes: 0 ok, 2 blocked/refused, 4 usage, 5 internal.',
    'Suite commands run as argv with no shell; tokens are split on whitespace',
    '(no quoted paths). The active skill is never modified; nothing is',
    'published automatically; user approval is mandatory before adopting a',
    'candidate;',
    SECRET_LIMITS_NOTE,
  ].join('\n');
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function optValue(argv, key) {
  const i = argv.indexOf(key);
  if (i < 0) return undefined;
  return argv[i + 1];
}

function runCli(argv) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || rest[0] === 'help') {
    process.stdout.write(`${usage()}\n`);
    return command === 'help' || rest[0] === 'help' ? 0 : 4;
  }
  const positional = rest.filter((a) => !a.startsWith('--'));
  const dir = positional[0] ?? DEFAULT_DATA_DIR;
  const repoRoot = path.resolve(optValue(rest, '--repo') ?? DEFAULT_REPO_ROOT);
  const now = new Date().toISOString();
  switch (command) {
    case 'collect': {
      const archives = optValue(rest, '--archives') ?? path.join(repoRoot, '.loop', 'archive');
      const collected = [];
      const errors = [];
      let dupes = 0;
      const root = fs.existsSync(archives) ? archives : null;
      if (!root && !fs.existsSync(path.join(repoRoot, '.loop', 'verification.json'))) {
        printResult({ ok: false, reason: `no archives at ${archives} and no verification manifest` });
        return 2;
      }
      if (root) {
        for (const f of fs.readdirSync(root).filter((x) => x.endsWith('.json')).sort()) {
          const r = collectOutcome(dir, { sourceKind: 'continuity-archive', sourceFile: f, absFile: path.join(root, f), collectedAt: now });
          if (r.ok && r.alreadyRecorded) { dupes += 1; continue; }
          if (r.ok) collected.push(r);
          else errors.push({ file: f, reason: r.reason });
        }
      }
      const manifest = path.join(repoRoot, '.loop', 'verification.json');
      if (fs.existsSync(manifest)) {
        const r = collectOutcome(dir, { sourceKind: 'evaluator-manifest', sourceFile: 'verification.json', absFile: manifest, collectedAt: now });
        if (r.ok && r.alreadyRecorded) dupes += 1;
        else if (r.ok) collected.push(r);
        else errors.push({ file: 'verification.json', reason: r.reason });
      }
      printResult({ ok: collected.length > 0 || (dupes > 0 && errors.length === 0), collected: collected.map((c) => c.file), alreadyRecorded: dupes, errors });
      return collected.length > 0 ? 0 : errors.length > 0 ? 2 : 0;
    }
    case 'patterns': {
      const r = derivePatterns(dir);
      printResult(r.ok ? r : r);
      return r.ok ? 0 : 2;
    }
    case 'propose': {
      if (!rest.includes('--from-stdin')) { printResult({ error: 'propose requires --from-stdin' }); return 4; }
      let input;
      try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (e) { printResult({ error: `invalid proposal JSON: ${e.message}` }); return 4; }
      const r = createProposal(dir, input);
      printResult(r.ok ? r : r);
      return r.ok ? 0 : r.blocked ? 2 : 4;
    }
    case 'verify': {
      const proposalId = optValue(rest, '--proposal');
      if (!proposalId) { printResult({ error: 'verify requires --proposal' }); return 4; }
      let suiteSpec;
      if (rest.includes('--from-stdin')) {
        try { suiteSpec = JSON.parse(fs.readFileSync(0, 'utf8')); }
        catch (e) { printResult({ error: `invalid suiteSpec JSON: ${e.message}` }); return 4; }
      }
      const r = verifyCandidate(dir, repoRoot, {
        proposalId,
        baseRef: optValue(rest, '--base'),
        candidateRef: optValue(rest, '--candidate'),
        suiteSpec,
        createdAt: now,
        keepWorktrees: rest.includes('--keep-worktrees'),
      });
      printResult(r.ok ? r : r);
      return r.ok ? 0 : r.blocked ? 2 : 4;
    }
    case 'approve': {
      const proposalId = optValue(rest, '--proposal');
      if (!proposalId) { printResult({ error: 'approve requires --proposal' }); return 4; }
      const r = approveProposal(dir, { proposalId, approvedBy: optValue(rest, '--approved-by') });
      printResult(r.ok ? r : r);
      return r.ok ? 0 : 2;
    }
    case 'report': {
      const proposalId = optValue(rest, '--proposal');
      if (!proposalId) { printResult({ error: 'report requires --proposal' }); return 4; }
      const r = buildReport(dir, { proposalId });
      printResult(r.ok ? r.report : r);
      return r.ok ? 0 : 2;
    }
    case 'list': {
      const led = readLedger(dir);
      if (!led.ok) { printResult(led); return 2; }
      const proposals = [];
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          if (f.startsWith('proposal-') && f.endsWith('.json')) {
            proposals.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
          }
        }
      }
      printResult({ entries: led.entries.length, proposals: proposals.map((p) => ({ proposalId: p.proposalId, title: p.changeTitle, class: p.weaknessClass, status: p.status })) });
      return 0;
    }
    default:
      printResult({ error: `unknown command: ${command}` });
      return 4;
  }
}

const IS_CLI_ENTRY = process.argv[1] !== undefined
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (IS_CLI_ENTRY) {
  try {
    process.exit(runCli(process.argv.slice(2)));
  } catch (e) {
    printResult({ ok: false, error: `internal error: ${e.message}` });
    process.exit(5);
  }
}
