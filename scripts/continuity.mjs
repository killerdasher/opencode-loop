#!/usr/bin/env node
/**
 * LOOP Continuity helper - deterministic state validation and persistence for
 * the loop-engine workflow (ADR 0002, docs/adr/0002-loop-continuity.md).
 *
 * WHAT THIS IS
 *   An optional, zero-external-dependency Node (>=16.7) helper. It provides:
 *     - state-file schema validation (versioned schema, allowlisted fields)
 *     - transition validation against the documented lifecycle table
 *     - project identity verification (with sanitized remote-URL fingerprints)
 *     - atomic persistence (temp file + rename, recoverable left-behind temps)
 *     - best-effort secret-shape scanning of everything it persists
 *
 * WHAT THIS IS NOT
 *   It is not a plugin, daemon, server, database, or resident runtime. It has
 *   no session hooks, registers no tools, intercepts no events, acquires no
 *   locks, and adds no dependency. The normal LOOP /loop workflow remains
 *   fully usable without this file; when continuity operations cannot reach a
 *   working helper they report BLOCKED instead of degrading silently.
 *
 * INTEGRITY MODEL (ADR 0002 amendment 2)
 *   Run status:   ACTIVE | PAUSED | RECOVERY_REQUIRED | BLOCKED | COMPLETED | CANCELLED
 *   Integrity:    VALID  | SUSPECTED_STALE | CORRUPT
 *   Corrupt or unsupported-schema state is NEVER silently overwritten,
 *   emptied, or deleted. It is inspected read-only; moving it aside is only
 *   ever an explicitly requested repair, byte-for-byte.
 *
 * CONCURRENCY HONESTY (ADR 0002 amendment 4)
 *   `generation` is bumped on every write so stale snapshots become
 *   detectable. It is NOT a lock and NOT a compare-and-swap: two writers may
 *   still race. One live run per project is an operational rule enforced by
 *   refusal at command level, not a technical guarantee.
 *
 * SECRET SCANNING - BEST-EFFORT, NEVER COMPLETE (ADR 0002 amendment 5)
 *   This scanner is pattern-based and fail-closed on match: anything that
 *   smells like a credential refuses the write. Its detection limits:
 *     - it cannot recognize secret formats it does not list;
 *     - it can be defeated by encoding, obfuscation, or substitution;
 *     - short fragments and placeholders under the minimum lengths it checks
 *       are not treated as secrets.
 *   Therefore a passing scan must NEVER be described as proof that the state
 *   file contains no sensitive data. It is best-effort friction, not
 *   complete protection.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 1;
export const TOOL_ID = 'loop-continuity';

export const STATUSES = Object.freeze([
  'ACTIVE',
  'PAUSED',
  'RECOVERY_REQUIRED',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED',
]);
export const TERMINAL_STATUSES = Object.freeze(['COMPLETED', 'CANCELLED']);
export const INTEGRITY_VALUES = Object.freeze(['VALID', 'SUSPECTED_STALE', 'CORRUPT']);

export const LIVE_STATE_REL = path.join('.loop', 'continuity.json');
export const ARCHIVE_DIR_REL = path.join('.loop', 'archive');

/** Documented lifecycle (ADR 0002 "Architecture"): event name -> from -> to. */
export const TRANSITIONS = Object.freeze({
  ACTIVE: Object.freeze({
    pause: 'PAUSED',
    block: 'BLOCKED',
    'recovery-flag': 'RECOVERY_REQUIRED',
    complete: 'COMPLETED',
    cancel: 'CANCELLED',
  }),
  PAUSED: Object.freeze({
    resume: 'ACTIVE',
    block: 'BLOCKED',
    'recovery-flag': 'RECOVERY_REQUIRED',
    cancel: 'CANCELLED',
  }),
  RECOVERY_REQUIRED: Object.freeze({
    'resolve-recovery': 'ACTIVE',
    cancel: 'CANCELLED',
  }),
  BLOCKED: Object.freeze({
    unblock: 'ACTIVE',
    cancel: 'CANCELLED',
  }),
  COMPLETED: Object.freeze({}),
  CANCELLED: Object.freeze({}),
});

/** Events that may be issued on a run with no live state file. */
export const ROOT_EVENTS = Object.freeze(['init']);

/** Where reasons recorded at cancel/complete/completion are kept. */
export const STOP_REASON_FIELD = 'stopReason';

// ---------------------------------------------------------------------------
// Secret-shape scanning (best-effort; see header - never "complete")
// ---------------------------------------------------------------------------

export const SECRET_LIMITS_NOTE =
  'Best-effort pattern scan: cannot recognize unlisted formats, defeated by ' +
  'encoding/obfuscation, ignores short fragments; a passing scan must never ' +
  'be described as proof of absence of secrets.';

const SECRET_PATTERNS = [
  { id: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'github-token', re: /ghp_[A-Za-z0-9]{36}/ },
  { id: 'github-fine-grained-token', re: /github_pat_[A-Za-z0-9_]{22,}/ },
  { id: 'openai-style-key', re: /\bsk-[A-Za-z0-9_-]{40,}/ },
  { id: 'anthropic-style-key', re: /\bsk-ant-[A-Za-z0-9_-]{40,}/ },
  { id: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/ },
  { id: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { id: 'url-userinfo', re: /[a-z][a-z0-9+.-]*:\/\/[^/\s:?#]*[^\s:/?#]:[^\s@/]+@/i },
  { id: 'jwt-shaped', re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  {
    id: 'labeled-credential',
    re:
      /\b(?:token|password|passwd|secret|api[_-]?key|access[_-]?key|auth(?:orization)?)\b["'`=\s]{0,4}["'`]?[A-Za-z0-9_/+=-]{16,}/i,
  },
];

/** Find secret-shaped matches in a string. Returns [{id, index}] or []. */
export function findSecrets(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const hits = [];
  for (const { id, re } of SECRET_PATTERNS) {
    const m = re.exec(text);
    if (m) hits.push({ id, index: m.index });
  }
  return hits;
}

/** Best-effort scan of a persistable object; returns hits or null (clean). */
export function scanForSecrets(content) {
  return findSecrets(JSON.stringify(content));
}

// ---------------------------------------------------------------------------
// Identity fingerprints (sanitized remote URLs - ADR 0002 amendment 5)
// ---------------------------------------------------------------------------

/**
 * Strip userinfo (user:pass@) from a remote URL before it is fingerprinted.
 * Returns {ok, sanitized} where sanitized contains scheme/host/port/path only,
 * or {ok:false} when the value is not a parseable remote URL.
 */
export function sanitizeRemoteUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return { ok: false, sanitized: null };
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, sanitized: null };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'ssh:') {
    return { ok: false, sanitized: null };
  }
  // The host may itself carry a user component for scp-like syntax; URL keeps
  // credentials in username/password, so re-serializing from components
  // guarantees they are dropped even when the password was URL-encoded.
  const zone = parsed.hostname.startsWith('[') ? `[${parsed.hostname.slice(1, -1)}]` : parsed.hostname;
  let out = `${parsed.protocol}//${zone}${parsed.port ? ':' + parsed.port : ''}${parsed.pathname}`;
  out = out.replace(/\/+$/, '');
  return { ok: true, sanitized: out };
}

/**
 * Compute the identity fingerprint for a project. Only the scheme/host/path
 * SHA-256 prefix is stored - never credentials, never the raw URL.
 */
export function fingerprint({ originUrl = null, root = '', name = '' } = {}) {
  let originFingerprint = null;
  if (originUrl) {
    const s = sanitizeRemoteUrl(originUrl);
    if (!s.ok) return { ok: false, originFingerprint: null };
    originFingerprint = createHash('sha256').update(s.sanitized).digest('hex').slice(0, 16);
  }
  return {
    ok: true,
    originFingerprint,
    root,
    name,
  };
}

export function taskIdFor(objective, startedAt) {
  return createHash('sha256').update(`${objective}\u0000${startedAt}`).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

/** Resolve a transition. Returns {ok, to} or {ok:false, error}. */
export function checkTransition(from, event) {
  if (from === null || from === 'ABSENT') {
    if (ROOT_EVENTS.includes(event)) return { ok: true, to: 'ACTIVE' };
    return { ok: false, error: `event "${event}" is not valid without existing state (use init)` };
  }
  if (!STATUSES.includes(from)) {
    return { ok: false, error: `unknown run status "${from}` };
  }
  const table = TRANSITIONS[from];
  const target = Object.prototype.hasOwnProperty.call(table, event) ? table[event] : undefined;
  if (!target) {
    return {
      ok: false,
      error: `transition ${from} --${event}--> ? is not documented in the lifecycle table`,
    };
  }
  return { ok: true, to: target };
}

// ---------------------------------------------------------------------------
// State construction and schema validation
// ---------------------------------------------------------------------------

export function createState({
  objective,
  settings = null,
  mode = 'balanced',
  maxIterations = 5,
  stage = 0,
  iteration = 1,
  requirements = { MUST: [], SHOULD: [], COULD: [] },
  project = {},
  createdBy = {},
  now = new Date().toISOString(),
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    tool: TOOL_ID,
    taskId: taskIdFor(String(objective), now),
    createdAt: now,
    updatedAt: now,
    generation: 1,
    project,
    status: 'ACTIVE',
    integrity: 'VALID',
    stage,
    iteration,
    maxIterations,
    mode,
    settings,
    objective: String(objective),
    requirements,
    iterations: [],
    recovery: null,
    stopReason: null,
    stoppingCondition: null,
    createdBy,
  };
}

/**
 * Validate a parsed state object against the versioned schema.
 * Returns {ok, errors, classification} where classification is one of:
 *   'valid' | 'unsupported-schema-version' | 'not-an-object' | 'invalid'.
 */
export function validateStateObject(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['state file is not a JSON object'], classification: 'not-an-object' };
  }
  const errors = [];
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      classification: 'unsupported-schema-version',
      errors: [`unsupported schemaVersion: ${JSON.stringify(raw.schemaVersion)} (this helper implements ${SCHEMA_VERSION})`],
    };
  }
  if (raw.tool !== TOOL_ID) errors.push(`unknown tool identifier: ${JSON.stringify(raw.tool)}`);
  // Task identity is a derivation invariant, not just a format: the taskId must
  // recompute from (objective, createdAt). A drifted or hand-edited ID means
  // the record's identity no longer matches its content - refuse as invalid
  // (inspectState classifies this as CORRUPT; mutations are refused; nothing
  // is overwritten).
  const derivedTaskId =
    typeof raw.objective === 'string' && raw.objective.length > 0
    && typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt))
      ? taskIdFor(raw.objective, raw.createdAt)
      : null;
  if (typeof raw.taskId !== 'string' || !/^[0-9a-f]{16}$/.test(raw.taskId)) {
    errors.push('taskId must be 16 lowercase hex characters');
  } else if (derivedTaskId !== null && raw.taskId !== derivedTaskId) {
    errors.push(`taskId does not match its derivation SHA-256(objective + createdAt): ${raw.taskId} => expected ${derivedTaskId}`);
  }
  for (const f of ['createdAt', 'updatedAt']) {
    if (typeof raw[f] !== 'string' || Number.isNaN(Date.parse(raw[f]))) {
      errors.push(`${f} must be an ISO timestamp string`);
    }
  }
  if (raw.generation !== Math.floor(raw.generation) || typeof raw.generation !== 'number' || raw.generation < 1) {
    errors.push('generation must be an integer >= 1');
  }
  if (!raw.project || typeof raw.project !== 'object' || Array.isArray(raw.project)) {
    errors.push('project must be an object {root, name, originFingerprint}');
  } else {
    if (typeof raw.project.root !== 'string' || raw.project.root === '') {
      errors.push('project.root must be a non-empty string');
    }
    if (raw.project.name !== undefined && typeof raw.project.name !== 'string') {
      errors.push('project.name must be a string when present');
    }
    if (raw.project.originFingerprint !== undefined
      && raw.project.originFingerprint !== null
      && !/^[0-9a-f]{16}$/.test(raw.project.originFingerprint)) {
      errors.push('project.originFingerprint must be a 16-character fingerprint hash or null');
    }
  }
  if (!STATUSES.includes(raw.status)) {
    errors.push(`status must be one of ${STATUSES.join(' | ')}`);
  }
  if (!INTEGRITY_VALUES.includes(raw.integrity)) {
    errors.push(`integrity must be one of ${INTEGRITY_VALUES.join(' | ')}`);
  }
  for (const f of ['stage', 'iteration', 'maxIterations']) {
    if (typeof raw[f] !== 'number') errors.push(`${f} must be a number`);
  }
  if (typeof raw.mode !== 'string') errors.push('mode must be a string');
  if (typeof raw.objective !== 'string' || raw.objective === '') {
    errors.push('objective must be a non-empty string');
  }
  if (raw.requirements !== undefined) {
    const req = raw.requirements;
    if (!req || typeof req !== 'object' || Array.isArray(req)) {
      errors.push('requirements must be an object {MUST, SHOULD, COULD}');
    } else {
      for (const label of ['MUST', 'SHOULD', 'COULD']) {
        if (req[label] !== undefined && !Array.isArray(req[label])) {
          errors.push(`requirements.${label} must be an array when present`);
        }
      }
    }
  }
  if (raw.iterations !== undefined) {
    if (!Array.isArray(raw.iterations)) {
      errors.push('iterations must be an array');
    } else {
      raw.iterations.forEach((it, i) => {
        if (!it || typeof it !== 'object') errors.push(`iterations[${i}] must be an object`);
      });
    }
  }
  if (raw.recovery !== undefined && raw.recovery !== null
    && (typeof raw.recovery !== 'object' || Array.isArray(raw.recovery))) {
    errors.push('recovery must be an object or null when present');
  }
  for (const f of ['stopReason', 'stoppingCondition', 'settings']) {
    if (raw[f] !== undefined && raw[f] !== null && typeof raw[f] !== 'string' && typeof raw[f] !== 'object') {
      errors.push(`${f} must be a string, object, or null when present`);
    }
  }
  return errors.length === 0
    ? { ok: true, errors: [], classification: 'valid' }
    : { ok: false, errors, classification: 'invalid' };
}

// ---------------------------------------------------------------------------
// Read-only inspection (never mutates the on-disk state file)
// ---------------------------------------------------------------------------

/** List recoverable left-behind temp files from interrupted atomic writes. */
export function listTemps(projectRoot) {
  const temps = [];
  for (const dirRel of [path.dirname(LIVE_STATE_REL), ARCHIVE_DIR_REL]) {
    const dir = path.join(projectRoot, dirRel);
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.includes('.tmp-')) temps.push(path.join(dir, name));
    }
  }
  return temps.sort();
}

/**
 * Read and classify `<projectRoot>/.loop/continuity.json` WITHOUT mutating it.
 * Returns {readStatus, integrity, identity, errors, temps, state}
 *   readStatus: 'ok' | 'missing' | 'unparseable' | 'unsupported-schema-version'
 *             | 'invalid' | 'not-an-object' | 'read-failed'
 *   integrity:  'VALID' | 'CORRUPT' | (stored value when valid)
 *   identity:   'unknown' | 'match' | 'mismatch'
 */
export function inspectState(projectRoot, { expectedRoot = null } = {}) {
  const liveFile = path.join(projectRoot, LIVE_STATE_REL);
  const temps = listTemps(projectRoot);
  let raw;
  try {
    raw = fs.readFileSync(liveFile, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { readStatus: 'missing', integrity: 'VALID', identity: expectedRoot ? 'unknown' : 'unknown', errors: [], temps, state: null };
    }
    return { readStatus: 'read-failed', integrity: 'CORRUPT', identity: 'unknown', errors: [String(err)], temps, state: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { readStatus: 'unparseable', integrity: 'CORRUPT', identity: 'unknown', errors: [String(err)], temps, state: null };
  }
  const v = validateStateObject(parsed);
  if (!v.ok) {
    return {
      readStatus: v.classification === 'not-an-object'
        ? 'not-an-object'
        : v.classification === 'unsupported-schema-version'
          ? 'unsupported-schema-version'
          : 'invalid',
      integrity: 'CORRUPT',
      identity: 'unknown',
      errors: v.errors,
      temps,
      state: v.classification === 'unsupported-schema-version' ? parsed : null,
    };
  }
  let identity = 'unknown';
  if (expectedRoot) {
    identity = pathsEqual(parsed.project.root, expectedRoot) ? 'match' : 'mismatch';
  }
  return {
    readStatus: 'ok',
    integrity: parsed.integrity,
    identity,
    errors: [],
    temps,
    state: parsed,
  };
}

function pathsEqual(a, b) {
  if (process.platform === 'win32') {
    return String(a).replace(/[\\/]+$/, '').toLowerCase() === String(b).replace(/[\\/]+$/, '').toLowerCase();
  }
  return String(a).replace(/[\\/]+$/, '') === String(b).replace(/[\\/]+$/, '');
}

// ---------------------------------------------------------------------------
// Atomic persistence (temp + fsync + rename; ADR 0002 amendment 6)
// ---------------------------------------------------------------------------

/**
 * Atomically write JSON: `<target>.tmp-<generation>` then rename over target.
 * On success no temp remains; if the process dies between write and rename the
 * temp file is left behind and is reported by listTemps()/inspectState().
 */
export function writeJsonAtomic(targetPath, data) {
  const hits = scanForSecrets(data);
  if (hits.length > 0) {
    return { ok: false, blocked: true, reason: 'secret-shaped content refused by best-effort scanner', hits: hits.map((h) => h.id) };
  }
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const generation = data && data.generation ? data.generation : 'unknown';
  const temp = `${targetPath}.tmp-${generation}-${randomBytes(4).toString('hex')}`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  const fd = fs.openSync(temp, 'w');
  try {
    fs.writeFileSync(fd, payload, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, targetPath);
  return { ok: true, temp };
}

/**
 * Remove left-behind temps that are provably superseded: parseable AND with a
 * generation strictly lower than the live state's generation. Anything else is
 * refused (it may hold unrecorded work). Never touches the live state file.
 */
export function repairTemps(projectRoot) {
  const live = inspectState(projectRoot);
  if (live.readStatus !== 'ok') {
    return { ok: false, reason: 'live state must be VALID before repair', readStatus: live.readStatus };
  }
  const liveGen = live.state.generation;
  const removed = [];
  const refused = [];
  for (const temp of live.temps) {
    try {
      const content = JSON.parse(fs.readFileSync(temp, 'utf8'));
      if (content && typeof content === 'object' && content.generation < liveGen) {
        fs.unlinkSync(temp);
        removed.push(path.basename(temp));
        continue;
      }
      refused.push(path.basename(temp));
    } catch {
      refused.push(path.basename(temp));
    }
  }
  return { ok: refused.length === 0, removed, refused, liveGeneration: liveGen };
}

/**
 * Persist the live state file (bumping generation). Refuses on secret-shaped
 * content. Caller must have validated the transition.
 */
export function persistState(projectRoot, state) {
  const next = { ...state, generation: state.generation, updatedAt: new Date().toISOString() };
  const result = writeJsonAtomic(path.join(projectRoot, LIVE_STATE_REL), next);
  return result.ok ? { ok: true, state: next } : result;
}

// ---------------------------------------------------------------------------
// Operations (used by CLI; also tested directly as the real module)
// ---------------------------------------------------------------------------

export function opInitialize(projectRoot, draft) {
  const liveFile = path.join(projectRoot, LIVE_STATE_REL);
  const existing = inspectState(projectRoot);
  if (existing.readStatus !== 'missing') {
    return {
      ok: false,
      blocked: existing.readStatus === 'unparseable' || existing.readStatus === 'unsupported-schema-version',
      reason: existing.readStatus === 'missing' ? 'impossible' : 'a live state file already exists; refusing to overwrite (see /loop-status or /loop-cancel)',
      readStatus: existing.readStatus,
      errors: existing.errors,
    };
  }
  const state = createState(draft);
  state.project = {
    ...state.project,
    root: state.project.root || projectRoot,
    name: state.project.name || path.basename(projectRoot),
  };
  if (draft.originUrl) {
    const fp = fingerprint({ originUrl: draft.originUrl });
    if (!fp.ok) {
      return { ok: false, reason: `cannot fingerprint origin-url: ${String(draft.originUrl)}` };
    }
    state.project.originFingerprint = fp.originFingerprint;
  }
  const written = persistState(projectRoot, state);
  return written.ok ? { ok: true, state: written.state, file: liveFile } : written;
}

/**
 * Apply a lifecycle event to a VALID live state. Refuses when the file is
 * corrupt/unsupported (BLOCKED class), when identity mismatches, or when the
 * transition is not documented in the table.
 */
export function opTransition(projectRoot, event, {
  reason = null,
  expectedRoot,
  stoppingCondition = null,
  now = new Date().toISOString(),
} = {}) {
  // Identity is mandatory for mutations: the default authority is the
  // projectRoot we were pointed at. Callers may narrow it, never widen.
  const identityRoot = expectedRoot === undefined ? projectRoot : expectedRoot;
  const inspect = inspectState(projectRoot, { expectedRoot: identityRoot });
  if (inspect.readStatus === 'missing') {
    return { ok: false, reason: 'no live state file; nothing to transition', blocked: false };
  }
  if (inspect.readStatus !== 'ok' || inspect.integrity === 'CORRUPT') {
    return {
      ok: false,
      blocked: true,
      readStatus: inspect.readStatus,
      reason: 'state file integrity is CORRUPT or unsupported; refusing to mutate (anything on disk is preserved)',
      errors: inspect.errors,
    };
  }
  const state = inspect.state;
  if (inspect.identity === 'mismatch') {
    return { ok: false, reason: `project identity mismatch: state belongs to "${state.project.root}"`, blocked: false };
  }
  const t = checkTransition(state.status, event);
  if (!t.ok) return { ok: false, reason: t.error, blocked: false };
  const next = { ...state, status: t.to };
  if (event === 'cancel' || event === 'complete') {
    next[STOP_REASON_FIELD] = reason;
    if (event === 'complete') next.stoppingCondition = stoppingCondition;
  }
  if (event === 'recovery-flag') {
    next.recovery = {
      ...(state.recovery || {}),
      reason,
      flaggedAt: now,
      integrity: 'SUSPECTED_STALE',
    };
  }
  if (event === 'resolve-recovery') {
    next.recovery = { ...(state.recovery || {}), resolvedAt: now };
  }
  next.generation = state.generation + 1;
  const persist = persistState(projectRoot, next);
  if (!persist.ok) return persist;
  const updated = persist.state;
  if (TERMINAL_STATUSES.includes(t.to)) {
    const archivePath = path.join(projectRoot, ARCHIVE_DIR_REL, `${updated.taskId}.json`);
    const archived = writeJsonAtomic(archivePath, updated);
    if (!archived.ok) return archived;
    try {
      fs.unlinkSync(path.join(projectRoot, LIVE_STATE_REL));
    } catch (err) {
      return { ok: false, reason: `archived but failed to remove live state: ${String(err)}`, blocked: false };
    }
    return { ok: true, archived: true, archivePath, state: updated };
  }
  return { ok: true, state: updated };
}

/** Merge operator-managed fields (stage/iteration/ledger) into a VALID state. */
export function opUpdate(projectRoot, patch, { expectedRoot } = {}) {
  const identityRoot = expectedRoot === undefined ? projectRoot : expectedRoot;
  const inspect = inspectState(projectRoot, { expectedRoot: identityRoot });
  if (inspect.readStatus !== 'ok') {
    return { ok: false, blocked: inspect.readStatus !== 'missing', readStatus: inspect.readStatus, errors: inspect.errors };
  }
  const allowlisted = {};
  for (const key of ['stage', 'iteration', 'maxIterations', 'mode', 'status', 'integrity', 'iterations', 'requirements', 'stoppingCondition', 'stopReason', 'settings']) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) allowlisted[key] = patch[key];
  }
  const merged = { ...inspect.state, ...allowlisted };
  const v = validateStateObject(merged);
  if (!v.ok) return { ok: false, reason: 'patch produces an invalid state', errors: v.errors };
  const persist = persistState(projectRoot, { ...merged, generation: inspect.state.generation + 1 });
  return persist.ok ? { ok: true, state: persist.state } : persist;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function helpText() {
  return [
    'Usage: node continuity.mjs <command> <projectRoot> [options]',
    '',
    'Commands:',
    '  inspect <r>                        read-only integrity/identity report (always safe)',
    '  init <r> --objective TEXT [--stage N] [--iterations N] [--mode M]',
    '        [--settings TEXT] [--session-id S] [--model M] [--origin-url U]',
    '        [--requirements-json J]      create an ACTIVE live run (refuses if one exists)',
    '  transition <r> --event EVENT [--reason TEXT] [--stopping-condition TEXT]',
    '        [--origin-url U]             pause|resume|block|unblock|recovery-flag|',
    '                                     resolve-recovery|cancel|complete',
    '  update <r> --patch-json J          merge operator fields into the live state',
    '  repair <r>                         delete provably superseded leftover temps',
    '  help                               this text',
    '',
    'Exit codes: 0 = ok, 1 = refused/error (e.g. invalid transition),',
    '            2 = BLOCKED (corrupt/unsupported state, integrity refusal), 3 = usage.',
    '',
    'Secret scanning is best-effort; see the file header. Never describes itself',
    'as complete protection.',
  ].join('\n');
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(argv[i]);
    }
  }
  return out;
}

function runCli(argv) {
  const [command, projectRoot, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }
  if (!projectRoot) {
    process.stderr.write('missing <projectRoot>\n');
    process.stdout.write(`${helpText()}\n`);
    return 3;
  }
  const root = path.resolve(projectRoot);
  const args = parseArgs(rest);
  const print = (obj) => process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);

  switch (command) {
    case 'inspect': {
      const r = inspectState(root, { expectedRoot: root });
      print(r);
      return r.readStatus === 'ok' || r.readStatus === 'missing' ? 0 : 2;
    }
    case 'init': {
      if (typeof args['objective'] !== 'string') { print({ error: 'init requires --objective' }); return 3; }
      let requirements;
      try {
        requirements = args['requirements-json'] ? JSON.parse(args['requirements-json']) : undefined;
      } catch (err) {
        print({ error: `invalid --requirements-json: ${String(err)}` });
        return 3;
      }
      const result = opInitialize(root, {
        objective: args['objective'],
        stage: args['stage'] ? Number(args['stage']) : 0,
        iteration: args['iteration'] ? Number(args['iteration']) : 1,
        maxIterations: args['iterations'] ? Number(args['iterations']) : 5,
        mode: typeof args['mode'] === 'string' ? args['mode'] : 'balanced',
        settings: typeof args['settings'] === 'string' ? args['settings'] : null,
        requirements: requirements || { MUST: [], SHOULD: [], COULD: [] },
        project: {},
        originUrl: typeof args['origin-url'] === 'string' ? args['origin-url'] : null,
        createdBy: {
          sessionId: typeof args['session-id'] === 'string' ? args['session-id'] : null,
          model: typeof args['model'] === 'string' ? args['model'] : null,
        },
      });
      return reportResult(result);
    }
    case 'transition': {
      const events = ['pause', 'resume', 'block', 'unblock', 'recovery-flag', 'resolve-recovery', 'cancel', 'complete'];
      if (!events.includes(args['event'])) { print({ error: `transition requires --event among: ${events.join(', ')}` }); return 3; }
      const result = opTransition(root, args['event'], {
        reason: typeof args['reason'] === 'string' ? args['reason'] : null,
        stoppingCondition: typeof args['stopping-condition'] === 'string' ? args['stopping-condition'] : null,
        expectedRoot: root,
      });
      return reportResult(result);
    }
    case 'update': {
      let patch;
      const raw = typeof args['patch-json'] === 'string'
        ? args['patch-json']
        : (typeof args['from-stdin'] !== 'undefined' ? fs.readFileSync(0, 'utf8') : null);
      if (raw === null) { print({ error: 'update requires --patch-json or --from-stdin' }); return 3; }
      try {
        patch = JSON.parse(raw);
      } catch (err) {
        print({ error: `invalid patch JSON: ${String(err)}` });
        return 3;
      }
      return reportResult(opUpdate(root, patch, { expectedRoot: root }));
    }
    case 'repair': {
      const r = repairTemps(root);
      print(r);
      return r.ok ? 0 : 2;
    }
    default:
      print({ error: `unknown command: ${command}` });
      return 3;
  }
}

function reportResult(result) {
  const printable = { ...result, file: undefined };
  delete printable.file;
  process.stdout.write(`${JSON.stringify(printTidy(printable), null, 2)}\n`);
  if (result.ok) return 0;
  return result.blocked ? 2 : 1;
}

/** Drop functions/undefined values that JSON.stringify would hide. */
function printTidy(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(printTidy);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = printTidy(v);
  }
  return out;
}

// CLI entry point only - library consumers import the functions above.
const invokedAsMain =
  process.argv[1] !== undefined
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedAsMain) {
  process.exit(runCli(process.argv.slice(2)));
}
