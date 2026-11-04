/**
 * Unattended-run safety controls for the LOOP behavioral harness.
 *
 * Kept in its own side-effect-free module so the FREE self-test
 * (tests/harness/selftest.mjs) can unit-test every rule without importing the
 * runner or touching a model call.
 *
 * Threat model (see tests/harness/README.md "Isolation model"): an evaluated
 * agent is an ordinary child process of this user. OpenCode's permission layer
 * gates its own tools, but `--auto` approves every request that is not
 * explicitly denied, bash/edit/read default to allow, and nothing here is an
 * operating-system sandbox. These helpers therefore:
 *
 *   1. REQUIRE an explicit operator acknowledgement (--allow-auto) before the
 *      runner enables auto-approval - never silently.
 *   2. Strip credential-shaped environment variables from the evaluated
 *      session (allowlist; the operator must name any extra var, e.g. a
 *      provider key their auth setup needs, via --env-pass).
 *   3. Install a least-privilege permission config (delivered through the
 *      documented OPENCODE_CONFIG tier, which overrides the user's global
 *      config on conflicting keys) that hard-denies the actions an
 *      unattended evaluation has no business performing.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Exact env-key REGISTRY the evaluated session may inherit, compared without
 * case on Windows (the OS treats env names case-insensitively and its real
 * spellings are `Path`, `ComSpec`, `SystemRoot`, `windir` - verified on a live
 * machine) and case-sensitively on POSIX (where `path` and `PATH` are
 * genuinely different variables). Obscure vars fail closed: anything not in
 * this registry is NOT inherited unless the operator names it via --env-pass.
 */
const ENV_KEEP = new Set([
  // Runtime discovery: shell, node, git, npm must be reachable.
  'PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR',
  // Windows shell/runtime basics. SystemRoot is REQUIRED for node/npm crypto;
  // PATHEXT/COMSPEC for cmd; PSModulePath so PowerShell tooling can load its
  // core modules; processor/drive vars for npm and installers.
  'SYSTEMROOT', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT', 'WINDIR',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)', 'PROGRAMDATA', 'HOMEDRIVE', 'HOMEPATH',
  'PROCESSOR_ARCHITECTURE', 'PSMODULEPATH', 'OS', 'USERNAME',
  'APPDATA', 'LOCALAPPDATA',
  // Interactive/API basics.
  'SHELL', 'USER', 'LOGNAME', 'TERM', 'LANG', 'LC_ALL', 'LANGUAGE',
  'NO_COLOR',
  // Corporate egress: without these, a proxied network cannot even reach the
  // model provider - deliberately kept, and documented.
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
]);

const IS_WINDOWS = process.platform === 'win32';

/**
 * Build the environment handed to an evaluated `opencode run` process.
 *
 * Values are NEVER returned for env vars outside the registry plus the
 * explicitly named pass-throughs; process.env is only ever a source of VALUES
 * for keys listed here. Matching is case-insensitive on Windows (OS
 * semantics: `Path`, `PATH`, `SystemRoot`, `SYSTEMROOT` are the same
 * variable) and case-sensitive on POSIX.
 *
 * @param {{[k:string]: string|undefined}} [source] environment to filter
 *   (default: process.env)
 * @param {string[]} [pass] extra variable NAMES the operator explicitly wants
 *   forwarded (values not printed anywhere by the harness)
 * @returns {{env: {[k:string]: string}, dropped: string[]}} the sanitized env
 *   copy and the SOURCE env var names that were removed
 */
export function keeperEnv(source = process.env, pass = []) {
  const allow = new Set(
    IS_WINDOWS
      ? [...ENV_KEEP, ...pass.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim())].map((n) => n.toUpperCase())
      : [...ENV_KEEP, ...pass.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim())],
  );
  const probe = (key) => (IS_WINDOWS ? key.toUpperCase() : key);
  const env = {};
  const dropped = [];
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (allow.has(probe(key))) env[key] = value;
    else dropped.push(key);
  }
  return { env, dropped };
}

/**
 * The least-privilege permission block for unattended evaluation runs.
 *
 * Denies are HARDED against the runner's `--auto` mode: OpenCode docs state
 * auto mode approves requests that are not explicitly denied, while explicit
 * "deny" rules are still enforced. bash and edit stay allowed because the
 * evaluation cases legitimately need arbitrary verification commands inside
 * the fixture - this is containment of a few named risky actions, NOT a
 * sandbox; see the isolation model in tests/harness/README.md.
 *
 * Keys documented in the official OpenCode permissions/config docs:
 *   - `external_directory` gates any tool touching paths outside the working
 *     directory the runner started in (the fixture).
 *   - `webfetch` / `websearch` are the generic network tools.
 *   - `read` matches file paths; `*.env` reads default to "ask" (auto-approved
 *     under --auto) - they are denied here outright.
 *   - `bash` matches parsed command prefixes; `curl`/`wget` fetch arbitrary
 *     remote content into the session.
 */
export function permissionRules() {
  return {
    external_directory: 'deny',
    webfetch: 'deny',
    websearch: 'deny',
    read: { '*': 'allow', '*.env': 'deny', '*.env.*': 'deny', '*.env.example': 'allow' },
    bash: { 'curl *': 'deny', 'wget *': 'deny' },
  };
}

/**
 * Write the least-privilege permission config as an OpenCode config file.
 *
 * @param {string} destDir directory to write into (the run's evidence dir)
 * @param {string} [fileName] output file name
 * @returns {string} absolute path of the written file
 */
export function writePermissionConfig(destDir, fileName = 'opencode.permissions.json') {
  const config = {
    $schema: 'https://opencode.ai/config.json',
    permission: permissionRules(),
  };
  const target = path.join(destDir, fileName);
  fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return target;
}

/** Where the runner tells operators to read the isolation model. */
export const ISOLATION_DOC = 'tests/harness/README.md';
