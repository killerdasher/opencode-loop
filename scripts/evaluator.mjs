#!/usr/bin/env node
/**
 * LOOP EVALUATOR (ADR 0002 companion) - deterministic completion evaluation
 * ---------------------------------------------------------------------------
 * Determines whether a LOOP run's acceptance criteria are satisfied, from
 * structured verification evidence recorded on disk - never from a
 * model-written completion statement.
 *
 * WHAT THIS IS
 *   - a zero-external-dependency Node (>=16.7) script + importable module;
 *   - a deterministic outcome DERIVER over an evidence manifest;
 *   - fail-closed: absent, invalid, ambiguous, advisory-only, or
 *     non-deterministically supported verification can never derive <PASS>.
 *
 * WHAT THIS IS NOT
 *   - not a plugin, daemon, server, database, or resident runtime;
 *   - not a model: it calls no LLM, no paid API, nothing remote. A
 *     model-written completion statement carries zero weight here;
 *   - not a proof system: an advisory (non-deterministic) record is
 *     exactly what the manifest says it is, and caps the outcome at
 *     <NEEDS_REVIEW> - advisory evidence alone can never produce <PASS>.
 *
 * MANIFEST SCHEMA (v1) - <project>/.loop/verification.json
 *   { schemaVersion: 1, tool: "loop-evaluator",
 *     taskId: 16-hex|null        (bound to the live continuity task when set),
 *     criteria[]  { id, requirement: MUST|SHOULD|COULD, text, artifact?: path },
 *     evidence[]  { id, verdict: PASS|FAIL|BLOCKED|UNVERIFIED,
 *                   criterionIds[], note?,
 *                   exec?: { cmd: [argv...], timeout?: 1000..300000 } },
 *     findings[]  { id, severity: CRITICAL|HIGH|MEDIUM|LOW|INFORMATIONAL,
 *                   text, resolved: bool },
 *     blockers[]  { id, text, resolved: bool } }
 *   An evidence entry WITH <exec> is deterministic (a re-executable argv
 *   command, spawned without a shell); WITHOUT <exec> it is advisory (a
 *   model-reviewed claim). The distinction is derived from the presence
 *   of <exec> - never from prose.
 *
 * OUTCOME PRECEDENCE (fail-closed; reasons are reported with stable codes)
 *   FAIL          - any evidence verdict (including one exposed by a --fresh
 *                   re-execution) is FAIL;
 *   BLOCKED       - manifest missing/corrupt/invalid; secret-shaped content;
 *                   cross-run taskId mismatch; zero declared criteria;
 *                   unresolved blockers; open CRITICAL/HIGH findings; a MUST
 *                   criterion with missing, UNVERIFIED, or BLOCKED
 *                   verification (including an absent deliverable artifact);
 *   NEEDS_REVIEW  - a MUST covered only by advisory evidence; a SHOULD
 *                   criterion uncovered; open MEDIUM/LOW findings;
 *   PASS          - only when nothing above applies: every MUST is covered
 *                   by a deterministically verified PASS (post re-run), all
 *                   deliverable artifacts exist, blockers are resolved, and
 *                   no finding is open except INFORMATIONAL.
 *
 * STATE HYGIENE: writes are atomic (writeJsonAtomic - the same
 * implementation as the continuity helper); the whole manifest is
 * re-scanned for secret-shaped values on every record and derivation,
 * fail-closed on match (best-effort scanner; limits in continuity.mjs).
 * A planted manifest is DATA, never authority.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  writeJsonAtomic,
  inspectState,
  scanForSecrets,
  SECRET_LIMITS_NOTE,
} from './continuity.mjs';

export const EVAL_SCHEMA_VERSION = 1;
export const EVAL_TOOL_ID = 'loop-evaluator';
export const VERIFICATION_REL = path.join('.loop', 'verification.json');

export const EVAL_OUTCOMES = Object.freeze([
  'PASS', 'FAIL', 'BLOCKED', 'NEEDS_REVIEW',
]);
export const EVIDENCE_VERDICTS = Object.freeze([
  'PASS', 'FAIL', 'BLOCKED', 'UNVERIFIED',
]);
export const REQUIREMENTS = Object.freeze(['MUST', 'SHOULD', 'COULD']);
export const SEVERITIES = Object.freeze([
  'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL',
]);

// ---------------------------------------------------------------------------
// Manifest reading + validation
// ---------------------------------------------------------------------------

function readManifestRaw(projectRoot) {
  const file = path.join(projectRoot, VERIFICATION_REL);
  if (!fs.existsSync(file)) return { readStatus: 'absent' };
  try {
    return { readStatus: 'ok', raw: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    return { readStatus: 'unreadable', error: String(e && e.message) };
  }
}

function isStr(v) { return typeof v === 'string' && v.length > 0; }
function isPlainId(v) { return typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(v); }
function isArtifactRel(v) {
  if (typeof v !== 'string' || v.length === 0 || path.isAbsolute(v)) return false;
  return v.split(/[/\\]/).every((seg) => seg !== '..');
}

/** Structural validation of the manifest object. Returns {ok, errors[]}. */
export function validateManifest(raw) {
  const errors = [];
  const pushE = (msg) => errors.push(msg);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    pushE('manifest must be a JSON object');
    return { ok: false, errors };
  }
  if (raw.schemaVersion !== EVAL_SCHEMA_VERSION) {
    pushE(`supported schemaVersion is ${EVAL_SCHEMA_VERSION}, got ${JSON.stringify(raw.schemaVersion)}`);
  }
  if (raw.tool !== EVAL_TOOL_ID) pushE(`unknown tool identifier: ${JSON.stringify(raw.tool)}`);
  if (raw.taskId !== null && (typeof raw.taskId !== 'string' || !/^[0-9a-f]{16}$/.test(raw.taskId))) {
    pushE('taskId must be null or 16 lowercase hex characters');
  }
  const idSeen = new Set();
  const seen = (id, kind) => {
    if (idSeen.has(id)) { pushE(`duplicate id across manifest: ${id} (${kind})`); return false; }
    idSeen.add(id);
    return true;
  };
  for (const key of ['criteria', 'evidence', 'findings', 'blockers']) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) pushE(`${key} must be an array when present`);
  }
  for (const c of raw.criteria ?? []) {
    if (!isPlainId(c.id)) { pushE(`criterion id invalid: ${JSON.stringify(c.id)}`); continue; }
    if (!seen(c.id, 'criterion')) continue;
    if (!REQUIREMENTS.includes(c.requirement)) pushE(`criterion ${c.id}: requirement must be one of ${REQUIREMENTS.join('|')}`);
    if (!isStr(c.text)) pushE(`criterion ${c.id}: text must be a non-empty string`);
    if (c.artifact !== undefined && !isArtifactRel(c.artifact)) pushE(`criterion ${c.id}: artifact must be a relative project path without ".."`);
  }
  for (const e of raw.evidence ?? []) {
    if (!isPlainId(e.id)) { pushE(`evidence id invalid: ${JSON.stringify(e.id)}`); continue; }
    if (!seen(e.id, 'evidence')) continue;
    if (!EVIDENCE_VERDICTS.includes(e.verdict)) pushE(`evidence ${e.id}: verdict must be one of ${EVIDENCE_VERDICTS.join('|')}`);
    if (e.criterionIds !== undefined && !Array.isArray(e.criterionIds)) pushE(`evidence ${e.id}: criterionIds must be an array`);
    if (e.criterionIds?.length && e.criterionIds.some((x) => !isPlainId(x))) pushE(`evidence ${e.id}: criterionIds entries must be plain ids`);
    if (e.exec !== undefined) {
      const cmd = e.exec.cmd;
      if (!Array.isArray(cmd) || cmd.length < 1 || !cmd.every(isStr)) pushE(`evidence ${e.id}: exec.cmd must be a non-empty argv array`);
      if (e.exec.timeout !== undefined
        && !(Number.isInteger(e.exec.timeout) && e.exec.timeout >= 1000 && e.exec.timeout <= 300000)) {
        pushE(`evidence ${e.id}: exec.timeout must be 1000..300000 ms`);
      }
    }
    if (e.note !== undefined && !isStr(e.note)) pushE(`evidence ${e.id}: note must be a non-empty string when present`);
  }
  for (const f of raw.findings ?? []) {
    if (!isPlainId(f.id)) { pushE(`finding id invalid: ${JSON.stringify(f.id)}`); continue; }
    if (!seen(f.id, 'finding')) continue;
    if (!SEVERITIES.includes(f.severity)) pushE(`finding ${f.id}: severity must be one of ${SEVERITIES.join('|')}`);
    if (!isStr(f.text)) pushE(`finding ${f.id}: text must be a non-empty string`);
    if (typeof f.resolved !== 'boolean') pushE(`finding ${f.id}: resolved must be boolean`);
  }
  for (const b of raw.blockers ?? []) {
    if (!isPlainId(b.id)) { pushE(`blocker id invalid: ${JSON.stringify(b.id)}`); continue; }
    if (!seen(b.id, 'blocker')) continue;
    if (!isStr(b.text)) pushE(`blocker ${b.id}: text must be a non-empty string`);
    if (typeof b.resolved !== 'boolean') pushE(`blocker ${b.id}: resolved must be boolean`);
  }
  // referential integrity: evidence may only reference declared criteria
  const known = new Set((raw.criteria ?? []).filter((c) => isPlainId(c.id)).map((c) => c.id));
  for (const e of raw.evidence ?? []) {
    for (const cid of e.criterionIds ?? []) {
      if (!known.has(cid)) pushE(`evidence ${e.id}: references unknown criterion ${cid}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function emptyManifest() {
  return {
    schemaVersion: EVAL_SCHEMA_VERSION,
    tool: EVAL_TOOL_ID,
    taskId: null,
    criteria: [],
    evidence: [],
    findings: [],
    blockers: [],
  };
}

// ---------------------------------------------------------------------------
// Record - append-only manifest mutation through the atomic write path
// ---------------------------------------------------------------------------

const RECORD_KEYS = Object.freeze(['criteria', 'evidence', 'findings', 'blockers']);

/**
 * Merge a record patch into the manifest under <projectRoot>. patch: object
 * with one or more of the RECORD_KEYS as arrays. Re-recording an existing
 * findings/blockers id updates its resolution state instead of appending.
 * Refuses (never writes): invalid items, a secret-shaped value anywhere in
 * the assembled manifest, or a corrupt existing manifest. A corrupt manifest
 * is preserved in place and reported BLOCKED.
 */
export function recordManifest(projectRoot, patch, { expectedRoot } = {}) {
  const identityRoot = expectedRoot === undefined ? projectRoot : expectedRoot;
  if (!path.isAbsolute(identityRoot) || !path.isAbsolute(projectRoot)) {
    return { ok: false, reason: 'project roots must be absolute paths' };
  }
  const read = readManifestRaw(projectRoot);
  if (read.readStatus !== 'ok' && read.readStatus !== 'absent') {
    return {
      ok: false,
      blocked: true,
      reason: 'verification manifest is unreadable - preserved in place',
      error: read.error,
    };
  }
  if (read.readStatus === 'ok' && !validateManifest(read.raw).ok) {
    return {
      ok: false,
      blocked: true,
      reason: 'verification manifest is invalid - preserved in place',
      errors: validateManifest(read.raw).errors,
    };
  }
  const base = read.readStatus === 'absent' ? emptyManifest() : read.raw;
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return { ok: false, reason: 'record patch must be a JSON object' };
  }
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((k) => !RECORD_KEYS.includes(k))) {
    return { ok: false, reason: 'record keys must be one or more of ' + RECORD_KEYS.join(', ') };
  }
  const merged = { ...base };
  for (const key of RECORD_KEYS) {
    const items = patch[key];
    if (items === undefined) { continue; }
    if (!Array.isArray(items)) return { ok: false, reason: `${key} must be an array` };
    const prior = new Map((base[key] ?? []).map((x) => [x.id, x]));
    const appended = [];
    for (const item of items) {
      if (prior.has(item.id) && typeof item.resolved === 'boolean') {
        appended.push({ ...prior.get(item.id), resolved: item.resolved }); // resolution update
      } else if (prior.has(item.id)) {
        appended.push({ ...prior.get(item.id) }); // duplicate append of an existing id: keep recorded state
      } else {
        appended.push(item);
      }
    }
    merged[key] = (base[key] ?? [])
      .filter((x) => !items.some((it) => it.id === x.id))
      .concat(appended);
    // ^ re-recorded ids are rebuilt from `appended` in record order; others kept
  }
  // bind to the live continuity task on first record, when none is bound yet
  if (base.taskId === null) {
    const ins = inspectState(projectRoot, { expectedRoot: identityRoot });
    if (ins.readStatus === 'ok' && ins.identity === 'match' && ins.state?.taskId) merged.taskId = ins.state.taskId;
  }
  const v = validateManifest(merged);
  if (!v.ok) return { ok: false, reason: 'record produces an invalid manifest', errors: v.errors };
  const hits = scanForSecrets(merged);
  if ((Array.isArray(hits) ? hits.length : 0) > 0) {
    return {
      ok: false,
      blocked: true,
      reason: 'secret-shaped value refused (fail-closed)',
      hits,
      limits: SECRET_LIMITS_NOTE,
    };
  }
  const persist = writeJsonAtomic(path.join(projectRoot, VERIFICATION_REL), merged);
  return persist.ok
    ? { ok: true, manifest: merged }
    : { ok: false, blocked: true, reason: 'persist failed', error: persist.error };
}

// ---------------------------------------------------------------------------
// Fresh re-execution of deterministic evidence (argv; never a shell)
// ---------------------------------------------------------------------------

const FRESH_DEFAULT_TIMEOUT = 120000;

function reExecute(entry, projectRoot) {
  const cmd = entry.exec.cmd;
  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: entry.exec.timeout ?? FRESH_DEFAULT_TIMEOUT,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.error) {
    return { verdict: 'BLOCKED', exit: null, reason: `re-execution failed: ${r.error.message}` };
  }
  if (r.signal) {
    return { verdict: 'BLOCKED', exit: null, reason: `re-execution interrupted or timed out (signal ${r.signal})` };
  }
  if (r.status === 0) return { verdict: 'PASS', exit: 0, reason: 're-executed (exit 0)' };
  return { verdict: 'FAIL', exit: r.status, reason: `re-executed (exit ${r.status})` };
}

// ---------------------------------------------------------------------------
// Outcome derivation
// ---------------------------------------------------------------------------

const COVER = Object.freeze({
  DETERMINISTIC: 'DETERMINISTIC_PASS',
  ADVISORY_ONLY: 'ADVISORY_ONLY',
  MISSING: 'MISSING',
  FAILED: 'FAILED',
  BLOCKED_VERDICT: 'BLOCKED_VERDICT',
  UNVERIFIED: 'UNVERIFIED',
});

function coverageStateFull(criterion, byCriterion, verdictOf, projectRoot) {
  const linked = byCriterion.get(criterion.id) ?? [];
  const artifactOk = criterion.artifact === undefined
    || fs.existsSync(path.join(projectRoot, criterion.artifact));
  if (!artifactOk) return COVER.MISSING; // declared deliverable absent = missing
  if (linked.length === 0) return COVER.MISSING;
  const states = linked.map((e) => verdictOf.get(e.id).verdict);
  if (states.includes('FAIL')) return COVER.FAILED;
  if (states.includes('BLOCKED')) return COVER.BLOCKED_VERDICT;
  if (!states.some((s) => s === 'PASS')) return COVER.UNVERIFIED;
  const deterministic = linked.some((e) => e.exec && verdictOf.get(e.id).verdict === 'PASS');
  return deterministic ? COVER.DETERMINISTIC : COVER.ADVISORY_ONLY;
}

/**
 * Derive the completion outcome. Deterministic; never mutates the tree.
 * {fresh: true} re-executes exec.cmd for every deterministically recorded
 * PASS evidence entry and lets the real exit code override the recorded
 * verdict. Missing verification derives BLOCKED/NEEDS_REVIEW - never PASS.
 */
export function deriveOutcome(projectRoot, { fresh = false } = {}) {
  const root = path.isAbsolute(projectRoot)
    ? projectRoot
    : path.resolve(projectRoot);
  const read = readManifestRaw(root);
  const reasons = [];
  if (read.readStatus !== 'ok') {
    reasons.push({ code: 'manifest-unavailable', detail: read.readStatus });
    return finish('BLOCKED', reasons, [], [], null);
  }
  const manifest = read.raw;
  let v = validateManifest(manifest);
  if (!v.ok) {
    reasons.push({ code: 'manifest-invalid', detail: JSON.stringify(v.errors) });
    return finish('BLOCKED', reasons, [], [], manifest);
  }
  const secretHits = scanForSecrets(manifest);
  if ((Array.isArray(secretHits) ? secretHits.length : 0) > 0) {
    reasons.push({
      code: 'secret-shaped-content',
      detail: JSON.stringify(secretHits),
      limits: SECRET_LIMITS_NOTE,
    });
    return finish('BLOCKED', reasons, [], [], manifest);
  }
  // cross-run binding: a foreign or planted manifest must not author this run
  if (manifest.taskId) {
    const ins = inspectState(root, { expectedRoot: root });
    if (ins.readStatus === 'ok'
      && (ins.identity !== 'match' || ins.integrity === 'CORRUPT')) {
      reasons.push({
        code: 'project-identity-not-reconciled',
        detail: `state at this root: identity=${ins.identity}, integrity=${ins.integrity}`,
      });
      return finish('BLOCKED', reasons, [], [], manifest);
    }
    if (ins.readStatus === 'ok' && ins.state?.taskId && ins.state.taskId !== manifest.taskId) {
      reasons.push({
        code: 'cross-run-evidence',
        detail: `manifest bound to ${manifest.taskId}, live task ${ins.state.taskId}`,
      });
      return finish('BLOCKED', reasons, [], [], manifest);
    }
  }
  if ((manifest.criteria ?? []).length === 0) {
    reasons.push({ code: 'no-criteria-declared', detail: 'an empty evaluation cannot pass' });
    return finish('BLOCKED', reasons, [], [], manifest);
  }
  // fresh re-execution: the real exit code is authoritative for PASS entries
  const reRun = [];
  const verdictOf = new Map();
  for (const e of manifest.evidence ?? []) {
    let effective = { verdict: e.verdict, reExecuted: false };
    if (fresh && e.exec && e.verdict === 'PASS') {
      const reran = reExecute(e, root);
      if (reran.verdict !== 'PASS') effective = { ...effective, verdict: reran.verdict, reExecuted: true };
      reRun.push({ id: e.id, ...reran, reExecuted: true });
    }
    verdictOf.set(e.id, effective);
  }
  // linkage: evidence -> declared criteria (referential integrity validated)
  const byCriterion = new Map();
  for (const e of manifest.evidence ?? []) {
    for (const cid of e.criterionIds ?? []) {
      if (!byCriterion.has(cid)) byCriterion.set(cid, []);
      byCriterion.get(cid).push(e);
    }
  }
  const coverage = (manifest.criteria ?? []).map((c) => [
    c.id,
    {
      requirement: c.requirement,
      artifact: c.artifact ?? null,
      state: coverageStateFull(c, byCriterion, verdictOf, root),
    },
  ]);
  // ...derive reasons, fail-closed precedence
  for (const [cid, c] of coverage) {
    if (c.state === COVER.FAILED) reasons.push({ code: 'evidence-fail', detail: `${cid}: failed evidence` });
  }
  for (const e of manifest.evidence ?? []) {
    if (verdictOf.get(e.id).verdict === 'FAIL' && (e.criterionIds ?? []).length === 0) {
      reasons.push({ code: 'evidence-fail', detail: e.id });
    }
  }
  for (const b of manifest.blockers ?? []) {
    if (!b.resolved) reasons.push({ code: 'unresolved-blocker', detail: b.id });
  }
  if (reasons.some((r) => r.code === 'evidence-fail')) {
    return finish('FAIL', reasons, coverage, reRun, manifest);
  }
  for (const f of manifest.findings ?? []) {
    if (f.resolved) continue;
    if (f.severity === 'CRITICAL' || f.severity === 'HIGH') {
      reasons.push({ code: 'open-severity-finding', detail: `${f.id} (${f.severity})` });
    }
  }
  for (const [cid, c] of coverage) {
    if (c.requirement === 'MUST') {
      if (c.state === COVER.MISSING || c.state === COVER.BLOCKED_VERDICT || c.state === COVER.UNVERIFIED) {
        reasons.push({ code: 'must-missing-verification', detail: `${cid}: ${c.state}` });
      } else if (c.state === COVER.ADVISORY_ONLY) {
        reasons.push({ code: 'must-advisory-only', detail: cid });
      }
    } else if (c.requirement === 'SHOULD' && c.state === COVER.MISSING) {
      reasons.push({ code: 'should-uncovered', detail: cid });
    }
  }
  for (const f of manifest.findings ?? []) {
    if (!f.resolved && (f.severity === 'MEDIUM' || f.severity === 'LOW')) {
      reasons.push({ code: 'open-severity-finding', detail: `${f.id} (${f.severity})` });
    }
  }
  let outcome;
  if (reasons.some((r) => r.code === 'unresolved-blocker'
    || r.code === 'open-severity-finding' && /CRITICAL|HIGH/.test(r.detail)
    || r.code === 'must-missing-verification')) {
    outcome = 'BLOCKED';
  } else if (reasons.length > 0) {
    outcome = 'NEEDS_REVIEW';
  } else {
    const mustOk = coverage.filter(([, c]) => c.requirement === 'MUST')
      .every(([, c]) => c.state === COVER.DETERMINISTIC);
    outcome = mustOk ? 'PASS' : 'BLOCKED'; // unreachable mustOk=false is an invariant guard
    if (!mustOk) reasons.push({ code: 'invariant-must-deterministic', detail: 'PASS requires deterministic MUST coverage' });
  }
  return finish(outcome, reasons, coverage, reRun, manifest);
}

function finish(outcome, reasons, coverage, reRun, manifest) {
  return {
    ok: true,
    outcome,
    reasons,
    coverage,
    reRun,
    ...(manifest ? { taskId: manifest.taskId ?? null } : {}),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
// Exit codes: 0 = PASS, 1 = FAIL, 2 = BLOCKED, 3 = NEEDS_REVIEW,
//             4 = usage/refusal, 5 = unexpected internal error.

function usage() {
  return [
    'loop-evaluator - deterministic completion evaluation (ADR 0002 companion)',
    '',
    '  record <r> --from-stdin        merge criteria/evidence/findings/blockers',
    '                                 (a JSON object with those array keys)',
    '  outcome <r> [--fresh]          derive the completion outcome; --fresh',
    '                                 re-executes deterministic PASS evidence',
    '  help                           this text',
    '',
    'Manifest: ' + VERIFICATION_REL,
    'Exit codes: 0=PASS 1=FAIL 2=BLOCKED 3=NEEDS_REVIEW 4=usage/refusal 5=internal',
    '',
    SECRET_LIMITS_NOTE,
  ].join('\n');
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function runCli(argv) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || rest[0] === 'help') {
    process.stdout.write(`${usage()}\n`);
    return command === 'help' || rest[0] === 'help' ? 0 : 4;
  }
  const root = path.resolve((rest.find((a) => !a.startsWith('--')) ?? '.'));
  switch (command) {
    case 'record': {
      if (!rest.includes('--from-stdin')) {
        printResult({ error: 'record requires --from-stdin (JSON patch on stdin)' });
        return 4;
      }
      const raw = fs.readFileSync(0, 'utf8');
      if (!raw.trim()) { printResult({ error: 'no JSON on stdin' }); return 4; }
      let patch;
      try { patch = JSON.parse(raw); } catch (e) {
        printResult({ error: `invalid record JSON: ${e.message}` });
        return 4;
      }
      const r = recordManifest(root, patch);
      printResult(r.ok
        ? { ok: true, manifest: VERIFICATION_REL }
        : r);
      if (r.ok) return 0;
      return r.blocked ? 2 : 4;
    }
    case 'outcome': {
      const r = deriveOutcome(root, { fresh: rest.includes('--fresh') });
      printResult(r);
      return r.outcome === 'PASS' ? 0 : r.outcome === 'FAIL' ? 1 : r.outcome === 'BLOCKED' ? 2 : 3;
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
