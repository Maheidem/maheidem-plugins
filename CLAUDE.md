# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is `maheidem-plugins`, a Claude Code plugin **marketplace**: a collection of independent plugins (agents, commands, hooks, skills) distributed via `.claude-plugin/marketplace.json`. It is a separate git repo (remote `github.com/maheidem/maheidem-plugins`, branch `master`) nested inside the parent `claude-code-management` repo. There is no build step, package manager, or compiled artifact — plugins are markdown (frontmatter + prompt) and standalone scripts (Python/Bash/JS) that Claude Code loads directly.

## Repo structure

```
.claude-plugin/marketplace.json   # marketplace manifest — the source of truth for which plugins are published
plugins/<plugin-name>/
  .claude-plugin/plugin.json      # per-plugin manifest (name, version, description, author, keywords)
  agents/*.md                     # subagent definitions (YAML frontmatter + system prompt)
  commands/*.md                   # slash commands (invoked as /<plugin-name>:<command>)
  skills/<skill-name>/SKILL.md    # progressive-disclosure skill docs, loaded via the Skill tool
  hooks/hooks.json + *.py         # lifecycle hooks (PreToolUse, SessionStart, Stop, etc.)
  scripts/, lib/                  # deterministic helper scripts the agents/commands shell out to
  tests/                          # per-plugin test suites (bash-driven, no shared test framework)
```

**Registering a plugin requires two manifests to agree**: `.claude-plugin/marketplace.json` (top-level list with `name`/`version`/`source`/`category`) and `plugins/<name>/.claude-plugin/plugin.json` (per-plugin metadata). Bumping a plugin's version means editing both files — check `git log` for prior bump commits (e.g. `pi-delegate 0.2.0 -> 0.3.0`) for the expected commit-message convention: `<plugin> <old> -> <new>: <what changed>`.

One plugin (`handoff`) breaks the convention: its manifest is `plugins/handoff/plugin.json` directly, not under a `.claude-plugin/` subdirectory. Verify which layout an existing plugin uses before assuming.

The root `README.md` is stale — it advertises `ralph-loop-mac`/`ralph-loop-windows` plugins that no longer exist in `plugins/` or `marketplace.json`. Don't treat it as authoritative for what's currently published; treat `marketplace.json` as ground truth instead.

## Publishing a new plugin version

See `.claude/rules/publish-plugin.md` for the exact, ordered steps (version bump script, commit convention, push, then `marketplace update` + `plugin update`). Follow it literally whenever the user asks to publish, release, or ship a new version of a plugin — do not improvise the sequence.

@.claude/rules/publish-plugin.md

## Working on a plugin

- Never edit a plugin's cached/installed copy under `~/.claude/` — always edit here and let it sync. (See the parent repo's `CLAUDE.md` and `.claude/rules/plugin-workflows.md` for the sync/deploy model and the list of currently *enabled* plugins, which is a subset of what's published here.)
- After changing a plugin, sanity-check it loads: `ls plugins/<plugin-name>/` and confirm the manifest(s) parse (`python3 -m json.tool plugins/<plugin-name>/.claude-plugin/plugin.json`).
- Most plugins have no automated tests. Where they exist, run them directly — there's no unified test command:
  - `bash plugins/deep-research/tests/run_all.sh` (orchestrates that plugin's suites, non-zero exit on failure)
- `scripts/version_bumper.py` handles semver bumps for any plugin: `python3 scripts/version_bumper.py bump <plugin_path> [--type patch|minor|major]`.

## Notable non-obvious architecture

- **`orchestrator-mode`** and **`pi-delegate`** compose one-directionally: `orchestrator-mode`'s `pi` state restricts the main agent's `Task`/`Agent` tool to only `pi-delegate`'s subagent, forcing all delegated code changes through a local `pi` CLI subprocess. `pi-delegate` itself works standalone without `orchestrator-mode`. State for `orchestrator-mode` lives in a root `.orchestrator-mode.state` file (gitignored, off by default, per-project opt-in).
- Several plugins wrap external processes/services rather than pure prompts: `obscura-browser` bundles a Docker build + supergateway MCP gateway, `pi-delegate`'s `scripts/pi-companion.mjs` is a subprocess wrapper around the `pi` CLI with a completion-marker success contract (NDJSON stream parsing is only a fallback).
- Untracked `run_*.txt` files and the `latest` symlink at the repo root are session/log artifacts, not source — don't treat them as part of the codebase.
