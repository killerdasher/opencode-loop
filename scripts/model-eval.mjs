#!/usr/bin/env node
/**
 * LOOP MODEL-EVAL (P6) - model-independent capability evaluation framework
 * ---------------------------------------------------------------------------
 * Evaluates LOOP-compatible AI models on identical tasks and controlled
 * environments, and derives evidence-backed capability profiles from
 * *completed* evaluation records - never from marketing descriptions.
 *
 * WHAT THIS IS
 *   - a deterministic record-keeping + derivation framework (zero external
 *     dependencies, Node >= 16.7);
 *   - a version-pinned task set (tests/model-eval/taskset.v1.json, hashed
 *     into every record) so identical-task comparisons are reproducible;
 *   - fail-closed: records refuse unknown fields, secret-shaped content,
 *     and evidence-free claims; profiles require completed records.
 *
 * WHAT THIS IS NOT
 *   - not a model runner, provider client, or credential holder. It never
 *     calls a provider, never selects or switches providers, never touches
 *     network, and never stores credentials: only names the operator typed.
 *     Evaluation runs are operator-initiated with operator-supplied
 *     credentials (token-gated); the core project tests run offline on
 *     fixture records with no paid API;
 *   - not a ranking engine. `compare` emits per-dimension counts labeled
 *     "observed difference" - it contains no overall score, no winner.
 *     A single-number ranking of models is not derivable, by design;
 *   - not proof of quality: a profile states what was recorded, at what
 *     sample size, in which environment. Sample-size limits are explicit
 *     (dimensions below MIN_TASKS_PER_DIMENSION are INSUFFICIENT_SAMPLE,
 *     never scored).
 *
 * RECORD SCHEMA (v1) - one JSON file per evaluation run in a records dir
 *   { schemaVersion: 1, tool: "loop-model-eval",
 *     runId: 16-hex (derived: sha256(provider+model+taskSetHash+testedAt)),
 *     provider: string, modelId: string, testedAt: ISO,
 *     environment: { os, nodeVersion, harnessNote? } (exact, compared),
 *     taskSetVersion, taskSetHash: 16-hex,
 *     tasks: [{ id, dimension: <one of 8>, result: PASS|FAIL|PARTIAL,
 *               evidence?: project-relative path, notes? }],
 *     limitations: string   (required on complete - sample-size honesty),
 *     completed: bool }
 *   Provider/modelId are free-form names (no secrets scanned-in beyond the
 *   fail-closed scanner). Evidence paths are relative to the record dir and
 *   are DATA: the framework never asserts their existence (the operator
 *   inspectnes - matching the continuity evidence-path boundary).
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { scanForSecrets, SECRET_LIMITS_NOTE } from './continuity.mjs';

export const ME_SCHEMA_VERSION = 1;
export const ME_TOOL_ID = 'loop-model-eval';
export const MIN_TASKS_PER_DIMENSION = 3;

export const DIMENSIONS = Object.freeze([
  'instruction-adherence',
  'tool-calling',
  'coding-correctness',
  'context-management',
  'verification-accuracy',
  'security-reasoning',
  'recovery-behavior',
  'completion-evaluator-adherence',
]);
export const TASK_RESULTS = Object.freeze(['PASS', 'FAIL', 'PARTIAL']);
export const DEFAULT_TASKSET = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'tests', 'model-eval', 'taskset.v1.json',
);

const FILES = ['schemaVersion', 'tool', 'runId', 'provider', 'modelId', 'testedAt',
  'environment', 'taskSetVersion', 'taskSetHash', 'tasks', 'limitations', 'completed'];
const FILE_ALLOWED = new Set(FILES);

function sha16(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
function isHex16(v) { return typeof v === 'string' && /^[0-9a-f]{16}$/.test(v); }
function isRelPath(v) {
  return typeof v === 'string' && v.length > 0 && !path.isAbsolute(v)
    && v.split(/[/\\]/).every((seg) => seg !== '..');
}

/** Validate a record object; allowlist-strict. Returns {ok, errors[]}. */
export function validateRecord(raw) {
  const errors = [];
  const pushE = (msg) => errors.push(msg);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    pushE('record must be a JSON object');
    return { ok: false, errors };
  }
  for (const key of Object.keys(raw)) {
    if (!FILE_ALLOWED.has(key)) pushE(`unknown record field: ${key}`);
  }
  if (raw.schemaVersion !== ME_SCHEMA_VERSION) pushE(`supported schemaVersion is ${ME_SCHEMA_VERSION}`);
  if (raw.tool !== ME_TOOL_ID) pushE(`unknown tool identifier: ${JSON.stringify(raw.tool)}`);
  if (raw.runId !== undefined && !isHex16(raw.runId)) pushE('runId must be 16 lowercase hex chars');
  if (!isStr(raw.provider)) pushE('provider must be a non-empty string');
  if (!isStr(raw.modelId)) pushE('modelId must be a non-empty string');
  if (!isStr(raw.testedAt) || Number.isNaN(Date.parse(raw.testedAt))) pushE('testedAt must be an ISO timestamp');
  if (typeof raw.environment !== 'object' || raw.environment === null || Array.isArray(raw.environment)) {
    pushE('environment must be an object');
  } else {
    for (const key of Object.keys(raw.environment)) {
      if (!['os', 'nodeVersion', 'harnessNote'].includes(key)) pushE(`unknown environment field: ${key}`);
    }
    if (!isStr(raw.environment.os)) pushE('environment.os is required');
    if (!isStr(raw.environment.nodeVersion)) pushE('environment.nodeVersion is required');
  }
  if (!isStr(raw.taskSetVersion)) pushE('taskSetVersion must be a non-empty string');
  if (!isHex16(raw.taskSetHash)) pushE('taskSetHash must be 16 lowercase hex chars');
  if (!Array.isArray(raw.tasks)) pushE('tasks must be an array');
  else {
    const seen = new Set();
    for (const t of raw.tasks) {
      if (typeof t !== 'object' || t === null) { pushE('each task entry must be an object'); continue; }
      const idOk = typeof t.id === 'string' && t.id.length > 0;
      if (idOk && seen.has(t.id)) pushE(`duplicate task id: ${t.id}`);
      if (idOk) seen.add(t.id);
      if (!idOk) pushE('task id must be a non-empty string');
      if (!DIMENSIONS.includes(t.dimension)) pushE(`task ${t.id}: unknown dimension ${JSON.stringify(t.dimension)}`);
      if (!TASK_RESULTS.includes(t.result)) pushE(`task ${t.id}: result must be one of ${TASK_RESULTS.join('|')}`);
      if (t.evidence !== undefined && !isRelPath(t.evidence)) pushE(`task ${t.id}: evidence must be a relative path`);
      if (t.notes !== undefined && (typeof t.notes !== 'string' || t.notes.length === 0)) pushE(`task ${t.id}: notes must be a non-empty string when present`);
    }
  }
  if (raw.completed !== undefined && typeof raw.completed !== 'boolean') pushE('completed must be boolean');
  if (raw.limitations !== undefined && (!isStr(raw.limitations))) pushE('limitations must be a non-empty string when present');
  if (raw.completed === true && !isStr(raw.limitations)) pushE('completing a record requires recorded limitations (sample-size honesty)');
  return { ok: errors.length === 0, errors };
}
function isStr(v) { return typeof v === 'string' && v.length > 0; }

/** Load the pinned task set file. Returns {ok, version, hash, tasks} */
export function loadTaskSet(taskSetPath = DEFAULT_TASKSET) {
  if (!fs.existsSync(taskSetPath)) return { ok: false, reason: `task set not found: ${taskSetPath}` };
  let bytes;
  try { bytes = fs.readFileSync(taskSetPath); } catch (e) { return { ok: false, reason: `task set unreadable: ${e.message}` }; }
  let parsed; try { parsed = JSON.parse(bytes.toString('utf8')); } catch (e) { return { ok: false, reason: `task set is not JSON: ${e.message}` }; }
  const covered = new Set(DIMENSIONS);
  for (const t of parsed.tasks ?? []) {
    if (!covered.has(t.dimension)) return { ok: false, reason: `task set covers unknown dimension: ${t.dimension}` };
  }
  for (const dim of DIMENSIONS) {
    if (!(parsed.tasks ?? []).some((t) => t.dimension === dim)) {
      return { ok: false, reason: `task set does not cover dimension: ${dim}` };
    }
  }
  return {
    ok: true,
    version: parsed.taskSetVersion,
    hash: sha16(bytes.toString('utf8')),
    tasks: parsed.tasks,
    controlRules: parsed.controlRules ?? [],
  };
}

function recordPath(dir, runId) { return path.join(dir, `model-eval-${runId}.json`); }

/** Create a new evaluation record. provider/modelId are operator-typed names. */
export function initRecord(dir, { provider, modelId, testedAt, environment, taskSetPath }) {
  if (!isStr(provider) || !isStr(modelId)) return { ok: false, reason: 'provider and modelId are required' };
  if (typeof testedAt !== 'string' || Number.isNaN(Date.parse(testedAt))) return { ok: false, reason: 'testedAt must be an ISO timestamp' };
  const ts = loadTaskSet(taskSetPath);
  if (!ts.ok) return { ok: false, reason: ts.reason };
  const env = environment ?? { os: `${process.platform}`, nodeVersion: process.version };
  const runId = sha16(`${provider}\u0000${modelId}\u0000${ts.hash}\u0000${testedAt}`);
  const record = {
    schemaVersion: ME_SCHEMA_VERSION,
    tool: ME_TOOL_ID,
    runId,
    provider,
    modelId,
    testedAt,
    environment: env,
    taskSetVersion: ts.version,
    taskSetHash: ts.hash,
    tasks: [],
    completed: false,
  };
  const v = validateRecord(record);
  if (!v.ok) return { ok: false, reason: 'init produces an invalid record', errors: v.errors };
  const hits = scanForSecrets(record);
  if (Array.isArray(hits) && hits.length > 0) {
    return { ok: false, blocked: true, reason: 'secret-shaped value in record refused', hits: hits.map((h) => h.id), limits: SECRET_LIMITS_NOTE };
  }
  const target = recordPath(dir, runId);
  if (fs.existsSync(target)) {
    return { ok: false, reason: `record already exists: ${path.basename(target)} (deterministic runId - identical inputs collide; bump testedAt or inspect the existing record)` };
  }
  fs.mkdirSync(dir, { recursive: true });
  const payload = `${JSON.stringify(record, null, 2)}\n`;
  const tmp = `${target}.tmp-${randomBytes(4).toString('hex')}`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, payload, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, target);
  return { ok: true, runId, file: path.basename(target) };
}

/** Append/patch a task result into a record (--from-stdin object). */
export function addTaskResult(dir, runId, patch) {
  const file = recordPath(dir, runId);
  if (!fs.existsSync(file)) return { ok: false, reason: `no record ${runId} in ${dir}` };
  let record;
  try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    return { ok: false, blocked: true, reason: 'record unreadable - preserved in place', error: String(e && e.message) };
  }
  if (typeof patch !== 'object' || patch === null) return { ok: false, reason: 'result patch must be an object' };
  if (record.completed === true) {
    return {
      ok: false,
      blocked: true,
      reason: 'record is completed - completed records are immutable (capability profiles were derived from this record)',
    };
  }
  const { id, dimension, result, evidence, notes } = patch;
  if (typeof id !== 'string' || id.length === 0) return { ok: false, reason: 'id is required' };
  if (!DIMENSIONS.includes(dimension)) return { ok: false, reason: `unknown dimension: ${JSON.stringify(dimension)}` };
  if (!TASK_RESULTS.includes(result)) return { ok: false, reason: `result must be one of ${TASK_RESULTS.join('|')}` };
  if (evidence !== undefined && !isRelPath(evidence)) return { ok: false, reason: 'evidence must be a relative path' };
  const existing = record.tasks.findIndex((t) => t.id === id);
  const entry = { id, dimension, result };
  if (evidence !== undefined) entry.evidence = evidence;
  if (notes !== undefined) entry.notes = notes;
  if (existing >= 0) record.tasks[existing] = entry; // re-record = overwrite same id
  else record.tasks.push(entry);
  const v = validateRecord(record);
  if (!v.ok) return { ok: false, reason: 'patch produces an invalid record', errors: v.errors };
  const hits = scanForSecrets(record);
  if (Array.isArray(hits) && hits.length > 0) {
    return { ok: false, blocked: true, reason: 'secret-shaped value refused', hits: hits.map((h) => h.id), limits: SECRET_LIMITS_NOTE };
  }
  const payload = `${JSON.stringify(record, null, 2)}\n`;
  const tmp = `${file}.tmp-${randomBytes(4).toString('hex')}`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, payload, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  return { ok: true, tasks: record.tasks.length };
}

/**
 * Mark a record complete. Requires an explicit limitations statement -
 * sample-size honesty is part of the record, not a footnote.
 */
export function completeRecord(dir, runId, limitations) {
  const file = recordPath(dir, runId);
  if (!fs.existsSync(file)) return { ok: false, reason: `no record ${runId} in ${dir}` };
  let record;
  try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    return { ok: false, blocked: true, reason: 'record unreadable - preserved in place', error: String(e && e.message) };
  }
  if (!isStr(limitations)) return { ok: false, reason: 'limitations statement is required on completion' };
  if (record.completed === true) return { ok: false, reason: 'record already completed - completed records are immutable' };
  record.completed = true;
  record.limitations = limitations;
  const v = validateRecord(record);
  if (!v.ok) return { ok: false, reason: 'completed record invalid', errors: v.errors };
  const hits = scanForSecrets(record);
  if (Array.isArray(hits) && hits.length > 0) {
    return { ok: false, blocked: true, reason: 'secret-shaped value refused', hits: hits.map((h) => h.id), limits: SECRET_LIMITS_NOTE };
  }
  const payload = `${JSON.stringify(record, null, 2)}\n`;
  const tmp = `${file}.tmp-${randomBytes(4).toString('hex')}`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, payload, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  return { ok: true };
}

function readRecord(dir, runId) {
  const file = recordPath(dir, runId);
  if (!fs.existsSync(file)) return { readStatus: 'absent' };
  try { return { readStatus: 'ok', raw: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (e) { return { readStatus: 'unreadable', error: String(e && e.message) }; }
}

/**
 * Derive a capability profile from a COMPLETED record. Uncompleted records
 * derive nothing (BLOCKED): a half-run is data, not a capability profile.
 * Dimensions below MIN_TASKS_PER_DIMENSION are INSUFFICIENT_SAMPLE.
 */
export function deriveProfile(dir, runId) {
  const read = readRecord(dir, runId);
  if (read.readStatus !== 'ok') {
    return { ok: false, blocked: true, reason: `record ${read.readStatus === 'absent' ? 'absent' : read.readStatus}` };
  }
  const record = read.raw;
  const v = validateRecord(record);
  if (!v.ok) {
    return {
      ok: false,
      blocked: true,
      reason: 'record invalid - preserved in place',
      errors: v.errors,
    };
  }
  const hits = scanForSecrets(record);
  if (Array.isArray(hits) && hits.length > 0) {
    return { ok: false, blocked: true, reason: 'secret-shaped value refused', limits: SECRET_LIMITS_NOTE };
  }
  if (record.completed !== true) {
    return {
      ok: false,
      blocked: true,
      reason: 'record is not completed - capability profiles require a completed, limitations-carrying evaluation run',
      tasks: record.tasks.length,
    };
  }
  const dimensionStats = new Map();
  const insufficientSampleDimensions = [];
  for (const dim of DIMENSIONS) {
    const inDim = record.tasks.filter((t) => t.dimension === dim);
    const pass = inDim.filter((t) => t.result === 'PASS').length;
    const fail = inDim.filter((t) => t.result === 'FAIL').length;
    const partial = inDim.filter((t) => t.result === 'PARTIAL').length;
    const classification = inDim.length < MIN_TASKS_PER_DIMENSION ? 'INSUFFICIENT_SAMPLE' : 'EVIDENCED';
    if (classification === 'INSUFFICIENT_SAMPLE') insufficientSampleDimensions.push(dim);
    dimensionStats.set(dim, {
      tasks: inDim.length,
      pass,
      fail,
      partial,
      classification, // never a score: counts + a sample-size classification only
    });
  }
  const evidenceBacked = record.tasks.filter((t) => t.evidence !== undefined).length;
  return {
    ok: true,
    profile: {
      provider: record.provider,
      modelId: record.modelId,
      testedAt: record.testedAt,
      environment: record.environment,
      taskSet: { version: record.taskSetVersion, hash: record.taskSetHash },
      recordId: record.runId,
      dimensions: Object.fromEntries(dimensionStats),
      insufficientSampleDimensions,
      sampleSize: record.tasks.length,
      evidenceBacked,
      limitations: record.limitations,
      note: 'counts and sample-size classifications only; no score, no rank, no aggregate',
    },
  };
}

/**
 * Compare two completed records. Requires the SAME taskSetHash (identical
 * tasks - the precondition of any comparison) and records the environments;
 * differing environments are flagged, not hidden. There is no overall
 * ranking field anywhere in the output, by construction.
 */
export function compareRecords(dir, runIdA, runIdB) {
  const a = readRecord(dir, runIdA);
  const b = readRecord(dir, runIdB);
  if (a.readStatus !== 'ok' || b.readStatus !== 'ok') {
    return { ok: false, blocked: true, reason: `record missing: ${a.readStatus !== 'ok' ? runIdA : runIdB} (${a.readStatus !== 'ok' ? a.readStatus : b.readStatus})` };
  }
  const [A, B] = [a.raw, b.raw];
  for (const [rec, id] of [[A, runIdA], [B, runIdB]]) {
    if (rec.completed !== true) return { ok: false, blocked: true, reason: `record ${id} is not completed` };
    const v = validateRecord(rec);
    if (!v.ok) return { ok: false, blocked: true, reason: `record ${id} invalid` };
  }
  if (A.taskSetHash !== B.taskSetHash) {
    return {
      ok: false,
      blocked: true,
      reason: 'task sets differ - the runs did not execute identical tasks; comparison refused (never silent)',
      hashes: [A.taskSetHash, B.taskSetHash],
    };
  }
  const sameEnv = JSON.stringify(A.environment) === JSON.stringify(B.environment);
  const dimensions = DIMENSIONS.map((dim) => {
    const ca = A.tasks.filter((t) => t.dimension === dim);
    const cb = B.tasks.filter((t) => t.dimension === dim);
    const insufficient = ca.length < MIN_TASKS_PER_DIMENSION || cb.length < MIN_TASKS_PER_DIMENSION;
    return {
      dimension: dim,
      a: { pass: ca.filter((t) => t.result === 'PASS').length, fail: ca.filter((t) => t.result === 'FAIL').length, partial: ca.filter((t) => t.result === 'PARTIAL').length, tasks: ca.length },
      b: { pass: cb.filter((t) => t.result === 'PASS').length, fail: cb.filter((t) => t.result === 'FAIL').length, partial: cb.filter((t) => t.result === 'PARTIAL').length, tasks: cb.length },
      observedDifference: passDelta(ca, cb) ? 'counts differ' : 'same counts',
      sampleSize: insufficient ? `INSUFFICIENT_SAMPLE (below ${MIN_TASKS_PER_DIMENSION} tasks on at least one side)` : 'adequate',
    };
  });
  const anyInsufficient = (dim) => dim.sampleSize !== 'adequate';
  return {
    ok: true,
    comparison: {
      models: [{ provider: A.provider, modelId: A.modelId, runId: A.runId }, { provider: B.provider, modelId: B.modelId, runId: B.runId }],
      taskSet: { version: A.taskSetVersion, hash: A.taskSetHash },
      environmentEqual: sameEnv,
      environmentNote: sameEnv
        ? 'environments identical (as recorded)'
        : 'environments DIFFER (recorded values shown above the dimensions) - treat as directional, never as a controlled comparison',
      environments: [A.environment, B.environment],
      dimensions,
      allSampleSizes: dimensions.every((d) => !anyInsufficient(d)) ? 'adequate' : `some dimensions below ${MIN_TASKS_PER_DIMENSION} tasks per side - do not publish comparative claims on them`,
      limitations: [A.limitations, B.limitations],
      note: 'per-dimension observed counts only; no ranking, no winner, no aggregate score is derivable here',
    },
  };
}
function passDelta(ca, cb) {
  return ca.filter((t) => t.result === 'PASS').length !== cb.filter((t) => t.result === 'PASS').length;
}

// ---------------------------------------------------------------------------
// CLI: init | result | complete | profile | compare | taskset | help
// ---------------------------------------------------------------------------

function usage() {
  return [
    'loop-model-eval - model capability evaluation framework (P6)',
    '',
    '  init <dir> --provider P --model M --tested-at ISO [--taskset PATH]',
    '                                 creates record-<runId>.json (deterministic runId)',
    '  result <dir> --run-id R --from-stdin',
    '                                 append a task result (JSON: id, dimension,',
    '                                 result PASS|FAIL|PARTIAL, evidence?, notes?)',
    '  complete <dir> --run-id R --from-stdin',
    '                                 mark complete; stdin { "limitations": "..." }',
    '                                 is REQUIRED (sample-size honesty)',
    '  profile <dir> --run-id R       derive the capability profile (seconds:',
    '                                 exit 0 = profile, 2 = blocked/incomplete)',
    '  compare <dir> --run-ids A,B    observed per-dimension counts (NO ranking)',
    '  taskset [--path PATH]          print the pinned task set summary + hash',
    '  help                           this text',
    '',
    'Exit codes: 0 ok, 2 blocked, 4 usage/refusal, 5 internal.',
    'Credentials never appear in records or commands; runs are operator-gated.',
    '',
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
  const dir = positional[0] ?? '.';
  switch (command) {
    case 'init': {
      const r = initRecord(dir, {
        provider: optValue(rest, '--provider'),
        modelId: optValue(rest, '--model'),
        testedAt: optValue(rest, '--tested-at'),
        environment: (optValue(rest, '--os') || optValue(rest, '--node')) ? {
          os: optValue(rest, '--os') ?? `${process.platform}`,
          nodeVersion: optValue(rest, '--node') ?? process.version,
        } : undefined,
        taskSetPath: optValue(rest, '--taskset') ?? DEFAULT_TASKSET,
      });
      printResult(r.ok ? { ok: true, runId: r.runId, file: r.file } : r);
      return r.ok ? 0 : r.blocked ? 2 : 4;
    }
    case 'result': {
      if (!rest.includes('--from-stdin')) { printResult({ error: 'result requires --from-stdin' }); return 4; }
      const rid = optValue(rest, '--run-id');
      if (!rid) { printResult({ error: 'result requires --run-id' }); return 4; }
      let patch; try { patch = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (e) { printResult({ error: `invalid result JSON: ${e.message}` }); return 4; }
      const r = addTaskResult(dir, rid, patch);
      printResult(r.ok ? { ok: true, tasks: r.tasks } : r);
      return r.ok ? 0 : r.blocked ? 2 : 4;
    }
    case 'complete': {
      if (!rest.includes('--from-stdin')) { printResult({ error: 'complete requires --from-stdin ({ "limitations": "..." })' }); return 4; }
      const rid = optValue(rest, '--run-id');
      if (!rid) { printResult({ error: 'complete requires --run-id' }); return 4; }
      let patch; try { patch = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (e) { printResult({ error: `invalid complete JSON: ${e.message}` }); return 4; }
      const r = completeRecord(dir, rid, patch?.limitations);
      printResult(r.ok ? { ok: true } : r);
      return r.ok ? 0 : r.blocked ? 2 : 4;
    }
    case 'profile': {
      const rid = optValue(rest, '--run-id');
      if (!rid) { printResult({ error: 'profile requires --run-id' }); return 4; }
      const r = deriveProfile(dir, rid);
      printResult(r.ok ? r.profile : r);
      return r.ok ? 0 : 2;
    }
    case 'compare': {
      const ids = (optValue(rest, '--run-ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length !== 2) { printResult({ error: 'compare requires --run-ids A,B (exactly two)' }); return 4; }
      const r = compareRecords(dir, ids[0], ids[1]);
      printResult(r.ok ? r.comparison : r);
      return r.ok ? 0 : 2;
    }
    case 'taskset': {
      const r = loadTaskSet(optValue(rest, '--path') ?? DEFAULT_TASKSET);
      printResult(r.ok ? {
        ok: true, taskSetVersion: r.version, taskSetHash: r.hash,
        tasks: r.tasks.length, dimensions: DIMENSIONS, controlRules: r.controlRules,
      } : r);
      return r.ok ? 0 : 2;
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
