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

    bash ${CLAUDE_PLUGIN_ROOT}/scripts/invoke-cli.sh {tool} \"{QUESTION}\" \".\" 300 \"{MODE}\" \"{ROUND}\" \"{CONTEXT}\"

    Return the complete output. Do not summarize or interpret."
)
```

**Important execution notes:**
- Launch ALL Task agents in a SINGLE message (parallel execution)
- Default timeout: **300 seconds** (5 minutes) per tool
- Each agent runs independently and returns its result
- Collect all responses before proceeding to synthesis

## Step 5: Synthesize Responses with Consensus Scoring

Once all Task agents return, perform **structured consensus analysis**:

### Step 5.1: Extract Key Claims
From each response, identify the **main recommendations/claims** (typically 3-7 per response).

### Step 5.2: Score Consensus
Compare claims across all tools and categorize:

| Category | Criteria | Display |
|----------|----------|---------|
| **🟢 Strong Consensus** | 3-4 out of 4 tools agree | "✅ All/Most agree: ..." |
| **🟡 Partial Agreement** | 2 out of 4 tools agree | "⚠️ Split opinion: ..." |
| **🔵 Unique Insight** | Only 1 tool mentions | "💡 {Tool} uniquely suggests: ..." |
| **🔴 Contradiction** | Tools directly disagree | "❌ Disagreement: {Tool A} says X, {Tool B} says Y" |

### Step 5.3: Generate Structured Synthesis

**REQUIRED OUTPUT FORMAT:**

```
## 🟢 Strong Consensus (All/Most Agree)
1. [First point all tools agree on]
2. [Second point...]

## 🟡 Partial Agreement (2/4 Agree)
- [Point with split opinion] - Supported by: {tools}

## 💡 Unique Insights
- **Codex**: [Unique valuable point]
- **Gemini**: [Unique valuable point]
- **OpenCode**: [Unique valuable point]
- **Agent**: [Unique valuable point]

## 🎯 My Assessment
Based on the council's input, I recommend:
[Claude's synthesis combining the best insights]
```

### Step 5.4: Quality Indicators
Include in the synthesis header:
- **Consensus strength**: "High" (3+ agree on most points), "Medium" (mixed), "Low" (mostly disagreement)
- **Response quality**: Note if any tool gave low-quality/off-topic response

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
│  Mode: quick | Tools: codex, gemini, opencode, agent      │
│  Consensus: High | Time: 12.4s                            │
└───────────────────────────────────────────────────────────┘

## 🟢 Strong Consensus (All/Most Agree)
1. [First point all tools agree on]
2. [Second consensus point]

## 🟡 Partial Agreement (2/4 Agree)
- [Split opinion point] - Supported by: codex, gemini

## 💡 Unique Insights
- **Codex**: [Unique point from codex]
- **Gemini**: [Unique point from gemini]

## 🎯 My Assessment
Based on the council's input, I recommend:
[Claude's synthesis]

---

<details>
<summary>📜 Raw Response: Codex (2.4s)</summary>

[Full codex output here]

</details>

<details>
<summary>📜 Raw Response: Gemini (5.1s)</summary>

[Full gemini output here]

</details>

<details>
<summary>📜 Raw Response: OpenCode (8.2s)</summary>

[Full opencode output here]

</details>

<details>
<summary>📜 Raw Response: Agent (4.7s)</summary>

[Full agent output here]

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
