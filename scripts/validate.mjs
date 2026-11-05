#!/usr/bin/env node
/**
 * LOOP repository validator - zero external dependencies.
 *
 * Modes:
 *   (default)        Structural and content validation of this repository.
 *   --self-test      Proves the validator detects deliberately broken copies
 *                    (runs validation against mutated temporary copies).
 *   --install-test   Runs install.ps1 and install.sh against temporary
 *                    directories only - never the real OpenCode config.
 *   --all            Runs every mode.
 *
 * Exit codes: 0 = all checks passed, 1 = at least one failure.
 *
 * Output lines: PASS / FAIL / SKIP with a check id and optional detail.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');
const isWindows = process.platform === 'win32';

const REQUIRED_FILES = [
  '.opencode/commands/loop.md',
  '.opencode/skills/loop-engine/SKILL.md',
  '.opencode/skills/loop-engine/references/quality-gates.md',
  '.opencode/skills/loop-engine/references/risk-analysis.md',
  '.opencode/skills/loop-engine/references/evaluation-cases.md',
  'scripts/install.ps1',
  'scripts/install.sh',
  'scripts/validate.mjs',
  'scripts/continuity.mjs',
  'tests/evaluation.md',
  'tests/comparison.md',
  'tests/harness/README.md',
  'tests/harness/fixtures.mjs',
  'tests/harness/transcript.mjs',
  'tests/harness/checks.mjs',
  'tests/harness/run-case.mjs',
  'tests/harness/safety.mjs',
  'tests/harness/selftest.mjs',
  'docs/architecture.md',
  'docs/design-principles.md',
  'docs/adr/0001-runtime-orchestration.md',
  '.github/workflows/validate.yml',
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CHANGELOG.md',
  'LICENSE',
  '.gitignore',
];

const REQUIRED_SKILL_REFERENCES = [
  'quality-gates.md',
  'risk-analysis.md',
  'evaluation-cases.md',
];

const SECRET_PATTERNS = [
  { id: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'github-token', re: /ghp_[A-Za-z0-9]{36}/ },
  { id: 'github-fine-grained-token', re: /github_pat_[A-Za-z0-9_]{22,}/ },
  { id: 'openai-style-key', re: /\bsk-[A-Za-z0-9]{40,}/ },
  { id: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/ },
  { id: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Case-exact path existence, used to catch case mismatches that Windows would
 * hide but Linux/macOS installs would break on.
 *
 * Only segments inside `trustedRoot` are compared exactly: environment-supplied
 * paths (temp directories, drive letters, junctions) may spell a directory
 * differently from its on-disk entry on case-insensitive filesystems, and that
 * is not a repository defect. Paths outside the trusted root fall back to plain
 * existence checks.
 */
function existsExactCase(target, trustedRoot) {
  const t = path.resolve(target);
  const r = path.resolve(trustedRoot);
  if (t === r) return fs.existsSync(r);
  const rel = path.relative(r, t);
  const inside = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  if (!inside) return fs.existsSync(t);
  if (!fs.existsSync(r)) return false;
  let current = r;
  for (const segment of rel.split(path.sep)) {
    let entries;
    try {
      entries = fs.readdirSync(current);
    } catch {
      return false;
    }
    if (!entries.includes(segment)) return false;
    current = path.join(current, segment);
  }
  return true;
}

/** Recursive file list, excluding .git and local evaluation evidence. */
function walkFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Evidence is transient local output of behavioral runs (gitignored):
      // it is not repository content and must never fail repository checks
      // (a transcript could contain arbitrary model output).
      if (path.basename(dir) === 'harness' && entry.name === 'evidence') continue;
      walkFiles(full, out);
    } else out.push(full);
  }
  return out;
}

/** Parse flat YAML frontmatter. Returns {ok, data, body} or {ok:false, error}. */
function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== '---') return { ok: false, error: 'missing opening ---' };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return { ok: false, error: 'missing closing ---' };
  const data = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (/^\s/.test(line) || line.trim() === '') continue; // nested blocks: not needed for these checks
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) data[m[1]] = m[2];
  }
  return { ok: true, data, body: lines.slice(end + 1).join('\n') };
}

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

/** Extract local markdown link targets from a document. */
function localLinkTargets(text) {
  const targets = [];
  const re = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let t = m[1].replace(/^<|>$/g, '');
    if (/^(https?:|mailto:|#)/i.test(t)) continue;
    t = t.split('#')[0];
    if (t) targets.push(t);
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

function validateRepo(root) {
  const res = [];
  const push = (id, ok, detail = '') => res.push({ id, ok, detail });

  // -- Required files -------------------------------------------------------
  for (const rel of REQUIRED_FILES) {
    const full = path.join(root, rel);
    const ok = existsExactCase(full, root);
    push(`structure:${rel}`, ok, ok ? rel : `missing: ${rel}`);
  }

  // Behavioral-run evidence is local, gitignored output: it must never be
  // committable by accident (transcripts may contain model output).
  const gitignore = readIfExists(path.join(root, '.gitignore'));
  const ignoresEvidence = gitignore !== null && gitignore.includes('tests/harness/evidence/');
  push(
    'structure:gitignore-evidence',
    ignoresEvidence,
    ignoresEvidence ? 'tests/harness/evidence/ ignored' : '.gitignore must exclude tests/harness/evidence/',
  );

  // -- Behavioral runner safety contract ------------------------------------
  // The runner must require explicit operator acknowledgement before enabling
  // unattended auto-approval, must deliver a least-privilege permission config
  // through the documented OPENCODE_CONFIG tier, and must scrub the child
  // environment. The precise rule values are unit-tested in selftest.mjs;
  // this is the anti-regression tripwire for the mechanism existing at all.
  const runnerText = readIfExists(path.join(root, 'tests/harness/run-case.mjs'));
  const safetyText = readIfExists(path.join(root, 'tests/harness/safety.mjs'));
  // The gate needs BOTH halves: the acknowledgement flag and the actual
  // assignment that delivers the permission config through
  // OPENCODE_CONFIG (a comment mention alone cannot count).
  push(
    'harness:allow-auto-gate',
    runnerText !== null
      && runnerText.includes('--allow-auto')
      && /.OPENCODE_CONFIG\s*=/.test(runnerText),
    runnerText === null
      ? 'run-case.mjs unreadable'
      : 'model runs gate on --allow-auto acknowledgement + OPENCODE_CONFIG least-privilege config',
  );
  push(
    'harness:scrubs-environment',
    safetyText !== null && /ENV_KEEP\s*=\s*new Set/.test(safetyText) && /function keeperEnv/.test(safetyText),
    safetyText === null ? 'safety.mjs unreadable' : 'keeperEnv allowlist present in safety.mjs',
  );
  const harnessReadme = readIfExists(path.join(root, 'tests/harness/README.md'));
  const taxonomy = harnessReadme !== null && /no operating-system sandbox/i.test(harnessReadme);
  push(
    'docs:harness-isolation-taxonomy',
    taxonomy,
    taxonomy ? 'harness README states no OS sandbox exists' : 'tests/harness/README.md must state "no operating-system sandbox" (isolation honesty)',
  );
  const securityText = readIfExists(path.join(root, 'SECURITY.md'));
  const harnessInScope = securityText !== null && /behavioral harness/i.test(securityText);
  push(
    'security:harness-in-scope',
    harnessInScope,
    harnessInScope ? 'SECURITY.md covers the behavioral harness' : 'SECURITY.md must cover the behavioral runner',
  );

  // -- Command --------------------------------------------------------------
  const commandPath = path.join(root, '.opencode/commands/loop.md');
  const commandText = readIfExists(commandPath);
  if (commandText === null) {
    push('command:frontmatter', false, 'loop.md unreadable');
  } else {
    const fm = parseFrontmatter(commandText);
    push('command:frontmatter', fm.ok, fm.ok ? 'valid' : fm.error);
    if (fm.ok) {
      push('command:description', Boolean(fm.data.description), fm.data.description ? 'present' : 'missing description:');
      const forced = ['agent', 'model'].filter((k) => k in fm.data);
      push(
        'command:default-agent',
        forced.length === 0,
        forced.length === 0 ? 'no agent/model override' : `must not force agent/model: ${forced.join(', ')}`,
      );
      push(
        'command:arguments',
        commandText.includes('$ARGUMENTS'),
        commandText.includes('$ARGUMENTS') ? 'literal $ARGUMENTS present' : 'missing $ARGUMENTS placeholder',
      );
      const invokes =
        commandText.includes('loop-engine') && /skill/i.test(commandText) && /load/i.test(commandText);
      push(
        'command:skill-invocation',
        invokes,
        invokes ? 'instructs loading the loop-engine skill' : 'missing explicit loop-engine skill invocation',
      );
    }
  }

  // -- Skill ----------------------------------------------------------------
  const skillPath = path.join(root, '.opencode/skills/loop-engine/SKILL.md');
  const skillText = readIfExists(skillPath);
  if (skillText === null) {
    push('skill:frontmatter', false, 'SKILL.md unreadable');
  } else {
    const fm = parseFrontmatter(skillText);
    push('skill:frontmatter', fm.ok, fm.ok ? 'valid' : fm.error);
    if (fm.ok) {
      const dirName = path.basename(path.dirname(skillPath));
      const name = fm.data.name ?? '';
      push('skill:name', name === dirName, `name="${name}" dir="${dirName}"`);
      const nameFormat = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) && name.length >= 1 && name.length <= 64;
      push('skill:name-format', nameFormat, nameFormat ? 'valid identifier' : `invalid skill name: "${name}"`);
      const desc = fm.data.description ?? '';
      const descOk = desc.length >= 1 && desc.length <= 1024;
      push('skill:description', descOk, descOk ? `length ${desc.length}` : `description length ${desc.length} outside 1-1024`);
      const missingStages = [];
      for (let n = 0; n <= 8; n++) {
        if (!new RegExp(`^## STAGE ${n} `, 'm').test(fm.body)) missingStages.push(n);
      }
      push(
        'skill:stages',
        missingStages.length === 0,
        missingStages.length === 0 ? 'STAGE 0-8 present' : `missing stage headings: ${missingStages.join(', ')}`,
      );
      const refTokens = [...new Set(fm.body.match(/references\/[A-Za-z0-9._-]+\.md/g) ?? [])];
      const missingRefs = refTokens.filter((t) => !existsExactCase(path.join(path.dirname(skillPath), t), root));
      const requiredMissing = REQUIRED_SKILL_REFERENCES.filter(
        (f) => !existsExactCase(path.join(path.dirname(skillPath), 'references', f), root),
      );
      const refsOk = missingRefs.length === 0 && requiredMissing.length === 0;
      push(
        'skill:references-exist',
        refsOk,
        refsOk
          ? `${refTokens.length} referenced file(s) resolve`
          : `broken: ${[...missingRefs, ...requiredMissing].join(', ')}`,
      );
    }
  }

  // -- Reference documents ---------------------------------------------------
  for (const name of REQUIRED_SKILL_REFERENCES) {
    const full = path.join(root, '.opencode/skills/loop-engine/references', name);
    const text = readIfExists(full);
    const ok = text !== null && text.trim().length > 0;
    push(`reference:${name}`, ok, ok ? 'present and non-empty' : 'missing or empty');
  }

  // -- Reporting contract (F5) ---------------------------------------------
  // The banner and settings restatement are the visible contract of every
  // LOOP run; the status vocabulary is the honesty contract. Deleting any of
  // them from the engine must fail validation.
  if (skillText !== null) {
    const hasBanner = skillText.includes('LOOP | ITERATION');
    push('skill:reporting-banner', hasBanner, hasBanner ? 'LOOP | ITERATION banner format present' : 'SKILL.md missing LOOP | ITERATION banner format');
    const hasSettings = skillText.includes('SETTINGS:');
    push('skill:settings-restatement', hasSettings, hasSettings ? 'SETTINGS: restatement present' : 'SKILL.md missing SETTINGS: restatement');
  } else {
    push('skill:reporting-banner', false, 'SKILL.md unreadable');
    push('skill:settings-restatement', false, 'SKILL.md unreadable');
  }

  const gates = readIfExists(path.join(root, '.opencode/skills/loop-engine/references/quality-gates.md'));
  if (gates === null) {
    push('reporting:status-vocabulary', false, 'quality-gates.md unreadable');
  } else {
    const labels = ['VERIFIED', 'IMPLEMENTED BUT NOT VERIFIED', 'BLOCKED', 'NOT APPLICABLE', 'FAILED'];
    const missing = labels.filter((l) => !gates.includes(l));
    push(
      'reporting:status-vocabulary',
      missing.length === 0,
      missing.length === 0 ? 'all 5 status labels defined' : `missing labels: ${missing.join(', ')}`,
    );
  }

  // -- Relative markdown links (case-exact) ----------------------------------
  for (const file of walkFiles(root).filter((f) => f.endsWith('.md'))) {
    const text = readIfExists(file);
    if (text === null) continue;
    const broken = [];
    for (const target of localLinkTargets(text)) {
      const resolved = path.resolve(path.dirname(file), target);
      if (!existsExactCase(resolved, root)) broken.push(target);
    }
    const rel = path.relative(root, file).split(path.sep).join('/');
    push(`links:${rel}`, broken.length === 0, broken.length === 0 ? 'all local links resolve' : `broken: ${broken.join(', ')}`);
  }

  // -- Installers ------------------------------------------------------------
  const ps1 = readIfExists(path.join(root, 'scripts/install.ps1'));
  if (ps1 === null) {
    push('installer:ps1:content', false, 'install.ps1 missing');
  } else {
    const markers = [
      ['overwrite guard', /-Overwrite/],
      ['backup behavior', /backup/i],
      ['xdg destination', /XDG_CONFIG_HOME/],
      ['uninstall support', /Uninstall/],
      ['dry-run support', /DryRun/],
      ['command artifact', /loop\.md/],
      ['skill artifact', /loop-engine/],
      ['continuity helper copy', /continuity\.mjs/],
      ['project scope', /'project'/],
    ];
    const missing = markers.filter(([, re]) => !re.test(ps1)).map(([label]) => label);
    push('installer:ps1:content', missing.length === 0, missing.length === 0 ? 'all behavior markers present' : `missing: ${missing.join(', ')}`);
  }

  const sh = readIfExists(path.join(root, 'scripts/install.sh'));
  if (sh === null) {
    push('installer:sh:content', false, 'install.sh missing');
  } else {
    const markers = [
      ['shebang', /^#!\/usr\/bin\/env bash/m],
      ['strict mode', /set -euo pipefail/],
      ['overwrite guard', /--overwrite/],
      ['backup behavior', /backup/i],
      ['xdg destination', /XDG_CONFIG_HOME/],
      ['uninstall support', /--uninstall/],
      ['dry-run support', /--dry-run/],
      ['command artifact', /loop\.md/],
      ['skill artifact', /loop-engine/],
      ['continuity helper copy', /continuity\.mjs/],
      ['project scope', /--project/],
    ];
    const missing = markers.filter(([, re]) => !re.test(sh)).map(([label]) => label);
    push('installer:sh:content', missing.length === 0, missing.length === 0 ? 'all behavior markers present' : `missing: ${missing.join(', ')}`);
  }

  // -- Continuity helper (ADR 0002) -----------------------------------------
  // Deterministic helper tier. The file must stay offline (no network calls),
  // dependency-free (only node: builtins), and must carry the honest status
  // vocabulary plus the best-effort secret-scan limitation language.
  const continuity = readIfExists(path.join(root, 'scripts/continuity.mjs'));
  const pushContinuity = (id, ok, detail = '') => push(`continuity:${id}`, ok, detail);
  if (continuity === null) {
    pushContinuity('file-content', false, 'scripts/continuity.mjs missing');
  } else {
    const nonBuiltin = [...continuity.matchAll(/^\s*(?:import\s.+?from\s+|const\s.+?=\s*require\()\s*['"]([^'"]+)['"]/gm)]
      .map((m) => m[1]).filter((spec) => !spec.startsWith('node:') && !spec.startsWith('.'));
    pushContinuity('zero-dep', nonBuiltin.length === 0,
      nonBuiltin.length === 0 ? 'all imports are node: builtins or relative' : `non-builtin imports: ${nonBuiltin.join(', ')}`);
    const networkCalls = /[^.\w\u0170](?:fetch\s*\(|got\s*\(|axios|node-fetch|https?\.request|net\.connect)/.test(continuity);
    pushContinuity('no-network', !networkCalls, networkCalls ? 'looks like a network call' : 'no network primitives');
    const vocab = ['ACTIVE', 'PAUSED', 'RECOVERY_REQUIRED', 'BLOCKED', 'COMPLETED', 'CANCELLED',
      'VALID', 'SUSPECTED_STALE', 'CORRUPT'];
    const missingVocab = vocab.filter((s) => !continuity.includes(s));
    pushContinuity('status-vocabulary', missingVocab.length === 0,
      missingVocab.length === 0 ? 'run + integrity vocabulary present' : `missing: ${missingVocab.join(', ')}`);
    const honestLimits = /best-effort/i.test(continuity) && /never\s+be\s+described\s+as\s+(complete|proof)/i.test(continuity)
      && /best-effort, never complete/i.test(continuity);
    pushContinuity('limits-documented', honestLimits, honestLimits ? 'best-effort limitation language present' : 'secret-scan limitation language missing');
  }

  for (const r of syntaxChecks(root)) res.push(r);

  // -- CI --------------------------------------------------------------------
  const workflow = readIfExists(path.join(root, '.github/workflows/validate.yml'));
  push(
    'ci:workflow',
    workflow !== null && workflow.includes('validate.mjs'),
    workflow !== null && workflow.includes('validate.mjs') ? 'runs validate.mjs' : 'workflow missing or does not run validate.mjs',
  );
  const runsHarnessSelftest = workflow !== null && workflow.includes('tests/harness/selftest.mjs');
  push(
    'ci:harness-selftest',
    runsHarnessSelftest,
    runsHarnessSelftest ? 'runs free harness self-test' : 'workflow must run node tests/harness/selftest.mjs (free, no model calls)',
  );

  // -- Documentation ---------------------------------------------------------
  const readme = readIfExists(path.join(root, 'README.md'));
  if (readme === null) {
    push('docs:readme', false, 'README.md missing');
  } else {
    const needed = ['/loop', 'loop-engine', 'scripts/install.ps1', 'scripts/install.sh'];
    const missing = needed.filter((s) => !readme.includes(s));
    push('docs:readme', missing.length === 0, missing.length === 0 ? 'documents command, skill, installers' : `missing mentions: ${missing.join(', ')}`);
  }

  const changelog = readIfExists(path.join(root, 'CHANGELOG.md'));
  push('docs:changelog', changelog !== null && /0\.1\.0/.test(changelog), changelog !== null && /0\.1\.0/.test(changelog) ? 'version 0.1.0 present' : 'CHANGELOG missing 0.1.0');
  // F4: the changelog must document the CURRENT version, not just the first
  // release. "Current" = any semver heading beyond 0.1.0 (the initial
  // release); newest-first ordering is also enforced (Keep a Changelog).
  if (changelog === null) {
    push('docs:changelog-current-version', false, 'CHANGELOG missing');
  } else {
    const versions = [...changelog.matchAll(/^## \[(\d+)\.(\d+)\.(\d+)\]/gm)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    const newerThanFirst = versions.filter((v) => !(v[0] === 0 && v[1] === 1 && v[2] === 0));
    const ordered = versions.every((v, i) => i === 0 || (() => {
      const p = versions[i - 1];
      return v[0] < p[0] || (v[0] === p[0] && (v[1] < p[1] || (v[1] === p[1] && v[2] <= p[2])));
    })());
    const ok = newerThanFirst.length > 0 && ordered;
    push(
      'docs:changelog-current-version',
      ok,
      ok
        ? `${newerThanFirst.length} version(s) beyond 0.1.0, newest first`
        : newerThanFirst.length === 0
          ? 'no version beyond 0.1.0 documented (current version missing)'
          : 'version headings are not newest-first',
    );
  }

  const license = readIfExists(path.join(root, 'LICENSE'));
  push('docs:license', license !== null && /MIT/i.test(license), license !== null && /MIT/i.test(license) ? 'MIT license present' : 'LICENSE missing or not MIT');

  const evaluation = readIfExists(path.join(root, 'tests/evaluation.md'));
  if (evaluation === null) {
    push('tests:evaluation-cases', false, 'tests/evaluation.md missing');
  } else {
    const missing = 'ABCDEFGHI'.split('').filter((c) => !new RegExp(`Case ${c}\\b`).test(evaluation));
    push('tests:evaluation-cases', missing.length === 0, missing.length === 0 ? 'Cases A-I present' : `missing cases: ${missing.join(', ')}`);
  }

  // -- F3: evaluation framework alignment ------------------------------------
  // tests/evaluation.md (after-the-fact rubric) and the skill's
  // evaluation-cases.md (in-session guidance) both claim they "must stay
  // aligned"; this check makes that claim enforceable.
  const rubric = readIfExists(path.join(root, '.opencode/skills/loop-engine/references/evaluation-cases.md'));
  if (evaluation === null || rubric === null) {
    push('tests:evaluation-alignment', false, 'tests/evaluation.md or evaluation-cases.md missing');
  } else {
    const caseIds = (t) => new Set([...t.matchAll(/^## Case ([A-I])\b/gm)].map((m) => m[1]));
    const rubricIds = caseIds(evaluation);
    const guideIds = caseIds(rubric);
    const rubricOnly = [...rubricIds].filter((c) => !guideIds.has(c)).sort();
    const guideOnly = [...guideIds].filter((c) => !rubricIds.has(c)).sort();
    const complete = rubricIds.size === 9 && guideIds.size === 9;
    const ok = rubricOnly.length === 0 && guideOnly.length === 0 && complete;
    push(
      'tests:evaluation-alignment',
      ok,
      ok
        ? `both documents cover Cases ${[...rubricIds].sort().join('')}`
        : `drift: evaluation.md only=[${rubricOnly.join('')}] evaluation-cases.md only=[${guideOnly.join('')}] counts=${rubricIds.size}/${guideIds.size} (need 9/9)`,
    );
  }

  // -- Secrets ---------------------------------------------------------------
  for (const r of secretScan(root)) res.push(r);

  return res;
}

/** Optional syntax checks: run only when a working runtime is discoverable. */
function syntaxChecks(root) {
  const out = [];

  const bash = findBash();
  const shPath = path.join(root, 'scripts/install.sh');
  if (fs.existsSync(shPath)) {
    if (bash) {
      const r = spawnSync(bash, ['-n', shPath], { encoding: 'utf8' });
      out.push({ id: 'installer:sh:syntax', ok: r.status === 0, detail: r.status === 0 ? `bash -n passed (${bash})` : `bash -n failed: ${(r.stderr || '').trim()}` });
    } else {
      out.push({ id: 'installer:sh:syntax', ok: true, skipped: true, detail: 'no working bash runtime found; syntax check skipped' });
    }
  }

  const ps = findPowerShell();
  const ps1Path = path.join(root, 'scripts/install.ps1');
  if (fs.existsSync(ps1Path)) {
    if (ps) {
      const r = runPowerShellParse(ps, ps1Path);
      out.push({ id: 'installer:ps1:syntax', ok: r.status === 0, detail: r.status === 0 ? `PowerShell parse passed (${ps})` : `parse failed: ${(r.stdout || r.stderr || '').trim()}` });
    } else {
      out.push({ id: 'installer:ps1:syntax', ok: true, skipped: true, detail: 'no PowerShell runtime found; syntax check skipped' });
    }
  }

  return out;
}

function runPowerShellParse(exe, scriptPath) {
  const escaped = scriptPath.replace(/'/g, "''");
  const command = `$errs=$null; $tok=$null; [System.Management.Automation.Language.Parser]::ParseFile('${escaped}',[ref]$tok,[ref]$errs) | Out-Null; if ($errs.Count -gt 0) { Write-Output $errs[0].Message; exit 1 } else { exit 0 }`;
  const args = ['-NoProfile', '-Command', command];
  return spawnSync(exe, args, { encoding: 'utf8' });
}

/** Find a bash that actually executes (the Windows WSL stub fails this test). */
function findBash() {
  const candidates = ['bash'];
  if (isWindows) {
    candidates.push('C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe');
  }
  for (const candidate of candidates) {
    const r = spawnSync(candidate, ['-c', 'echo LOOP_BASH_OK'], { encoding: 'utf8', shell: false });
    if (r.status === 0 && (r.stdout || '').includes('LOOP_BASH_OK')) return candidate;
  }
  return null;
}

function findPowerShell() {
  for (const candidate of ['pwsh', 'powershell']) {
    const r = spawnSync(candidate, ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8', shell: false });
    if (r.status === 0) return candidate;
  }
  return null;
}

function secretScan(root) {
  const findings = [];
  for (const file of walkFiles(root)) {
    const stat = fs.statSync(file);
    if (stat.size > 1024 * 1024) continue;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue; // binary
    for (const { id, re } of SECRET_PATTERNS) {
      if (re.test(text)) {
        findings.push(`${id} in ${path.relative(root, file).split(path.sep).join('/')}`);
      }
    }
  }
  const ok = findings.length === 0;
  return [{ id: 'security:secrets', ok, detail: ok ? 'no secret patterns found' : findings.join('; ') }];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printResults(results) {
  let failed = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.skipped) {
      skipped++;
      console.log(`SKIP  ${r.id} - ${r.detail}`);
    } else if (r.ok) {
      console.log(`PASS  ${r.id}${r.detail ? ` - ${r.detail}` : ''}`);
    } else {
      failed++;
      console.log(`FAIL  ${r.id}${r.detail ? ` - ${r.detail}` : ''}`);
    }
  }
  const passed = results.length - failed - skipped;
  console.log(`\nSummary: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  return failed;
}

// ---------------------------------------------------------------------------
// Self-test: the validator must catch broken copies
// ---------------------------------------------------------------------------

function copyRepoToTemp(root, baseTmp) {
  const dest = fs.mkdtempSync(path.join(baseTmp, 'selftest-'));
  fs.cpSync(root, dest, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      if (base === '.git') return false;
      // Never copy behavioral evidence: transient local output, not content.
      const rel = path.relative(root, src).split(path.sep).join('/');
      return !rel.startsWith('tests/harness/evidence');
    },
  });
  return dest;
}

function runSelfTest(root) {
  const baseTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-selftest-'));
  const mutations = [
    {
      id: 'command:$ARGUMENTS removed',
      expect: 'command:arguments',
      file: '.opencode/commands/loop.md',
      apply: (t) => t.replace('$ARGUMENTS', 'THE_TASK'),
    },
    {
      id: 'skill name not directory-matching',
      expect: 'skill:name',
      file: '.opencode/skills/loop-engine/SKILL.md',
      apply: (t) => t.replace('name: loop-engine', 'name: LOOP Engineering Engine'),
    },
    {
      id: 'skill name has invalid characters',
      expect: 'skill:name-format',
      file: '.opencode/skills/loop-engine/SKILL.md',
      apply: (t) => t.replace('name: loop-engine', 'name: loop_engine'),
    },
    {
      id: 'command forces a non-default agent',
      expect: 'command:default-agent',
      file: '.opencode/commands/loop.md',
      apply: (t) => t.replace('---\n', '---\nagent: plan\n'),
    },
    {
      id: 'command frontmatter unclosed',
      expect: 'command:frontmatter',
      file: '.opencode/commands/loop.md',
      apply: (t) => t.replace(/\n---\n/, '\n'),
    },
    {
      id: 'skill missing STAGE 5 heading',
      expect: 'skill:stages',
      file: '.opencode/skills/loop-engine/SKILL.md',
      apply: (t) => t.replace('## STAGE 5 - Verification', '## VERIFICATION'),
    },
    {
      id: 'skill references a deleted document',
      expect: 'skill:references-exist',
      file: '.opencode/skills/loop-engine/SKILL.md',
      apply: (t) => t.replace('references/risk-analysis.md', 'references/does-not-exist.md'),
    },
    {
      id: 'reference document deleted',
      expect: 'reference:quality-gates.md',
      delete: '.opencode/skills/loop-engine/references/quality-gates.md',
    },
    {
      id: 'README broken relative link',
      expect: 'links:README.md',
      file: 'README.md',
      apply: (t) => t.split('docs/architecture.md').join('docs/does-not-exist.md'),
    },
    {
      id: 'fake secret injected',
      expect: 'security:secrets',
      file: 'README.md',
      apply: (t) => `${t}\nghp_${'A'.repeat(36)}\n`,
    },
    {
      id: 'installer loses overwrite guard',
      expect: 'installer:ps1:content',
      file: 'scripts/install.ps1',
      apply: (t) => t.replace(/-Overwrite/g, '-Replace'),
    },
    // -- 0.3.0 audit findings (F3/F4/F5) + new-file guards --------------------
    {
      id: 'evaluation rubric loses a case (alignment)',
      expect: 'tests:evaluation-alignment',
      file: 'tests/evaluation.md',
      apply: (t) => t.replace(/^## Case G - .+$/m, '## Scenario G'),
    },
    {
      id: 'changelog loses the current version',
      expect: 'docs:changelog-current-version',
      file: 'CHANGELOG.md',
      // Strip EVERY version heading beyond 0.1.0 (version-agnostic): the
      // check must fail only when no current version is documented at all.
      // The lookahead mirrors the check's own definition of the first release.
      apply: (t) => t.replace(/^## \[(?!0\.1\.0\])\d+\.\d+\.\d+\][^\n]*$/gm, '## legacy'),
    },
    {
      id: 'skill loses the iteration banner',
      expect: 'skill:reporting-banner',
      file: '.opencode/skills/loop-engine/SKILL.md',
      apply: (t) => t.split('LOOP | ITERATION').join('ITERATION LINE'),
    },
    {
      id: 'skill loses the SETTINGS restatement',
      expect: 'skill:settings-restatement',
      file: '.opencode/skills/loop-engine/SKILL.md',
      apply: (t) => t.split('SETTINGS:').join('SETTINGS ='),
    },
    {
      id: 'quality gates lose a status label',
      expect: 'reporting:status-vocabulary',
      file: '.opencode/skills/loop-engine/references/quality-gates.md',
      apply: (t) => t.split('IMPLEMENTED BUT NOT VERIFIED').join('UNVERIFIED'),
    },
    {
      id: 'gitignore stops excluding evidence',
      expect: 'structure:gitignore-evidence',
      file: '.gitignore',
      apply: (t) => t.split('tests/harness/evidence/').join('tests/harness/evidence-keep/'),
    },
    {
      id: 'runner drops the auto-approval acknowledgement gate',
      expect: 'harness:allow-auto-gate',
      file: 'tests/harness/run-case.mjs',
      apply: (t) => t.split('--allow-auto').join('--allow-acknowledged'),
    },
    {
      id: 'runner drops the least-privilege config plumbing',
      expect: 'harness:allow-auto-gate',
      file: 'tests/harness/run-case.mjs',
      // Replace the whole env-var name: appending a suffix would leave the
      // checked literal (`OPENCODE_CONFIG`) as a substring and the gate would
      // limp by on it.
      apply: (t) => t.split('OPENCODE_CONFIG').join('HARNESS_PERMISSION_ENV'),
    },
    {
      id: 'runner drops the environment scrubber module',
      expect: 'harness:scrubs-environment',
      file: 'tests/harness/safety.mjs',
      // Invalidate both halves of the tripwire in one pass.
      apply: (t) => t
        .split('function keeperEnv').join('function keptEnvLegacy')
        .split('ENV_KEEP = new Set').join('LEGACY_KEEP'),
    },
    {
      id: 'harness README loses the isolation caveat',
      expect: 'docs:harness-isolation-taxonomy',
      file: 'tests/harness/README.md',
      // Exact casing of the README phrase ("**No operating-system sandbox**").
      apply: (t) => t.split('No operating-system sandbox').join('isolated by a full operating-system jail'),
    },
    {
      id: 'SECURITY policy drops the behavioral harness',
      expect: 'security:harness-in-scope',
      file: 'SECURITY.md',
      // Exact casing of the SECURITY.md phrase ("**Behavioral harness**").
      apply: (t) => t.split('Behavioral harness').join('Unrelated packaging tooling'),
    },
    {
      id: 'safety module deleted',
      expect: 'structure:tests/harness/safety.mjs',
      delete: 'tests/harness/safety.mjs',
    },
    {
      id: 'CI drops the harness self-test step',
      expect: 'ci:harness-selftest',
      file: '.github/workflows/validate.yml',
      apply: (t) => t.split('tests/harness/selftest.mjs').join('tests/harness/run-case.mjs --build-only'),
    },
    {
      id: 'harness README deleted',
      expect: 'structure:tests/harness/README.md',
      delete: 'tests/harness/README.md',
    },
  ];

  const results = [];

  // Baseline: a clean copy must pass.
  const baseline = copyRepoToTemp(root, baseTmp);
  const baselineFailures = validateRepo(baseline).filter((r) => !r.ok && !r.skipped);
  results.push({
    id: 'selftest:baseline-clean-copy-passes',
    ok: baselineFailures.length === 0,
    detail: baselineFailures.length === 0 ? 'clean copy validates' : `unexpected failures: ${baselineFailures.map((f) => f.id).join(', ')}`,
  });
  fs.rmSync(baseline, { recursive: true, force: true });

  // Regression probe for a CI-only defect: exact-case checks must not fail when
  // the environment spells the trusted root differently from its on-disk entry
  // (observed on a Windows runner whose TEMP casing differs from the directory
  // entries). The probe only runs where the filesystem is case-insensitive.
  const probeDir = fs.mkdtempSync(path.join(baseTmp, 'caseprobe-'));
  fs.writeFileSync(path.join(probeDir, 'probe.md'), 'probe');
  const reCasedRoot = probeDir.toUpperCase();
  if (fs.existsSync(reCasedRoot)) {
    const ok = existsExactCase(path.join(reCasedRoot, 'probe.md'), reCasedRoot);
    results.push({
      id: 'selftest:exact-case-tolerates-environment-spelling',
      ok,
      detail: ok ? 'anchored check passes with a re-cased root' : 'FAILED: exact-case check broke for a re-cased environment root (CI bug regression)',
    });
  } else {
    results.push({
      id: 'selftest:exact-case-tolerates-environment-spelling',
      ok: true,
      skipped: true,
      detail: 'case-sensitive filesystem; environment re-casing not applicable',
    });
  }
  fs.rmSync(probeDir, { recursive: true, force: true });

  for (const mutation of mutations) {
    const copy = copyRepoToTemp(root, baseTmp);
    try {
      if (mutation.delete) {
        fs.rmSync(path.join(copy, mutation.delete), { force: true });
      } else {
        const target = path.join(copy, mutation.file);
        const text = fs.readFileSync(target, 'utf8');
        // Normalize to LF before mutating, then restore the file's own line
        // endings: runner checkouts may be CRLF while mutation patterns are
        // written against LF text.
        const eol = text.includes('\r\n') ? '\r\n' : '\n';
        const lfText = text.replace(/\r\n/g, '\n');
        const mutated = mutation.apply(lfText);
        if (mutated === lfText) {
          results.push({ id: `selftest:${mutation.id}`, ok: false, detail: 'mutation had no effect - test is broken' });
          continue;
        }
        fs.writeFileSync(target, eol === '\n' ? mutated : mutated.replace(/\n/g, '\r\n'));
      }
      const failures = validateRepo(copy).filter((r) => !r.ok && !r.skipped);
      const detected = failures.some((f) => f.id === mutation.expect || f.id.startsWith(`${mutation.expect}:`));
      results.push({
        id: `selftest:${mutation.id}`,
        ok: detected,
        detail: detected ? `detected as ${mutation.expect}` : `NOT detected (expected ${mutation.expect}); failures were: ${failures.map((f) => f.id).join(', ') || 'none'}`,
      });
    } catch (err) {
      results.push({ id: `selftest:${mutation.id}`, ok: false, detail: `error: ${err.message}` });
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  }

  fs.rmSync(baseTmp, { recursive: true, force: true });
  return results;
}

// ---------------------------------------------------------------------------
// Installer tests (temporary directories only)
// ---------------------------------------------------------------------------

function runInstallTests(root) {
  const results = [];
  const baseTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-install-'));
  let anyFailure = false;

  const scenariosFor = (kind) => {
    const ps1Path = path.join(root, 'scripts/install.ps1');
    const shPath = path.join(root, 'scripts/install.sh');
    const srcCommand = path.join(root, '.opencode/commands/loop.md');
    const srcSkill = path.join(root, '.opencode/skills/loop-engine/SKILL.md');

    const makeRunner = (xdgDir) => {
      if (kind === 'ps1') {
        const exe = findPowerShell();
        if (!exe) return null;
        return (args) => {
          const psArgs = ['-NoProfile'];
          if (isWindows) psArgs.push('-ExecutionPolicy', 'Bypass');
          psArgs.push('-File', ps1Path, ...args);
          const r = spawnSync(exe, psArgs, { encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: xdgDir } });
          return { status: r.status ?? -1, out: `${r.stdout || ''}${r.stderr || ''}` };
        };
      }
      const bash = findBash();
      if (!bash) return null;
      return (args) => {
        const r = spawnSync(bash, [shPath, ...args], { encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: xdgDir } });
        return { status: r.status ?? -1, out: `${r.stdout || ''}${r.stderr || ''}` };
      };
    };

    const xdg = path.join(baseTmp, `xdg-${kind}`);
    const run = makeRunner(xdg);
    if (!run) {
      results.push({ id: `install-test:${kind}`, ok: true, skipped: true, detail: `no ${kind === 'ps1' ? 'PowerShell' : 'bash'} runtime available; scenarios skipped` });
      return;
    }

    const destCommand = path.join(xdg, 'opencode', 'commands', 'loop.md');
    const destSkill = path.join(xdg, 'opencode', 'skills', 'loop-engine', 'SKILL.md');
    const scenario = (name, fn) => {
      try {
        fn();
        results.push({ id: `install-test:${kind}:${name}`, ok: true });
      } catch (err) {
        anyFailure = true;
        results.push({ id: `install-test:${kind}:${name}`, ok: false, detail: err.message });
      }
    };
    const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

    scenario('fresh-global-install', () => {
      const r = run([]);
      assert(r.status === 0, `exit ${r.status}: ${r.out}`);
      assert(fs.existsSync(destCommand), 'loop.md not installed');
      assert(fs.existsSync(destSkill), 'SKILL.md not installed');
      assert(fs.readFileSync(destCommand, 'utf8') === fs.readFileSync(srcCommand, 'utf8'), 'installed loop.md differs from source');
    });

    scenario('idempotent-rerun', () => {
      const r = run([]);
      assert(r.status === 0, `exit ${r.status}: ${r.out}`);
      assert(r.out.includes('Up to date'), `expected "Up to date" in output: ${r.out}`);
    });

    scenario('refuses-silent-overwrite', () => {
      fs.writeFileSync(destCommand, 'TAMPERED USER CONTENT\n');
      const r = run([]);
      assert(r.status !== 0, 'expected non-zero exit for differing file');
      assert(fs.readFileSync(destCommand, 'utf8').includes('TAMPERED'), 'file was modified without authorization');
      assert(/refus/i.test(r.out), `expected refusal message: ${r.out}`);
    });

    scenario('overwrite-with-backup', () => {
      const args = kind === 'ps1' ? ['-Overwrite'] : ['--overwrite'];
      const r = run(args);
      assert(r.status === 0, `exit ${r.status}: ${r.out}`);
      assert(fs.readFileSync(destCommand, 'utf8') === fs.readFileSync(srcCommand, 'utf8'), 'file not restored to source content');
      // Backups must live OUTSIDE OpenCode's extension discovery directories
      // (commands/, skills/): an in-place backup directory of the skill was
      // discovered by OpenCode as a phantom skill after 0.3.0 (ghost of the
      // replaced version). Regrooted backups belong in the sibling root.
      const backupsRoot = path.join(xdg, 'opencode-loop-backups');
      assert(fs.existsSync(backupsRoot), `backup root not created: ${backupsRoot}`);
      let foundBackup = false;
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (path.basename(p) === 'loop.md') { foundBackup = true; return; }
        }
      };
      walk(backupsRoot);
      assert(foundBackup, `no backup of the replaced file kept under ${backupsRoot}`);
      for (const scanDir of [path.join(xdg, 'opencode', 'commands'), path.join(xdg, 'opencode', 'skills')]) {
        const leftovers = fs.readdirSync(scanDir).filter((f) => /backup/i.test(f));
        assert(leftovers.length === 0, `backup left inside discovery dir ${path.basename(path.dirname(scanDir))}: ${leftovers.join(' | ')}`);
      }
    });

    scenario('overwrite-preserves-existing-backups', () => {
      // Pre-create markers covering a 60-second timestamp window, in BOTH
      // places the installer has ever used for backups: legacy in-place
      // backups next to the original (from older installer versions - user
      // content that must never be touched) and the current backup root.
      // The installer must never clobber an existing backup.
      const dir = path.dirname(destCommand);
      const backupsRoot = path.join(xdg, 'opencode-loop-backups');
      const legacyMarkers = [];
      const rootMarkers = [];
      const nowSec = Math.floor(Date.now() / 1000);
      const pad = (n) => String(n).padStart(2, '0');
      const formatTs = (sec) => {
        const d = new Date(sec * 1000);
        return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      };
      for (let i = -10; i < 50; i++) {
        const legacy = path.join(dir, `loop.md.backup-${formatTs(nowSec + i)}`);
        fs.writeFileSync(legacy, 'MARKER-DO-NOT-CLOBBER');
        legacyMarkers.push(legacy);
        const inRoot = path.join(backupsRoot, formatTs(nowSec + i), 'commands', 'loop.md');
        fs.mkdirSync(path.dirname(inRoot), { recursive: true });
        fs.writeFileSync(inRoot, 'MARKER-DO-NOT-CLOBBER');
        rootMarkers.push(inRoot);
      }
      fs.writeFileSync(destCommand, 'TAMPERED-AGAIN\n');
      const args = kind === 'ps1' ? ['-Overwrite'] : ['--overwrite'];
      const r = run(args);
      assert(r.status === 0, `exit ${r.status}: ${r.out}`);
      assert(fs.readFileSync(destCommand, 'utf8') === fs.readFileSync(srcCommand, 'utf8'), 'file not restored');
      for (const p of [...legacyMarkers, ...rootMarkers]) {
        assert(fs.readFileSync(p, 'utf8') === 'MARKER-DO-NOT-CLOBBER', `existing backup clobbered: ${path.basename(p)}`);
      }
      // The fresh backup must have landed at a unique sibling of the blocked
      // same-timestamp marker (e.g. <stamp>/commands/loop.md-2), still outside
      // the discovery directories, preserving the content that was replaced.
      let foundReplaced = false;
      const walkFresh = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walkFresh(p);
          else if (/^loop\.md(-\d+)?$/.test(path.basename(p)) && fs.readFileSync(p, 'utf8') === 'TAMPERED-AGAIN\n') { foundReplaced = true; return; }
        }
      };
      walkFresh(backupsRoot);
      assert(foundReplaced, 'fresh backup not found as a unique sibling of the marker, or wrong content');
      for (const p of legacyMarkers) fs.rmSync(p, { force: true });
    });

    scenario('dry-run-changes-nothing', () => {
      const freshXdg = path.join(baseTmp, `xdg-${kind}-dry`);
      const dryRun = makeRunner(freshXdg)(kind === 'ps1' ? ['-DryRun'] : ['--dry-run']);
      assert(dryRun.status === 0, `exit ${dryRun.status}: ${dryRun.out}`);
      assert(!fs.existsSync(path.join(freshXdg, 'opencode', 'commands', 'loop.md')), 'dry run created files');
    });

    scenario('project-scope-install', () => {
      const proj = fs.mkdtempSync(path.join(baseTmp, 'proj-'));
      const args = kind === 'ps1' ? ['-Scope', 'project', '-ProjectDir', proj] : ['--project', proj];
      const r = run(args);
      assert(r.status === 0, `exit ${r.status}: ${r.out}`);
      assert(fs.existsSync(path.join(proj, '.opencode', 'commands', 'loop.md')), 'project loop.md not installed');
      assert(fs.existsSync(path.join(proj, '.opencode', 'skills', 'loop-engine', 'SKILL.md')), 'project SKILL.md not installed');
    });

    scenario('uninstall-removes-with-backup', () => {
      // Runs last on the shared xdg: discard earlier scenarios' backups so the
      // assertions below prove what THIS uninstall run kept.
      fs.rmSync(path.join(xdg, 'opencode-loop-backups'), { recursive: true, force: true });
      const args = kind === 'ps1' ? ['-Uninstall'] : ['--uninstall'];
      const r = run(args);
      assert(r.status === 0, `exit ${r.status}: ${r.out}`);
      assert(!fs.existsSync(destCommand), 'loop.md still present after uninstall');
      assert(!fs.existsSync(destSkill), 'skill dir still present after uninstall');
      const backupsRoot = path.join(xdg, 'opencode-loop-backups');
      assert(fs.existsSync(backupsRoot), `no uninstall backup root kept: ${backupsRoot}`);
      // The uninstall backup must keep the loop.md content; the discovery
      // directories must stay free of backup-shaped leftovers.
      let foundBackup = false;
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (path.basename(p) === 'loop.md') { foundBackup = true; return; }
        }
      };
      walk(backupsRoot);
      assert(foundBackup, `no uninstall backup kept under ${backupsRoot}`);
      for (const scanDir of [path.join(xdg, 'opencode', 'commands'), path.join(xdg, 'opencode', 'skills')]) {
        const leftovers = fs.readdirSync(scanDir).filter((f) => /backup/i.test(f));
        assert(leftovers.length === 0, `backup left inside discovery dir after uninstall: ${leftovers.join(' | ')}`);
      }
    });
  };

  scenariosFor('ps1');
  scenariosFor('sh');

  if (anyFailure) {
    results.push({ id: 'install-test:cleanup', ok: true, skipped: true, detail: `temp dir kept for inspection: ${baseTmp}` });
  } else {
    fs.rmSync(baseTmp, { recursive: true, force: true });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const known = new Set(['--self-test', '--install-test', '--all', '-h', '--help']);
  const unknown = args.filter((a) => !known.has(a));
  if (unknown.length > 0) {
    console.error(`Unknown option(s): ${unknown.join(', ')}`);
    console.error('Usage: node scripts/validate.mjs [--self-test] [--install-test] [--all]');
    process.exit(1);
  }
  if (args.includes('-h') || args.includes('--help')) {
    console.log('Usage: node scripts/validate.mjs [--self-test] [--install-test] [--all]');
    process.exit(0);
  }

  const root = DEFAULT_ROOT;
  let failed = 0;

  const structural = validateRepo(root);
  console.log('== structural validation ==');
  failed += printResults(structural);

  if (args.includes('--self-test') || args.includes('--all')) {
    console.log('\n== self-test (validator must catch broken copies) ==');
    failed += printResults(runSelfTest(root));
  }

  if (args.includes('--install-test') || args.includes('--all')) {
    console.log('\n== installer tests (temporary directories only) ==');
    failed += printResults(runInstallTests(root));
  }

  if (failed > 0) {
    console.log(`\nRESULT: FAIL (${failed} failing check(s))`);
    process.exit(1);
  }
  console.log('\nRESULT: PASS');
  process.exit(0);
}

main();
