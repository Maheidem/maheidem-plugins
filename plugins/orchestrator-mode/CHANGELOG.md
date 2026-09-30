# Changelog

Earlier versions have no changelog; see `git log -- plugins/orchestrator-mode`.

## 0.10.1 (2026-09-30)

### Added
- **allow / disallow wizard.** `/orchestrator-mode:mode allow <plain words>`
  maps the request to real tool names (tool list + `ToolSearch`), proposes
  read-only tools as recommended and marks side-effecting ones
  `⚠️ writes/sends`, and writes what you pick after a multi-select picker.
  A single tool name or `mcp__...` pattern still adds directly; a bare
  `allow` asks what you want. `disallow` in plain words picks from the
  existing project and user-wide entries.
- **User-wide target.** Saying *everywhere / globally / all projects* makes
  the wizard write `$CLAUDE_CONFIG_DIR/orchestrator-mode.json`. The
  enforcer's Write-only toggle exemption now covers that file too (main
  thread only; Edit, shell, MCP and subagents stay denied). After adding an
  entry user-wide, the wizard offers to drop the same entry from the project
  file.

### Fixed
- **`/orchestrator-mode:mode` was broken outside bypass-permissions mode.**
  Its `!python3 .../_state.py status` injection needs a Bash permission, and
  the command didn't grant one, so in the default permission mode it failed
  with "This command requires approval" and the command did nothing. The
  frontmatter now allows exactly `Bash(python3 *_state.py* status)`.

## 0.10.0 (2026-09-30)

Configurable main-thread allowlist, plus fixes from a security and design
audit of 0.9.4.

### Changed
- **Config is JSON**: `<project>/.orchestrator-mode.json` with `mode`,
  `allowed-models` and `main-allow`. The legacy `.orchestrator-mode.state`
  line is still read when no JSON sits in the same directory; `/mode` writes
  only JSON.
- **User-wide layer**: `$CLAUDE_CONFIG_DIR/orchestrator-mode.json`
  `main-allow` is added to every project's list.
- **Hard-coded MCP carve-outs removed**: discord, telegram,
  presales-toolkit and `waha-whatsapp` send_text are no longer allowed by the
  plugin. Put the ones you want in the user-wide file. The pi-delegate tools
  stay core.
- `/orchestrator-mode:mode` gains `allow <pattern>` and `disallow <pattern>`;
  `status` prints the effective allowlist (core + user-wide + project) from
  `python3 hooks/_state.py status`. `off` keeps `main-allow` and drops
  `allowed-models`.
- The reminder is generated from the enforcer's own tables and config. It no
  longer claims "all MCP tools are blocked", now mentions the memory write
  exemption, and drops the duplicated PI delegation contract. It is about
  740 chars, down from about 1,500 for PI.
- The enforcer is one mode table plus one dispatcher (294 lines, down from
  745). `pi` and `wf` tool sets derive from the same base, so `pi` now allows
  Artifact and ReportFindings like the other modes.

### Fixed (audit numbering)
1. `Monitor` runs a shell command and was allowlisted in every mode. Removed;
   Monitor commands are also scanned for config paths.
2. The config-file checks were case-sensitive on a case-insensitive
   filesystem. Any `.orchestrator-mode.*` name, any case, any directory (and
   through symlinks) is now protected, along with the user-wide file.
3. The Explore scout was documented as unable to write. It has Bash; the
   docs now say so (it stays allowed in `wf`).
4. The model allowlist now applies to Agent/Task/Workflow calls made by
   subagents, not only the main thread.
5. Forks ignore their `model` field; with an allowlist set they are denied.
6. `allowed-models` was never applied in `pi`. An explicit `pi_task` model is
   now checked.
7. Launching from a subdirectory with `CLAUDE_PROJECT_DIR` set skipped the
   config at the repo root. Lookup now always walks up.
8. Nested config files that shadow the root one can't be written by any agent.
9. A symlinked `.remember` or memory dir widened the write exemption. Any
   symlinked component now voids it.
10. A FIFO or huge `scriptPath` could hang the hook past its timeout. Only
    regular files under 1 MiB are read.
11. Crashes (`tool_input: null`, non-object payloads) exited 1, which Claude
    Code treats as "proceed". The gate now denies on any internal error.
12. Model matching was a substring match (`o` allowed `opus`) and a stray
    space dropped the whole legacy list. Matching is now exact, family token
    or boundary prefix.
13. The Workflow lint compared totals. It now checks each `agent()` call for a
    string-literal allowed model, ignoring comments and string contents, and
    denies named workflows it can't read.
14. `Artifact` delete and durable `CronCreate` are denied on the main thread.
    MCP matching is exact-or-trailing-`*` only.
15. See the enforcer refactor above.
16. README rewritten to match the code; skills-as-subagents and the
    permission-mode caveat on the toggle are documented as limitations.

### Tests
- 143 cases across `test_state.sh`, `test_enforce.sh` and `test_reminder.sh`,
  including a regression case for each audit item. Tests use one temp root
  that is removed on exit, and an isolated `CLAUDE_CONFIG_DIR`.
- Checked end to end with `claude -p --plugin-dir` (CLI 2.1.285, haiku) in
  a scratch project under `wf`: Bash, Monitor and a non-listed MCP tool
  denied; a `main-allow` MCP tool ran; reminder injected; `/mode status`,
  `/mode allow` and `/mode wf --allowed-models haiku` wrote and reported the
  right config; with the allowlist, an Explore agent without a model and
  one on `opus` were denied, and one on `haiku` ran Bash in the subagent.
