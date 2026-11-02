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
  'tests/evaluation.md',
  'docs/architecture.md',
  'docs/design-principles.md',
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

/** Case-exact path existence (catches case mismatches that Windows would hide). */
function existsExactCase(target) {
  const parsed = path.parse(target);
  let current = parsed.root;
  const segments = path.relative(parsed.root, target).split(path.sep).filter(Boolean);
  for (const segment of segments) {
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

/** Recursive file list, excluding .git. */
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
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
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
    const ok = existsExactCase(full);
    push(`structure:${rel}`, ok, ok ? rel : `missing: ${rel}`);
  }

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
      const missingRefs = refTokens.filter((t) => !existsExactCase(path.join(path.dirname(skillPath), t)));
      const requiredMissing = REQUIRED_SKILL_REFERENCES.filter(
        (f) => !existsExactCase(path.join(path.dirname(skillPath), 'references', f)),
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

  // -- Relative markdown links (case-exact) ----------------------------------
  for (const file of walkFiles(root).filter((f) => f.endsWith('.md'))) {
    const text = readIfExists(file);
    if (text === null) continue;
    const broken = [];
    for (const target of localLinkTargets(text)) {
      const resolved = path.resolve(path.dirname(file), target);
      if (!existsExactCase(resolved)) broken.push(target);
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
      ['project scope', /--project/],
    ];
    const missing = markers.filter(([, re]) => !re.test(sh)).map(([label]) => label);
    push('installer:sh:content', missing.length === 0, missing.length === 0 ? 'all behavior markers present' : `missing: ${missing.join(', ')}`);
  }

  for (const r of syntaxChecks(root)) res.push(r);

  // -- CI --------------------------------------------------------------------
  const workflow = readIfExists(path.join(root, '.github/workflows/validate.yml'));
  push(
    'ci:workflow',
    workflow !== null && workflow.includes('validate.mjs'),
    workflow !== null && workflow.includes('validate.mjs') ? 'runs validate.mjs' : 'workflow missing or does not run validate.mjs',
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

  const license = readIfExists(path.join(root, 'LICENSE'));
  push('docs:license', license !== null && /MIT/i.test(license), license !== null && /MIT/i.test(license) ? 'MIT license present' : 'LICENSE missing or not MIT');

  const evaluation = readIfExists(path.join(root, 'tests/evaluation.md'));
  if (evaluation === null) {
    push('tests:evaluation-cases', false, 'tests/evaluation.md missing');
  } else {
    const missing = 'ABCDEFGHI'.split('').filter((c) => !new RegExp(`Case ${c}\\b`).test(evaluation));
    push('tests:evaluation-cases', missing.length === 0, missing.length === 0 ? 'Cases A-I present' : `missing cases: ${missing.join(', ')}`);
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
      return base !== '.git';
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

  for (const mutation of mutations) {
    const copy = copyRepoToTemp(root, baseTmp);
    try {
      if (mutation.delete) {
        fs.rmSync(path.join(copy, mutation.delete), { force: true });
      } else {
        const target = path.join(copy, mutation.file);
        const text = fs.readFileSync(target, 'utf8');
        const mutated = mutation.apply(text);
        if (mutated === text) {
          results.push({ id: `selftest:${mutation.id}`, ok: false, detail: 'mutation had no effect - test is broken' });
          continue;
        }
        fs.writeFileSync(target, mutated);
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
      const backups = fs.readdirSync(path.dirname(destCommand)).filter((f) => f.startsWith('loop.md.backup-'));
      assert(backups.length >= 1, 'no backup created');
    });

    scenario('overwrite-preserves-existing-backups', () => {
      // Pre-create marker backups covering a 60-second timestamp window. The
      // installer must never clobber an existing backup, even within the same
      // second as a previous run.
      const dir = path.dirname(destCommand);
      const markers = [];
      const nowSec = Math.floor(Date.now() / 1000);
      const pad = (n) => String(n).padStart(2, '0');
      const formatTs = (sec) => {
        const d = new Date(sec * 1000);
        return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      };
      for (let i = -10; i < 50; i++) {
        const p = path.join(dir, `loop.md.backup-${formatTs(nowSec + i)}`);
        fs.writeFileSync(p, 'MARKER-DO-NOT-CLOBBER');
        markers.push(p);
      }
      fs.writeFileSync(destCommand, 'TAMPERED-AGAIN\n');
      const args = kind === 'ps1' ? ['-Overwrite'] : ['--overwrite'];
      const r = run(args);
      assert(r.status === 0, `exit ${r.status}: ${r.out}`);
      assert(fs.readFileSync(destCommand, 'utf8') === fs.readFileSync(srcCommand, 'utf8'), 'file not restored');
      for (const p of markers) {
        assert(fs.readFileSync(p, 'utf8') === 'MARKER-DO-NOT-CLOBBER', `existing backup clobbered: ${path.basename(p)}`);
      }
      for (const p of markers) fs.rmSync(p, { force: true });
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
      const args = kind === 'ps1' ? ['-Uninstall'] : ['--uninstall'];
      const r = run(args);
      assert(r.status === 0, `exit ${r.status}: ${r.out}`);
      assert(!fs.existsSync(destCommand), 'loop.md still present after uninstall');
      assert(!fs.existsSync(destSkill), 'skill dir still present after uninstall');
      const backups = fs.readdirSync(path.dirname(destCommand)).filter((f) => f.startsWith('loop.md.backup-'));
      assert(backups.length >= 1, 'no uninstall backup kept');
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
