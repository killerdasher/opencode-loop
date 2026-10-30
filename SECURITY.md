# Security policy

LOOP is a prompt-level workflow for OpenCode. It ships Markdown instructions,
installer scripts, and a validation script — no runtime service and no daemon.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| older | Not supported |

## Reporting a vulnerability

Please do not open a public issue for a security problem.

1. Preferred: use GitHub's private security advisory reporting on the
   `opencode-loop` repository (Security tab → Report a vulnerability).
2. Alternative: open a public issue without exploit details or reproduction
   steps, state that you have a security report to share privately, and a
   maintainer will follow up.

Please include: a description of the issue, the affected files (command,
skill, installer, validator), steps to reproduce, and your assessment of
impact. Do not paste secrets, tokens, or private user data into your report.

## Scope

In scope:

- Prompt-injection weaknesses: places where repository or file content could
  make LOOP violate user instructions or the safety rules.
- Installer safety: silent overwrites, deletion of user files, unsafe
  destination handling, backup corruption.
- Secret exposure: anything that could write credentials into logs,
  transcripts, or committed files.
- The validator: checks that can be bypassed, or selftest logic that passes
  when it should fail.

Out of scope for this repository (report to the relevant project instead):

- Vulnerabilities in OpenCode itself.
- Model provider security.
- General weaknesses in projects that LOOP is reviewing on a user's behalf —
  report those directly to that project's owner.

## Responsible disclosure

We will acknowledge reports as quickly as possible (best effort, within a
week), work on a fix, and credit reporters who ask for it. Coordinated
disclosure is the default posture.
