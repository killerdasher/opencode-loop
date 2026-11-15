#!/usr/bin/env node
/**
 * LOOP PROFILES (P5) - adaptive engineering methodology resolver
 * ---------------------------------------------------------------------------
 * Resolves the LOOP task profile from explicit user intent. Five profiles are
 * supported: BUILD, DEBUG, REFACTOR, AUDIT, MIGRATE - each backed by a
 * modular reference at .opencode/skills/loop-engine/references/profiles/.
 *
 * WHAT THIS IS
 *   - a deterministic resolver: name-in, profile + reference path out;
 *   - a scope-preserving flag stripper for the `--profile` argument.
 *
 * WHAT THIS IS NOT
 *   - not a router with path-dependent behavior; not a heuristic model. The
 *     profile never overrides the task: the task text passes through
 *     verbatim (only the --profile flag is removed, everything else is
 *     returned exactly as given);
 *   - not silent: an unknown profile is refused with the valid ones named -
 *     and the caller runs the generic loop, per the "unknown flags are
 *     never fatal" contract of /loop;
 *   - not authority: profiles adjust stage emphasis, verification, risk
 *     priorities, completion criteria, forbidden shortcuts, and expected
 *     evidence. They never remove stages and never weaken the hard safety
 *     rules of the LOOP engine; universal safeguards apply unchanged to
 *     every profile.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PROFILES = Object.freeze([
  'BUILD', 'DEBUG', 'REFACTOR', 'AUDIT', 'MIGRATE',
]);

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.opencode', 'skills', 'loop-engine');
const PROFILES_DIR = path.join(SKILL_DIR, 'references', 'profiles');
export const PROFILE_REFERENCE = Object.freeze({
  BUILD: path.join(PROFILES_DIR, 'build.md'),
  DEBUG: path.join(PROFILES_DIR, 'debug.md'),
  REFACTOR: path.join(PROFILES_DIR, 'refactor.md'),
  AUDIT: path.join(PROFILES_DIR, 'audit.md'),
  MIGRATE: path.join(PROFILES_DIR, 'migrate.md'),
});

/**
 * Resolve an explicit profile name. `auto` (or an absent name) resolves to
 * the generic_loop (no profile reference; emphasis comes from the task
 * itself). Names are case-insensitive; separators are tolerated. An unknown
 * or non-string name is REFUSED (never silently the default): the caller
 * then runs the generic loop and must state the correction.
 */
export function resolveProfile(rawName) {
  if (rawName === undefined || rawName === null || rawName === '') {
    return { ok: true, profile: 'GENERIC_LOOP', reference: null, inferred: false };
  }
  if (typeof rawName !== 'string') {
    return { ok: false, reason: 'profile must be a name like --profile audit', valid: PROFILES };
  }
  const normalized = rawName.trim().toUpperCase().replace(/[-_ ]+/g, '');
  if (normalized === 'AUTO' || normalized === 'DEFAULT' || normalized === 'GENERIC') {
    return { ok: true, profile: 'GENERIC_LOOP', reference: null, inferred: false };
  }
  const hit = PROFILES.find((p) => p === normalized);
  if (!hit) {
    return { ok: false, reason: `unknown task profile: ${JSON.stringify(rawName)}`, valid: PROFILES };
  }
  const reference = PROFILE_REFERENCE[hit];
  if (!fs.existsSync(reference)) {
    return { ok: false, reason: `profile reference missing on disk: ${hit}`, valid: PROFILES };
  }
  return { ok: true, profile: hit, reference, inferred: false };
}

/**
 * Strip the profile flag from task text, preserving the task scope verbatim:
 * `--profile <name>` (and only that flag) is removed; everything else -
 * other flags, whitespace, line breaks - is returned exactly as given.
 * Resolution contract:
 *   - the LAST --profile wins (deterministic, with a correction note);
 *   - `--profile` with no following value -> refuse with the valid list;
 *   - text without the flag -> { profile: null } - nothing was requested.
 */
export function stripProfileFlag(taskText) {
  if (typeof taskText !== 'string') return { ok: false, reason: 'task text must be a string' };
  const tokens = taskText.split(/(\s+)/); // keep whitespace tokens verbatim
  const hits = [];
  let correction = null;
  for (let i = 0; i < tokens.length; i++) {
    if (/^--profile$/i.test(tokens[i])) {
      // find the value across whitespace tokens
      let j = i + 1;
      while (j < tokens.length && /^\s+$/.test(tokens[j])) j++;
      if (j >= tokens.length || /^--/.test(tokens[j])) {
        return { ok: false, reason: '--profile requires a value', valid: PROFILES };
      }
      hits.push(tokens[j]);
      i = j; // continue scanning after the value (LAST occurrence wins)
      continue;
    }
  }
  if (hits.length === 0) return { ok: true, profile: null, taskText, corrections: [] };
  // remove exactly the consumed tokens, not reconstructed prose
  let idx = 0;
  const rebuilt = [];
  while (idx < tokens.length) {
    if (/^--profile$/i.test(tokens[idx])) {
      let j = idx + 1;
      while (j < tokens.length && /^\s+$/.test(tokens[j])) j++;
      idx = j + 1;
      continue;
    }
    rebuilt.push(tokens[idx]);
    idx++;
  }
  if (hits.length > 1) {
    correction = `multiple --profile flags; the last one wins: ${hits[hits.length - 1]}`;
  }
  const first = hits[hits.length - 1];
  return { ok: true, profile: first, taskText: rebuilt.join(''), corrections: correction ? [correction] : [] };
  // ^ `profile` is the requested raw name (resolution happens in resolveFromTask)
}

/**
 * Combined resolution used by /loop: strip the flag, resolve the profile,
 * preserve the task text. Unknown profiles never silently default; the full
 * task (minus only the --profile flag) is returned verbatim.
 */
export function resolveFromTask(taskText) {
  const stripped = stripProfileFlag(taskText);
  if (!stripped.ok) return stripped;
  if (stripped.profile === null) {
    return { ok: true, profile: 'GENERIC_LOOP', reference: null, taskText, corrections: stripped.corrections };
  }
  const resolved = resolveProfile(stripped.profile);
  if (!resolved.ok) return resolved;
  return { ...resolved, taskText: stripped.taskText, corrections: stripped.corrections };
}

function usage() {
  return [
    'loop-profiles - adaptive engineering methodology resolver (P5)',
    '',
    '  resolve <name>                 resolve an explicit profile (or: auto)',
    '                                 exit 0 = resolved, 4 = refused',
    '  strip --task TEXT              remove --profile <name>; task stays verbatim',
    '  help                           this text',
    '',
    'Profiles: ' + PROFILES.join(' | ') + ' (explicit intent only, never auto-inferred)',
    'Generic fallback: no --profile -> GENERIC_LOOP (plain nine-stage workflow)',
    '',
    'Profiles adjust emphasis only; the nine stages and the hard safety rules',
    'apply unchanged to every profile. Task scope is never overridden.',
  ].join('\n');
}

function runCli(argv) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || rest[0] === 'help') {
    process.stdout.write(`${usage()}\n`);
    return command === 'help' || rest[0] === 'help' ? 0 : 4;
  }
  switch (command) {
    case 'resolve': {
      const name = rest.find((a) => !a.startsWith('--'));
      const r = resolveProfile(name);
      process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
      return r.ok ? 0 : 4;
    }
    case 'strip': {
      const eq = rest.find((a) => a.startsWith('--task='));
      const iEq = eq ? rest.indexOf(eq) + 1 : -1;
      let text = eq ? eq.slice('--task='.length) : null;
      if (text === null) {
        const ti = rest.indexOf('--task');
        if (ti >= 0 && rest[ti + 1] !== undefined) text = rest[ti + 1];
      }
      if (text === null) { process.stdout.write(`${JSON.stringify({ error: 'strip requires --task TEXT' })}\n`); return 4; }
      const r = stripProfileFlag(text);
      process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
      return r.ok ? 0 : 4;
    }
    case 'task': {
      const ti = rest.indexOf('--task');
      const text = rest[ti + 1];
      if (text === undefined || ti < 0) { process.stdout.write(`${JSON.stringify({ error: 'task requires --task TEXT' })}\n`); return 4; }
      const r = resolveFromTask(text);
      process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
      return r.ok ? 0 : 4;
    }
    default:
      process.stdout.write(`${JSON.stringify({ error: `unknown command: ${command}` })}\n`);
      return 4;
  }
}

const IS_CLI_ENTRY = process.argv[1] !== undefined
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (IS_CLI_ENTRY) {
  process.exit(runCli(process.argv.slice(2)));
}
