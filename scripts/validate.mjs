#!/usr/bin/env node
/**
 * LOOP repository validator.
 *
 * Usage:
 *   node scripts/validate.mjs [--selftest] [repoRoot]
 *
 * Default run: structural, frontmatter, reference, portability, and
 * documentation integrity checks against the repository. No side effects on
 * any OpenCode configuration.
 *
 * --selftest: additionally
 *   - runs the installer scripts end-to-end against throwaway temporary
 *     sandbox directories (never the real OpenCode configuration): fresh
 *     install, idempotency, backup-before-replace, backup collision safety,
 *     uninstall with KEPT protection of unowned files, forced uninstall,
 *     the default (XDG) destination, and the project-local destination;
 *   - injects defects into throwaway copies of the repository and runs the
 *     REAL validator binary on them, asserting that each defect is caught.
 *
 * Requires Node >= 18. Uses only Node built-ins.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const selftest = args.includes('--selftest');
const repoArg = args.find((a) => !a.startsWith('--'));
const repoRoot = path.resolve(repoArg || path.resolve(scriptDir, '..'));

const results = [];

function record(name, status, detail) {
    results.push({ name, status, detail: detail || null });
}
function pass(name, detail) { record(name, 'PASS', detail); }
function skip(name, detail) { record(name, 'SKIP', detail); }

function assert(bool, message) {
    if (!bool) throw new Error(message);
}

function runCheck(name, fn) {
    try {
        const detail = fn();
        pass(name, typeof detail === 'string' ? detail : undefined);
    } catch (err) {
        record(name, 'FAIL', err && err.message ? err.message : String(err));
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readText(rel) {
    return fs.readFileSync(path.join(repoRoot, ...rel.split('/')), 'utf8');
}

function exists(rel) {
    return fs.existsSync(path.join(repoRoot, ...rel.split('/')));
}

function normalize(text) {
    return text.replace(/\r\n/g, '\n');
}

function hashFile(filePath) {
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listFilesUnder(rootDir) {
    const out = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(p);
            else out.push(p);
        }
    };
    walk(rootDir);
    return out;
}

// Relative, forward-slash paths of every file under a directory, sorted.
function walkRelative(rootDir) {
    const rootAbs = path.resolve(rootDir);
    return listFilesUnder(rootAbs)
        .map((abs) => path.relative(rootAbs, abs).split(path.sep).join('/'))
        .sort();
}

/**
 * Parses the strict single-line frontmatter contract used by LOOP files:
 *   ---
 *   key: value
 *   ---
 * Returns { fields, body } or throws with a precise message.
 */
function parseFrontmatter(label, text) {
    const norm = normalize(text);
    const m = /^---\n([\s\S]*?)\n---\n/.exec(norm);
    if (!m) throw new Error(`${label}: no valid frontmatter block found (file must start with '---')`);
    const fields = {};
    for (const line of m[1].split('\n')) {
        const fm = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ ](.*))?$/.exec(line);
        if (!fm) throw new Error(`${label}: frontmatter line does not match the single-line 'key: value' contract: "${line}"`);
        fields[fm[1]] = (fm[2] || '').trim();
    }
    return { fields, body: norm.slice(m[0].length) };
}

function isAsciiBuffer(buf) {
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] > 0x7f) {
            const upto = buf.subarray(0, i).toString('utf8');
            return { ascii: false, lineNo: upto.split('\n').length };
        }
    }
    return { ascii: true };
}

// ---------------------------------------------------------------------------
// Group 1 - required repository structure
// ---------------------------------------------------------------------------

// The explicit expected-file contract: changing the repository layout also
// requires updating this list (see CONTRIBUTING.md). Installer manifests, by
// contrast, are derived from the source tree.
const requiredFiles = [
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

function checkStructure() {
    const missing = requiredFiles.filter((rel) => !exists(rel));
    assert(missing.length === 0, `missing required files: ${missing.join(', ')}`);
    for (const rel of requiredFiles) {
        const stat = fs.statSync(path.join(repoRoot, ...rel.split('/')));
        if (stat.isFile() && stat.size === 0) throw new Error(`required file is empty: ${rel}`);
    }
    return `${requiredFiles.length} required files present and non-empty`;
}

// ---------------------------------------------------------------------------
// Group 2 - command checks
// ---------------------------------------------------------------------------

function checkCommand() {
    const text = readText('.opencode/commands/loop.md');
    const parsed = parseFrontmatter('loop.md', text);
    for (const line of normalize(text).split('\n')) {
        if (/^template:/.test(line)) {
            throw new Error('loop.md: frontmatter must not contain a template field (the Markdown body is the template per OpenCode docs)');
        }
    }
    assert(parsed.fields.description !== undefined && parsed.fields.description.length > 0,
        'loop.md: a non-empty description is required so the command is discoverable');
    assert(parsed.body.includes('$ARGUMENTS'), 'loop.md: body must reference $ARGUMENTS so user arguments are preserved');
    assert(parsed.body.includes('loop-engine'), 'loop.md: body must explicitly reference the loop-engine skill id');
    assert(parsed.body.includes('--max-iterations'), 'loop.md: body must document --max-iterations');
    assert(parsed.body.includes('--mode'), 'loop.md: body must document --mode');
    assert(parsed.body.includes('SETTINGS:'), 'loop.md: body must require restating resolved settings (SETTINGS: mode=..., iterations=...) in the Stage 0 summary');
    assert(!/!\`/.test(parsed.body), 'loop.md: shell interpolation blocks ("!` ... `") are forbidden in LOOP commands for safety');
    return 'frontmatter valid; $ARGUMENTS, flags, settings handover, and explicit loop-engine invocation present; no shell blocks';
}

// ---------------------------------------------------------------------------
// Group 3 - skill checks
// ---------------------------------------------------------------------------

const skillDirRel = '.opencode/skills/loop-engine';
const referenceFiles = ['quality-gates.md', 'risk-analysis.md', 'evaluation-cases.md'];

function checkSkill() {
    const text = readText(`${skillDirRel}/SKILL.md`);
    const parsed = parseFrontmatter('SKILL.md', text);
    assert(parsed.fields.name && parsed.fields.name.length > 0, 'SKILL.md: name field is required');
    assert(parsed.fields.description && parsed.fields.description.length > 0,
        'SKILL.md: description field is required (without it OpenCode does not advertise the skill)');
    const dirName = path.basename(path.resolve(repoRoot, skillDirRel));
    assert(dirName === 'loop-engine', `SKILL.md: directory name "${dirName}" must be "loop-engine" (skill id is path-derived and case-sensitive)`);
    assert(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(dirName), 'SKILL.md: skill id must be lowercase kebab-case');
    for (let stage = 0; stage <= 8; stage++) {
        assert(text.includes(`STAGE ${stage}`), `SKILL.md: missing STAGE ${stage} of the iteration lifecycle`);
    }
    for (const label of ['VERIFIED', 'IMPLEMENTED BUT NOT VERIFIED', 'BLOCKED', 'NOT APPLICABLE', 'FAILED']) {
        assert(text.includes(label), `SKILL.md: status vocabulary missing label ${label}`);
    }
    assert(/stopping condition/i.test(text), 'SKILL.md: stopping conditions must be documented');
    assert(/SETTINGS:/.test(text), 'SKILL.md: must reference the SETTINGS handover from the /loop argument handling');
    assert(/references\/(quality-gates|risk-analysis|evaluation-cases)\.md/.test(text),
        'SKILL.md: must reference the supporting reference files');
    return 'frontmatter valid; lifecycle stages 0-8 present; status vocabulary and settings handover present';
}

function checkReferences() {
    for (const ref of referenceFiles) {
        const rel = `${skillDirRel}/references/${ref}`;
        assert(exists(rel), `reference file missing: ${rel}`);
        const text = readText(rel);
        assert(text.trim().length > 0, `reference file is empty: ${rel}`);
        assert(/^#\s/m.test(text), `reference file lacks a markdown heading: ${rel}`);
        assert(readText(`${skillDirRel}/SKILL.md`).includes(ref), `SKILL.md does not mention ${ref}`);
    }
    return 'all three reference documents exist, are non-empty, and are mentioned in SKILL.md';
}

// ---------------------------------------------------------------------------
// Group 4 - documentation integrity
// ---------------------------------------------------------------------------

function checkDocsContent() {
    const readme = normalize(readText('README.md'));
    assert(readme.includes('/loop'), 'README.md: must document the /loop command');
    assert(readme.includes('--max-iterations'), 'README.md: must document --max-iterations');
    assert(/--mode/.test(readme), 'README.md: must document --mode');
    assert(/windows/i.test(readme) && /linux/i.test(readme) && /macos|mac os/i.test(readme),
        'README.md: must document Windows, Linux, and macOS installation');
    assert(/known limitations/i.test(readme), 'README.md: must include an honest Known limitations section');
    const evaluation = normalize(readText('tests/evaluation.md'));
    for (const caseName of ['Case A', 'Case B', 'Case C', 'Case D', 'Case E', 'Case F', 'Case G', 'Case H', 'Case I']) {
        assert(evaluation.includes(caseName), `tests/evaluation.md: missing ${caseName}`);
    }
    const changelog = readText('CHANGELOG.md');
    assert(/0\.1\.0/.test(changelog), 'CHANGELOG.md: must record version 0.1.0');
    const license = normalize(readText('LICENSE'));
    assert(/MIT License/.test(license) && /Permission is hereby granted/.test(license), 'LICENSE: expected MIT license text');
    return 'README completeness, evaluation cases A-I, changelog version, and license verified';
}

function checkMarkdownLinks() {
    const mdFiles = [
        'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md',
        'docs/architecture.md', 'docs/design-principles.md',
        'tests/evaluation.md',
        '.opencode/commands/loop.md',
        `${skillDirRel}/SKILL.md`,
        ...referenceFiles.map((r) => `${skillDirRel}/references/${r}`),
    ];
    let checked = 0;
    for (const rel of mdFiles) {
        if (!exists(rel)) continue; // structure-group failures already cover this
        const absPath = path.join(repoRoot, ...rel.split('/'));
        const text = normalize(fs.readFileSync(absPath, 'utf8'));
        const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
        let match;
        while ((match = linkRe.exec(text)) !== null) {
            const target = match[1];
            if (/^(https?:|mailto:)/.test(target)) continue;
            if (target.startsWith('#')) continue;
            const clean = target.split(/\s+/)[0];
            const decoded = clean.replace(/%20/g, ' ');
            if (decoded.length === 0) continue;
            const resolved = path.resolve(path.dirname(absPath), decoded);
            assert(fs.existsSync(resolved), `dangling relative markdown link in ${rel}: (${target})`);
            checked++;
        }
    }
    return `${checked} relative markdown link targets resolved`;
}

// ---------------------------------------------------------------------------
// Group 5 - portability and packaging
// ---------------------------------------------------------------------------

function checkAsciiScripts() {
    for (const rel of ['scripts/install.ps1', 'scripts/install.sh', 'scripts/validate.mjs']) {
        const buf = fs.readFileSync(path.join(repoRoot, ...rel.split('/')));
        const r = isAsciiBuffer(buf);
        assert(r.ascii, `${rel} contains non-ASCII bytes near line ${r.lineNo} (installer and tooling scripts must stay ASCII-only for portability, e.g. Windows PowerShell 5.1 codepage issues)`);
    }
    return 'installer and validator scripts are ASCII-only';
}

function checkWorkflow() {
    const text = readText('.github/workflows/validate.yml');
    assert(text.includes('validate.mjs'), 'validate.yml: workflow must run scripts/validate.mjs');
    assert(/actions\/checkout/.test(text), 'validate.yml: workflow must check out the repository');
    return 'CI workflow triggers validation';
}

// ---------------------------------------------------------------------------
// Group 6 - installer sandbox tests --selftest only; never touches real config
// ---------------------------------------------------------------------------

function findPowershell() {
    const candidates = process.platform === 'win32' ? ['powershell.exe', 'pwsh.exe'] : ['pwsh'];
    for (const exe of candidates) {
        const probe = spawnSync(exe, ['-NoProfile', '-Command', '"$PSVersionTable.PSVersion.Major.ToString()"'], { encoding: 'utf8', timeout: 30000 });
        if (probe.status === 0) return { exe };
    }
    return null;
}

function findBash() {
    const candidates = process.platform === 'win32' ? ['bash', 'C:\\Program Files\\Git\\bin\\bash.exe'] : ['bash'];
    for (const exe of candidates) {
        const probe = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 30000 });
        const out = probe.stdout || '';
        if (out.includes('GNU bash')) return exe;
        if (out.includes('Windows Subsystem')) continue; // WSL stub without any distribution
    }
    return null;
}

/** Creates the sandbox destination with sentinel user files; returns state object. */
function createSandbox() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-sandbox-'));
    const dest = path.join(tmp, 'cfg', 'opencode');
    fs.mkdirSync(dest, { recursive: true });

    const sentinel = path.join(dest, 'commands', 'user-existing-command.md');
    const sentinelText = `# user data sentinel ${Date.now()}\n`;
    fs.mkdirSync(path.dirname(sentinel), { recursive: true });
    fs.writeFileSync(sentinel, sentinelText, 'utf8');
    const userSkillFile = path.join(dest, 'skills', 'my-thing', 'SKILL.md');
    fs.mkdirSync(path.dirname(userSkillFile), { recursive: true });
    fs.writeFileSync(userSkillFile, '# user skill sentinel\n', 'utf8');

    return { tmp, dest, sentinel, sentinelText, userSkillFile };
}

function runInstaller(runner, sandbox, scriptArgs, envExtra, cwd) {
    const { cmd, argv } = runner.buildCall(scriptArgs);
    return spawnSync(cmd, argv, {
        encoding: 'utf8',
        timeout: 120000,
        cwd: cwd || repoRoot,
        env: { ...process.env, ...(envExtra || {}) },
    });
}

function makeRunner(platformScript, interpreter, scriptPath) {
    if (platformScript === 'ps1') {
        return {
            label: `install.ps1 via ${interpreter.exe}`,
            installArgs: [], // resolved per run: [-Destination, path]
            buildCall: (scriptArgs) => ({
                cmd: interpreter.exe,
                argv: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...scriptArgs],
            }),
        };
    }
    return {
        label: `install.sh via ${interpreter.cmd}`,
        buildCall: (scriptArgs) => ({ cmd: interpreter.cmd, argv: [scriptPath, ...scriptArgs] }),
    };
}

function baksUnder(dest) {
    return listFilesUnder(dest).filter((f) => f.includes('.bak.'));
}

function assertInstalledState(runner, sandbox, manifest) {
    for (const rel of manifest) {
        const t = path.join(sandbox.dest, ...rel.split('/'));
        const s = path.join(repoRoot, '.opencode', ...rel.split('/'));
        assert(fs.existsSync(t), `${runner.label}: expected installed file missing: ${rel}`);
        assert(hashFile(t) === hashFile(s), `${runner.label}: installed content differs from source: ${rel}`);
    }
}

function assertUninstalledState(runner, sandbox, manifest) {
    for (const rel of manifest) {
        assert(!fs.existsSync(path.join(sandbox.dest, ...rel.split('/'))), `${runner.label}: ${rel} survived uninstall`);
    }
    assert(fs.existsSync(sandbox.sentinel) && fs.readFileSync(sandbox.sentinel, 'utf8') === sandbox.sentinelText,
        `${runner.label}: sentinel user command was destroyed or modified`);
    assert(fs.existsSync(sandbox.userSkillFile) && fs.readFileSync(sandbox.userSkillFile, 'utf8') === '# user skill sentinel\n',
        `${runner.label}: sentinel user skill was destroyed or modified`);
}

function checkInstallersFor(platformScript) {
    const scriptName = platformScript === 'ps1' ? 'install.ps1' : 'install.sh';
    const scriptPath = path.join(repoRoot, 'scripts', scriptName);

    let interpreter;
    if (platformScript === 'ps1') {
        interpreter = findPowershell();
        if (!interpreter) {
            skip(`installer sandbox: ${scriptName}`, 'no PowerShell interpreter found on this machine');
            return;
        }
    } else {
        interpreter = { cmd: findBash() };
        if (!interpreter.cmd) {
            skip(`installer sandbox: ${scriptName}`, 'no suitable bash found (WSL stub without distributions, or bash absent)');
            return;
        }
    }

    const runner = makeRunner(platformScript, interpreter, scriptPath);
    const manifest = walkRelative(path.join(repoRoot, '.opencode'));
    assert(manifest.length > 0, `${runner.label}: derived manifest is empty`);

    const sandbox = createSandbox();
    try {
        const destArgs = platformScript === 'ps1' ? ['-Destination', sandbox.dest.replace(/\\/g, '/')] : ['--dest', sandbox.dest.replace(/\\/g, '/')];
        const unArgs = platformScript === 'ps1' ? ['-Uninstall', ...destArgs] : ['--uninstall', '--dest', sandbox.dest.replace(/\\/g, '/')];
        const forceUnArgs = platformScript === 'ps1' ? [...unArgs, '-Force'] : [...unArgs, '--force-uninstall'];

        // 1. Fresh install into an empty destination.
        let r = runInstaller(runner, sandbox, destArgs);
        assert(r.status === 0, `${runner.label}: fresh install exited ${r.status}; stderr: ${r.stderr}`);
        assertInstalledState(runner, sandbox, manifest);

        // 2. Idempotent rerun must report UP-TO-DATE and create zero backups.
        r = runInstaller(runner, sandbox, destArgs);
        assert(r.status === 0, `${runner.label}: idempotent rerun exited ${r.status}`);
        assert((r.stdout || '').includes('UP-TO-DATE'), `${runner.label}: idempotent rerun did not report UP-TO-DATE`);
        assert(baksUnder(sandbox.dest).length === 0, `${runner.label}: idempotent rerun created unexpected backup files`);

        // 3. Existing user file must be backed up, not silently replaced.
        fs.writeFileSync(path.join(sandbox.dest, 'commands', 'loop.md'), '# my own custom loop\n', 'utf8');
        r = runInstaller(runner, sandbox, destArgs);
        assert(r.status === 0, `${runner.label}: overwrite-case install exited ${r.status}`);
        assert((r.stdout || '').includes('REPLACED'), `${runner.label}: overwrite-case install did not report REPLACED`);
        assertInstalledState(runner, sandbox, manifest);
        let baks = baksUnder(sandbox.dest);
        assert(baks.length === 1, `${runner.label}: expected exactly one backup after replace, found: ${baks.join(', ')}`);
        assert(fs.readFileSync(baks[0], 'utf8').includes('# my own custom loop'),
            `${runner.label}: backup file does not contain the user original content`);

        // 4. Same-second backup collision: two rapid replacements must keep both backups.
        fs.writeFileSync(path.join(sandbox.dest, 'commands', 'loop.md'), '# second custom loop\n', 'utf8');
        r = runInstaller(runner, sandbox, destArgs);
        assert(r.status === 0, `${runner.label}: collision-case install exited ${r.status}`);
        assertInstalledState(runner, sandbox, manifest);
        baks = baksUnder(sandbox.dest);
        assert(baks.length === 2, `${runner.label}: expected two distinct backups after rapid re-replace, found: ${baks.join(', ')}`);
        const hasSecond = baks.some((b) => fs.readFileSync(b, 'utf8').includes('# second custom loop'));
        const hasFirst = baks.some((b) => fs.readFileSync(b, 'utf8').includes('# my own custom loop'));
        assert(hasFirst && hasSecond, `${runner.label}: backup collision destroyed an earlier backup`);

        // 5. Uninstall: removes identical LOOP content; sentinels survive.
        r = runInstaller(runner, sandbox, unArgs);
        assert(r.status === 0, `${runner.label}: uninstall exited ${r.status}`);
        assertUninstalledState(runner, sandbox, manifest);
        assert(baksUnder(sandbox.dest).length === 2, `${runner.label}: uninstall created or lost backups unexpectedly`);

        // 6. KEPT protection: a differing, non-marker file at a LOOP path stays untouched.
        r = runInstaller(runner, sandbox, destArgs);
        assert(r.status === 0, `${runner.label}: reinstall after uninstall exited ${r.status}`);
        assertInstalledState(runner, sandbox, manifest);
        fs.writeFileSync(path.join(sandbox.dest, 'commands', 'loop.md'), '# my custom loop, no marker\n', 'utf8');
        r = runInstaller(runner, sandbox, unArgs);
        assert(r.status === 0, `${runner.label}: KEPT-case uninstall exited ${r.status}`);
        assert((r.stdout || '').includes('KEPT'), `${runner.label}: KEPT-case uninstall did not report KEPT`);
        assert(fs.readFileSync(path.join(sandbox.dest, 'commands', 'loop.md'), 'utf8').includes('# my custom loop, no marker'),
            `${runner.label}: unowned user file was destroyed by uninstall`);
        assert(baksUnder(sandbox.dest).length === 2, `${runner.label}: KEPT-case uninstall must not create backups`);

        // 7. Forced uninstall of the differing unowned file: removed, with backup.
        r = runInstaller(runner, sandbox, forceUnArgs);
        assert(r.status === 0, `${runner.label}: forced uninstall exited ${r.status}`);
        assert(!fs.existsSync(path.join(sandbox.dest, 'commands', 'loop.md')), `${runner.label}: forced uninstall did not remove the differing file`);
        baks = baksUnder(sandbox.dest);
        assert(baks.length === 3, `${runner.label}: forced uninstall should have created one additional backup, found: ${baks.join(', ')}`);
        const forcedBak = baks.some((b) => fs.readFileSync(b, 'utf8').includes('# my custom loop, no marker'));
        assert(forcedBak, `${runner.label}: forced-removal backup does not contain the removed user content`);

        assertUninstalledState(runner, sandbox, manifest.slice(0)); // sentinels safe at each stage

        pass(`installer sandbox: ${runner.label}`,
            'fresh, idempotency, backup-before-replace, collision safety, selective uninstall, KEPT protection, and forced-uninstall backup verified');
    } finally {
        fs.rmSync(sandbox.tmp, { recursive: true, force: true });
    }

    // 8. Default (global) destination via XDG_CONFIG_HOME override.
    const defaultTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-default-'));
    try {
        const envOver = { XDG_CONFIG_HOME: path.join(defaultTmp, 'xdg') };
        const defResult = runInstaller(runner, sandbox, platformScript === 'ps1' ? [] : [], envOver);
        assert(defResult.status === 0, `${runner.label}: default-destination install exited ${defResult.status}; stderr: ${defResult.stderr}`);
        for (const rel of manifest) {
            const t = path.join(envOver.XDG_CONFIG_HOME, 'opencode', ...rel.split('/'));
            const s = path.join(repoRoot, '.opencode', ...rel.split('/'));
            assert(fs.existsSync(t), `${runner.label}: default destination missing file: ${rel}`);
            assert(hashFile(t) === hashFile(s), `${runner.label}: default destination content differs from source: ${rel}`);
        }
        pass(`installer default destination: ${runner.label}`, 'XDG_CONFIG_HOME override verified (real user config untouched)');
    } finally {
        fs.rmSync(defaultTmp, { recursive: true, force: true });
    }

    // 9. Project-local destination.
    const localTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-local-'));
    try {
        const locResult = runInstaller(runner, sandbox, platformScript === 'ps1' ? ['-Local'] : ['--local'], null, localTmp);
        assert(locResult.status === 0, `${runner.label}: local install exited ${locResult.status}; stderr: ${locResult.stderr}`);
        for (const rel of manifest) {
            const t = path.join(localTmp, '.opencode', ...rel.split('/'));
            const s = path.join(repoRoot, '.opencode', ...rel.split('/'));
            assert(fs.existsSync(t), `${runner.label}: local destination missing file: ${rel}`);
            assert(hashFile(t) === hashFile(s), `${runner.label}: local destination content differs from source: ${rel}`);
        }
        pass(`installer local destination: ${runner.label}`, '-Local/--local project install verified');
    } finally {
        fs.rmSync(localTmp, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// Group 7 - defect injection: the real validator must catch every injection
// ---------------------------------------------------------------------------

function copyRepoToSandbox() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-inject-'));
    const sandbox = path.join(tmp, 'repo');
    fs.cpSync(repoRoot, sandbox, {
        recursive: true,
        filter: (src) => {
            const top = path.relative(repoRoot, src).split(path.sep)[0];
            return top !== '.git';
        },
    });
    return sandbox;
}

const injections = [
    {
        name: 'defect injection: SKILL.md description removed',
        file: '.opencode/skills/loop-engine/SKILL.md',
        mutate: (text) => text.replace(/^description:.*\n/m, ''),
        needle: 'description field is required',
    },
    {
        name: 'defect injection: reference file risk-analysis.md deleted',
        file: '.opencode/skills/loop-engine/references/risk-analysis.md',
        delete: true,
        needle: 'risk-analysis.md',
    },
    {
        name: 'defect injection: $ARGUMENTS removed from loop.md',
        file: '.opencode/commands/loop.md',
        mutate: (text) => text.replace(/\$ARGUMENTS/g, ''),
        needle: '$ARGUMENTS',
    },
];

function runDefectInjections() {
    for (const inj of injections) {
        const sandbox = copyRepoToSandbox();
        try {
            const target = path.join(sandbox, ...inj.file.split('/'));
            if (inj.delete) {
                fs.rmSync(target, { force: true });
            } else {
                const original = fs.readFileSync(target, 'utf8');
                const mutated = inj.mutate(original);
                assert(mutated !== original, `mutation for "${inj.name}" had no effect (selftest bug)`);
                fs.writeFileSync(target, mutated, 'utf8');
            }
            // Probe the REAL validator against the mutated sandbox.
            const probe = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'validate.mjs'), sandbox], {
                encoding: 'utf8',
                timeout: 120000,
            });
            assert(probe.status === 1, `${inj.name}: real validator exited ${probe.status} (expected 1/failure)`);
            const out = probe.stdout || '';
            assert(out.includes('FAIL'), `${inj.name}: validator output contains no FAIL lines`);
            assert(out.includes(inj.needle), `${inj.name}: expected failure detail "${inj.needle}" was not reported; output: ${out.slice(0, 400)}...`);
            pass(inj.name, 'the real validator binary caught the defect with a precise message');
        } finally {
            fs.rmSync(path.dirname(sandbox), { recursive: true, force: true });
        }
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

runCheck('repository structure', checkStructure);
runCheck('command loop.md', checkCommand);
runCheck('skill SKILL.md', checkSkill);
runCheck('skill references', checkReferences);
runCheck('documentation content', checkDocsContent);
runCheck('relative markdown links', checkMarkdownLinks);
runCheck('script encoding (ASCII-only)', checkAsciiScripts);
runCheck('CI workflow', checkWorkflow);

if (process.platform === 'win32') {
    skip('install.sh executable bit', 'not applicable on Windows (no POSIX mode bits)');
} else {
    runCheck('install.sh executable bit', () => {
        const stat = fs.statSync(path.join(repoRoot, 'scripts', 'install.sh'));
        assert((stat.mode & 0o111) !== 0, 'scripts/install.sh is not executable (chmod +x required)');
        return 'install.sh carries the executable bit';
    });
}

if (selftest) {
    checkInstallersFor('ps1');
    checkInstallersFor('sh');
    runDefectInjections();
}

const failures = results.filter((r) => r.status === 'FAIL');
const skips = results.filter((r) => r.status === 'SKIP');
const passes = results.filter((r) => r.status === 'PASS');

console.log('');
for (const r of results) {
    const icon = r.status === 'PASS' ? '[ok]  ' : r.status === 'SKIP' ? '[skip]' : '[FAIL]';
    console.log(`${icon} ${r.name}${r.detail ? ` - ${r.detail}` : ''}`);
}
console.log('');
console.log(`summary: ${passes.length} passed, ${failures.length} failed, ${skips.length} skipped${selftest ? ' (selftest: installer sandbox + defect injection included)' : ''}`);

if (failures.length > 0) {
    process.exitCode = 1;
}
