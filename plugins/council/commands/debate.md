---
description: "Query multiple AI CLI tools in parallel and synthesize their responses"
argument-hint: "[--thorough] [--tools=tool1,tool2] [--bash-tools=gh,git] [--no-bash-tools] <question>"
---

# Council Debate Command

Consult your AI council - query multiple AI CLI tools using the council-orchestrator agent, then synthesize the best answer.

## Step 0: Check Initialization

```bash
CONFIG_FILE="$HOME/.claude/council.local.md"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "not_initialized"
else
    echo "initialized"
fi
```

**If not initialized**: Redirect to `/council:setup` first.

## Step 1: Parse Arguments

Parse the command arguments:
- `--thorough`: Enable multi-round debate mode
- `--tools=codex,gemini`: Override which AI tools to query
- `--bash-tools=gh,git`: Enable specific bash tools for CLI agents (from allowlist)
- `--no-bash-tools`: Explicitly disable all bash tool access for CLI agents
- Everything else: The question to ask

**Bash Tools Notes:**
- Only tools listed in `bash_tools.allowlist` config can be enabled
- Without `--bash-tools` or `--no-bash-tools`, no bash tools are enabled (safe default)
- CLI agents can use enabled tools to gather real data for their analysis

**Examples:**
- `/council What's the best testing framework for Node.js?`
- `/council --thorough Should I use TypeScript or JavaScript?`
- `/council --tools=codex,gemini How do I optimize this query?`
- `/council --bash-tools=gh "List the open PRs in this repo and suggest priorities"`
- `/council --bash-tools=gh,git "Analyze our git history and suggest workflow improvements"`
- `/council --no-bash-tools "What's the best architecture for this?"` (explicit no tools)

## Step 2: Load Configuration

Read `~/.claude/council.local.md` and extract:
- `enabled_tools` with status and command templates
- `default_mode` (unless `--thorough` overrides)
- `display` preferences
- `bash_tools.allowlist` for validating --bash-tools argument
- `bash_tools.blocked_commands` for safety enforcement
- `bash_tools.default_timeout` for bash operations

If `--tools` specified, filter to only those AI tools.

### Validate Bash Tools

If `--bash-tools` specified:
1. Parse comma-separated list of requested bash tools
2. Check each against `bash_tools.allowlist` in config
3. Reject any tool not in the allowlist with error message
4. Reject any tool in `bash_tools.blocked_commands` (safety net)
5. Set `ENABLED_BASH_TOOLS` to validated comma-separated list

If `--no-bash-tools` specified:
- Set `ENABLED_BASH_TOOLS` to empty string

If neither specified:
- Set `ENABLED_BASH_TOOLS` to empty string (safe default)

## Step 3: Validate Tools

Check that requested tools are:
1. Enabled in config
2. Actually installed (path exists)

If a tool is missing, warn the user and continue with remaining tools.

**Minimum requirement**: At least 2 tools must be available for a council.

## Step 4: Execute via Council Orchestrator

**DELEGATE TO ORCHESTRATOR AGENT**: Use the Task tool to spawn the council-orchestrator:

```
Task(
  subagent_type: "council-orchestrator",
  description: "Execute council debate",
  prompt: "Execute council debate:
    QUESTION: {parsed question}
    MODE: {quick|thorough based on args or config default}
    ENABLED_TOOLS: {comma-separated list of validated AI tools}
    ENABLED_BASH_TOOLS: {comma-separated list of validated bash tools, or empty}
    BASH_TIMEOUT: {bash_tools.default_timeout from config, default 30}
    PLUGIN_ROOT: ${CLAUDE_PLUGIN_ROOT}
    CONFIG_PATH: ~/.claude/council.local.md"
)
```

The orchestrator will:
1. Launch parallel Task agents for each CLI tool
2. Pass enabled bash tools to invoke-cli.sh for each agent
3. Maintain context across all debate rounds
4. Check for convergence (thorough mode)
5. Return the synthesized result with consensus analysis

## Step 5: Display Results

The orchestrator returns the formatted synthesis. Display it to the user.

## Step 6: Offer Follow-Up

After displaying results:

```
💡 Follow-up options:
- Ask a clarifying question: /council "What about X?"
- Deep dive with debate: /council --thorough "More details on..."
- See status: /council:status
```

## Error Handling

### Not Initialized
```
⚠️ Council not configured yet!

Run `/council:setup` to:
1. Detect available AI CLI tools
2. Select which tools to enable
3. Test connectivity
```

### Insufficient Tools
```
⚠️ Need at least 2 tools for a council debate.

Currently available: {tool_count} tool(s)
Run `/council:setup` to configure more tools.
```

### Task Agent Failures
The orchestrator handles individual tool failures gracefully:
- Notes failures in the synthesis
- Continues with successful responses
- Suggests `/council:status --test` to diagnose

### Injection Detected
If the `invoke-cli.sh` script detects forbidden flags:
```
🚨 Security Warning

Potential injection detected in prompt.
The query contained forbidden flags that could bypass safety.

Council query aborted for security.
```

### Bash Tool Not in Allowlist
```
⚠️ Bash Tool Not Allowed

The requested tool "{tool}" is not in the allowlist.

Allowed bash tools: gh, git, az, npm, docker, kubectl, yarn, pnpm, cargo, pip

Run `/council:status` to see the current allowlist.
Edit ~/.claude/council.local.md to modify the allowlist.
```

### Blocked Command Attempted
```
🚨 Blocked Command

The command "{command}" is blocked for security.

Blocked commands include: rm, sudo, chmod, chown, mkfs, dd, etc.

These commands cannot be enabled for CLI agents.
```

## Configuration Reference

Default timeouts in `~/.claude/council.local.md`:
- Per-tool timeout: **300 seconds** (5 minutes)
- Thorough mode max rounds: 3

## Safety Reference

See `@skills/council/references/safety-enforcement.md` for complete safety documentation.
