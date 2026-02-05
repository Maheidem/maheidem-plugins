---
description: "Configure Council plugin - detect AI CLI tools and select which to use"
argument-hint: "[--force]"
---

# Council Setup Command

First-run configuration that detects available AI CLI tools and lets you choose which to enable.

## Step 1: Check Existing Configuration

```bash
CONFIG_FILE="$HOME/.claude/council.local.md"
if [ -f "$CONFIG_FILE" ]; then
    echo "existing"
else
    echo "new"
fi
```

**If config exists and `--force` not provided**: Show current config and offer to reconfigure.

## Step 2: Detect Available Tools

Run the detection script:

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
"$SCRIPT_DIR/detect-cli-tools.sh"
```

Parse the JSON output to identify:
- **Found + Supported**: Can be enabled (has read-only mode)
- **Found + Not Supported**: Installed but can't be used safely
- **Not Found**: Not installed

## Step 3: Present Discovery Results

Show a summary table to the user:

```
🔍 AI CLI Tool Discovery
┌──────────┬─────────┬───────────┬────────────────────────────────────┐
│ Tool     │ Found   │ Supported │ Notes                              │
├──────────┼─────────┼───────────┼────────────────────────────────────┤
│ codex    │ ✅      │ ✅        │ OpenAI Codex CLI                   │
│ gemini   │ ✅      │ ✅        │ Google Gemini CLI                  │
│ opencode │ ❌      │ -         │ Not installed                      │
│ cursor   │ ✅      │ ❌        │ No non-interactive mode            │
│ aider    │ ❌      │ -         │ Not installed                      │
└──────────┴─────────┴───────────┴────────────────────────────────────┘
```

## Step 4: User Selection

Use `AskUserQuestion` to let user select which tools to enable.

**Only offer supported tools.** Show recommendations:

```
Select AI tools to include in your council:

Options:
1. codex (Recommended) - OpenAI Codex with sandbox mode
2. gemini (Recommended) - Google Gemini prompt mode
3. aider - AI pair programmer

You can select multiple tools. More tools = more diverse opinions.
```

Allow multi-select: `multiSelect: true`

## Step 5: Test Selected Tools

For each selected tool, run a quick test:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/invoke-cli.sh" "$TOOL" "Say hello in one word" "." "30"
```

Report success/failure for each tool.

## Step 6: Write Configuration

Create the config file with selected tools enabled:

```bash
mkdir -p "$HOME/.claude"
cat > "$HOME/.claude/council.local.md" << 'TEMPLATE_EOF'
---
initialized: true

enabled_tools:
  codex:
    enabled: ${CODEX_ENABLED}
    path: "${CODEX_PATH}"
    command_template: "codex exec --sandbox read-only -C \"${CWD}\" \"${PROMPT}\""
    timeout: 120
  gemini:
    enabled: ${GEMINI_ENABLED}
    path: "${GEMINI_PATH}"
    command_template: "gemini -p \"${PROMPT}\" 2>&1"
    timeout: 120
  opencode:
    enabled: ${OPENCODE_ENABLED}
    path: "${OPENCODE_PATH}"
    command_template: "opencode run --format json \"${PROMPT}\" 2>&1"
    timeout: 120
  aider:
    enabled: ${AIDER_ENABLED}
    path: "${AIDER_PATH}"
    command_template: "aider --no-auto-commits --yes --message \"${PROMPT}\" 2>&1"
    timeout: 120

default_mode: quick

thorough_settings:
  max_rounds: 3
  convergence_threshold: 0.8

display:
  show_raw_responses: true
  show_timing: true
  show_agreement_analysis: true
---

# Council Plugin Configuration

Your council is configured with the tools selected during setup.
Run `/council:status` to view current settings.
Run `/council:setup --force` to reconfigure.
TEMPLATE_EOF
```

## Step 7: Confirm Setup Complete

Display success message:

```
✅ Council Setup Complete!

Enabled tools: codex, gemini
Default mode: quick

Try it out:
  /council "What's the best way to structure a React component?"

For more options:
  /council --thorough "Complex question here"
  /council:status
```

## Safety Note

⚠️ All tools are configured with **READ-ONLY** permissions:
- `codex` uses `--sandbox read-only`
- `gemini` uses `-p` (prompt-only mode)
- `opencode` uses `--format json` (output-only)
- `aider` uses `--no-auto-commits`

The council will **never** modify files.
