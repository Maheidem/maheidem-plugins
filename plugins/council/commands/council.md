---
description: "Query multiple AI CLI tools in parallel and synthesize their responses"
argument-hint: "[--thorough] [--tools=tool1,tool2] <question>"
---

# Council Command

Consult your AI council - query multiple AI CLI tools using parallel Task agents, then synthesize the best answer.

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

## Step 4: Parallel Execution via Task Agents

**CRITICAL**: Use Claude's Task tool to spawn parallel agents - one per CLI tool.

Launch all enabled tools **in a single message with multiple Task calls**:

```
For each enabled tool (codex, gemini, opencode, agent), spawn a Task agent:

Task(
  subagent_type: "general-purpose",
  description: "Query {tool} CLI",
  prompt: "Execute this command and return ONLY the output:

    bash ${CLAUDE_PLUGIN_ROOT}/scripts/invoke-cli.sh {tool} \"{QUESTION}\" \".\" 300

    Return the complete output. Do not summarize or interpret."
)
```

**Important execution notes:**
- Launch ALL Task agents in a SINGLE message (parallel execution)
- Default timeout: **300 seconds** (5 minutes) per tool
- Each agent runs independently and returns its result
- Collect all responses before proceeding to synthesis

## Step 5: Synthesize Responses (Quick Mode)

Once all Task agents return, analyze their responses:

1. **Find Agreement**: What do all tools agree on?
2. **Find Differences**: Where do they diverge?
3. **Evaluate Quality**: Which response is most helpful/accurate?
4. **Create Synthesis**: Combine the best insights

**Synthesis Guidelines:**
- Lead with the consensus answer
- Note unique valuable points from each tool
- Call out disagreements with Claude's assessment
- Keep synthesis concise but comprehensive

## Step 6: Thorough Mode (Multi-Round Debate)

If `--thorough` mode:

### Round 1: Initial Responses
Same as quick mode - collect initial responses from all tools via Task agents.

### Round 2+: Cross-Examination
For up to `max_rounds` (default 3):

1. Summarize the disagreements/questions from previous round
2. Spawn new Task agents asking each tool: "Given that [other tool] said X, what's your response?"
3. Collect new responses
4. Check for convergence

**Convergence Detection:**
- If all tools now agree on key points → stop
- If responses repeat without new information → stop
- If max_rounds reached → stop

### Final Synthesis
Create a more detailed synthesis including:
- Evolution of the debate
- Final consensus (if reached)
- Remaining disagreements
- Claude's verdict

## Step 7: Display Results

Output format:

```
┌───────────────────────────────────────────────────────────┐
│  🤝 COUNCIL SYNTHESIS                                     │
│  Mode: quick | Tools: codex, gemini | Time: 8.2s          │
└───────────────────────────────────────────────────────────┘

[Claude's synthesized answer]

**Agreement**: Both tools recommend X for Y
**Codex emphasizes**: Z
**Gemini emphasizes**: W
**My assessment**: Based on the responses, I recommend...

<details>
<summary>📜 Raw Response: Codex (2.4s)</summary>

[Full codex output here]

</details>

<details>
<summary>📜 Raw Response: Gemini (3.1s)</summary>

[Full gemini output here]

</details>
```

If `display.show_raw_responses` is false, omit the details sections.

## Step 8: Offer Follow-Up

After displaying results:

```
💡 Follow-up options:
- Ask a clarifying question: /council "What about X?"
- Deep dive with debate: /council --thorough "More details on..."
- See status: /council:status
```

## Error Handling

### Task Agent Failures
If a Task agent fails or times out:
- Note the failure in the synthesis
- Continue with successful responses
- Suggest running `/council:status --test` to diagnose

### Partial Failure
Continue with successful tools, note failures:
```
⚠️ Note: opencode agent did not respond (timeout after 300s)
Proceeding with: codex, gemini
```

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
