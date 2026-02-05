---
description: "Query multiple AI CLI tools in parallel and synthesize their responses"
argument-hint: "[--thorough] [--tools=tool1,tool2] <question>"
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
- `--tools=codex,gemini`: Override which tools to query
- Everything else: The question to ask

**Examples:**
- `/council What's the best testing framework for Node.js?`
- `/council --thorough Should I use TypeScript or JavaScript?`
- `/council --tools=codex,gemini How do I optimize this query?`

## Step 2: Load Configuration

Read `~/.claude/council.local.md` and extract:
- `enabled_tools` with status and command templates
- `default_mode` (unless `--thorough` overrides)
- `display` preferences

If `--tools` specified, filter to only those tools.

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
    ENABLED_TOOLS: {comma-separated list of validated tools}
    PLUGIN_ROOT: ${CLAUDE_PLUGIN_ROOT}
    CONFIG_PATH: ~/.claude/council.local.md"
)
```

The orchestrator will:
1. Launch parallel Task agents for each CLI tool
2. Maintain context across all debate rounds
3. Check for convergence (thorough mode)
4. Return the synthesized result with consensus analysis

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

## Configuration Reference

Default timeouts in `~/.claude/council.local.md`:
- Per-tool timeout: **300 seconds** (5 minutes)
- Thorough mode max rounds: 3

## Safety Reference

See `@skills/council/references/safety-enforcement.md` for complete safety documentation.
