#!/usr/bin/env node
/**
 * LOOP behavioral evaluation runner (semi-automated harness).
 *
 * Builds an isolated fixture repository (tests/harness/fixtures.mjs), runs one
 * model session against it through the officially supported automation path
 * (`opencode run --format json`), collects observable evidence (transcript,
 * git diff, harness re-run of the fixture suite), and applies the objective
 * criteria in tests/harness/checks.mjs.
 *
 * Isolation model - what this harness isolates, and what it does NOT. Nothing
 * here is an operating-system sandbox; the full model lives in
 * tests/harness/README.md.
 *   - fixtures are built in temporary directories; the HARNESS itself only
 *     writes inside them (and the gitignored evidence directory)
 *   - LOOP is installed into the fixture only (project scope); the user's
 *     real OpenCode configuration is never a destination
 *   - session data goes to an isolated OPENCODE_DB file inside the evidence
 *     directory, via `opencode run --standalone` (non-standalone runs talk to
 *     the shared background server, whose database is the user's own - so the
 *     session isolation REQUIRES --standalone)
 *   - config directory NOT isolated: the user's global OpenCode config still
 *     merges into the run; the harness layers a least-privilege permission
 *     config on top through the documented OPENCODE_CONFIG tier
 *   - the evaluated AGENT is not sandboxed: under unattended auto-approval it
 *     can read files, run shell commands, and use the network like any
 *     process the user could run (minus what the least-privilege config and
 *     the scrubbed environment deny below). Unattended runs therefore require
 *     an explicit operator acknowledgement: pass --allow-auto.
 *
 * Usage:
 *   node tests/harness/run-case.mjs --case A --arm loop
 *   node tests/harness/run-case.mjs --case D --arm control --model provider/model
 *   node tests/harness/run-case.mjs --case A --build-only     (no model call)
 *
 * Exit codes: 0 PASS | 1 FAIL | 2 BLOCKED | 3 REVIEW | 4 harness error
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildFixture, hashUserFiles, runFixtureTest, removeFixture, findBash, commitFixturePaths, CASE_IDS } from './fixtures.mjs';
import { parseTranscript, collectDiffFiles, writeReports } from './transcript.mjs';
import { evaluate, STATUS } from './checks.mjs';
import { keeperEnv, writePermissionConfig, permissionRules, scrubSummary, ISOLATION_DOC } from './safety.mjs';

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HARNESS_DIR, '..', '..');
const IS_WINDOWS = process.platform === 'win32';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { case: null, arm: 'loop', model: null, keep: false, buildOnly: false,
    timeout: 900_000, evidence: null, list: false,
    allowAuto: false, envPass: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--case') opts.case = String(argv[++i] || '').toUpperCase();
    else if (a === '--arm') opts.arm = String(argv[++i] || '');
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--timeout') opts.timeout = Number(argv[++i]);
    else if (a === '--evidence') opts.evidence = argv[++i];
    else if (a === '--keep') opts.keep = true;
    else if (a === '--build-only') opts.buildOnly = true;
    else if (a === '--allow-auto') opts.allowAuto = true;
    else if (a === '--env-pass') {
      opts.envPass.push(...String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean));
    }
    else if (a === '--list') opts.list = true;
    else if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
    else { console.error(`Unknown option: ${a}`); printHelp(); process.exit(4); }
  }
  if (opts.list) { console.log(`Cases: ${CASE_IDS.join(', ')}`); process.exit(0); }
  if (!opts.case || !CASE_IDS.includes(opts.case)) {
    console.error(`--case must be one of ${CASE_IDS.join(', ')}`);
    process.exit(4);
  }
  if (!['loop', 'control'].includes(opts.arm)) {
    console.error("--arm must be 'loop' or 'control'");
    process.exit(4);
  }
  if (!Number.isFinite(opts.timeout) || opts.timeout <= 0) {
    console.error('--timeout must be a positive number of milliseconds');
    process.exit(4);
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node tests/harness/run-case.mjs --case <A-I> [--arm loop|control] [--model p/m] [--allow-auto] [--env-pass NAME,...] [--keep] [--timeout ms] [--evidence dir] [--build-only]

Safety contract:
  A model run (anything without --build-only) requires explicit operator
  acknowledgement: pass --allow-auto to enable OpenCode's unattended auto-
  approval. Without that flag the runner refuses to start. It is required
  because --auto approves every permission request OpenCode would otherwise
  prompt for, and no OS-level sandbox exists - see ${ISOLATION_DOC}.
  The runner always scrubs the child environment to an allowlist (credential
  variables are not inherited); --env-pass NAME,... forwards named extra
  variables (e.g. the provider key your setup authenticates with). Both arms
  receive identical permission rules and identical env scrubbing.`);
}

// ---------------------------------------------------------------------------
// Sub-process helpers
// ---------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    cwd: opts.cwd,
    env: opts.env || process.env,
    timeout: opts.timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return { status: -1, out: '', err: String(r.error.message) };
  return { status: r.status ?? -1, out: r.stdout || '', err: r.stderr || '' };
}

/** Install LOOP into the fixture (project scope) using the shipped installer. */
function installLoopIntoFixture(fixtureDir) {
  if (IS_WINDOWS) {
    const r = run('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(REPO_ROOT, 'scripts', 'install.ps1'),
      '-Scope', 'project', '-ProjectDir', fixtureDir,
    ], { timeout: 120_000 });
    return { ok: r.status === 0, out: `${r.out}${r.err}` };
  }
  const bash = findBash();
  if (!bash) return { ok: false, out: 'no working bash available to run scripts/install.sh' };
  const r = run(bash, [path.join(REPO_ROOT, 'scripts', 'install.sh'), '--project', fixtureDir], { timeout: 120_000 });
  return { ok: r.status === 0, out: `${r.out}${r.err}` };
}

// ---------------------------------------------------------------------------
// Git evidence: transcript.mjs (parseTranscript, collectDiffFiles, writeReports)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Operator acknowledgement gate: an unattended model run must never enable
  // unrestricted automatic permission approval silently. --build-only stays
  // free (no model call, no opencode invocation).
  if (!opts.buildOnly && !opts.allowAuto) {
    console.error(`[harness] REFUSING to start a model run without --allow-auto.`);
    console.error(`[harness] "opencode run --auto" approves every permission request that is not`);
    console.error(`[harness] explicitly denied, and no OS-level sandbox exists: an unattended agent`);
    console.error(`[harness] must only ever run over a disposable environment you have accepted`);
    console.error(`[harness] responsibility for. See ${ISOLATION_DOC}.`);
    console.error(`[harness] - acknowledge by passing --allow-auto, or use --build-only for the free,`);
    console.error(`[harness]   model-independent fixture checks.`);
    process.exit(4);
  }

  const date = new Date().toISOString();
  const stamp = date.replace(/[:.]/g, '-');
  const evidenceDir = opts.buildOnly
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'loop-buildonly-'))
    : opts.evidence
      ? path.resolve(opts.evidence)
      : path.join(REPO_ROOT, 'tests', 'harness', 'evidence', `${stamp}-case${opts.case}-${opts.arm}`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  // 1. Fixture -------------------------------------------------------------
  const fixture = buildFixture(opts.case, path.join(evidenceDir, 'fixture'));
  const userFilesBefore = hashUserFiles(fixture);
  console.log(`[harness] fixture built: ${fixture.dir}`);
  console.log(`[harness] task: ${fixture.task}`);

  // Seeded-state sanity: the fixture must be in its declared state first.
  const preTest = runFixtureTest(fixture);
  console.log(`[harness] pre-run suite: ${preTest.status}`);
  if (fixture.expectTestFailsBefore && preTest.status !== 'FAIL') {
    console.error(`[harness] ERROR: fixture ${fixture.caseId} declares a seeded failure but its suite is ${preTest.status}`);
    process.exit(4);
  }
  if (!fixture.expectTestFailsBefore && preTest.status === 'FAIL') {
    console.error(`[harness] ERROR: fixture ${fixture.caseId} should start green but its suite fails:\n${preTest.output}`);
    process.exit(4);
  }

  if (opts.buildOnly) {
    console.log(`[harness] build-only: task=${JSON.stringify(fixture.task)} allowlist=${JSON.stringify(fixture.allowlist)}`);
    removeFixture(fixture.dir);
    fs.rmSync(evidenceDir, { recursive: true, force: true });
    process.exit(0);
  }

  // 2. Arm setup -----------------------------------------------------------
  if (opts.arm === 'loop') {
    const inst = installLoopIntoFixture(fixture.dir);
    if (!inst.ok) {
      console.error(`[harness] ERROR: could not install LOOP into fixture:\n${inst.out}`);
      process.exit(4);
    }
    // Commit ONLY the harness's own install into the fixture baseline, so the
    // post-run diff reflects agent-authored changes alone. Never `add -A`:
    // Case D keeps deliberately uncommitted user work (config.json, notes.md).
    commitFixturePaths(fixture.dir, ['.opencode'], 'harness: install LOOP (project scope)');
    console.log('[harness] LOOP installed into fixture (project scope, committed to baseline)');
  }

  // Arm setup (install + baseline commit) must not touch user files. If it
  // did, the later userFilesBefore-vs-After comparison would blame the agent
  // for harness damage - so fail as a harness error before any model call.
  const userFilesBeforeArmed = hashUserFiles(fixture);
  const armTouchedUserFiles = Object.keys(userFilesBefore)
    .filter((rel) => userFilesBefore[rel] !== userFilesBeforeArmed[rel]);
  if (armTouchedUserFiles.length > 0) {
    console.error(`[harness] ERROR: arm setup modified user file(s): ${armTouchedUserFiles.join(', ')}`);
    process.exit(4);
  }

  // 3. Model run (official automation path) --------------------------------
  // Safety: unattended auto-approval is opt-in (--allow-auto, checked above)
  // and always paired with a least-privilege permission config and a scrubbed
  // child environment. Both arms receive the same treatment so A/B comparisons
  // stay fair.
  const permissionConfig = writePermissionConfig(evidenceDir);
  const { env: isolatedEnv, dropped: droppedEnv } = keeperEnv(process.env, opts.envPass);
  isolatedEnv.OPENCODE_DB = path.join(evidenceDir, 'session.sqlite');
  isolatedEnv.OPENCODE_CONFIG = permissionConfig;

  const message = opts.arm === 'loop' ? `/loop ${fixture.task}` : fixture.task;
  const args = ['run', '--standalone', '--format', 'json', '--auto', '--title', `loop-eval-${fixture.caseId}-${opts.arm}`];
  if (opts.model) args.push('--model', opts.model);
  args.push(message);

  const opencodeVersion = (run('opencode', ['--version']).out || '').trim() || 'unknown';
  const isolatedDb = isolatedEnv.OPENCODE_DB;
  console.log('[harness] unattended-run safety (both arms):');
  console.log(`[harness]   operator acknowledgement of unattended auto-approval: --allow-auto`);
  console.log(`[harness]   least-privilege permission config: ${permissionConfig}`);
  console.log(`[harness]     built-in denies: external_directory, webfetch, websearch, .env reads, curl/wget (NOT an OS sandbox - see ${ISOLATION_DOC})`);
  console.log(`[harness]   scrubbed environment (${scrubSummary(droppedEnv)})`);
  if (opts.envPass.length > 0) {
    console.log(`[harness]   operator-approved env forwarding (names only, operator-supplied): ${opts.envPass.join(', ')}`);
  }
  console.log(`[harness] running: opencode ${args.slice(0, -1).join(' ')} "<message>"`);
  const started = Date.now();
  const runResult = run('opencode', args, {
    cwd: fixture.dir,
    env: isolatedEnv,
    timeout: opts.timeout,
  });
  const elapsedMs = Date.now() - started;
  const ndjson = `${runResult.out}`;
  fs.writeFileSync(path.join(evidenceDir, 'transcript.ndjson'), ndjson, 'utf8');
  fs.writeFileSync(path.join(evidenceDir, 'run-stderr.log'), runResult.err, 'utf8');
  console.log(`[harness] run finished in ${(elapsedMs / 1000).toFixed(1)}s (exit ${runResult.status})`);

  const parsed = parseTranscript(ndjson);
  const runError = runResult.status === 0 && parsed.eventCount > 0
    ? null
    : `opencode run exit=${runResult.status}, events=${parsed.eventCount}, stderr=${runResult.err.slice(0, 300)}`;

  // 4. Post-run evidence ---------------------------------------------------
  const diffFiles = collectDiffFiles(fixture.dir);
  const userFilesAfter = hashUserFiles(fixture);
  let testOutcome = runFixtureTest(fixture);
  if (testOutcome.status === 'NOT_CONFIGURED' && fs.existsSync(path.join(fixture.dir, 'package.json'))) {
    const pkg = JSON.parse(fs.readFileSync(path.join(fixture.dir, 'package.json'), 'utf8'));
    if (pkg.scripts && pkg.scripts.test) {
      const r = run('npm', ['test', '--silent'], { cwd: fixture.dir, timeout: 300_000 });
      testOutcome = { status: r.status === 0 ? 'PASS' : 'FAIL', output: `${r.out}${r.err}`.slice(0, 4000) };
    }
  }

  const facts = {
    timeline: parsed.timeline,
    bashCommands: parsed.bashCommands,
    fileWrites: parsed.fileWrites,
    allText: parsed.allText,
    finalText: parsed.finalText,
    firstWriteIndex: parsed.firstWriteIndex,
    userFilesBefore,
    userFilesAfter,
    diffFiles,
    testOutcome,
    iterationBanners: parsed.iterationBanners,
    isLoopArm: opts.arm === 'loop',
    runError,
  };

  // 5. Evaluate ------------------------------------------------------------
  const { verdict, checks } = evaluate(fixture, facts);
  const payload = {
    case: fixture.caseId,
    arm: opts.arm,
    verdict,
    date,
    opencodeVersion,
    model: opts.model || 'session default',
    elapsedMs,
    sessionID: parsed.sessionID,
    fixtureDir: fixture.dir,
    skillLoadObserved: parsed.skillLoadObserved,
    unknownEventTypes: parsed.unknownEventTypes,
    runError,
    safety: {
      unattendedAutoApproval: Boolean(opts.allowAuto),
      permissionConfigPath: path.relative(REPO_ROOT, permissionConfig),
      permissionRules: permissionRules(),
      environmentScrubbed: true,
      // Counts only: the NAMES of dropped variables would disclose which
      // credentials exist on the machine - and the machine's env inventory
      // is not report content. Values are never carried anywhere at all.
      envNotInheritedCount: droppedEnv.length,
      envForwardedByOperator: [...opts.envPass],
    },
    checks,
    facts: { ...facts, timeline: undefined, allText: undefined, finalText: facts.finalText.slice(0, 8000) },
  };
  writeReports(evidenceDir, payload);

  // 6. Summary -------------------------------------------------------------
  console.log(`\n[harness] Case ${fixture.caseId} (${opts.arm} arm) -> ${verdict}`);
  for (const chk of checks) console.log(`  ${chk.status.padEnd(7)} ${chk.id} - ${chk.detail}`);
  console.log(`[harness] evidence: ${evidenceDir}`);
  if (parsed.unknownEventTypes.length > 0) {
    console.log(`[harness] note: unrecognized transcript event shapes: ${parsed.unknownEventTypes.join(', ')}`);
  }

  if (!opts.keep && verdict === STATUS.PASS) {
    removeFixture(fixture.dir);
  } else if (!opts.keep) {
    console.log('[harness] fixture kept for inspection (non-PASS verdict)');
  }

  const code = { [STATUS.PASS]: 0, [STATUS.FAIL]: 1, [STATUS.BLOCKED]: 2, [STATUS.REVIEW]: 3 }[verdict] ?? 4;
  process.exit(code);
}

try {
  main();
} catch (err) {
  console.error(`[harness] harness error: ${err && err.stack ? err.stack : err}`);
  process.exit(4);
}
