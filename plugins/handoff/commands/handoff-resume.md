---
description: "Resume from the most recent handoff document in .scratchpad/handoffs/. Use after /clear to reload context. Optional args: N (show last N for selection) or <agent-name> (filter by agent)."
argument-hint: "[N | <agent-name>]"
allowed-tools: Read, Bash, Glob, AskUserQuestion
---

# Handoff Resume

Reload context from a previously written handoff so the session can continue after `/clear`.

## Argument: `$ARGUMENTS`

Interpret `$ARGUMENTS` as follows (trimmed):

1. **Empty** → load the most recent handoff file (default).
2. **A positive integer N** → list the last N handoffs (newest first) and use `AskUserQuestion` to let the user pick one.
3. **A non-numeric string** → treat as an agent-name filter; load the most recent handoff whose filename starts with that string. If none match, fall back to listing the last 5 from any agent.

## Steps

1. **Locate the handoffs directory**:
   - Primary: `./.scratchpad/handoffs/` (current working directory).
   - If missing, tell the user no handoffs exist for this project and stop.

2. **List handoffs** sorted by modification time, newest first. Use Bash:
   ```bash
   ls -t .scratchpad/handoffs/*.md 2>/dev/null | head -20
   ```
   Each filename follows `{agent-name}-YYYY-MM-DD-HH-mm-SS-{SUCCESS|FAIL}.md`.

3. **Select the target file** per the argument rules above. For selection lists, present labels like `mcp-manager-agent · 2026-05-19 14:22 · SUCCESS` so the user can pick at a glance.

4. **Read** the selected handoff with the `Read` tool.

5. **Summarize** in 3–5 lines:
   - Agent + timestamp + status
   - Mission (one sentence from `## Mission Summary`)
   - Last concrete state (files touched / where things stood)
   - Top recommendation from `## Recommended Next Steps`

6. **Ask what to do next** using `AskUserQuestion` with these options:
   - **Continue the work** — pick up from "Recommended Next Steps".
   - **New direction** — user provides a different next step.
   - **Just briefed, no action** — stop here, wait for instructions.
   - **Archive this handoff** — move file to `.scratchpad/handoffs/archive/` (create dir if missing).

## Notes

- Do **not** auto-execute the recommended next steps without the user choosing "Continue".
- Use project-relative paths in the summary.
- If multiple handoffs share the same timestamp, prefer SUCCESS over FAIL.
- This command is read-only by default — only the "Archive" choice writes.
