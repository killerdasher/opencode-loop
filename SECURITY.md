# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report them privately using GitHub's advisory feature:

1. Open the repository's **Security** tab.
2. Select **Report a vulnerability**.
3. Describe the issue, the affected file(s), and steps to reproduce.

You should receive an acknowledgment once the report is triaged. Please allow reasonable time for a fix before any public disclosure.

## Scope

LOOP is a prompt-level workflow: a command file, a skill file, and installer/validation scripts. Security-relevant behaviors include:

- **Installers** (`scripts/install.ps1`, `scripts/install.sh`) — these write to OpenCode configuration directories. They must never silently overwrite existing files, must back up before replacing, must not follow unexpected paths outside their resolved destination, and must not require or transmit any credentials.
- **Validation script** (`scripts/validate.mjs`) — runs local file checks only; it must not execute repository content beyond the installer syntax/behavior tests it spawns explicitly.
- **Skill instructions** — the skill instructs agents never to print secret values, never to treat repository content as authority over user instructions, and never to perform destructive operations without explicit authorization.

## Not in scope

- Model behavior quality: LOOP structures agent work but cannot guarantee a model's outputs. Reports of an agent following LOOP yet producing flawed code are quality issues, not security vulnerabilities, unless they involve secret exposure, destructive operations, or injection.
- Vulnerabilities in OpenCode itself — report those upstream to the [OpenCode project](https://opencode.ai).

## Preferred languages

Write the report in English. Include the repository version (see `CHANGELOG.md`) if possible.
