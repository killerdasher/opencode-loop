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
 * Safety guarantees:
 *   - fixtures live in temporary directories; nothing outside them is written
 *   - LOOP is installed into the fixture only (project scope) - the user's
 *     real OpenCode configuration is never modified
 *   - session data goes to an isolated OPENCODE_DB file inside the evidence
 *     directory, never the user's normal OpenCode database
 *   - no network access is required beyond the model call itself
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
import { parseTranscript, collectDiffFiles } from './transcript.mjs';
import { evaluate, STATUS } from './checks.mjs';

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HARNESS_DIR, '..', '..');
const IS_WINDOWS = process.platform === 'win32';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { case: null, arm: 'loop', model: null, keep: false, buildOnly: false,
    timeout: 900_000, evidence: null, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--case') opts.case = String(argv[++i] || '').toUpperCase();
    else if (a === '--arm') opts.arm = String(argv[++i] || '');
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--timeout') opts.timeout = Number(argv[++i]);
    else if (a === '--evidence') opts.evidence = argv[++i];
    else if (a === '--keep') opts.keep = true;
    else if (a === '--build-only') opts.buildOnly = true;
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
  console.log('Usage: node tests/harness/run-case.mjs --case <A-I> [--arm loop|control] [--model p/m] [--keep] [--timeout ms] [--evidence dir] [--build-only]');
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
// Git evidence: transcript.mjs (parseTranscript, collectDiffFiles)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Evidence reports
// ---------------------------------------------------------------------------

function writeReports(evidenceDir, payload) {
  fs.writeFileSync(path.join(evidenceDir, 'report.json'), JSON.stringify(payload, null, 2), 'utf8');
  const lines = [
    `# Behavioral run - Case ${payload.case} (${payload.arm} arm)`,
    '',
    `- Verdict: **${payload.verdict}**`,
    `- Date: ${payload.date}`,
    `- OpenCode: ${payload.opencodeVersion}`,
    `- Model: ${payload.model}`,
    `- Session: ${payload.sessionID || 'n/a'}`,
    `- Fixture: \`${payload.fixtureDir}\``,
    `- Commands observed: ${payload.facts.bashCommands.length}`,
    `- Files changed: ${payload.facts.diffFiles.length ? payload.facts.diffFiles.join(', ') : '(none)'}`,
    '',
    '| Criterion | Status | Detail |',
    '| --- | --- | --- |',
    ...payload.checks.map((chk) => `| ${chk.id} | ${chk.status} | ${String(chk.detail).replace(/\|/g, '\\|')} |`),
    '',
    '## Final report excerpt (first 2000 chars)',
    '',
    '```',
    payload.facts.finalText.slice(0, 2000),
    '```',
    '',
  ];
  fs.writeFileSync(path.join(evidenceDir, 'report.md'), lines.join('\n'), 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
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
  const message = opts.arm === 'loop' ? `/loop ${fixture.task}` : fixture.task;
  const args = ['run', '--standalone', '--format', 'json', '--auto', '--title', `loop-eval-${fixture.caseId}-${opts.arm}`];
  if (opts.model) args.push('--model', opts.model);
  args.push(message);

  const opencodeVersion = (run('opencode', ['--version']).out || '').trim() || 'unknown';
  const isolatedDb = path.join(evidenceDir, 'session.sqlite');
  console.log(`[harness] running: opencode ${args.slice(0, -1).join(' ')} "<message>"`);
  const started = Date.now();
  const runResult = run('opencode', args, {
    cwd: fixture.dir,
    env: { ...process.env, OPENCODE_DB: isolatedDb },
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
