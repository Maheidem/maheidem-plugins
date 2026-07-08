---
description: Check whether the local pi CLI is ready and report its configured provider/model
allowed-tools: Bash, Read, AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/pi-companion.mjs" setup --json
```

Report back:
- Whether `pi` is installed and its version.
- Whether `~/.pi/agent/settings.json` was found, and if so its `defaultProvider` and `defaultModel`.
- The exact error message if `pi` was not found on PATH.

If `pi` is missing (the result's `piInstalled` is `false` / `ok` is `false` with an ENOENT-style error):
- Use `AskUserQuestion` exactly once to ask whether to install pi now.
- Options:
  - `Install pi (Recommended)`
  - `Skip for now`
- Do NOT run the install yourself without the user confirming via `AskUserQuestion` — this is a global package install and a real side effect.
- If the user chooses to install, run:

```bash
npm install -g @earendil-works/pi-coding-agent
```

- Then rerun the setup check:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/pi-companion.mjs" setup --json
```

and report the final result.

If `pi` is already installed, do not ask about installation — just report the readiness summary.
